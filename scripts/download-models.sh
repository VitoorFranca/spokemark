#!/usr/bin/env bash
# Downloads whisper.cpp ggml models + Silero VAD into the app's models directory,
# verifying SHA-256 against values pinned from the Hugging Face LFS pointers.
# Usage: scripts/download-models.sh [base.en|small.en|base.en-q5_1|small.en-q5_1|small.en-tdrz|speakers|parakeet|all]...
#        speakers = the speaker-change model (Nemotron 3 Diarization, CoreML, for speaker-worker)
#        parakeet = the Parakeet engine model (Nemotron Speech Streaming 0.6B, 560 ms, CoreML, for parakeet-worker)
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
PARAKEET_REV="e673531caa6d25ab7baf5a8c14c9b99ba1551838" # FluidInference/nemotron-speech-streaming-en-0.6b-coreml
PK=parakeet-nemotron-560ms # PARAKEET_MODEL_DIR
PARAKEET_FILES="
decoder.mlmodelc/analytics/coremldata.bin bca0e343fa0d698de8bdb22c66fd377b79104f606b1bfffc90931fe2161029b8
decoder.mlmodelc/coremldata.bin 4d0549ac72a38abdcbe7927f2b7d488386d6b96f1f5e837d93ba9e379de04f4e
decoder.mlmodelc/model.mil 8298f16d3926565b77732b549fa9c64fedebb2e5a29a76e33d0b2e970e93ae69
decoder.mlmodelc/weights/weight.bin d9758e49f9b2b9a0462c933256663d4174209739e62f0ddc14e4147bc50e7818
decoder_joint.mlmodelc/analytics/coremldata.bin d46ecf790a728d91b8962ec62e597980e288e66c775e45429bf734b54c658ffc
decoder_joint.mlmodelc/coremldata.bin d9a7f7cfece967a69dca59b3fc3cc7d1ecff93ad2815ac3ba6b47e057db22172
decoder_joint.mlmodelc/model.mil 517bb31cf87eb8aa80adaa8c3fee2df0fd7d7dd0c8791e615c5023886c39d572
decoder_joint.mlmodelc/weights/weight.bin 96cac67a1352e45a2418284779dbd5efe5865159b7b92f328247e5ed31485f52
encoder/encoder_int8.mlmodelc/analytics/coremldata.bin ef51dbab5c6ce310ce1a537538a4df6b88f13ad5c45c0acaddca055503896daa
encoder/encoder_int8.mlmodelc/coremldata.bin 864a357ae2eb7d6b38ced73d5f23c908096a256516afa498c6730778767ec404
encoder/encoder_int8.mlmodelc/model.mil 4b903ee4f401d81add07d1252192a486bd07154174818902f03bca38b2f293f6
encoder/encoder_int8.mlmodelc/weights/weight.bin 8ced31411f7903eaec52de85e94c7847228f3e44028d8f0040800e5603943a40
joint.mlmodelc/analytics/coremldata.bin 478804308534c7f9cab1030aa9ce19ddf672fcd15deba633fe3ed5da8f53b103
joint.mlmodelc/coremldata.bin 46363626fd89730ade6e6461e8be808c7fade198fb0df63db83fb00ed033abb2
joint.mlmodelc/model.mil 73bcc51b58ff73c7620e31a2c32dc5ef4939e8ec2a77ec22242303422bfafba4
joint.mlmodelc/weights/weight.bin d1d45514a91da39f24e264712a9f8b5a2a90e9cbce04bad3f3f74242bea106d5
metadata.json e8d93e5afa1e5c87257f6e31a5c336058eeba7d6cacd36ba80fbf9758c3916dc
tokenizer.json a87b5b8a0e0a989fa7db3121f279ce6af70e337feb55ab553b8d0658db70b9d3"
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
    $PK/*) echo "$PARAKEET_FILES" | awk -v f="${1#$PK/}" '$1==f {print $2}' ;;
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
  elif [ "$m" = "parakeet" ]; then
    hub="https://huggingface.co/FluidInference/nemotron-speech-streaming-en-0.6b-coreml/resolve/$PARAKEET_REV/nemotron_coreml_560ms"
    echo "$PARAKEET_FILES" | while read -r f _; do [ -n "$f" ] && fetch "$PK/$f" "$hub/$f"; done
  elif [ "$m" = "small.en-tdrz" ]; then
    fetch "ggml-$m.bin" "https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/$TDRZ_REV/ggml-$m.bin"
  else
    fetch "ggml-$m.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/$WHISPER_REV/ggml-$m.bin"
  fi
done
echo "models in: $DEST"
