const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const URL = 'https://wayfarer.nianticlabs.com/';

let browser;
let page;
let isRunning = false;
let shouldStop = false;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clickAnswerForCriteria(kw, prefer) {
  try {
    // Find all visible buttons that look like answer buttons
    const allBtns = await page.locator('button:visible').all();

    // Find buttons by text content (XPath normalize-space)
    const positivoBtn = page.locator(`button:has-text("Positivo")`).first();
    const negativoBtn = page.locator(`button:has-text("Negativo")`).first();
    const naoSeiBtn = page.locator(`button:has-text("NÃO SEI")`).first();

    // Get Y and X positions of answer buttons
    const answers = [];
    if (await positivoBtn.count() > 0) {
      const box = await positivoBtn.boundingBox().catch(() => null);
      if (box) answers.push({ label: 'positivo', y: box.y, x: box.x, btn: positivoBtn });
    }
    if (await negativoBtn.count() > 0) {
      const box = await negativoBtn.boundingBox().catch(() => null);
      if (box) answers.push({ label: 'negativo', y: box.y, x: box.x, btn: negativoBtn });
    }
    if (await naoSeiBtn.count() > 0) {
      const box = await naoSeiBtn.boundingBox().catch(() => null);
      if (box) answers.push({ label: 'não sei', y: box.y, x: box.x, btn: naoSeiBtn });
    }

    if (answers.length === 0) {
      // Fallback: check aria-label
      const thumbUpBtn = page.locator(`button[aria-label*="up"], button[aria-label*="positivo"]`).first();
      const thumbDownBtn = page.locator(`button[aria-label*="down"], button[aria-label*="negativo"]`).first();
      const nsBtn = page.locator(`button[aria-label*="sei"]`).first();

      const answers2 = [];
      if (await thumbUpBtn.count() > 0) {
        const box = await thumbUpBtn.boundingBox().catch(() => null);
        if (box) answers2.push({ label: 'positivo', y: box.y, x: box.x, btn: thumbUpBtn });
      }
      if (await thumbDownBtn.count() > 0) {
        const box = await thumbDownBtn.boundingBox().catch(() => null);
        if (box) answers2.push({ label: 'negativo', y: box.y, x: box.x, btn: thumbDownBtn });
      }
      if (await nsBtn.count() > 0) {
        const box = await nsBtn.boundingBox().catch(() => null);
        if (box) answers2.push({ label: 'não sei', y: box.y, x: box.x, btn: nsBtn });
      }

      if (answers2.length > 0) answers.push(...answers2);
    }

    if (answers.length === 0) return false;

    // Find the question heading by keyword
    const kwLower = kw.toLowerCase();
    const headingEls = page.locator(`*`).filter({ hasText: new RegExp(`^${kw}$`, 'i') });
    let headingBox = null;
    for (let i = 0; i < await headingEls.count(); i++) {
      const el = headingEls.nth(i);
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 10 && box.height > 10) {
        headingBox = box;
        break;
      }
    }

    if (!headingBox) {
      // Try partial match
      const headingEls2 = page.locator(`*`).filter({ hasText: new RegExp(kw, 'i') });
      for (let i = 0; i < Math.min(await headingEls2.count(), 50); i++) {
        const el = headingEls2.nth(i);
        const box = await el.boundingBox().catch(() => null);
        const text = await el.textContent().catch(() => '');
        if (box && text.toLowerCase().includes(kwLower)) {
          headingBox = box;
          break;
        }
      }
    }

    if (!headingBox) return false;

    // Group answers by Y row (each question has 3 answer buttons)
    // Sort answers by Y then X
    answers.sort((a, b) => a.y - b.y || a.x - b.x);

    // Find which answer row is closest to the heading
    let targetAnswer = null;
    let minDist = Infinity;

    for (const a of answers) {
      const dist = Math.abs(a.y - headingBox.y);
      if (dist < minDist) {
        minDist = dist;
        targetAnswer = a;
      }
    }

    if (minDist > 250) return false; // too far

    // Get the full row of 3 buttons (same Y ± 5px)
    const rowY = targetAnswer.y;
    const rowBtns = [];
    for (const a of answers) {
      if (Math.abs(a.y - rowY) < 5) {
        rowBtns.push(a);
      }
    }
    rowBtns.sort((a, b) => a.x - b.x); // left to right

    // Map: 0=Positivo, 1=Negativo, 2=NÃO SEI
    const targetLabel = prefer === 'positive' ? 'positivo' :
                        prefer === 'negative' ? 'negativo' : 'não sei';

    const target = rowBtns.find(a => a.label === targetLabel);
    if (target) {
      await target.btn.click({ timeout: 3000 });
      return true;
    }
  } catch {}

  return false;
}

async function handleModal() {
  await sleep(600);

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
    await sleep(400);
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
    await sleep(400);
    const confirmBtn = modal.locator('button').filter({ hasText: /confirmar|continuar|ok/i }).first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click({ timeout: 3000 }).catch(() => {});
      console.log('  [OK] Confirmado');
    } else {
      await page.keyboard.press('Enter').catch(() => {});
    }
    await sleep(400);
    return;
  }

  // Any other modal — close
  await sleep(400);
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

  const criteria = [
    { kw: 'apropriado', prefer: 'positive' },
    { kw: 'apropriada', prefer: 'positive' },
    { kw: 'adequada', prefer: 'positive' },
    { kw: 'adequado', prefer: 'positive' },
    { kw: 'seguro', prefer: 'unknown' },
    { kw: 'exatid', prefer: 'unknown' },
    { kw: 'permanente', prefer: 'unknown' },
    { kw: 'distinto', prefer: 'unknown' },
    { kw: 'socializar', prefer: 'positive' },
    { kw: 'exercí', prefer: 'negative' },
    { kw: 'explorar', prefer: 'unknown' },
  ];

  for (const crit of criteria) {
    const found = await clickAnswerForCriteria(crit.kw, crit.prefer);
    const label = crit.prefer === 'positive' ? 'Positivo' : crit.prefer === 'negative' ? 'Negativo' : 'Não sei';
    if (found) {
      console.log(`  [OK] ${crit.kw} → ${label}`);
    } else {
      console.log(`  [!!] ${crit.kw} não encontrado`);
    }

    // Handle modals that may appear after clicking an answer
    await handleModal();
    await handleModal();

    await sleep(600);
  }

  // Category SIM buttons (0 to 3)
  await sleep(500);
  let simClicked = 0;

  for (let safety = 0; safety < 10; safety++) {
    // Re-fetch buttons each time
    const simBtns = await page.locator('button:visible').filter({ hasText: /^sim$/i }).all();
    const simBtnsEnabled = [];
    for (const btn of simBtns) {
      const disabled = await btn.isDisabled().catch(() => true);
      if (!disabled) simBtnsEnabled.push(btn);
    }

    if (simBtnsEnabled.length === 0) break;

    await simBtnsEnabled[0].click({ timeout: 3000 });
    simClicked++;
    console.log(`  [OK] Categoria #${simClicked} = SIM`);
    await sleep(800);
  }

  if (simClicked === 0) console.log('  [--] Sem categoria extra');

  // Submit
  await sleep(500);
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

  await page.goto(URL);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('[INFO] Página aberta. Faça login se necessário.');
  console.log('[INFO] Depois digite "start" para iniciar.\n');

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
          console.log('[INFO] Sem avaliações. Aguardando 15s...');
          await sleep(15000);
        } else {
          console.log('[INFO] Aguardando recarregar...');
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
          await sleep(2000);
        }
      } catch (e) {
        console.log(`[ERRO] ${e.message}`);
        await sleep(5000);
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
