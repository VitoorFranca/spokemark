# Spokemark (macOS)

Legendas em tempo real, no idioma original (inglês), para qualquer áudio que o Mac estiver tocando: Meet, Zoom, Discord, YouTube e outros. Funciona 100% local com whisper.cpp + Metal e captura o áudio por CoreAudio Process Tap, sem driver virtual e sem trocar o dispositivo de saída.

Requisitos: Apple Silicon e macOS 14.4 ou mais recente. Testado no macOS 26.6.2 com M4.

## Arquitetura

```
audiotap (Swift, Process Tap) ──PCM frames/stdout──▶ main (Electron)
                                                     ├─ AudioCaptureService      decodifica frames, status, permissão
                                                     ├─ AudioProcessingPipeline  mono + resample 16 kHz + ring buffer fixo (60 s)
                                                     ├─ VoiceActivityDetector ─┐
                                                     ├─ WhisperProvider ───────┼─frames/stdin──▶ whisper-worker (C++, libwhisper+Metal,
                                                     │   (TranscriptionProvider)◀──JSON lines───   Silero VAD em thread própria)
                                                     ├─ SubtitleManager          LocalAgreement-2 → linhas confirmadas + cauda provisória
                                                     ├─ OverlayManager ──IPC (zod)──▶ overlay (React/Tailwind, sandbox)
                                                     ├─ SettingsService, AppStateMachine, Tray, atalhos globais
```

```
native/audiotap/main.swift        captura (Process Tap + aggregate device), protocolo binário
native/whisper-worker/main.cpp    worker whisper.cpp (modelo carregado 1x, VAD + ASR)
src/main/                         processo main (módulos acima), ChildSupervisor (restart c/ backoff)
src/preload/overlay.ts            API mínima validada
src/renderer/                     overlay
src/shared/ipc.ts                 contrato IPC (zod)
src/cli/transcribe.ts             harness headless (mesmos módulos) para benchmarks/E2E
scripts/                          build nativo, modelos, empacotamento, E2E
docs/DECISIONS.md                 decisões e alternativas descartadas
```

## Comandos

```bash
npm install
brew install cmake               # apenas para compilar o whisper.cpp
npm run build:native             # build/bin/{audiotap,whisper-worker} (clona whisper.cpp v1.9.5 em vendor/)
npm run models                   # base.en + Silero VAD (SHA-256 verificado) → ~/Library/Application Support/Spokemark/models
scripts/download-models.sh all   # + small.en, base.en-q5_1, small.en-q5_1
scripts/download-models.sh small.en-tdrz   # opcional: marca troca de falante (menu Model → "small.en + speaker changes")
npm run dev                      # Vite + Electron (permissão TCC herdada do terminal)
npm test                         # testes unitários (vitest)
npm run typecheck
scripts/make-fixtures.sh         # gera os áudios dos testes E2E (say + jfk.wav)
npm run package                  # release/Spokemark-darwin-arm64/Spokemark.app (assinatura ad hoc)
```

Para usar: abra o app. Aparece "CC" na barra de menus. Clique em **Start Captions** ou use ⌥⌘C. O ⌥⌘E alterna entre o modo click-through e o modo de edição (arrastar e redimensionar).

## Permissões do macOS

A captura de áudio do sistema exige a permissão **Gravação de Áudio do Sistema** (TCC `kTCCServiceAudioCapture`). Gravação de Tela e Microfone **não** são necessárias.

| Modo | Quem recebe a permissão | Como conceder |
|---|---|---|
| `npm run dev` / CLI | o **terminal** que lançou o processo (ex.: iTerm2). Se o terminal não declarar `NSAudioCaptureUsageDescription` (caso do iTerm2), não aparece prompt e o tap entrega silêncio. | Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela e Áudio do Sistema → seção **"Somente Gravação de Áudio do Sistema"** → **+** → selecione o terminal. |
| App empacotado | **Spokemark.app** (declara `NSAudioCaptureUsageDescription` no Info.plist). | Prompt do sistema na primeira captura, ou o mesmo painel acima. |

Com a permissão ausente, o app mostra "CC ⚠︎" e oferece **Open Privacy Settings…** no menu. Observações:
- A assinatura ad hoc muda a cada build. Nos meus testes, reempacotar não fez o macOS pedir a permissão de novo, mas isso pode variar.
- Uma assinatura Developer ID estável evita o problema.

## Resultados verificados

Veja a resposta final da sessão. As métricas brutas ficam em `docs/RESULTS.md`.

## Testes manuais (passo a passo)

1. **Chamada real (Meet/Zoom/Discord):** abra o app, clique em Start, entre na chamada e confira se as legendas acompanham quem fala e se o áudio continua audível.
2. **Fones com fio e Bluetooth / troca de saída:** com a captura ativa, troque a saída em Central de Controle → Som. O log deve mostrar `device-changed` e as legendas devem continuar.
3. **Permissão negada → concedida:** em Ajustes, desligue o Spokemark na lista "Somente Gravação de Áudio do Sistema" e clique em Start. Deve aparecer "CC ⚠︎" com a mensagem de permissão. Religue, clique em Stop e Start, e a captura deve voltar.
4. **Tela cheia / Spaces:** coloque um vídeo em tela cheia (⌃⌘F) e confira se o overlay aparece por cima e em todos os Spaces.
5. **Múltiplos monitores:** com o cursor no monitor 2, faça Hide/Show Overlay. O overlay deve abrir no monitor 2. Mova no modo de edição, trave e reabra: a posição deve ser lembrada por monitor.
