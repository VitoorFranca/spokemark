# Identidade visual — Spokemark

## Nome: **Spokemark**

*spoken* + *mark*: a marca do que foi dito. O nome foi escolhido amplo de propósito: serve para as legendas ao vivo de hoje e para a expansão planejada (transcrição de reuniões, histórico, atas), além de uma possível versão community open source.

**Domínios em 11/10/2026**, consultados por RDAP (fonte oficial do registro; `404` significa não registrado):
- **Fontes:** `spokemark.com` (Verisign) e `spokemark.app` (Google Registry).
- **Resultado:** os dois estavam **livres**.
- **Limite da checagem:** "Não registrado" não garante preço normal, porque o domínio pode ser reservado ou *premium*. É preciso confirmar num registrador antes de comprar.
- **Conflito:** nenhum app ou produto com esse nome encontrado em busca na web. Não foi feita busca de marca registrada (INPI/USPTO).

**Histórico da escolha:**
1. O primeiro nome proposto foi **Earline**, com `.app` livre e `.com` registrado. Foi descartado porque o `.com` não estava disponível.
2. Na segunda rodada, ~130 candidatos foram testados com a exigência de `.com` **e** `.app` livres. Quase todo nome com palavra comum já tem o `.com` registrado.
3. Passaram 8 nomes: Saidstone, Minuteloom, Wrenote, **Spokemark**, Quillear, Heardlight, Heardara e Larkscribe. Larkscribe tinha menção a um app de áudio com o mesmo nome; Minuteloom é próximo da marca Loom.

**Onde o nome está no código:** numa constante única, `APP_NAME` em `src/shared/brand.ts`, que também define o nome do pacote, os textos, a pasta de dados e o menu.
- **Bundle ID:** continua o do MVP, para preservar a permissão TCC já concedida.
- **Pasta de dados:** as pastas de builds anteriores ("Earline" e "Live Captions") são migradas uma vez.

## Logo

**Fonte:** `assets/logo.png`, de 1254 px. A logo foi gerada por IA (ChatGPT), sem designer contratado e sem uso intencional de elementos de terceiros. Mostra um "S" em forma de balão de fala, em branco, gelo e ciano com brilho, sobre um squircle azul-elétrico e fundo azul-marinho.

**Uso:** a licença MIT do código **não** se aplica ao nome, à logo nem à identidade visual. Veja [`TRADEMARKS.md`](../TRADEMARKS.md).

### Derivados gerados a partir da logo

| Arquivo | Como é gerado | Uso |
|---|---|---|
| `build/macos/icon.icns` (128 a 1024 px) | **PNG original**, recortado com squircle de cantos contínuos (superelipse n=5) e posicionado na grade de 824/1024 do macOS | Ícone do app |
| `build/macos/icon.icns` (16 e 32 px) | `logo.svg` | Nos tamanhos pequenos, o brilho do original vira borrão; o vetor fica nítido |
| `src/renderer/public/icon.png` | PNG original recortado, 512 px | Logo dentro do app (painel, onboarding, Sobre, sidebar) |
| `assets/brand/glyph.svg` | Glifo vetorizado com `potrace` a partir do PNG (pixels claros: verde > 140, dentro do squircle) | Base dos vetores abaixo |
| `assets/brand/logo.svg` | **Recriação** vetorial, com gradientes e brilho aproximados; não é cópia exata | Tamanhos pequenos, web e documentação |
| `assets/tray/*Template.png` | `tray-idle.svg` (glifo sólido) e `tray-listening.svg` (glifo com ponto indicador), em 18 pt @1x/@2x | Barra de menus (*template images* monocromáticas) |

**Regerar:** `scripts/brand/vectorize-logo.sh`, depois `npx electron scripts/render-icons.cjs`. O pipeline é reproduzível: a saída é idêntica byte a byte aos arquivos versionados.

## Cores (derivadas da logo)

Amostradas nos pixels da logo:
- **Azul-marinho:** `#00061E` / `#012478`
- **Azul-elétrico:** `#1658FA` / `#0034BE`
- **Ciano:** `#18D2FD`
- **Gelo:** `#BBECFD`

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#F5F6FA` (neutro frio) | `#0A0F1F` (marinho) | fundo das janelas |
| `--surface` / `--surface-2` | `#FFFFFF` / `#ECEEF5` | `#121A30` / `#1A2440` | cards e áreas recuadas |
| `--text` | `#0D1326` (17:1) | `#EAF0FB` (16,7:1) | texto primário |
| `--text-2` | `#566079` (5,8:1) | `#9AA7C2` (7,9:1) | texto secundário |
| `--accent` | `#1658FA`, azul-elétrico (texto branco 5,5:1) | `#18D2FD`, ciano (10,6:1; texto marinho 10,3:1) | ação primária, seleção, foco |
| `--signal` | `#0789B8` (3,7:1, gráfico) | `#18D2FD` | estado "ouvindo", medidor de nível |
| `--success` / `--warning` / `--danger` | `#0F7A50` / `#9A5A00` / `#C42B1F` | `#3FD49A` / `#F2B84B` / `#FF7A6E` | estados (todos ≥ 4,5:1 nas superfícies) |
| `--chrome-tint` | gelo a 35% | marinho a 55% | tinge a vibrancy do sistema na cor da marca (painel, sidebar, toolbar) |
| `--glow` | sombra azul | contorno ciano com sombra azul | brilho **estático** no botão principal enquanto ouve, que remete ao brilho da logo |

- **Contraste:** calculado com a fórmula WCAG 2.x. Os tokens ficam em `src/renderer/shared/tokens.css`.
- **Raios:** 6, 10 e 14 px. **Transições:** 180 ms.
- **Overlay:** **não** usa a cor da marca. Mantém branco sobre preto por legibilidade.
- **Azul é a cor padrão do macOS:** a identidade se diferencia pelo ciano (estado ativo) e pelo marinho (tema escuro).

## Tipografia

- **Interface:** a fonte do sistema (`-apple-system`, que é o SF Pro).
- **Legendas:** configuráveis entre Sistema (SF Pro), Arredondada (SF Pro Rounded), Serifada (New York) e Monoespaçada (SF Mono). O padrão é Sistema em peso médio, que tem alta legibilidade em tamanho grande.

## Ícones de interface

A biblioteca é **Lucide** (`lucide-react`), com traço de 1,75 px em 16 a 18 px, importada por ícone (tree-shaking). Não usamos SF Symbols.
