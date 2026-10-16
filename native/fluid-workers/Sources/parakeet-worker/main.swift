// parakeet-worker: streaming speech recognition with NVIDIA Nemotron Speech Streaming 0.6B
// (a Parakeet FastConformer-RNNT, English, CoreML via FluidAudio, 560 ms chunks).
// One of Spokemark's recognition engines; same protocol as speech-worker.
// Tokens are final as soon as they are decoded (streaming RNNT, no revisions); only the
// last word can still grow ("Americ" -> "Americans"), so it is reported as volatile.
//
// Usage: parakeet-worker --model-dir DIR   (encoder/, decoder, joint, tokenizer.json, metadata.json)
// stdin: frames with the shared 24-byte header (src/main/native/protocol.ts)
//   u32 magic 'LCAS' (0x5341434C) | u8 type | u8 version(1) | u16 reserved | u32 id | u32 len | u64 reserved
//   type 1 = audio: float32 LE, 16 kHz mono, contiguous
// stdout: one JSON object per line
//   {"type":"ready","loadMs":..,"chunkMs":560}
//   {"type":"words","final":[[text,start,end],..],"volatile":[[text,start,end],..]}  (seconds)
//   {"type":"error","fatal":bool,"message":".."}
// Exits when stdin closes.
import AVFoundation
import FluidAudio
import Foundation

let MAGIC: UInt32 = 0x5341_434C

func emit(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
    FileHandle.standardOutput.write(d + Data([0x0A]))
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "fatal": true, "message": message])
    exit(1)
}

func readExact(_ n: Int) -> Data? {
    var out = Data(capacity: n)
    var buf = [UInt8](repeating: 0, count: min(max(n, 1), 1 << 16))
    while out.count < n {
        let r = buf.withUnsafeMutableBytes { read(STDIN_FILENO, $0.baseAddress, min($0.count, n - out.count)) }
        if r <= 0 { return nil }
        out.append(contentsOf: buf[0..<r])
    }
    return out
}

var modelDir: String?
var it = CommandLine.arguments.dropFirst().makeIterator()
while let a = it.next() { if a == "--model-dir" { modelDir = it.next() } }
guard let modelDir else {
    FileHandle.standardError.write(Data("usage: parakeet-worker --model-dir DIR\n".utf8))
    exit(2)
}

let t0 = Date()
let asr = StreamingNemotronAsrManager()
do { try await asr.loadModels(from: URL(fileURLWithPath: modelDir)) } catch { fail("could not load the speech model: \(error.localizedDescription)") }
emit(["type": "ready", "loadMs": Int(Date().timeIntervalSince(t0) * 1000), "chunkMs": await asr.config.chunkMs])

let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
let (frames, sink) = AsyncStream<[Float]>.makeStream()
Thread.detachNewThread {
    while let h = readExact(24) {
        let magic = h.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: UInt32.self) }
        guard magic == MAGIC else { fail("bad magic") }
        let type = h[h.startIndex + 4]
        let len = Int(h.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 12, as: UInt32.self) })
        guard len <= 16 << 20 else { fail("payload too large") }
        guard let payload = len > 0 ? readExact(len) : Data() else { break }
        if type == 1, len >= 4 { sink.yield(payload.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }) }
    }
    sink.finish()
}

/// A token that starts a new word. Punctuation never does, even with the marker ("sprint" "▁."):
/// it belongs to the word before it.
nonisolated func isBoundary(_ t: String) -> Bool {
    guard t.hasPrefix("▁") || t.hasPrefix(" ") else { return false }
    let core = t.trimmingCharacters(in: CharacterSet(charactersIn: "▁ "))
    return core.isEmpty || !core.unicodeScalars.allSatisfy { CharacterSet.punctuationCharacters.contains($0) }
}
/// Group tokens into words: [text, start, end].
nonisolated func group(_ toks: ArraySlice<TokenTiming>) -> [[Any]] {
    var out: [[Any]] = []
    for t in toks where !t.token.isEmpty && t.token != "<blank>" && t.token != "<pad>" {
        let piece = isBoundary(t.token) ? t.token.replacingOccurrences(of: "▁", with: " ") : t.token.replacingOccurrences(of: "▁", with: "")
        if isBoundary(t.token) || out.isEmpty {
            out.append([piece.trimmingCharacters(in: .whitespaces), max(0, t.startTime - leadS), max(0, t.endTime - leadS)])
        } else {
            out[out.count - 1][0] = (out[out.count - 1][0] as! String) + piece
            out[out.count - 1][2] = max(0, t.endTime - leadS)
        }
    }
    return out.filter { !($0[0] as! String).isEmpty }
}

let chunkSamples = await asr.config.chunkSamples
// The model drops a word spoken in the very first instant of a stream: start with 0.5 s of
// silence and shift every time back by it.
let LEAD = 8000
nonisolated(unsafe) let leadS = Double(LEAD) / 16000
do {
    let z = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(LEAD))!
    z.frameLength = AVAudioFrameCount(LEAD)
    memset(z.floatChannelData![0], 0, LEAD * 4)
    try await asr.appendAudio(z)
}
var fed = LEAD  // samples given to the model
var finalTok = 0  // tokens before this index belong to words already reported as final
var lastCount = 0
var idleChunks = 0  // model chunks in a row that decoded nothing new
for await samples in frames {
    guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { continue }
    buf.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
    let chunksBefore = fed / chunkSamples
    fed += samples.count
    do {
        try await asr.appendAudio(buf)
        try await asr.processBufferedAudio()
    } catch {
        fail("recognition failed: \(error.localizedDescription)")
    }
    let newChunks = fed / chunkSamples - chunksBefore
    if newChunks == 0 { continue }
    let toks = await asr.getTokenTimings()
    let grew = toks.count != lastCount
    lastCount = toks.count
    idleChunks = grew ? 0 : idleChunks + newChunks
    // The last word stays volatile: the next chunk may continue it ("check" + "ed"), and
    // punctuation arrives late, after the pause. It becomes final when another word starts
    // or after ~1.7 s (3 chunks) without anything new.
    var lastWordStart = toks.count
    if idleChunks < 3 {
        var i = toks.count - 1
        while i >= finalTok, !isBoundary(toks[i].token) { i -= 1 }
        lastWordStart = max(i, finalTok)
    }
    let fin = group(toks[finalTok..<lastWordStart])
    let vol = group(toks[lastWordStart..<toks.count])
    finalTok = lastWordStart
    if !fin.isEmpty || grew { emit(["type": "words", "final": fin, "volatile": vol]) }
}
exit(0)
