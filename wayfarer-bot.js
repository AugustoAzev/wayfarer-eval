const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const URL = 'https://wayfarer.scopely.com/new/review';

// ============================================================
// CONFIGURAÇÕES DE TEMPO (em milissegundos)
// Aumente esses valores se a página estiver lenta ou o bot
// estiver clicando muito rápido e perdendo botões.
// ============================================================
const TIMING = {
  CLICK_DELAY:      700,   // pausa depois de cada clique em botão de resposta
  CATEGORY_DELAY:    700,   // pausa entre categorias (Sim/Não)
  MODAL_DELAY:       700,   // pausa para modal renderizar
  QUESTION_DELAY:   700,   // pausa entre responder uma pergunta e a próxima
  MODAL_AFTER:       400,   // pausa depois de fechar um modal
  PAGE_LOAD_DELAY:  3000,   // espera inicial da página carregar
  REVIEW_INTERVAL: 15000,   // espera quando não há avaliações para revisar
  ERROR_RECOVERY:   5000,   // pausa depois de erro no loop
};

let browser;
let page;
let isRunning = false;
let shouldStop = false;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Map question keywords → preferred answer
const ANSWER_MAP = {
  'apropriado': 'positive',
  'adequada': 'positive',
  'adequado': 'positive',
  'socializar': 'positive',
  'seguro': 'unknown',
  'exatid': 'unknown',
  'permanente': 'unknown',
  'distinto': 'unknown',
  'explorar': 'unknown',
  'exercí': 'negative',
};

async function clickAnswerForCriteria(kw, prefer) {
  try {
    const kwLower = kw.toLowerCase();

    // Strategy: Each wf-question-card has .question-title + .action-buttons-row.
    // Iterate all question cards and find the one matching the keyword.
    const cards = await page.locator('.wf-question-card').all();

    for (const card of cards) {
      try {
        // Get the question title within this card
        const titleEl = card.locator('.question-title').first();
        const titleCount = await titleEl.count();
        if (titleCount === 0) continue;

        const titleText = (await titleEl.textContent()).trim().toLowerCase();
        if (!titleText.includes(kwLower)) continue;

        // Found the matching card — get its action buttons
        const row = card.locator('.action-buttons-row').first();
        const rowCount = await row.count();
        if (rowCount === 0) continue;

        const rowBtns = await row.locator('button').all();
        let positivoBtn = null;
        let negativoBtn = null;
        let naoSeiBtn = null;

        for (const btn of rowBtns) {
          try {
            const disabled = await btn.isDisabled();
            if (disabled) continue;

            const cls = await btn.getAttribute('class') || '';

            if (cls.includes('dont-know-button')) {
              naoSeiBtn = btn;
              continue;
            }

            const matIcon = btn.locator('mat-icon');
            if (await matIcon.count() > 0) {
              const iconText = (await matIcon.textContent()).trim();
              if (iconText === 'thumb_up') positivoBtn = btn;
              else if (iconText === 'thumb_down') negativoBtn = btn;
            }
          } catch {}
        }

        const targetLabel = prefer === 'positive' ? 'positivo' :
                            prefer === 'negative' ? 'negativo' : 'não sei';

        let targetBtn = null;
        if (targetLabel === 'positivo') targetBtn = positivoBtn;
        else if (targetLabel === 'negativo') targetBtn = negativoBtn;
        else targetBtn = naoSeiBtn;

        if (!targetBtn) continue;

        // Check if already selected (aria-pressed or is-selected class)
        const ariaPressed = await targetBtn.getAttribute('aria-pressed').catch(() => 'false');
        const cls = await targetBtn.getAttribute('class').catch(() => '');
        const alreadySelected = ariaPressed === 'true' || cls.includes('is-selected');

        if (alreadySelected) {
          // Already answered — skip silently, don't re-click
          return true;
        }

        await targetBtn.click({ timeout: 5000 });
        return true;

      } catch {}
    }
  } catch (e) {
    console.log(`  [ERR clickAnswerForCriteria] ${e.message}`);
  }
  return false;
}

async function handleModal() {
  await sleep(TIMING.MODAL_DELAY);

  let modal = page.locator('[role="dialog"], [role="alertdialog"]');
  modal = modal.filter({ isVisible: true });
  if (await modal.count() === 0) {
    const anyModal = page.locator('div[aria-modal="true"], [class*="modal"], [class*="dialog"]');
    if (await anyModal.count() === 0) return;
    modal = anyModal.filter({ isVisible: true });
    if (await modal.count() === 0) return;
  }

  const modalText = await modal.textContent().catch(() => '');
  console.log(`  [MODAL] "${modalText.slice(0, 100).replace(/\n/g, ' ').trim()}"`);

  // "Locais não são seguros" — fechar
  if (modalText.toLowerCase().includes('não são seguros') ||
      modalText.toLowerCase().includes('perigosos') ||
      modalText.toLowerCase().includes('dangerous')) {
    const closeBtn = modal.locator('button').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ timeout: 3000 }).catch(() => {});
      console.log('  [OK] Modal fechado');
    } else {
      await page.keyboard.press('Escape');
    }
    await sleep(TIMING.MODAL_AFTER);
    return;
  }

  // "Localização" modal — find and check the checkbox
  if (modalText.toLowerCase().includes('localização') ||
      modalText.toLowerCase().includes('localiza')) {
    const checkbox = modal.locator('input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) {
        try {
          await checkbox.check({ timeout: 3000 });
          console.log('  [OK] Localização marcada');
        } catch {
          const box = await checkbox.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            console.log('  [OK] Localização marcada (coords)');
          }
        }
      }
    }
    await sleep(TIMING.MODAL_AFTER);
    const confirmBtn = modal.locator('button').filter({ hasText: /confirmar|continuar|ok/i }).first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click({ timeout: 3000 }).catch(() => {});
      console.log('  [OK] Confirmado');
    } else {
      await page.keyboard.press('Enter').catch(() => {});
    }
    await sleep(TIMING.MODAL_AFTER);
    return;
  }

  // Any other modal — close
  await sleep(TIMING.MODAL_AFTER);
  const closeBtn = modal.locator('button').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ timeout: 3000 }).catch(() => {});
    console.log('  [OK] Modal fechado');
  } else {
    await page.keyboard.press('Escape');
  }
}

async function clickSubmit() {
  const submitBtn = page.locator('button:has-text("Enviar")').first();
  if (await submitBtn.count() === 0) return false;
  const disabled = await submitBtn.isDisabled().catch(() => true);
  if (disabled) return false;
  await submitBtn.click();
  return true;
}

async function evaluateWayspot() {
  console.log('[Wayspot] Avaliando...');

  // Collect all question cards on the page (in DOM order)
  const cards = await page.locator('.wf-question-card').all();
  console.log(`  [INFO] ${cards.length} perguntas encontradas`);

  if (cards.length === 0) {
    console.log('  [!!] Nenhum card de pergunta encontrado');
    return;
  }

  let answered = 0;
  let skipped = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    try {
      const titleEl = await card.locator('.question-title').first();
      const titleText = (await titleEl.textContent().catch(() => '')).trim();

      // Determine answer based on keyword match (partial match)
      const titleLower = titleText.toLowerCase();
      let prefer = ANSWER_MAP[titleLower];
      if (!prefer) {
        // Try partial keyword match (e.g. "Permanente e distinto" → "permanente")
        for (const kw of Object.keys(ANSWER_MAP)) {
          if (titleLower.includes(kw)) {
            prefer = ANSWER_MAP[kw];
            break;
          }
        }
      }
      if (!prefer) {
        // No rule for this question type — skip
        console.log(`  [--] "${titleText}" — sem regra, ignorado`);
        skipped++;
        continue;
      }

      const label = prefer === 'positive' ? 'Positivo' :
                    prefer === 'negative' ? 'Negativo' : 'Não sei';

      // Get the action buttons within this card
      const row = await card.locator('.action-buttons-row').first();
      const rowBtns = await row.locator('button').all();

      let positivoBtn = null;
      let negativoBtn = null;
      let naoSeiBtn = null;

      for (const btn of rowBtns) {
        try {
          const disabled = await btn.isDisabled();
          if (disabled) continue;

          const cls = await btn.getAttribute('class') || '';

          if (cls.includes('dont-know-button')) {
            naoSeiBtn = btn;
            continue;
          }

          const matIcon = btn.locator('mat-icon');
          if (await matIcon.count() > 0) {
            const iconText = (await matIcon.textContent()).trim();
            if (iconText === 'thumb_up') positivoBtn = btn;
            else if (iconText === 'thumb_down') negativoBtn = btn;
          }
        } catch {}
      }

      let targetBtn = null;
      if (prefer === 'positive') targetBtn = positivoBtn;
      else if (prefer === 'negative') targetBtn = negativoBtn;
      else targetBtn = naoSeiBtn;

      if (!targetBtn) {
        console.log(`  [!!] "${titleText}" — botão não encontrado`);
        continue;
      }

      // Check if already selected
      const ariaPressed = await targetBtn.getAttribute('aria-pressed').catch(() => 'false');
      const clsAttr = await targetBtn.getAttribute('class').catch(() => '');
      const alreadySelected = ariaPressed === 'true' || clsAttr.includes('is-selected');

      if (alreadySelected) {
        console.log(`  [==] "${titleText}" — já respondido (skip)`);
        answered++;
        continue;
      }

      await targetBtn.click({ timeout: 5000 });
      console.log(`  [OK] "${titleText}" → ${label}`);
      answered++;

      // Wait for Angular re-render + modal handling
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(TIMING.CLICK_DELAY);
      await handleModal();
      await handleModal();

      // Special: "Exatidão" — checkboxes são opcionais, apenas marcar "Não sei"
      // (NEEDS_SUPPLEMENTARY removido — não preenchemos mais os checkboxes)

    } catch (e) {
      console.log(`  [!!] Card #${i} — ${e.message}`);
    }
  }

  console.log(`  [RESUMO] Respondidas: ${answered}, Ignoradas: ${skipped}`);

  // Category SIM buttons — each category is a separate mat-button-toggle-group with Sim/Não
  await sleep(TIMING.QUESTION_DELAY);
  let simClicked = 0;

  // Iterate each mat-button-toggle-group separately to handle 1, 2, or 3 categories
  const groups = await page.locator('mat-button-toggle-group').all();

  // Filter only groups that look like categories (contain a Sim/Não button and a label)
  const categoryGroups = [];
  for (const g of groups) {
    try {
      const visible = await g.isVisible();
      if (!visible) continue;
      const btns = await g.locator('button').all();
      let hasSim = false;
      for (const b of btns) {
        const text = (await b.textContent().catch(() => '')).trim().toLowerCase();
        if (text === 'sim') { hasSim = true; break; }
      }
      if (hasSim) categoryGroups.push(g);
    } catch {}
  }

  console.log(`  [INFO] ${categoryGroups.length} categorias para revisar`);

  for (const group of categoryGroups) {
    try {
      // Find the Sim button inside this group
      const simBtn = group.locator('button').filter({ hasText: /^sim$/i }).first();
      const count = await simBtn.count();
      if (count === 0) continue;

      const visible = await simBtn.isVisible().catch(() => false);
      if (!visible) continue;

      // Check if already pressed
      const ariaPressed = await simBtn.getAttribute('aria-pressed').catch(() => 'false');
      if (ariaPressed === 'true') continue; // already answered

      const disabled = await simBtn.isDisabled().catch(() => true);
      if (disabled) continue;

      // Get the category name (label inside the group, not Sim/Não)
      const labelEl = group.locator('.text-orange-500, [class*="orange"], div').filter({ hasText: /^(?!sim|não)/i }).first();
      const catName = (await labelEl.textContent().catch(() => '')).trim();

      await simBtn.click({ timeout: 3000 });
      simClicked++;
      console.log(`  [OK] Categoria #${simClicked} "${catName}" = SIM`);
      await sleep(TIMING.CATEGORY_DELAY);
    } catch (e) {
      console.log(`  [!!] Categoria: ${e.message}`);
    }
  }

  if (simClicked === 0) console.log('  [--] Sem categoria extra (ou todas já marcadas)');

  // Submit
  await sleep(TIMING.MODAL_AFTER);
  const sent = await clickSubmit();
  if (sent) {
    console.log('  [OK] ENVIAR clicado!');
  } else {
    console.log('  [!!] ENVIAR desabilitado — respostas incompletas?');
  }
}

async function evaluatePhoto() {
  console.log('[Foto] Avaliando...');

  const btns = await page.locator('button:visible').all();
  for (const btn of btns) {
    try {
      const text = (await btn.textContent()).trim();
      const disabled = await btn.isDisabled();
      if (disabled) continue;
      const t = text.toLowerCase();
      if (t === 'enviar' || t === 'submit' || t === 'sim') continue;
      if (text.length > 0 && text.length < 40) {
        await btn.click({ timeout: 3000 });
        console.log(`  [OK] "${text}"`);
        await sleep(800);
        break;
      }
    } catch {}
  }

  await sleep(500);
  await handleModal();
  await handleModal();

  const sent = await clickSubmit();
  if (sent) {
    console.log('  [OK] ENVIAR clicado!');
  } else {
    console.log('  [!!] ENVIAR não encontrado!');
  }
}

async function evaluateCurrentPage() {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

    const body = await page.textContent('body');
    const noItems = ['não há nada', 'nada para avaliar', 'no more', 'nothing to review'];
    if (noItems.some(t => body.toLowerCase().includes(t.toLowerCase()))) {
      console.log('[INFO] Nenhuma avaliação pendente.');
      return false;
    }

    const photoKeywords = ['avalie esta foto', 'avaliar foto', 'candidate photo', 'photo candidate', 'photo review'];
    const isPhoto = photoKeywords.some(t => body.toLowerCase().includes(t.toLowerCase()));

    if (isPhoto) {
      await evaluatePhoto();
    } else {
      await evaluateWayspot();
    }

    return true;
  } catch (e) {
    console.log(`[ERRO] ${e.message}`);
    return false;
  }
}

function findChromePath() {
  const candidates = [
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['ProgramFiles'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    try {
      require('fs').accessSync(p);
      return p;
    } catch {}
  }
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function getProfileDir() {
  const dir = path.join(os.tmpdir(), 'wayfarer-bot-profile');
  try {
    if (!require('fs').existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
  } catch {}
  return dir;
}

async function runBot() {
  console.log('\n========================================');
  console.log('   WAYFARER BOT');
  console.log('========================================\n');

  const chromePath = findChromePath();
  const profileDir = getProfileDir();
  console.log(`[INFO] Chrome: ${chromePath}`);

  try {
    browser = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromePath,
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--lang=pt-BR',
      ],
    });
    page = browser.pages()[0];
  } catch (e) {
    console.log(`[WARN] Chrome falhou: ${e.message}`);
    browser = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    page = browser.pages()[0];
  }

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  page.setDefaultTimeout(15000);

  // Open browser on the review URL (or any wayfarer page)
  console.log(`[INFO] Abrindo ${URL}...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(TIMING.PAGE_LOAD_DELAY);

  // Wait for any redirect or login flow to settle
  let attempts = 0;
  while (attempts < 10) {
    const cur = page.url();
    const onWayfarer = cur.includes('wayfarer.scopely.com') || cur.includes('wayfarer.nianticlabs.com');
    if (onWayfarer) break;

    // If we're on a Google/auth page, give user time to log in
    if (cur.includes('accounts.google') || cur.includes('signin') || cur.includes('login')) {
      console.log('[INFO] Aguardando login...');
      await sleep(TIMING.PAGE_LOAD_DELAY);
      attempts++;
      continue;
    }
    break;
  }

  // After login (or if already logged in), navigate to review page
  const currentUrl = page.url();
  if (currentUrl.includes('wayfarer') && !currentUrl.includes('/new/review')) {
    console.log('[INFO] Navegando para página de avaliação...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(TIMING.PAGE_LOAD_DELAY);
  }

  console.log('[INFO] Página de avaliação pronta.');
  console.log('[INFO] Digite "start" para iniciar.\n');

  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = () => {
    rl.question('> start / stop / exit: ', async (cmd) => {
      const c = cmd.trim().toLowerCase();

      if (c === 'start') {
        if (!isRunning) {
          isRunning = true;
          shouldStop = false;
          console.log('[BOT] Iniciando automação...\n');
          await runLoop();
        }
      } else if (c === 'stop') {
        shouldStop = true;
        console.log('[BOT] Pausando...\n');
      } else if (c === 'exit') {
        shouldStop = true;
        isRunning = false;
        console.log('[BOT] Encerrando...');
        await browser.close();
        process.exit(0);
      } else {
        console.log('[BOT] use: start, stop ou exit');
      }

      if (isRunning) ask();
    });
  };

  ask();

  async function runLoop() {
    while (isRunning && !shouldStop) {
      try {
        const ok = await evaluateCurrentPage();
        if (!ok) {
          console.log(`[INFO] Sem avaliações. Aguardando ${TIMING.REVIEW_INTERVAL / 1000}s...`);
          await sleep(TIMING.REVIEW_INTERVAL);
        } else {
          console.log('[INFO] Aguardando recarregar...');
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
          await sleep(TIMING.PAGE_LOAD_DELAY);
        }
      } catch (e) {
        console.log(`[ERRO] ${e.message}`);
        await sleep(TIMING.ERROR_RECOVERY);
      }

      if (shouldStop) {
        isRunning = false;
        console.log('[BOT] Pausado.\n');
        ask();
        break;
      }
    }
  }
}

process.on('uncaughtException', e => console.error('[FATAL]', e.message));
process.on('unhandledRejection', e => console.error('[FATAL]', e.message));

runBot();
