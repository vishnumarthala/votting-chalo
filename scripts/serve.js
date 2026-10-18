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
const PUBLIC = ['index.html', 'shared', 'client', 'data/towns']; // data/osm holds the raw exports and stays private

http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  } catch (e) {
    res.writeHead(400).end('bad request');
    return;
  }
  const file = path.resolve(ROOT, rel);
  const shown = path.relative(ROOT, file).split(path.sep).join('/');
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.some((p) => shown === p || shown.startsWith(p + '/'))) {
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
}).listen(PORT, () => console.log(`Votting Chalo: http://localhost:${PORT}`));
