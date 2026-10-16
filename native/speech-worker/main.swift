// speech-worker: speech recognition with Apple's SpeechAnalyzer + SpeechTranscriber
// (macOS 26+, on-device; the language model is installed and updated by macOS).
// One of Spokemark's recognition engines, next to whisper-worker and parakeet-worker,
// with the same protocol as parakeet-worker.
//
// Usage: speech-worker [--locale en-US]          stream (default)
//        speech-worker --status | --install       asset state / install (JSON lines, then exit)
// stdin: frames with the shared 24-byte header (src/main/native/protocol.ts)
//   u32 magic 'LCAS' (0x5341434C) | u8 type | u8 version(1) | u16 reserved | u32 id | u32 len | u64 reserved
//   type 1 = audio: float32 LE, 16 kHz mono, contiguous
// stdout: one JSON object per line
//   {"type":"ready","loadMs":..}
//   {"type":"words","final":[[text,start,end],..],"volatile":[[text,start,end],..]}
//      seconds since the first sample; `final` words are new and never change,
//      `volatile` replaces the previous provisional tail
//   {"type":"status","supported":bool,"installed":bool} | {"type":"progress","fraction":x} | {"type":"installed"}
//   {"type":"error","fatal":bool,"message":".."}
// Exits when stdin closes.
import AVFoundation
import CoreMedia
import Foundation
import Speech

let MAGIC: UInt32 = 0x5341_434C
let SR = 16000.0

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

/// Reads audio frames on a thread of its own and hands them to `onAudio` (16 kHz mono float).
func readFrames(_ onAudio: @escaping ([Float]) -> Void, onEnd: @escaping () -> Void) {
    Thread.detachNewThread {
        while let h = readExact(24) {
            let magic = h.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: UInt32.self) }
            guard magic == MAGIC else { fail("bad magic") }
            let type = h[h.startIndex + 4]
            let len = Int(h.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 12, as: UInt32.self) })
            guard len <= 16 << 20 else { fail("payload too large") }
            guard let payload = len > 0 ? readExact(len) : Data() else { break }
            if type == 1, len >= 4 { onAudio(payload.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }) }
        }
        onEnd()
    }
}

@available(macOS 26, *)
func transcriber(_ locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults], attributeOptions: [.audioTimeRange])
}

/// Words of a result: timed runs as they are; untimed (volatile) text spread evenly over the result's range.
@available(macOS 26, *)
func words(_ r: SpeechTranscriber.Result) -> [[Any]] {
    var timed: [[Any]] = []
    for run in r.text.runs {
        let text = String(r.text[run.range].characters).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { continue }
        guard let tr = run.audioTimeRange else { timed.removeAll(); break }
        // a run can hold more than one word: split it and share its time
        let parts = text.split(separator: " ").map(String.init)
        let d = tr.duration.seconds / Double(max(parts.count, 1))
        for (i, p) in parts.enumerated() { timed.append([p, tr.start.seconds + d * Double(i), tr.start.seconds + d * Double(i + 1)]) }
    }
    if !timed.isEmpty { return timed }
    let parts = String(r.text.characters).split(separator: " ").map(String.init)
    let start = r.range.start.seconds, dur = max(r.range.duration.seconds, 0.01)
    let d = dur / Double(max(parts.count, 1))
    return parts.enumerated().map { [$0.element, start + d * Double($0.offset), start + d * Double($0.offset + 1)] }
}

@available(macOS 26, *)
func run(localeId: String, mode: String) async {
    guard SpeechTranscriber.isAvailable else { fail("SpeechTranscriber is not available on this Mac") }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else { fail("unsupported locale \(localeId)") }
    let module = transcriber(locale)
    let status = await AssetInventory.status(forModules: [module])
    if mode == "status" {
        emit(["type": "status", "supported": status != .unsupported, "installed": status == .installed, "locale": locale.identifier])
        exit(0)
    }
    if mode == "install" || status != .installed {
        if mode != "install" { fail("the speech model is not installed (run --install)") }
        do {
            if let req = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                let p = req.progress
                let obs = p.observe(\.fractionCompleted) { p, _ in emit(["type": "progress", "fraction": p.fractionCompleted]) }
                try await req.downloadAndInstall()
                obs.invalidate()
            }
            emit(["type": "installed"])
            exit(0)
        } catch {
            fail("install failed: \(error.localizedDescription)")
        }
    }

    let t0 = Date()
    let analyzer = SpeechAnalyzer(modules: [module], options: .init(priority: .userInitiated, modelRetention: .processLifetime))
    let inFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: SR, channels: 1, interleaved: false)!
    let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module], considering: inFormat) ?? inFormat
    let converter = format == inFormat ? nil : AVAudioConverter(from: inFormat, to: format)
    do { try await analyzer.prepareToAnalyze(in: format) } catch { fail("prepare failed: \(error.localizedDescription)") }
    let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()

    let results = Task {
        do {
            for try await r in module.results {
                let w = words(r)
                if r.isFinal { emit(["type": "words", "final": w, "volatile": []]) }
                else { emit(["type": "words", "final": [], "volatile": w]) }
            }
        } catch {
            emit(["type": "error", "fatal": false, "message": "results: \(error.localizedDescription)"])
        }
    }
    do { try await analyzer.start(inputSequence: stream) } catch { fail("start failed: \(error.localizedDescription)") }
    emit(["type": "ready", "loadMs": Int(Date().timeIntervalSince(t0) * 1000), "format": "\(Int(format.sampleRate)) Hz"])

    var sent: Int64 = 0
    let done = AsyncStream<Void>.makeStream()
    readFrames({ samples in
        guard let buf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(samples.count)) else { return }
        buf.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        let start = CMTime(value: sent, timescale: CMTimeScale(SR))
        sent += Int64(samples.count)
        var out: AVAudioPCMBuffer = buf
        if let converter {
            let cap = AVAudioFrameCount(Double(samples.count) * format.sampleRate / SR + 32)
            guard let o = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return }
            var given = false
            var err: NSError?
            converter.convert(to: o, error: &err) { _, status in
                if given { status.pointee = .noDataNow; return nil }
                given = true; status.pointee = .haveData; return buf
            }
            out = o
        }
        input.yield(AnalyzerInput(buffer: out, bufferStartTime: start))
    }, onEnd: { input.finish(); done.continuation.finish() })
    for await _ in done.stream {}
    try? await analyzer.finalizeAndFinishThroughEndOfInput()
    _ = await results.result
    exit(0)
}

@main struct SpeechWorker {
    static func main() async {
        var localeId = "en-US", mode = "stream"
        var it = CommandLine.arguments.dropFirst().makeIterator()
        while let a = it.next() {
            if a == "--locale", let v = it.next() { localeId = v }
            if a == "--status" { mode = "status" }
            if a == "--install" { mode = "install" }
        }
        if #available(macOS 26, *) { await run(localeId: localeId, mode: mode) }
        else { fail("needs macOS 26") }
    }
}
