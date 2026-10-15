#!/usr/bin/env bash
# Downloads whisper.cpp ggml models + Silero VAD into the app's models directory,
# verifying SHA-256 against values pinned from the Hugging Face LFS pointers.
# Usage: scripts/download-models.sh [base.en|small.en|base.en-q5_1|small.en-q5_1|small.en-tdrz|speakers|all]...
#        speakers = the speaker-change model (Nemotron 3 Diarization, CoreML, for speaker-worker)
#        (default: base.en + VAD)
set -euo pipefail
APP_DIR="$HOME/Library/Application Support/Spokemark"
for old in Earline "Live Captions"; do # pre-rename installs
  [ -d "$APP_DIR" ] || [ ! -d "$HOME/Library/Application Support/$old" ] || APP_DIR="$HOME/Library/Application Support/$old"
done
DEST="${LC_MODELS_DIR:-$APP_DIR/models}"
WHISPER_REV="5359861c739e955e79d9a303bcbc70fb988958b1" # ggerganov/whisper.cpp
VAD_REV="9ffd54a1e1ee413ddf265af9913beaf518d1639b"     # ggml-org/whisper-vad
TDRZ_REV="d44ba793fc67e509623a88a409723311fa677744" # akashmjn/tinydiarize-whisper.cpp
NEMOTRON_REV="25a90f97f254428d4b30374b76af9c74fdee8327" # FluidInference/nemotron-3-diarization-coreml
SPK=speakers-nemotron3-low # same folder as SPEAKER_MODEL_DIR in src/main/models/ModelManager.ts
mkdir -p "$DEST"

sha_for() {
  case "$1" in
    ggml-base.en.bin) echo a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002 ;;
    ggml-small.en.bin) echo c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d ;;
    ggml-base.en-q5_1.bin) echo 4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f ;;
    ggml-small.en-q5_1.bin) echo bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30 ;;
    ggml-small.en-tdrz.bin) echo ceac3ec06d1d98ef71aec665283564631055fd6129b79d8e1be4f9cc33cc54b4 ;;
    ggml-silero-v6.2.0.bin) echo 2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987 ;;
    $SPK/learnable_sil_emb.bin) echo d4417b3c0eabdf7c47032fac2b5b5a7ee83d819a6ddda8fd8eaf74e2b5cc4ac7 ;;
    $SPK/Nemotron3Diarizer_low.mlmodelc/coremldata.bin) echo 2c2c82efc948433cb47b60aceb4917182e2e00d1d79097b8898adfd615b0c5f8 ;;
    $SPK/Nemotron3Diarizer_low.mlmodelc/analytics/coremldata.bin) echo 1ec46d7392b470ebfaac473123de9e5bc62630972b01349b929bf6e48e067c6c ;;
    $SPK/Nemotron3Diarizer_low.mlmodelc/model.mil) echo 8e2ffc4ce5edf86b8a1845e5229a219ca9e8cc0e03aa4a6e7317e81cb7da2da5 ;;
    $SPK/Nemotron3Diarizer_low.mlmodelc/weights/weight.bin) echo 88307e2c51d1877de59803299354f689e70cad7f8892a197764d5f3626089495 ;;
    *) echo "unknown model $1" >&2; exit 2 ;;
  esac
}

fetch() { # file url
  local f="$1" url="$2" want; want="$(sha_for "$f")"
  if [ -f "$DEST/$f" ] && [ "$(shasum -a 256 "$DEST/$f" | cut -d' ' -f1)" = "$want" ]; then
    echo "ok   $f (already present)"; return
  fi
  echo "get  $f"
  mkdir -p "$(dirname "$DEST/$f")"
  curl -fL --progress-bar -o "$DEST/$f.part" "$url"
  local got; got="$(shasum -a 256 "$DEST/$f.part" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    rm -f "$DEST/$f.part"; echo "FAIL $f checksum mismatch: $got != $want" >&2; exit 1
  fi
  mv "$DEST/$f.part" "$DEST/$f"; echo "ok   $f (sha256 verified)"
}

models=("$@"); [ ${#models[@]} -eq 0 ] && models=(base.en)
[ "${models[0]}" = "all" ] && models=(base.en small.en base.en-q5_1 small.en-q5_1)
fetch ggml-silero-v6.2.0.bin "https://huggingface.co/ggml-org/whisper-vad/resolve/$VAD_REV/ggml-silero-v6.2.0.bin"
for m in "${models[@]}"; do
  if [ "$m" = "speakers" ]; then
    hub="https://huggingface.co/FluidInference/nemotron-3-diarization-coreml/resolve/$NEMOTRON_REV"
    fetch "$SPK/learnable_sil_emb.bin" "$hub/learnable_sil_emb.bin"
    for f in coremldata.bin analytics/coremldata.bin model.mil weights/weight.bin; do
      fetch "$SPK/Nemotron3Diarizer_low.mlmodelc/$f" "$hub/monolithic/v2/Nemotron3Diarizer_low.mlmodelc/$f"
    done
  elif [ "$m" = "small.en-tdrz" ]; then
    fetch "ggml-$m.bin" "https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/$TDRZ_REV/ggml-$m.bin"
  else
    fetch "ggml-$m.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/$WHISPER_REV/ggml-$m.bin"
  fi
done
echo "models in: $DEST"
