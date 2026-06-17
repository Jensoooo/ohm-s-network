const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGE ERROR: ' + e.message));
  await page.goto('https://ohmeraapp.vercel.app/netzplan', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Test 1: Click expand on first chain
  const scoreBtns = await page.locator('button').filter({ hasText: /^\d+/ }).all();
  console.log('Score-Buttons gefunden: ' + scoreBtns.length);
  if (scoreBtns.length > 0) {
    await scoreBtns[0].click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'netzplan-expanded.png', fullPage: false });
    console.log('Screenshot nach Expand gemacht');

    // Check if vertical column appeared
    const verticalCards = await page.evaluate(() => {
      // Vertical cards are 176px wide
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const s = b.getAttribute('style') || '';
        return s.includes('176') || s.includes('78');
      });
      return btns.length + ' vertikale Cards, Texte: ' + btns.slice(0,3).map(b => b.textContent.trim().substring(0,30)).join(' | ');
    });
    console.log('Nach Expand: ' + verticalCards);

    // Check X button (collapse)
    const xBtns = await page.locator('svg.lucide-x').count();
    console.log('X-Buttons (collapse): ' + xBtns);
  }

  // Test 2: Connect Mode
  const connectBtn = await page.locator('button svg.lucide-link-2').first();
  if (await connectBtn.count() > 0) {
    await connectBtn.click();
    await page.waitForTimeout(500);
    const bg = await page.evaluate(() => {
      const el = document.querySelector('[style*="1a0a3d"]');
      return el ? 'Connect-BG #1a0a3d AKTIV' : 'Connect-BG nicht gefunden';
    });
    console.log('Connect Mode BG: ' + bg);
    await page.screenshot({ path: 'netzplan-connect.png', fullPage: false });
  }

  // Test 3: showDone checkbox
  const checkbox = await page.locator('input[type="checkbox"]').first();
  await checkbox.check();
  await page.waitForTimeout(1000);
  const afterDone = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => {
      const s = b.getAttribute('style') || '';
      return s.includes('42') && b.textContent.trim().match(/^\d+/);
    });
    return 'Ketten mit Erledigte: ' + btns.length;
  });
  console.log(afterDone);

  // Test 4: Check for merge-refs (dashed border)
  const mergeInfo = await page.evaluate(() => {
    const dashedBtns = [...document.querySelectorAll('button')].filter(b => {
      const s = b.getAttribute('style') || '';
      return s.includes('dashed');
    });
    return 'Dashed-Border Cards (MergeRef oder blocked): ' + dashedBtns.length +
      (dashedBtns[0] ? ' | Erstes: ' + dashedBtns[0].textContent.trim().substring(0, 40) : '');
  });
  console.log(mergeInfo);

  await browser.close();
})();
