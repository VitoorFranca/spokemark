# Resultados medidos

Ambiente: MacBook Air M4 com 16 GB, macOS 26.6.2, Electron 44.7.0 e whisper.cpp v1.9.5 com Metal. Os números abaixo foram medidos nesta máquina; o que não foi medido está marcado.

Todo o áudio foi tocado pela saída real do sistema (`afplay`, `say` ou Chrome) e capturado pelo Process Tap. Os textos de referência são falas sintéticas do macOS (`say`) e o `jfk.wav`, que é fala humana real de domínio público, vindo dos samples do whisper.cpp.

## Fase 1: captura

| Teste | Resultado |
|---|---|
| `afplay` de fala em inglês, 10 s gravados em WAV | 48 000 Hz, 2 canais, float32 intercalado, RMS 0,163 (−15,8 dBFS) |
| Vídeo no Chrome (YouTube), 10 s | RMS 0,0565 (−25,0 dBFS) |
| Sem permissão TCC | RMS 0 (zeros digitais), e o evento `silent-since-start` foi emitido |
| Áudio continua audível durante a captura | Confirmado pelo usuário |
| Prompt de permissão no app empacotado | Apareceu, e o usuário clicou em "Permitir" |
| Relógio captura → main | ~32 ms (p50 e p95), latência de entrega do tap |

## Fase 2: transcrição (harness headless `dist/cli/transcribe.js`, mesmos módulos do app)

A latência aqui vai da captura da última amostra da palavra até o resultado chegar no main, sem a renderização.

| Teste | base.en | small.en |
|---|---|---|
| Referência de 75 palavras com pausa de 5 s: WER | 0% | 1,3% (1 deleção) |
| Inferência p50 / p95 | 179 / 243 ms | 338 / 423 ms |
| Primeira aparição da palavra, p50 / p95 | 527 / 1204 ms | 491 / 1187 ms |
| Confirmação (LocalAgreement), p50 / p95 | 946 / 1556 ms | 934 / 1493 ms |
| `jfk.wav` (fala humana real): WER | 0% | não medido |
| 45 s de silêncio | 0 palavras e 0 inferências | não medido |

Com dedup só por timestamp (a primeira versão), a WER do mesmo teste foi de 5,3%.

**Depois da correção do fim de frase (código final), com base.en:**
- **Referência:** 3 execuções, WER de 1,3%, 0% e 0%. Primeira aparição com p50 de 392, 481 e 565 ms e p95 de 1230, 1133 e 1207 ms. Confirmação com p50 de 927 a 968 ms e p95 de 1413 a 1490 ms.
- **`jfk.wav`:** WER 0%.
- **45 s de silêncio:** 0 palavras e 0 inferências.

## App empacotado (`Live Captions.app`, assinatura ad hoc)

A latência aqui vai da captura da última amostra até o overlay pintado: o renderer confirma depois do `requestAnimationFrame`.

### Sessão de 30 min com base.en, build final

Playlist em loop: 6 falas e 5 vozes, pausas de 1 a 10 s e 60 s de silêncio por volta. Métricas amostradas a cada minuto (32 amostras).

- **Latência na tela:** mediana dos p50 por minuto de 446 ms e dos p95 de 1312 ms. O pior minuto teve p95 de 2104 ms.
- **WER:** 2,3% em 2750 palavras. Por arquivo: ref1 0,4%, p2 2,1%, p3 2,4%, p4 7,2% (voz britânica "Eddy"), jfk 3,2% e p5 0,5%.
- **Silêncio:** 621 s de pausas longas, com 0 palavras.
- **Memória total** (app + overlay + worker + captura): 745 / 753 / 755 MB nos 3 primeiros minutos e 676 / 666 / 666 MB nos 3 últimos. Sem crescimento. O worker ocupa ~260 a 300 MB.
- **CPU total:** mediana de 8,2% e máximo de 25%. Os valores vêm do `%cpu` do `ps`, que é uma média decaída, mais `app.getAppMetrics()`.
- **Inferências:** 1939, com 2 passos descartados por backpressure.
- **Depois do quit:** 0 helpers.

A sessão anterior, rodada antes da correção do fim de frase, teve resultados equivalentes: p50 de 493 ms, p95 de 1253 ms, WER de 2,8%, 0 palavras no silêncio e memória sem crescimento.

### Sessão de 6 min com small.en (trocado em execução, sem reiniciar o app)

- **Latência na tela:** p50 de 625 ms e p95 de 1522 ms (mediana por minuto).
- **WER:** 3,8% em 550 palavras.
- **Silêncio:** 124 s, com 0 palavras.
- **Memória total:** ~1,0 GB, estável.
- **Depois do quit:** 0 helpers.

### Ciclo de vida

| Teste | Resultado |
|---|---|
| 10 ciclos de Stop/Start (SIGUSR1 = mesma função do menu), executados duas vezes, a segunda no build final | 0 helpers depois de cada Stop, 0 órfãos, memória da árvore do app entre 308 e 375 MB, sem crescimento |
| Quit (`osascript quit`) | 0 processos do app e 0 helpers |
| `kill -9` no processo main | helpers saem sozinhos (EOF no stdin): 0 restantes |
| Troca de modelo com o app aberto | PID do app inalterado, worker reiniciado com o novo modelo (base.en → base.en-q5_1 → small.en → small.en-q5_1 → base.en) |

## Não verificado

- **Chamada real no Meet, Zoom ou Discord:** depende do usuário.
- **Fones com fio ou Bluetooth e troca de saída com a captura ativa:** o código está implementado, mas não há hardware disponível na sessão.
- **Permissão negada e depois concedida:** exige que o usuário altere o Ajustes do Sistema.
- **Overlay sobre app em tela cheia e em outros Spaces:** depende de `type: 'panel'`, que é o comportamento documentado; não testei interativamente.
- **Múltiplos monitores:** só há um monitor.
- **Click-through e arrastar/redimensionar no modo de edição:** implementados, mas não exercitados com mouse real.
- **`setContentProtection` durante compartilhamento de tela:** não testado. Pela documentação, apps que usam ScreenCaptureKit capturam a janela mesmo assim.

## Troca de falante (tinydiarize, `small.en-tdrz`)

| Teste | Resultado |
|---|---|
| 3 diálogos sintéticos (`say`, 2 a 3 vozes, pausas de 0, 300 e 800 ms, 16 trocas) | **0 trocas detectadas**, também offline com o `whisper-cli` oficial. O modelo não reconhece troca em voz sintética, então esse teste não serve para avaliá-lo. |
| Exemplo oficial Apollo 13 (rádio NASA, fala humana real), offline com `whisper-cli -tdrz` | 21 trocas marcadas, igual ao README do whisper.cpp |
| Mesmo áudio tocado pelo sistema, streaming, **sem** contexto de transição | 1 a 2 das 21 trocas offline (recall de 5 a 10%), 0 falsas |
| Streaming **com** 3 s de contexto (padrão para tdrz) | 2 execuções: recall de 52% e 57%, precisão de 73% e 75% (tolerância de ±2 palavras) |
| Monólogos (ref1, p2, p3) com tdrz + contexto | 0 trocas falsas. WER de 1,3%, 2,4% e 0% (o contexto não duplicou palavras) |
| Latência em fala limpa (monólogos), primeira aparição | p50 de 533 a 714 ms, p95 de 1,27 a 2,54 s (`small.en` sem tdrz: 491 ms / 1,19 s) |
| Latência no áudio Apollo 13 (rádio ruidoso), primeira aparição | tdrz + contexto: 1,42 s / 4,03 s. `small.en` comum no mesmo áudio: 1,03 s / 6,14 s |
| App empacotado | Troca para `small.en-tdrz` sem reiniciar o app, worker com `--tdrz`, e o overlay mostra cada fala numa linha com "–" (captura de tela verificada) |

**Ressalva importante:** a referência das 21 trocas é a saída **offline do próprio modelo**, não uma anotação humana. Ela mede o quanto o streaming preserva o que o modelo faria com o arquivo inteiro; a precisão absoluta contra a verdade não foi medida. Uma chamada real é o teste definitivo.
