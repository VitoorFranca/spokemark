# Decisões técnicas

Cada item traz a opção escolhida, as alternativas descartadas e o motivo. Tudo foi verificado no ambiente real: MacBook Air M4, macOS 26.6.2, Electron 44.7.0 e whisper.cpp v1.9.5.

## Captura de áudio

**Escolhida: helper Swift (`native/audiotap`) com CoreAudio Process Tap.** O tap é criado por `AudioHardwareCreateProcessTap` com `CATapDescription(stereoGlobalTapButExcludeProcesses: [])`, `muteBehavior = .unmuted` e `isPrivate = true`, dentro de um aggregate device privado com `kAudioAggregateDeviceTapAutoStartKey`. A API está disponível a partir do macOS 14.2, conforme os headers do SDK em `AudioHardwareTapping.h`.
- O tap exige só a permissão TCC "Gravação de Áudio do Sistema" (`kTCCServiceAudioCapture`), que é mais estreita que Gravação de Tela.
- `muteBehavior = .unmuted` mantém a reprodução normal audível.
- O PCM vai do helper direto para o processo main por stdout e nunca passa pelo renderer.

**Descartada: A, Electron puro (`setDisplayMediaRequestHandler` + `audio: 'loopback'`).** Testei em `scripts/spike-a/`:
- Sem Gravação de Tela, `desktopCapturer.getSources()` é rejeitado e `getDisplayMedia` falha com `AbortError: Invalid capture constraints`.
- Com Gravação de Tela concedida, funcionou: 1 trilha "loopback" a 48 kHz, RMS 0,18.
- Mesmo assim foi descartada, por três motivos: exige um stream de vídeo da tela e a permissão de Gravação de Tela; o áudio passa pelo renderer; e as constraints de áudio vêm com AEC, NS e AGC ligados por padrão.
- Desde o Electron 39 o Chromium já usa o mesmo CoreAudio Tap por baixo (docs de `desktopCapturer`), então a opção B usa a mesma API sem esse custo.

**Descartada: ScreenCaptureKit (`capturesAudio`).** Exige Gravação de Tela e não acrescenta nada ao Process Tap no macOS 14.2+.

**Descartada: BlackHole e drivers virtuais.** Proibidos pela especificação. Além disso, exigem trocar o dispositivo de saída.

**Troca de dispositivo de saída.** O helper escuta `kAudioHardwarePropertyDefaultSystemOutputDevice` e recria o aggregate device. O tap é global, não amarrado a um dispositivo. Isso não foi verificado com hardware real (ver README).

**Protocolo.** Frames binários com cabeçalho de 24 bytes (magic, tipo, seq, tamanho e timestamp em ns), com três tipos de payload: FORMAT (JSON), AUDIO (float32 intercalado) e STATUS (JSON). Logs vão para stderr.
- O timestamp usa `CLOCK_MONOTONIC_RAW` (= `mach_continuous_time`), o mesmo relógio de `process.hrtime.bigint()` no macOS.
- Medido: primeiro usei `CLOCK_UPTIME_RAW` e a diferença foi de cerca de 52 h, que é o tempo de sono da máquina.

**Detecção de problemas na captura.**
- Permissão negada: preflight via SPI de TCC (`TCCAccessPreflight`, somente leitura). Se o resultado for "denied", o helper sai com código 3 e o app mostra o estado "permissão".
- Permissão ausente: o tap entrega zeros digitais. Silêncio absoluto por 5 s desde o início gera `silent-since-start`.
- Stream silencioso: gera `silent` / `audio-resumed`.
- Dispositivo trocado: gera `device-changed`.
- Helper encerrado: o supervisor reinicia com backoff exponencial, até 5 vezes por minuto.

## Transcrição

**Escolhida: processo auxiliar C++ (`native/whisper-worker`) linkando a `libwhisper` estática com Metal (`GGML_METAL_EMBED_LIBRARY`).** O modelo é carregado uma vez e aquecido. Requisições chegam por frames binários no stdin; respostas saem em JSON por linha, com segmentos, tokens, `p`, `no_speech_prob` e logprob médio.
- Isola crashes e o Metal fora do processo do Electron, e não tem problemas de ABI.
- O log `ggml_metal_device_init: GPU name: MTL0 (Apple M4)` confirma o Metal.

**Descartado: `whisper-stream`.** Pelo código atual (`examples/stream`), ele captura do microfone via SDL e não aceita PCM por stdin.

**Descartado: addon Node (`examples/addon.node`).** É um exemplo, não um pacote mantido, e teria de ser compilado contra o ABI do Electron. Também colocaria o Metal no processo main.

**Descartado: `whisper-server`.** Usa HTTP e codifica WAV a cada janela. Só faria sentido se as alternativas acima falhassem.

**VAD: Silero, embutido no whisper.cpp.** A versão 1.9.5 traz `whisper_vad_detect_speech_no_reset` / `whisper_vad_probs` e usamos o modelo `ggml-silero-v6.2.0`.
- Roda na CPU, numa thread própria do worker, para continuar acompanhando o áudio enquanto uma inferência está em andamento.
- Histerese: limiar 0,5 para entrar em fala e 0,35 para sair, com 600 ms de silêncio para encerrar.
- Descartados: limiar de energia (proibido) e Silero via onnxruntime (dependência extra).

**Streaming.**
- Uma inferência a cada 500 ms, com no máximo uma em andamento. Se o worker estiver ocupado, o passo é descartado e contabilizado em `skippedBusy`.
- Janela mínima de 1 s e máxima de 15 s. Acima de 8 s, a janela é cortada na última palavra confirmada.
- A janela só existe se o VAD detectou fala; durante silêncio o início do buffer avança.
- O ring buffer é fixo: 60 s a 16 kHz.
- O Whisper não faz streaming por token. A latência vem de passo + inferência + concordância entre duas hipóteses.

**Confirmação: LocalAgreement-2.** O prefixo comum de duas hipóteses consecutivas é confirmado, e o texto confirmado nunca muda.
- O alinhamento com o que já foi confirmado é feito **por texto**: as últimas 2 a 4 palavras confirmadas são procuradas na nova hipótese.
- O timestamp por palavra é só fallback. Medi que os timestamps de token do whisper.cpp são grosseiros: com dedup só por tempo, a referência perdeu "team finished … version" e a WER foi de 5,3% (4 deleções em 75 palavras). Com alinhamento por texto, 0%.
- DTW foi descartado porque o whisper.cpp o desativa com flash attention (`dtw_token_timestamps is not supported with flash_attn`).

**Anti-alucinação.**
- Nada é transcrito sem fala detectada pelo VAD.
- Segmentos são descartados com `no_speech_prob > 0,6` e logprob médio < −1, ou com logprob médio < −1,5.
- Frases típicas de silêncio ("Thank you.", "Thanks for watching" etc.) são descartadas quando menos de 50% dos frames são fala.
- Tokens entre colchetes ou parênteses ("[BLANK_AUDIO]", "(music)") são removidos, e `suppress_nst` fica ligado.
- Loops de 1 a 4 gramas repetidos 3 vezes ou mais são colapsados.
- Palavra única isolada com p < 0,6 é descartada. Medido: aplausos no fim do `jfk.wav` geravam "Great." / "free." com p ≈ 0,55.
- `no_context = true` e o prompt com texto anterior fica desligado (`usePrompt: false`), para evitar arrastar alucinações entre janelas.
- Sem fallback de temperatura, para manter a latência limitada.

**Fim de frase.** Uma frase é considerada encerrada quando o VAD já declarou fim de fala (depois de 600 ms de silêncio) e esse fim está dentro da janela transcrita.
- A primeira versão também exigia que o VAD tivesse processado até o fim exato da janela. Como o VAD trabalha em blocos de 256 ms, essa condição quase nunca era verdadeira.
- O efeito era retranscrever a mesma fala durante a pausa até o corte da janela. Um teste unitário encontrou o problema.

**Troca de falante: tinydiarize** (`small.en-tdrz`, `tdrz_enable`, `whisper_full_get_segment_speaker_turn_next`).
- A troca vira um pseudo-token que passa pelo LocalAgreement, então só vale depois de confirmada. No `SubtitleManager` ela inicia uma nova linha com "–".
- Só marca a troca, sem identificar quem fala.
- **Contexto de transição:** com esse modelo, a janela depois de uma pausa reenvia os últimos 3 s da fala anterior (`turnContextS`). As palavras repetidas são descartadas pelo alinhamento por texto.
  - Medido no áudio Apollo 13: sem contexto, 1 a 2 de 21 trocas detectadas; com contexto, 11 a 12.
  - O custo é ~0,4 s a mais no p50 da primeira aparição.
- Descartada: diarização com embeddings de voz (WeSpeaker ou 3D-Speaker via ONNX), por ser uma dependência nativa nova, ter qualidade incerta em tempo real e não ter sido pedida.

## App

- **Overlay:** `BrowserWindow` com `type: 'panel'`, documentado como "float on top of full-screened apps" e "appear on all spaces". Também usa `setAlwaysOnTop(true, 'screen-saver')` e `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. Click-through usa `setIgnoreMouseEvents(true)`.
- **Redimensionamento no modo de edição:** feito por uma alça no renderer, que envia o novo tamanho por IPC validado com zod. Descartado: `resizable: true` nativo, porque a documentação do Electron diz que "Transparent windows are not resizable".
- **Proteção contra compartilhamento de tela:** `setContentProtection` fica como opção desligada por padrão. A documentação do Electron avisa que apps que usam ScreenCaptureKit capturam a janela mesmo assim.
- **Build:** esbuild para main/preload, porque o preload em sandbox precisa ser um bundle único com o zod dentro. Vite + React + Tailwind v4 para o overlay. Descartados: electron-vite e electron-forge, para reduzir dependências.
- **Empacotamento:** `@electron/packager` com assinatura ad hoc via `codesign`. Descartado: electron-builder, que é bem maior e cujos instaladores (DMG, auto-update) estão fora do escopo do MVP.
- **IPC:** zod nas duas pontas. O main valida o que vem do renderer e o preload valida o que vem do main. O preload expõe 4 funções.

## Dependências

**Runtime:** `react`, `react-dom` e `zod`, todas empacotadas no bundle.

**Dev:** `electron`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `esbuild`, `vitest`, `@electron/packager` e `@types/*`.

**Nativas, sem addon N-API:**
- whisper.cpp, compilado do código-fonte pela tag v1.9.5 em `vendor/`, porque é o motor de STT exigido.
- CoreAudio/AudioToolbox, que são frameworks do sistema.
- cmake, instalado via Homebrew, só para compilar o whisper.cpp.
