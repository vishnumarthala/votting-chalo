// Minimal static file server for local play: `npm run serve` then open http://localhost:8080
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const PUBLIC = ['index.html', 'shared', 'client'];
// the live player count, kept in memory locally (Redis on Vercel)
const presence = require('../api/presence.js').makeHandler(require('../api/presence.js').memoryStore());
const stats = require('../api/stats.js').makeHandler(require('../api/stats.js').memoryStore());

http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/presence') { presence(req, res); return; }
  if (req.url.split('?')[0] === '/api/stats') { stats(req, res); return; }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  } catch (e) {
    res.writeHead(400).end('bad request');
    return;
  }
  const file = path.resolve(ROOT, rel);
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top)) {
    res.writeHead(404).end('not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`The Death of Democracy: http://localhost:${PORT}`));
