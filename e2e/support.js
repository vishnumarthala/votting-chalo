'use strict';
// Shared e2e helper: serves the game with scripts/serve.js and opens it in headless Chromium.
// Chromium comes from the machine (never downloaded); override the path with CHROMIUM_PATH.
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

// Opens the game's menu at the given viewport and runs `body(page)`; the server and browser are always closed,
// including when Chromium fails to launch.
async function withMenu(viewport, body) {
  const port = await freePort();
  const server = await startServer(port);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(WAIT);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#play').waitFor();
    return await body(page);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

module.exports = { withMenu };
