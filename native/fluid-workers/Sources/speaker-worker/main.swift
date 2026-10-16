// speaker-worker: streaming speaker diarization with NVIDIA Nemotron 3 Diarization
// (CoreML, via FluidAudio), the `low` preset: 1.04 s of look-ahead, 8 speaker slots
// numbered by order of arrival. It says *who is speaking when*; it does not
// transcribe and does not separate voices. Nothing is stored: the speaker slots
// live only in memory for this process (one captioning session).
//
// stdin: frames with the shared 24-byte header (see src/main/native/protocol.ts)
//   u32 magic 'LCSP' (0x5053434C) | u8 type | u8 version(1) | u16 reserved
//   u32 id | u32 payloadLength | u64 reserved
//   type 1 = audio: float32 LE, 16 kHz mono, contiguous with the previous frame
// stdout: one JSON object per line
//   {"type":"ready","loadMs":..,"latencyMs":1040,"frameMs":10}
//   {"type":"spk","from":F,"runs":[[speaker,frames,overlap],...]}
//      F: index of the first 10 ms frame since the stream start; speaker -1 = nobody;
//      overlap 1 = two or more speakers active (the speaker is the strongest one)
//   {"type":"error","fatal":true,"message":".."}
// Exits when stdin closes.
import FluidAudio
import Foundation

let MAGIC: UInt32 = 0x5053_434C
let T_AUDIO: UInt8 = 1
let ACTIVE: Float = 0.5  // speaker activity threshold (FluidAudio's segment default)

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
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    if a == "--model-dir" { modelDir = args.next() }
}
guard let modelDir else {
    FileHandle.standardError.write(Data("usage: speaker-worker --model-dir DIR\n".utf8))
    exit(2)
}

let config = Nemotron3Config.low
let t0 = Date()
let diarizer: Nemotron3Diarizer
do {
    diarizer = Nemotron3Diarizer(config: config, models: try await Nemotron3Models.load(config: config, directory: URL(fileURLWithPath: modelDir)))
} catch {
    fail("could not load the speaker model: \(error.localizedDescription)")
}
emit(["type": "ready", "loadMs": Int(Date().timeIntervalSince(t0) * 1000), "latencyMs": Int(config.latencySeconds * 1000), "frameMs": 10])

var frame = 0  // next 10 ms output frame
let n = config.numSpeakers

/// Collapse a chunk's per-frame probabilities into runs of (speaker, length, overlap).
func runs(_ r: Nemotron3ChunkResult) -> [[Int]] {
    var out: [[Int]] = []
    for f in 0..<r.frameCount {
        var best = -1
        var bestP: Float = ACTIVE
        var active = 0
        for s in 0..<n {
            let p = r.probabilities[f * n + s]
            if p > ACTIVE { active += 1 }
            if p > bestP { bestP = p; best = s }
        }
        let ov = active >= 2 ? 1 : 0
        if let last = out.last, last[0] == best, last[2] == ov { out[out.count - 1][1] += 1 }
        else { out.append([best, 1, ov]) }
    }
    return out
}

while let h = readExact(24) {
    let magic = h.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: UInt32.self) }
    guard magic == MAGIC else { fail("bad magic") }
    let type = h[h.startIndex + 4]
    let len = Int(h.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 12, as: UInt32.self) })
    guard len <= 16 << 20 else { fail("payload too large") }
    guard let payload = len > 0 ? readExact(len) : Data() else { break }
    guard type == T_AUDIO, len >= 4 else { continue }
    let samples = payload.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    diarizer.appendAudio(samples)
    do {
        for r in try diarizer.processBufferedAudio() where r.frameCount > 0 {
            emit(["type": "spk", "from": frame, "runs": runs(r)])
            frame += r.frameCount
        }
    } catch {
        fail("diarization failed: \(error.localizedDescription)")
    }
}
exit(0)
