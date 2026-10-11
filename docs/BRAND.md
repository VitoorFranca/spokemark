# Identidade visual

## Nome

"Live Captions" colide com o recurso **Legendas ao Vivo** nativo do macOS. Candidatos, verificados em 11/10/2026:
- **Domínio:** consulta RDAP no registro do `.app` (pubapi.registry.google). `404` significa domínio livre.
- **Conflito:** busca na web por apps com o mesmo nome.

| # | Nome | Ideia | `.app` | Conflito óbvio |
|---|---|---|---|---|
| 1 | **Earline** (padrão) | *ear* + *line*: o ouvido vira linha de legenda | livre | nenhum encontrado |
| 2 | **Lumeline** | linha iluminada sobre o vídeo | livre | nenhum encontrado (há apps "Lumi…" sem relação) |
| 3 | **Sublio** | *sub*(title) + sufixo curto | livre | parecido com "Sublo", extensão de tradução de legendas para Chrome: risco de confusão |

Descartados por domínio já registrado: subline, hearline, overhear, echoline, captio, captionly, legendo, linewise.

O nome fica numa constante única, `APP_NAME` em `src/shared/brand.ts`. O `BUNDLE_ID` foi mantido do MVP porque a permissão TCC é atrelada a ele, e trocar o nome não deve exigir conceder a permissão de novo. A pasta de dados do MVP (`Live Captions`) é migrada uma vez na primeira execução.

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
