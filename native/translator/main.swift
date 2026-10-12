// translator — on-device text translation with Apple's Translation framework
// (TranslationSession(installedSource:target:), macOS 26+). No network: it only
// uses language packs already installed in System Settings.
//
// Protocol: JSON lines on stdin / stdout. Logs go to stderr. Exits when stdin closes.
//   in:  {"id":1,"op":"translate","source":"en","target":"es","text":"..."}
//   out: {"id":1,"ok":true,"text":"...","ms":312}
//   in:  {"id":2,"op":"languages","source":"en"}
//   out: {"id":2,"ok":true,"languages":[{"id":"es-ES","status":"installed"},...]}
//   on start: {"ready":true,"available":true|false}

import Foundation
import Translation

func emit(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
    FileHandle.standardOutput.write(d)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
func log(_ s: String) { FileHandle.standardError.write(("[translator] " + s + "\n").data(using: .utf8)!) }

@available(macOS 26.0, *)
actor Translator {
    private var sessions: [String: TranslationSession] = [:]

    private func session(_ source: String, _ target: String) -> TranslationSession {
        let key = source + ">" + target
        if let s = sessions[key] { return s }
        let s = TranslationSession(installedSource: Locale.Language(identifier: source), target: Locale.Language(identifier: target))
        sessions = [key: s] // one language pair at a time
        return s
    }

    func translate(id: Int, source: String, target: String, text: String) async {
        let t0 = Date()
        do {
            let r = try await session(source, target).translate(text)
            emit(["id": id, "ok": true, "text": r.targetText, "ms": Int(Date().timeIntervalSince(t0) * 1000)])
        } catch {
            emit(["id": id, "ok": false, "error": String(describing: error)])
        }
    }

    func languages(id: Int, source: String) async {
        let av = LanguageAvailability()
        let src = Locale.Language(identifier: source)
        var seen = Set<String>()
        var out: [[String: String]] = []
        for lang in await av.supportedLanguages {
            let code = lang.languageCode?.identifier ?? ""
            if code.isEmpty || code == src.languageCode?.identifier { continue }
            let tag = lang.minimalIdentifier
            if seen.contains(tag) { continue }
            seen.insert(tag)
            let st = await av.status(from: src, to: lang)
            let s: String
            switch st {
            case .installed: s = "installed"
            case .supported: s = "supported"
            case .unsupported: s = "unsupported"
            @unknown default: s = "unsupported"
            }
            out.append(["id": tag, "status": s])
        }
        emit(["id": id, "ok": true, "languages": out])
    }
}

@main
struct Main {
    static func main() async {
        guard #available(macOS 26.0, *) else {
            emit(["ready": true, "available": false])
            while readLine() != nil {} // keep the protocol alive; every request is unavailable
            return
        }
        let tr = Translator()
        emit(["ready": true, "available": true])
        // Read stdin on a background thread; requests are handled concurrently by the actor.
        let lines = AsyncStream<String> { cont in
            Thread.detachNewThread {
                while let l = readLine() { cont.yield(l) }
                cont.finish()
            }
        }
        await withTaskGroup(of: Void.self) { group in
            for await line in lines {
                guard let d = line.data(using: .utf8),
                      let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let id = o["id"] as? Int, let op = o["op"] as? String else { log("bad request"); continue }
                let source = (o["source"] as? String) ?? "en"
                if op == "translate", let target = o["target"] as? String, let text = o["text"] as? String {
                    group.addTask { await tr.translate(id: id, source: source, target: target, text: text) }
                } else if op == "languages" {
                    group.addTask { await tr.languages(id: id, source: source) }
                } else {
                    emit(["id": id, "ok": false, "error": "unknown op"])
                }
            }
        }
    }
}
