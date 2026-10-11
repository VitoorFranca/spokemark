#!/usr/bin/env bash
# Downloads whisper.cpp ggml models + Silero VAD into the app's models directory,
# verifying SHA-256 against values pinned from the Hugging Face LFS pointers.
# Usage: scripts/download-models.sh [base.en|small.en|base.en-q5_1|small.en-q5_1|small.en-tdrz|all]...
#        (default: base.en + VAD)
set -euo pipefail
APP_DIR="$HOME/Library/Application Support/Earline"
[ -d "$APP_DIR" ] || [ ! -d "$HOME/Library/Application Support/Live Captions" ] || APP_DIR="$HOME/Library/Application Support/Live Captions" # pre-rename install
DEST="${LC_MODELS_DIR:-$APP_DIR/models}"
WHISPER_REV="5359861c739e955e79d9a303bcbc70fb988958b1" # ggerganov/whisper.cpp
VAD_REV="9ffd54a1e1ee413ddf265af9913beaf518d1639b"     # ggml-org/whisper-vad
TDRZ_REV="d44ba793fc67e509623a88a409723311fa677744" # akashmjn/tinydiarize-whisper.cpp
mkdir -p "$DEST"

sha_for() {
  case "$1" in
    ggml-base.en.bin) echo a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002 ;;
    ggml-small.en.bin) echo c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d ;;
    ggml-base.en-q5_1.bin) echo 4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f ;;
    ggml-small.en-q5_1.bin) echo bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30 ;;
    ggml-small.en-tdrz.bin) echo ceac3ec06d1d98ef71aec665283564631055fd6129b79d8e1be4f9cc33cc54b4 ;;
    ggml-silero-v6.2.0.bin) echo 2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987 ;;
    *) echo "unknown model $1" >&2; exit 2 ;;
  esac
}

fetch() { # file url
  local f="$1" url="$2" want; want="$(sha_for "$f")"
  if [ -f "$DEST/$f" ] && [ "$(shasum -a 256 "$DEST/$f" | cut -d' ' -f1)" = "$want" ]; then
    echo "ok   $f (already present)"; return
  fi
  echo "get  $f"
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
  if [ "$m" = "small.en-tdrz" ]; then
    fetch "ggml-$m.bin" "https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/$TDRZ_REV/ggml-$m.bin"
  else
    fetch "ggml-$m.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/$WHISPER_REV/ggml-$m.bin"
  fi
done
echo "models in: $DEST"
