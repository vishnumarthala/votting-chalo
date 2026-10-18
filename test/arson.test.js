'use strict';
// CP-4: TDP mobs burn only supporters' houses and parked vehicles; a fire blocks its footprint plus one ring of tiles for
// 20 s and flow fields route around it (AC-8). T-13 goes through the simulation's public seam (createGame, step, state and
// drainEvents); T-14 through World.buildTown on the real towns, which the converter produced.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');
const { townData } = require('./towns.js');
const { TILE, N } = W;

const FIRE_TICKS = 20 * 30; // AC-8: a fire burns for 20 s, at 30 ticks a second
const REAL_TOWNS = ['pulivendula', 'kadapa', 'punganur'];

const NONE = S.EMPTY_INPUT;
const inp = (o) => Object.assign({}, NONE, o);
const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };

// A rectangle of tiles {x0, y0, x1, y1}, both corners inclusive.
const rectOf = (b) => ({ x0: b.x / TILE, y0: b.y / TILE, x1: (b.x + b.w) / TILE - 1, y1: (b.y + b.h) / TILE - 1 });
// Tiles between two rectangles, 0 when they touch.
const gap = (a, b) => Math.max(0, a.x0 - b.x1 - 1, b.x0 - a.x1 - 1, a.y0 - b.y1 - 1, b.y0 - a.y1 - 1);
// AC-8, from the spec and not from the code: the footprint plus one ring of tiles around it, inside the map.
function ringOf(rect) {
  const out = new Set();
  for (let y = rect.y0 - 1; y <= rect.y1 + 1; y++) for (let x = rect.x0 - 1; x <= rect.x1 + 1; x++) if (x >= 0 && y >= 0 && x < N && y < N) out.add(y * N + x);
  return out;
}
const tileOf = (p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];

function play(opts) {
  const g = S.createGame(Object.assign({ seed: 5, town: 'pulivendula' }, opts));
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(inp({ act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}

// An open tile next to a rectangle of tiles, as a pixel position, or null.
function standBeside(map, rect) {
  for (let y = rect.y0 - 1; y <= rect.y1 + 1; y++) for (let x = rect.x0 - 1; x <= rect.x1 + 1; x++) {
    const inside = x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    if (!inside && x > 2 && y > 2 && x < N - 3 && y < N - 3 && !W.solidAt(map, x, y)) return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
  }
  return null;
}

// One supporter house, one parked vehicle far from it, and one ordinary house far from both and from every supporter
// house and vehicle, each with an open tile beside it for the mob to stand on.
function chooseThree(G) {
  const map = G.map, houses = G.targets.filter((t) => t.kind === 'house'), vehicles = G.targets.filter((t) => t.kind === 'vehicle');
  assert.ok(houses.length > 0, 'the town has supporters’ houses');
  assert.ok(vehicles.length > 0, 'the town has parked vehicles');
  const ordinary = map.buildings.filter((b) => b.kind === 'house' && !b.shop).map((b) => ({ b, rect: rectOf(b) }))
    .filter((o) => G.targets.every((t) => gap(t.rect, o.rect) >= 6));
  for (const h of houses) for (const v of vehicles) {
    if (gap(h.rect, v.rect) < 10) continue;
    const hs = standBeside(map, h.rect), vs = standBeside(map, v.rect);
    if (!hs || !vs) continue;
    for (const o of ordinary) {
      if (gap(o.rect, h.rect) < 10 || gap(o.rect, v.rect) < 10) continue;
      const os = standBeside(map, o.rect);
      if (os) return { h, v, o, hs, vs, os };
    }
  }
  throw new Error('no supporter house, parked vehicle and ordinary house far enough apart');
}

test('T-13 only supporters’ houses and vehicles burn; a fire blocks its footprint and one ring of tiles for 20 s, then frees them', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const G = g.state, P = G.player, map = G.map;
  assert.ok(Array.isArray(G.targets) && G.targets.length > 0, 'the game lists the houses and vehicles that can burn');
  assert.ok(Array.isArray(G.fires) && G.fires.length === 0, 'no fire burns at the start');
  const { h, v, hs, vs, os } = chooseThree(G);
  assert.equal(h.state, 'ok');

  // one mob does the walking; the others stay home
  const mob = G.mobs[0];
  G.ents = G.ents.filter((e) => e.kind !== 'mob' || e.mob === mob.id);
  const members = G.ents.filter((e) => e.kind === 'mob');
  assert.ok(members.length >= 5, 'a mob of at least 5');

  // tiles that are open before any fire: only those can be blocked by one
  const watch = [];
  for (const t of [h, v]) {
    const around = { x0: t.rect.x0 - 1, y0: t.rect.y0 - 1, x1: t.rect.x1 + 1, y1: t.rect.y1 + 1 };
    for (const i of ringOf(around)) if (!W.solidAt(map, i % N, (i / N) | 0)) watch.push(i);
  }
  assert.ok(watch.length >= 9, 'open streets and lots around the two targets');

  const active = new Set(), rings = new Map(), fireTick = new Map(), burntTick = new Map(), fireEvents = [];
  const covered = (i) => [...active].some((id) => rings.get(id).has(i));
  const verifyBlocking = (tick) => {
    for (const i of watch) {
      const want = covered(i);
      assert.equal(W.solidAt(map, i % N, (i / N) | 0), want, `tick ${tick}: tile ${i % N},${(i / N) | 0} is ${want ? 'open' : 'blocked'} but should be ${want ? 'blocked' : 'open'}`);
    }
  };
  function run(ticks, stand) {
    let seen = [];
    for (let k = 0; k < ticks; k++) {
      if (stand) { members.forEach((m, j) => place(m, stand.x + (j % 3 - 1) * 8, stand.y + (j % 2 ? 6 : -6))); place(P, stand.x + 12, stand.y); }
      g.step(NONE);
      for (const e of g.drainEvents()) {
        if (e.t === 'fire') {
          assert.ok(G.targets[e.id] && G.targets[e.id].kind === e.kind, 'a fire is a supporter house or a parked vehicle');
          assert.equal(fireTick.has(e.id), false, `target ${e.id} caught fire twice`);
          fireTick.set(e.id, G.tick); active.add(e.id); rings.set(e.id, ringOf(G.targets[e.id].rect)); fireEvents.push(e); seen.push(e);
        } else if (e.t === 'burnt') {
          assert.ok(active.has(e.id), `target ${e.id} burnt without burning`);
          burntTick.set(e.id, G.tick); active.delete(e.id);
        }
      }
      verifyBlocking(G.tick);
    }
    return seen;
  }

  // the mob stops beside the supporter house, then the ordinary house, then the parked vehicle
  run(45, hs);
  assert.ok(fireTick.has(h.id), 'the supporter house caught fire');
  assert.equal(fireEvents.find((e) => e.id === h.id).kind, 'house');
  const ordinaryStop = run(45, os);
  assert.deepEqual(ordinaryStop, [], 'nothing burnt while the mob stood beside the ordinary house');
  const arrivedAtVehicle = G.tick;
  assert.equal(fireTick.has(v.id), false, 'the parked vehicle has not burnt before the mob reached it');
  run(45, vs);
  assert.ok(fireTick.get(v.id) > arrivedAtVehicle, 'the parked vehicle caught fire when the mob passed it');
  assert.equal(fireEvents.find((e) => e.id === v.id).kind, 'vehicle');

  // 20 s more: every fire burns for exactly 600 ticks, then its tiles are open again
  run(FIRE_TICKS + 30, null);
  for (const t of [h, v]) {
    assert.equal(burntTick.get(t.id) - fireTick.get(t.id), FIRE_TICKS, `target ${t.id} burnt for ${(burntTick.get(t.id) - fireTick.get(t.id)) / 30} s`);
    assert.equal(G.targets[t.id].state, 'burnt');
  }
  assert.ok(!G.fires.some((f) => f.id === h.id || f.id === v.id), 'their fires are over');

  // charred: the mob stopping beside the burnt house again does not light it a second time
  const again = run(60, hs);
  assert.ok(again.every((e) => e.id !== h.id), 'a charred house does not burn again');
  assert.equal(fireEvents.filter((e) => e.id === h.id).length, 1);
});

// The tiles of a path that follows a distance field downhill from a tile to the field's target.
function descend(f, from) {
  const path = [from];
  let at = from;
  while (f[at] > 0) {
    const x = at % N, y = (at / N) | 0;
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oy]) => [x + ox, y + oy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < N && ny < N)
      .map(([nx, ny]) => ny * N + nx).find((j) => f[j] === f[at] - 1);
    if (next === undefined) throw new Error('the field has no way down from tile ' + at);
    path.push(next); at = next;
  }
  return path;
}

for (const id of REAL_TOWNS) {
  test(`T-14 ${id}: a path to the RO office routes around a burning vehicle and the street is open again when the fire ends`, () => {
    const data = townData(id), m = W.buildTown(data);
    assert.deepEqual(m.targets, W.buildTown(data).targets, 'the supporters’ houses and vehicles are the same on every build');
    const vehicles = (m.targets || []).filter((t) => t.kind === 'vehicle');
    assert.ok(vehicles.length > 0, 'the town has parked vehicles');

    const [sx, sy] = tileOf(m.start), startTile = sy * N + sx;
    const goal = tileOf(m.office), before = W.field(m, [goal]);
    assert.ok(before[startTile] > 0, 'the RO office is reachable from the start');
    const oldPath = descend(before, startTile);

    // a vehicle the shortest path goes through, whose fire leaves the office reachable
    let chosen = null, after = null, openBefore = [];
    for (const v of vehicles) {
      const ring = ringOf(v.rect);
      if (!oldPath.some((i) => ring.has(i))) continue;
      const open = [...ring].filter((i) => !W.solidAt(m, i % N, (i / N) | 0));
      W.setFire(m, v.rect, true);
      const f = W.field(m, [goal]);
      if (f[startTile] > 0) { chosen = v; after = f; openBefore = open; break; }
      W.setFire(m, v.rect, false);
    }
    assert.ok(chosen, 'a parked vehicle stands on the shortest path from the start to the RO office');

    const blocked = ringOf(chosen.rect);
    assert.ok(openBefore.length >= 1, 'the vehicle stands among open tiles');
    for (const i of openBefore) assert.equal(W.solidAt(m, i % N, (i / N) | 0), true, `tile ${i % N},${(i / N) | 0} next to the fire is open`);
    const newPath = descend(after, startTile);
    assert.ok(newPath.length >= oldPath.length, 'the way round is no shorter');
    assert.equal(newPath[newPath.length - 1], goal[1] * N + goal[0], 'the new path ends at the RO office');
    for (const i of newPath) assert.equal(blocked.has(i), false, `the new path enters blocked tile ${i % N},${(i / N) | 0}`);
    assert.notDeepEqual(newPath, oldPath);

    // the fire ends: the same field is found again
    W.setFire(m, chosen.rect, false);
    assert.deepEqual(W.field(m, [goal]), before, 'the field is the same once the fire is over');
  });
}
