# Decisões de design (redesign Spokemark)

Cada item traz o que foi escolhido, as alternativas descartadas e o motivo. As medições foram feitas no MacBook Air M4 com macOS 26.6.2.

## Estrutura de produto

- **O painel da barra de menus é a superfície principal**, porque resolve o uso diário: ligar e desligar, ver o que está sendo captado e ajustar o essencial. O que é de consulta (transcrição ampla e histórico) fica na janela principal, e o que é de configuração fica na janela de Configurações. Descartado: manter o menu nativo do Tray, que não mostra estado, prévia nem erros acionáveis.
- **Uma ação primária por tela.** No painel é Iniciar/Parar, exceto quando um card (modelo ausente ou modelo corrompido) traz a ação que destrava o uso; nesse caso o botão grande fica neutro e desativado. Na aba Transcrição, "Usar" é secundário.
- **Erros dizem o que aconteceu e o que fazer.** As falhas técnicas são classificadas em `model`, `capture` ou `unknown`, e cada tipo tem um texto em pt-BR/en e uma ação. Modelo que falha ao carregar ganha "Baixar de novo", que apaga e baixa de novo. A mensagem técnica fica só no tooltip e nos logs.
- **Nada de placeholders:** não há "Em breve" nem controle morto. Busca e "Apagar…" somem quando o histórico está vazio. O idioma falado aparece como informação ("Inglês"), não como um seletor com uma única opção.

## Sensação nativa

- **Vibrancy:** `popover` no painel, `sidebar` na janela principal e `titlebar` na toolbar das Configurações. As áreas de conteúdo pintam `--bg` sólido, e as superfícies sobre vibrancy usam vidro translúcido (`--glass`).
- **Semáforos:** `titleBarStyle: 'hiddenInset'` com `trafficLightPosition` alinhado ao conteúdo. Toolbar e cabeçalhos são `-webkit-app-region: drag`, e os controles dentro deles são `no-drag`.
- **Comportamento de interface:** sem seleção de texto na interface (só as transcrições são selecionáveis), sem cursor de mão e com foco visível só para teclado. O foco programático usa `focusVisible: false`, e o título de cada passo do onboarding recebe foco para o VoiceOver, sem anel.
- **Menu do app completo,** com os atalhos padrão: ⌘, (Configurações), ⌘W, ⌘Q, ⌘F (busca no histórico) e ⌘0 (janela principal).
- **Tema:** o `prefers-color-scheme` **não acompanha** o `nativeTheme.themeSource` nos renderers deste Electron. Isso foi medido com Playwright: o main dizia `shouldUseDarkColors: true` e o renderer via `matches: false`.
  - **Solução:** o main é a fonte da verdade. Ele envia `dark` no estado, o renderer aplica `data-theme` no `<html>`, e o primeiro quadro já sai certo porque o preload lê o tema de forma síncrona uma vez.
  - **Cor de destaque:** usamos o destaque próprio da marca, e não o do sistema, para manter a identidade e um contraste AA verificado.

## Painel

- **Ciclo de vida medido** (do clique até o painel pintado, 12 aberturas cada):
  - **Pré-carregado permanente:** p50 de 42 ms, mas custa ~100–117 MB de renderer o tempo todo, o que leva o repouso de 376 para 503 MB.
  - **Criado no clique:** p50 de 138–153 ms e p95 de 188–190 ms.
  - **Escolhido, aquecido no hover:** o painel é criado no `mouse-enter` do ícone e destruído 60 s depois de fechado. Medido: **p50 de 47 ms e p95 de 59 ms** com hover, e 43 ms ao reabrir dentro de 60 s. Sem hover (a frio), o p50 é de 138 ms.
- **Teclado:** ao abrir, o foco vai para o botão principal. Tab percorre todo o painel, o menu `⋯` funciona com as setas e Esc fecha.
- **Medidor de nível:** só aparece e se mexe enquanto captura. Ele é alimentado pelo RMS calculado no main a ~15 Hz e enviado só para janelas visíveis.

## Configurações

- **Prévia ao vivo:** é o mesmo componente (`CaptionBox`) e a mesma função de estilo (`captionCss`) usados pelo overlay, então o que aparece na prévia é o que o overlay renderiza. A animação de exemplo **toca uma vez** e repete só quando o estilo muda. Descartado: um loop contínuo, que viola a regra de "nenhuma animação em loop".
- **Predefinições:** "Padrão", "Alto contraste" (peso 700, fundo a 92%) e "Cinema" (sem caixa, com contorno no texto). Aplicar uma predefinição ajusta fonte, tamanho e fundo, e cada valor continua ajustável depois.
- **Modelos:** a velocidade relativa foi medida offline, como mediana de 5 inferências numa janela de 10 s: base-q5 149 ms, base 159 ms, small-q5 388 ms e small 430 ms. Para a precisão relativa, os nossos testes com fala limpa não separaram os modelos, então ela segue a ordem por tamanho do artigo do Whisper e **nenhum número de WER aparece na interface**.
- **Atalhos configuráveis:** um gravador de teclas exige ⌘, ⌃ ou ⌥. Se o registro falhar (atalho já em uso), o campo fica vermelho com uma explicação.

## Histórico

- **`node:sqlite` com FTS5,** que é o SQLite 3.53 embutido no Node 24 do Electron 44.
  - Descartado `better-sqlite3`: é addon nativo, precisaria ser recompilado para o ABI do Electron e é uma dependência a mais.
  - Descartado JSON com busca linear: não escala para meses de histórico.
- **Escrita:** só palavras **confirmadas**, agrupadas em segmentos (pausa, troca de falante, 32 palavras ou 12 s) e gravadas **em lote a cada 2 s** numa transação. Sessão sem nenhuma palavra não é salva.
- **Busca:** cada termo é tratado como prefixo entre aspas, o que é seguro contra a sintaxe do FTS. Os resultados mostram o trecho com o termo destacado.
- **App de origem:** o `audiotap` lista os processos com `kAudioProcessPropertyIsRunningOutput` e sobe até o app "regular" pai (por exemplo, o processo de áudio do Chrome vira "Google Chrome"). A sessão guarda o app mais frequente.

## Overlay

- **Sem mudança de comportamento:** click-through, `type: 'panel'`, todos os Spaces e tela cheia continuam como antes. O estilo vem das predefinições.
- **Modo de edição:** mostra uma borda sutil, uma alça no canto e a dica "Arraste para mover · Esc para concluir". A janela recebe foco só nesse modo, para o Esc funcionar.

## Verificação visual

- **Capturas com `screencapture -l <CGWindowID>`** (o ID vem de `getMediaSourceId()`), em vez de `webContents.capturePage`. O `capturePage` captura só o conteúdo web, então as áreas com vibrancy saem transparentes e não representam o que o usuário vê.
- **Estados não felizes reais,** sem mocks: modelo ausente (pasta vazia), download em andamento (download real) e erro (arquivo de modelo inválido). O card de **permissão negada** não foi capturado, porque exigiria revogar a permissão real do usuário.

## Identidade

Veja `docs/BRAND.md`.
