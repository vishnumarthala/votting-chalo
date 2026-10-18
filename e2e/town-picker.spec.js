'use strict';
// Journey seam: the real page in headless Chromium, served by scripts/serve.js. Run with `npm run e2e`.
// Chromium comes from the machine (never downloaded); override the path with CHROMIUM_PATH.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WAIT = 8000;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

function startServer(port) {
  const child = spawn(process.execPath, ['scripts/serve.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error('server exited early with code ' + code)));
    child.stdout.on('data', (d) => { if (String(d).includes('http://localhost:' + port)) { child.removeAllListeners('exit'); resolve(child); } });
  });
}

test('T-5 pick Pulivendula and start Nomination Day offline', async () => {
  const port = await freePort();
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(WAIT);
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    // record every string the game draws on the canvas, so the HUD text can be checked
    await page.addInitScript(() => {
      const drawn = (window.__drawn = new Set());
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { if (drawn.size < 2000) drawn.add(String(text)); return fillText.call(this, text, ...rest); };
    });

    await page.goto(`http://127.0.0.1:${port}/`);
    assert.equal(await page.locator('#pin').count(), 0, 'no pincode input');
    assert.equal(await page.locator('input[autocomplete="postal-code"]').count(), 0, 'no postal-code input');
    assert.doesNotMatch(await page.locator('#menu').innerText(), /pincode/i);

    await page.getByRole('combobox', { name: 'Town' }).selectOption({ label: 'Pulivendula' });
    await page.getByRole('button', { name: /Nomination Day/ }).click();
    await page.getByRole('button', { name: /CHALO, NOMINATION/ }).click();

    await page.locator('#menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__vc && window.__vc.running);

    // the intro card is drawn on the canvas; any move key starts play
    await page.waitForFunction(() => [...window.__drawn].some((s) => s.includes('Pulivendula')));
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => window.__vc.game.state.mode === 'play');
    const tick0 = await page.evaluate(() => window.__vc.game.state.tick);
    await page.waitForFunction((t) => window.__vc.game.state.tick > t + 15, tick0);
    await page.keyboard.up('ArrowRight');

    const frames = await page.evaluate(() => new Promise((resolve) => {
      let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 > 500) resolve(n); else requestAnimationFrame(f); };
      requestAnimationFrame(f);
    }));
    assert.ok(frames >= 5, 'the canvas keeps drawing frames: ' + frames);
    const colours = await page.evaluate(() => {
      const cv = document.getElementById('c'), seen = new Set(), g = cv.getContext('2d');
      for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) seen.add(Array.from(g.getImageData(Math.floor((cv.width * i) / 10), Math.floor((cv.height * j) / 10), 1, 1).data).join(','));
      return seen.size;
    });
    assert.ok(colours >= 4, 'the canvas shows a map, not a blank page: ' + colours + ' colours');
    assert.equal(await page.evaluate(() => window.__vc.game.state.place.town), 'Pulivendula');

    const origin = `http://127.0.0.1:${port}`;
    const foreign = requests.filter((u) => /^(https?|wss?):/.test(u) && !u.startsWith(origin + '/'));
    assert.deepEqual(foreign, [], 'every request goes to the local server');
  } finally {
    await browser.close();
    server.kill();
  }
});
