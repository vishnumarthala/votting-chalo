'use strict';
// Shared test helper: loads a committed town file from data/towns when a test asks for it.
const fs = require('node:fs');
const path = require('node:path');

const cache = new Map();
function townData(id) {
  if (!cache.has(id)) cache.set(id, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'towns', id + '.json'), 'utf8')));
  return cache.get(id);
}

module.exports = { townData };
