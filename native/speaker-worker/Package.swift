// swift-tools-version: 6.2
// speaker-worker: streaming speaker diarization (who is speaking when) for Spokemark.
// FluidAudio (Apache-2.0) pinned to one commit, with only its `Diarizer` trait: no ASR/TTS
// models, no text-processing binary. Models are never downloaded from here; the app
// fetches them (pinned revision + SHA-256) and passes the folder with --model-dir.
import PackageDescription

let package = Package(
    name: "speaker-worker",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            revision: "82eb4c1e0ab67e1c7d8de5092aa42a8f74cbd7b8",
            traits: ["Diarizer"])
    ],
    targets: [
        .executableTarget(
            name: "speaker-worker",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            path: "Sources")
    ]
)
