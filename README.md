# Wayfarer Bot

Automação de avaliações Wayfarer (Niantic) usando Playwright. O bot abre o Chrome,
faz login na conta e avalia Wayspots de acordo com as regras configuradas.

---

# Resultados

<div align="center">
<em>Dia 1</em> &nbsp;&nbsp;&nbsp;&nbsp; <em>Dia 2</em> &nbsp;&nbsp;&nbsp;&nbsp; <em>Dia 3</em> &nbsp;&nbsp;&nbsp;&nbsp; <em>Dia 4</em>
<br>
<img src="img/day_1.jpg" width="20%" />
<img src="img/day_2.jpg" width="20%" />
<img src="img/day_3.jpg" width="20%" />
<img src="img/day_4.jpg" width="20%" />

</div>

---

## Instalação

```bash
# 1. Entrar na pasta do projeto
cd wayfarer-eval

# 2. Instalar dependências
npm install

# 3. Instalar o Chromium do Playwright (caso ainda não tenha)
npx playwright install chromium
```

> **Requisito**: o Google Chrome precisa estar instalado no sistema (o bot usa
> seu executável real para evitar detecção de automação).

---

## Como usar

```bash
npm start
```

**Fluxo automático:**

1. O Chrome abre direto em `https://wayfarer.scopely.com/new/review`
2. Se você não estiver logado, o script espera você fazer login no navegador
3. Após o login, ele navega sozinho para a página de avaliação
4. O terminal mostra um prompt interativo:

| Comando | Ação |
|---|---|
| `start` | Inicia o loop de avaliações |
| `stop` | Pausa após o próximo ciclo |
| `exit` | Fecha o navegador e encerra |

---

## O que o bot faz

### Wayspot

Para cada wayspot disponível, responde cada pergunta conforme o mapa abaixo:

| Critério | Resposta |
|---|---|
| Apropriado | Positivo |
| Adequado / Adequada | Positivo |
| Seguro | NÃO SEI |
| Exatidão | NÃO SEI |
| Permanente e distinto | NÃO SEI |
| Socializar | Positivo |
| Exercícios | Negativo |
| Explorar | NÃO SEI |

Em seguida, para a seção **"As categorias selecionadas são apropriadas?"**
(quando aparece com 1, 2 ou 3 categorias), clica **Sim** em cada categoria.

Por fim, clica em **Enviar**.

### Foto
Seleciona a primeira opção visível e envia.

---

## Configuração de tempos

Edite o objeto `TIMING` no topo do arquivo `wayfarer-bot.js`:

```js
const TIMING = {
  CLICK_DELAY:      1500,   // pausa depois de cada clique em botão de resposta
  CATEGORY_DELAY:    800,   // pausa entre categorias (Sim/Não)
  MODAL_DELAY:       700,   // pausa para modal renderizar
  QUESTION_DELAY:   1200,   // pausa entre responder uma pergunta e a próxima
  MODAL_AFTER:       400,   // pausa depois de fechar um modal
  PAGE_LOAD_DELAY:  3000,   // espera inicial da página carregar
  REVIEW_INTERVAL: 15000,   // espera quando não há avaliações para revisar
  ERROR_RECOVERY:   5000,   // pausa depois de erro no loop
};
```

> Se a página estiver lenta e o bot estiver clicando rápido demais (perdendo
> botões), aumente `CLICK_DELAY` e `QUESTION_DELAY` para 2000–3000.

---

## Estrutura

```
wayfarer-eval/
├── wayfarer-bot.js    # Script principal
├── package.json       # Dependências
├── README.md          # Este arquivo
├── url_sile.txt       # URL inicial
├── wayspot/           # HTML de referência (página wayspot)
│   └── Niantic Wayfarer.html
└── foto/              # HTML de referência (página foto)
    └── Niantic Wayfarer.html
```

---

## Aviso

Use com responsabilidade. O uso desta ferramenta pode violar os Termos de
Serviço do Niantic Wayfarer e resultar em banimento da sua conta. Esta
automação foi criada para fins educacionais / de estudo.