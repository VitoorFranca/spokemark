# Third-party code in `speaker-worker`

The `speaker-worker` binary statically links:

| Component | Version | License | File |
|---|---|---|---|
| [FluidAudio](https://github.com/FluidInference/FluidAudio) (only its `Diarizer` trait) | commit `82eb4c1e0ab67e1c7d8de5092aa42a8f74cbd7b8` | Apache License 2.0 | `FluidAudio-LICENSE.txt` |
| fastcluster (bundled by FluidAudio) | as vendored by FluidAudio | BSD 2-Clause | `fastcluster-LICENSE.md` |

The speaker model is **not** part of the app. The app downloads it on request from
[FluidInference/nemotron-3-diarization-coreml](https://huggingface.co/FluidInference/nemotron-3-diarization-coreml)
(revision `25a90f97f254428d4b30374b76af9c74fdee8327`, each file checked by SHA-256). It is a CoreML
conversion of NVIDIA's Nemotron 3 Diarization, released under the OpenMDW License 1.1.
