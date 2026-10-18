'use strict';
// Shared test helper: a navigation bot that walks the player to each missing document, then to the goal.
const W = require('../shared/world.js');

function makeBot(game) {
  const G = game.state, map = G.map;
  const free = Object.assign({}, map, { dyn: new Uint8Array(W.N * W.N) }); // plan through barricades; pushing breaks them
  const cache = new Map();
  let sig = '';
  function refresh() { // a shut gate can't be pushed: plan around it (via the side wicket)
    const tiles = G.gate ? G.gate.tiles.concat(G.gate.wicket ? [G.gate.wicket.tile] : []) : [];
    const s = tiles.map((j) => map.dyn[j]).join('');
    if (s === sig) return;
    sig = s; free.dyn = new Uint8Array(W.N * W.N); cache.clear();
    for (const j of tiles) if (map.dyn[j] === 2) free.dyn[j] = 1;
  }
  const fieldTo = (s) => {
    const key = s.x + ',' + s.y;
    if (!cache.has(key)) cache.set(key, W.field(free, [[Math.floor(s.x / W.TILE), Math.floor(s.y / W.TILE)]]));
    return cache.get(key);
  };
  return function input() {
    refresh();
    const P = G.player;
    const missing = G.docSites.filter((s) => !P.docs.includes(s.doc));
    let goal = G.target;
    if (missing.length) goal = missing.reduce((a, b) => (W.dist(P.x, P.y, a.x, a.y) < W.dist(P.x, P.y, b.x, b.y) ? a : b));
    const d = W.dist(P.x, P.y, goal.x, goal.y);
    let dir = d < 24 ? { x: 0, y: 0 } : W.flowDir(free, fieldTo(goal), P.x, P.y) || W.norm(goal.x - P.x, goal.y - P.y);
    return { mx: dir.x, my: dir.y, run: P.stamina > 40, act: G.tick % 75 === 0 };
  };
}

module.exports = { makeBot };
