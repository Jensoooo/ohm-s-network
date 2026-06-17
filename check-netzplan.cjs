const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('PAGE ERROR: ' + e.message));
  await page.goto('https://ohmeraapp.vercel.app/netzplan', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Screenshot
  await page.screenshot({ path: 'netzplan-live.png', fullPage: false });
  await page.screenshot({ path: 'netzplan-live-full.png', fullPage: true });

  // Inspect rendered chain rows
  const info = await page.evaluate(() => {
    const result = [];

    // Score badges: small 42px buttons with a number
    const allButtons = [...document.querySelectorAll('button')];
    const scoreBtns = allButtons.filter(b => {
      const style = b.getAttribute('style') || '';
      return style.includes('42') && b.textContent.trim().match(/^\d+/);
    });
    result.push('Score-Badges gefunden: ' + scoreBtns.length);
    scoreBtns.slice(0, 10).forEach((el, i) => {
      result.push('  Kette ' + (i+1) + ' Score: ' + el.textContent.trim().replace(/\s+/g, ' '));
    });

    // Task cards (132x62 or 176x78 buttons)
    const taskCards = allButtons.filter(b => {
      const style = b.getAttribute('style') || '';
      return (style.includes('132') || style.includes('176')) && b.textContent.trim().length > 5;
    });
    result.push('Task-Cards gefunden: ' + taskCards.length);
    taskCards.slice(0, 5).forEach((el, i) => {
      result.push('  Card ' + (i+1) + ': ' + el.textContent.trim().substring(0, 60).replace(/\s+/g, ' '));
    });

    // Empty state messages
    const emptyMsg = document.querySelector('.flex.h-full.items-center');
    if (emptyMsg) result.push('EMPTY STATE: ' + emptyMsg.textContent.trim());

    // Background color check
    const mainDiv = document.querySelector('[style*="0f0228"], [style*="1a0a3d"]');
    result.push('Dunkles Hintergrund-Div: ' + (mainDiv ? 'JA' : 'NEIN'));

    return result.join('\n');
  });

  console.log('=== RENDERED CHAINS ===');
  console.log(info);
  console.log('=== CONSOLE LOGS ===');
  logs.forEach(l => console.log(l));

  await browser.close();
})();
