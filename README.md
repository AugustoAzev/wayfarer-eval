# Wayfarer Bot

Automação de avaliações Wayfarer via Playwright.

## Instalação

```bash
cd C:\Users\bruno\OneDrive\Desktop\wayfarer
npm install
npx playwright install chromium
```

## Uso

```bash
npm start
```

O navegador vai abrir wayfarer.nianticlabs.com. Faça login normalmente.

Após o login, o terminal mostra um prompt interativo:

- `start` — Inicia a automação
- `stop` — Pausa após o próximo ciclo
- `exit` — Encerra tudo

## Comportamento

### Wayspot
| Critério | Resposta |
|---|---|
| Apropriado | Positivo |
| Seguro | NÃO SEI |
| Exatidão | NÃO SEI |
| Permanente e distinto | NÃO SEI |
| Socializar | Positivo |
| Exercícios | Negativo |
| Explorar | NÃO SEI |
| A categoria é apropriada? | SIM (se aparecer) |

### Foto
Seleciona a primeira opção visível e envia.

## Estrutura

```
wayfarer/
├── wayfarer-bot.js    # Script principal
├── package.json       # Dependências
├── wayspot/           # Página baixada (referência)
│   └── Niantic Wayfarer.html
└── foto/              # Página baixada (referência)
    └── Niantic Wayfarer.html
```
