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

## Cor de destaque: Brasa

Laranja-brasa, quente e diferente da referência monocromática. Remete à "luz" da legenda sobre o vídeo e só aparece na ação primária, no estado "ouvindo" e no foco.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#F6F5F3` | `#1C1B1A` | fundo das janelas (neutro levemente quente) |
| `--surface` | `#FFFFFF` | `#262524` | cards e linhas |
| `--surface-2` | `#EFEDEA` | `#2F2D2B` | áreas recuadas e trilho de controles |
| `--text` | `#1C1B1A` | `#F2F0ED` | texto primário |
| `--text-2` | `#6B6863` (5,1:1) | `#A19D97` (6,4:1) | texto secundário (AA) |
| `--border` | preto 9% | branco 10% | bordas finas |
| `--accent` | `#C2410C` (texto branco 5,2:1) | `#FF8A5B` (7,4:1 no fundo; texto escuro 8,1:1) | ação primária, foco |
| `--success` | `#1E7B4A` | `#4CC38A` | permissão ok, modelo pronto |
| `--warning` | `#A15C00` | `#F0B43C` | atenção |
| `--danger` | `#C0261B` | `#FF6B5E` | erro, apagar |

Os contrastes foram calculados com a fórmula WCAG 2.x (script em Python na sessão de desenvolvimento). Os tokens ficam em `src/renderer/shared/tokens.css`. Raios: 6, 10 e 14 px. Duração das transições: 180 ms. Easing: `cubic-bezier(.2,0,0,1)`.

## Ícones

- **App** (`assets/brand/app-icon.svg` → `build/macos/icon.icns`):
  - Formato: squircle na grade de 824/1024 do macOS, com gradiente Brasa.
  - Desenho: um balão de fala branco com **duas linhas de legenda**, uma sólida e uma atenuada. É a metáfora do produto: texto confirmado e texto provisório.
- **Barra de menus** (`assets/tray/*Template.png`): *template images* monocromáticas de 18 pt, em @1x e @2x.
  - **Inativo:** balão em contorno.
  - **Ouvindo:** balão preenchido, com as linhas vazadas.
- **Geração:** `npx electron scripts/render-icons.cjs` renderiza os SVGs com o próprio Electron e chama o `iconutil`. Não há dependência extra.

## Tipografia

- **Interface:** a fonte do sistema (`-apple-system`, que é o SF Pro).
- **Legendas:** configuráveis entre Sistema (SF Pro), Arredondada (SF Pro Rounded), Serifada (New York) e Monoespaçada (SF Mono). O padrão é Sistema em peso médio, que tem alta legibilidade em tamanho grande.

## Ícones de interface

A biblioteca é **Lucide** (`lucide-react`), com traço de 1,75 px em 16 a 18 px, importada por ícone (tree-shaking). Não usamos SF Symbols.
