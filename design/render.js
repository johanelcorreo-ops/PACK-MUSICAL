const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
  await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Anton&family=Montserrat:wght@600;700&display=block" rel="stylesheet"><style>body{margin:0}</style></head><body>${svg}</body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  console.log('Anton loaded:', await p.evaluate(() => document.fonts.check('100px Anton')));
  await p.screenshot({ type: 'jpeg', quality: 86, path: process.argv[3], clip: { x: 0, y: 0, width: 1000, height: 1000 } });
  // Imagen para compartir (WhatsApp/Facebook) 1200x630
  await p.setViewportSize({ width: 1200, height: 630 });
  await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Anton&family=Montserrat:wght@600;700&display=block" rel="stylesheet"><style>body{margin:0;width:1200px;height:630px;background:#120a30;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}.bgimg{position:absolute;inset:-40px;filter:blur(40px) brightness(.6)}.bgimg svg,.main svg{width:100%;height:100%}.main{position:relative;width:630px;height:630px}</style></head><body><div class="bgimg">${svg}</div><div class="main">${svg}</div></body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ type: 'jpeg', quality: 86, path: process.argv[4] });
  await b.close();
})();
