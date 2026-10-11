// audiotap — captures macOS system audio output via a CoreAudio Process Tap
// (AudioHardwareCreateProcessTap, macOS 14.2+) and streams it over stdout.
//
// stdout protocol (little endian), one frame = 24-byte header + payload:
//   u32 magic 'LCAP' (0x5041434C) | u8 type | u8 version(1) | u16 reserved
//   u32 seq | u32 payloadLength | u64 timestampNs (CLOCK_MONOTONIC_RAW, = Node hrtime)
// types: 1 = FORMAT (JSON), 2 = AUDIO (interleaved float32), 3 = STATUS (JSON)
// Human-readable logs go to stderr.
//
// Usage: audiotap [--exclude-pid PID]... [--wav PATH --seconds N]
//        audiotap --check-permission | --request-permission   (prints authorized|denied|unknown)

import AppKit
import AudioToolbox
import CoreAudio
import Darwin
import Foundation

// MARK: - Output

let MAGIC: UInt32 = 0x5041_434C
enum FrameType: UInt8 { case format = 1, audio = 2, status = 3 }

final class FrameWriter {
    private var seq: UInt32 = 0
    private let lock = NSLock()
    var enabled = true

    func write(_ type: FrameType, _ payload: UnsafeRawBufferPointer, ts: UInt64) {
        guard enabled else { return }
        lock.lock(); defer { lock.unlock() }
        var header = Data(capacity: 24)
        func put<T>(_ v: T) { withUnsafeBytes(of: v) { header.append(contentsOf: $0) } }
        put(MAGIC.littleEndian); put(type.rawValue); put(UInt8(1)); put(UInt16(0))
        put(seq.littleEndian); put(UInt32(payload.count).littleEndian); put(ts.littleEndian)
        seq &+= 1
        header.withUnsafeBytes { writeAll($0) }
        writeAll(payload)
    }

    func json(_ type: FrameType, _ obj: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        data.withUnsafeBytes { write(type, $0, ts: nowNs()) }
    }

    private func writeAll(_ buf: UnsafeRawBufferPointer) {
        guard var p = buf.baseAddress else { return }
        var left = buf.count
        while left > 0 {
            let n = Darwin.write(STDOUT_FILENO, p, left)
            if n < 0 {
                if errno == EINTR { continue }
                // Parent closed the pipe: nothing left to do.
                exit(0)
            }
            p += n; left -= n
        }
    }
}

// CLOCK_MONOTONIC_RAW == mach_continuous_time (includes sleep), the same clock
// as Node's process.hrtime.bigint() on macOS, so timestamps compare directly.
func nowNs() -> UInt64 { clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) }
func log(_ s: String) { FileHandle.standardError.write(("[audiotap] " + s + "\n").data(using: .utf8)!) }

let out = FrameWriter()
func status(_ event: String, _ extra: [String: Any] = [:]) {
    var o = extra; o["event"] = event
    out.json(.status, o)
    log("status: \(event) \(extra)")
}

// MARK: - TCC preflight (best effort)
// There is no public API to query "System Audio Recording" permission. We use the
// TCC SPI only to *read* the state, so the UI can show a precise error.
// Returns "authorized" | "denied" | "unknown".
func audioCapturePermission() -> String {
    guard let h = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW),
          let sym = dlsym(h, "TCCAccessPreflight") else { return "unknown" }
    typealias Fn = @convention(c) (CFString, CFDictionary?) -> Int
    let fn = unsafeBitCast(sym, to: Fn.self)
    switch fn("kTCCServiceAudioCapture" as CFString, nil) {
    case 0: return "authorized"
    case 1: return "denied"
    default: return "unknown" // 2 = not determined yet
    }
}

// MARK: - CoreAudio helpers

func getProp<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ def: T,
                scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> (OSStatus, T) {
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    var v = def
    var size = UInt32(MemoryLayout<T>.size)
    let err = AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v)
    return (err, v)
}

func defaultOutputDevice() -> AudioObjectID {
    getProp(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(0)).1
}

func deviceUID(_ dev: AudioObjectID) -> String? {
    let (err, uid) = getProp(dev, kAudioDevicePropertyDeviceUID, "" as CFString)
    return err == noErr ? uid as String : nil
}

func deviceName(_ dev: AudioObjectID) -> String {
    (getProp(dev, kAudioObjectPropertyName, "" as CFString).1 as String)
}

func processObject(for pid: pid_t) -> AudioObjectID? {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                                          mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var p = pid
    var obj = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr,
                                         UInt32(MemoryLayout<pid_t>.size), &p, &size, &obj)
    return (err == noErr && obj != kAudioObjectUnknown) ? obj : nil
}

// MARK: - Tap session

final class TapSession {
    let excludePids: [pid_t]
    var tapID = AudioObjectID(kAudioObjectUnknown)
    var aggID = AudioObjectID(kAudioObjectUnknown)
    var procID: AudioDeviceIOProcID?
    var format = AudioStreamBasicDescription()
    let ioQueue = DispatchQueue(label: "audiotap.io", qos: .userInteractive)
    var onAudio: ((UnsafePointer<Float>, Int, UInt64) -> Void)?

    init(excludePids: [pid_t]) { self.excludePids = excludePids }

    func start() throws {
        let exclude = excludePids.compactMap { processObject(for: $0) }
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: exclude)
        desc.uuid = UUID()
        desc.name = "LiveCaptions tap"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted // keep normal playback audible
        var err = AudioHardwareCreateProcessTap(desc, &tapID)
        guard err == noErr else { throw NSError(domain: "tap", code: Int(err), userInfo: [NSLocalizedDescriptionKey: "AudioHardwareCreateProcessTap failed \(err)"]) }

        let out = defaultOutputDevice()
        guard let outUID = deviceUID(out) else { throw NSError(domain: "tap", code: -1, userInfo: [NSLocalizedDescriptionKey: "no default output device"]) }
        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "LiveCaptions-Aggregate",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                               kAudioSubTapUIDKey: desc.uuid.uuidString]],
        ]
        err = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        guard err == noErr else { throw NSError(domain: "tap", code: Int(err), userInfo: [NSLocalizedDescriptionKey: "AudioHardwareCreateAggregateDevice failed \(err)"]) }

        let (ferr, fmt) = getProp(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription())
        guard ferr == noErr else { throw NSError(domain: "tap", code: Int(ferr), userInfo: [NSLocalizedDescriptionKey: "read tap format failed \(ferr)"]) }
        format = fmt
        let isFloat = fmt.mFormatFlags & kAudioFormatFlagIsFloat != 0
        let nonInterleaved = fmt.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
        guard isFloat, fmt.mBitsPerChannel == 32 else {
            throw NSError(domain: "tap", code: -2, userInfo: [NSLocalizedDescriptionKey: "unexpected tap format \(fmt)"])
        }
        let channels = Int(fmt.mChannelsPerFrame)
        log("tap format: \(fmt.mSampleRate) Hz, \(channels) ch, float32, \(nonInterleaved ? "planar" : "interleaved"); output device: \(deviceName(out))")

        var scratch = [Float](repeating: 0, count: 8192 * max(channels, 1))
        err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, ioQueue) { [weak self] _, inInput, inTime, _, _ in
            guard let self, let cb = self.onAudio else { return }
            let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInput))
            guard abl.count > 0 else { return }
            // Host time of the first sample -> ns on the same clock as nowNs().
            var ts = nowNs()
            if inTime.pointee.mFlags.contains(.hostTimeValid) {
                var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
                // mHostTime is mach_absolute_time (excludes sleep): shift to the continuous clock.
                let hostNs = inTime.pointee.mHostTime * UInt64(tb.numer) / UInt64(tb.denom)
                let offset = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) &- clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
                ts = hostNs &+ offset
            }
            if abl.count == 1 {
                let b = abl[0]
                guard let d = b.mData else { return }
                let n = Int(b.mDataByteSize) / 4
                cb(d.assumingMemoryBound(to: Float.self), n, ts)
            } else {
                // Planar -> interleave.
                let frames = Int(abl[0].mDataByteSize) / 4
                let ch = abl.count
                if scratch.count < frames * ch { scratch = [Float](repeating: 0, count: frames * ch) }
                for c in 0..<ch {
                    guard let d = abl[c].mData?.assumingMemoryBound(to: Float.self) else { continue }
                    for i in 0..<frames { scratch[i * ch + c] = d[i] }
                }
                scratch.withUnsafeBufferPointer { cb($0.baseAddress!, frames * ch, ts) }
            }
        }
        guard err == noErr else { throw NSError(domain: "tap", code: Int(err), userInfo: [NSLocalizedDescriptionKey: "create IOProc failed \(err)"]) }
        err = AudioDeviceStart(aggID, procID)
        guard err == noErr else { throw NSError(domain: "tap", code: Int(err), userInfo: [NSLocalizedDescriptionKey: "AudioDeviceStart failed \(err)"]) }
    }

    var channels: Int { Int(format.mChannelsPerFrame) }
    var outputDeviceName: String { deviceName(defaultOutputDevice()) }

    func stop() {
        if aggID != kAudioObjectUnknown {
            if let p = procID { AudioDeviceStop(aggID, p); AudioDeviceDestroyIOProcID(aggID, p) }
            AudioHardwareDestroyAggregateDevice(aggID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil; aggID = AudioObjectID(kAudioObjectUnknown); tapID = AudioObjectID(kAudioObjectUnknown)
    }
}

// MARK: - WAV writer (gate evidence / debugging)

func writeWav(path: String, samples: [Float], sampleRate: Int, channels: Int) throws {
    var d = Data()
    func put<T>(_ v: T) { withUnsafeBytes(of: v) { d.append(contentsOf: $0) } }
    let dataBytes = UInt32(samples.count * 4)
    d.append("RIFF".data(using: .ascii)!); put(UInt32(36 + dataBytes).littleEndian)
    d.append("WAVEfmt ".data(using: .ascii)!); put(UInt32(16)); put(UInt16(3)) // IEEE float
    put(UInt16(channels)); put(UInt32(sampleRate)); put(UInt32(sampleRate * channels * 4))
    put(UInt16(channels * 4)); put(UInt16(32))
    d.append("data".data(using: .ascii)!); put(dataBytes)
    samples.withUnsafeBufferPointer { d.append(UnsafeBufferPointer(start: $0.baseAddress, count: $0.count)) }
    try d.write(to: URL(fileURLWithPath: path))
}

// MARK: - Main

var excludePids: [pid_t] = []
var wavPath: String?
var seconds = 10.0
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    switch a {
    case "--exclude-pid": if let v = args.next(), let p = pid_t(v) { excludePids.append(p) }
    case "--wav": wavPath = args.next()
    case "--seconds": seconds = Double(args.next() ?? "10") ?? 10
    case "--check-permission": print(audioCapturePermission()); exit(0)
    case "--request-permission":
        // Starting a tap makes macOS show the "System Audio Recording" prompt for the
        // responsible app. Keep it running briefly, then report the resulting state.
        let probe = TapSession(excludePids: [])
        probe.onAudio = { _, _, _ in }
        do { try probe.start() } catch { log("request: \(error.localizedDescription)") }
        Thread.sleep(forTimeInterval: 1.0)
        probe.stop()
        print(audioCapturePermission()); exit(0)
    default: log("unknown arg \(a)"); exit(2)
    }
}
if wavPath != nil { out.enabled = false }

signal(SIGPIPE, SIG_IGN)
let perm = audioCapturePermission()
log("System Audio Recording permission (preflight): \(perm)")
if perm == "denied" {
    status("permission-denied", ["service": "kTCCServiceAudioCapture"])
    exit(3)
}

let session = TapSession(excludePids: excludePids)
var collected: [Float] = []
var silentSince: UInt64? = nil
var anyNonZero = false
var reportedSilent = false
var rmsAcc: Double = 0, rmsCount = 0
var lastLevelReport = nowNs()
let startNs = nowNs()

func installAudioHandler() {
    session.onAudio = { ptr, n, ts in
        var sum: Double = 0
        var nonZero = false
        for i in 0..<n { let v = ptr[i]; sum += Double(v * v); if v != 0 { nonZero = true } }
        rmsAcc += sum; rmsCount += n
        if nonZero { anyNonZero = true; silentSince = nil; if reportedSilent { reportedSilent = false; status("audio-resumed") } }
        else if silentSince == nil { silentSince = ts }
        if let wav = wavPath {
            collected.append(contentsOf: UnsafeBufferPointer(start: ptr, count: n))
            let target = Int(seconds * session.format.mSampleRate) * session.channels
            if collected.count >= target {
                try? writeWav(path: wav, samples: Array(collected.prefix(target)), sampleRate: Int(session.format.mSampleRate), channels: session.channels)
                let rms = sqrt(collected.prefix(target).reduce(0.0) { $0 + Double($1 * $1) } / Double(target))
                print(String(format: "wrote %@: %.0f Hz, %d ch, float32, %.1f s, RMS=%.5f (%.1f dBFS)", wav, session.format.mSampleRate, session.channels, seconds, rms, 20 * log10(max(rms, 1e-12))))
                session.stop(); exit(0)
            }
        } else {
            out.write(.audio, UnsafeRawBufferPointer(start: ptr, count: n * 4), ts: ts)
        }
        let now = nowNs()
        if now - lastLevelReport > 1_000_000_000 {
            let rms = rmsCount > 0 ? sqrt(rmsAcc / Double(rmsCount)) : 0
            out.json(.status, ["event": "level", "rms": rms])
            rmsAcc = 0; rmsCount = 0; lastLevelReport = now
            // Digital silence for a long time right after start usually means the TCC
            // permission was not granted (the tap then delivers zeros).
            if let s = silentSince, now - s > 5_000_000_000, !reportedSilent {
                reportedSilent = true
                status(anyNonZero ? "silent" : "silent-since-start", ["permission": audioCapturePermission()])
            }
        }
    }
}

func startSession() {
    do {
        try session.start()
        out.json(.format, ["sampleRate": session.format.mSampleRate, "channels": session.channels,
                           "sampleFormat": "f32le", "interleaved": true, "outputDevice": session.outputDeviceName])
        status("started", ["outputDevice": session.outputDeviceName, "permission": audioCapturePermission()])
    } catch {
        status("error", ["message": error.localizedDescription])
        session.stop()
        exit(4)
    }
}

installAudioHandler()
startSession()

// Rebuild the aggregate device when the default output changes (e.g. Bluetooth headset
// connected) — the aggregate's clock sub-device may have disappeared.
var outAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
                                         mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &outAddr, DispatchQueue.main) { _, _ in
    log("default output device changed -> rebuilding tap")
    session.ioQueue.sync { session.stop() }
    startSession()
    status("device-changed", ["outputDevice": session.outputDeviceName])
}

// Which apps are producing audio right now (for "source app" in the history).
// Helper processes (e.g. a browser's audio service) are mapped to their parent app.
func appName(forPid pid: pid_t) -> String? {
    var p = pid
    for _ in 0..<6 {
        if let app = NSRunningApplication(processIdentifier: p), app.activationPolicy == .regular, let name = app.localizedName { return name }
        var info = kinfo_proc(); var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, p]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
        let parent = info.kp_eproc.e_ppid
        if parent <= 1 || parent == p { return nil }
        p = parent
    }
    return nil
}

func currentAudioSources() -> [String] {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    var names = Set<String>()
    let me = getpid(), parent = getppid()
    for obj in ids {
        guard getProp(obj, kAudioProcessPropertyIsRunningOutput, UInt32(0)).1 != 0 else { continue }
        let pid = getProp(obj, kAudioProcessPropertyPID, pid_t(0)).1
        if pid <= 0 || pid == me || pid == parent { continue }
        if let n = appName(forPid: pid) { names.insert(n) }
    }
    return names.sorted()
}

var lastSources: [String] = []
let sourcesTimer = DispatchSource.makeTimerSource(queue: .main)
sourcesTimer.schedule(deadline: .now() + 1, repeating: 3)
sourcesTimer.setEventHandler {
    let s = currentAudioSources()
    if s != lastSources { lastSources = s; out.json(.status, ["event": "sources", "apps": s]) }
}
if wavPath == nil { sourcesTimer.resume() }

var _signalSources: [DispatchSourceSignal] = []
// Exit when the parent goes away (stdin closes) or on signals.
for sig in [SIGINT, SIGTERM, SIGHUP] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { session.stop(); status("stopped"); exit(0) }
    src.resume()
    _signalSources.append(src)
}
if wavPath == nil {
    DispatchQueue.global().async {
        var buf = [UInt8](repeating: 0, count: 256)
        while read(STDIN_FILENO, &buf, 256) > 0 {}
        DispatchQueue.main.async { session.stop(); exit(0) }
    }
}
_ = startNs
dispatchMain()
