'use strict';
// CP-4, second round: what a fire does to the people around it, and that two identical games agree while one burns.
// test/arson.test.js (locked) covers which props burn and how a fire blocks and frees its tiles; these cases cover
//  - nobody is left pinned inside the tiles a new fire closes (AC-8: 'I have to route around them', not 'be stuck'),
//  - a new fire scares townspeople within FIRE.scareR px, and a burning prop makes supporters within FIRE.leaveR px leave
//    the crowd (decision D-20), and
//  - a game with a fire burning replays identically (AC-14).
// Everything goes through the simulation's public seam (createGame, step, state, drainEvents), plus `_test.join` to make
// followers, as test/sim.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');
const { TILE, N } = W;
const { FIRE } = S;

const NONE = S.EMPTY_INPUT;
const inp = (o) => Object.assign({}, NONE, o);
const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };
const R = 9; // half size of the biggest body

function play(opts) {
  const g = S.createGame(Object.assign({ seed: 5, town: 'pulivendula' }, opts));
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(inp({ act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}

// Distance in px from a point to the nearest edge of a rectangle of tiles {x0, y0, x1, y1}.
const edgeDist = (x, y, r) => Math.hypot(Math.max(r.x0 * TILE - x, 0, x - (r.x1 + 1) * TILE), Math.max(r.y0 * TILE - y, 0, y - (r.y1 + 1) * TILE));
// True if a box of half size r centred on (x, y) touches no solid tile right now.
const openBox = (map, x, y, r) => [[-r, -r], [r - 0.01, -r], [-r, r - 0.01], [r - 0.01, r - 0.01]].every(([ox, oy]) => !W.solidPx(map, x + ox, y + oy));
// True if the box of body b touches one of the tiles in the set (indices y * N + x).
const touches = (tiles, b) => [[-b.r, -b.r], [b.r - 0.01, -b.r], [-b.r, b.r - 0.01], [b.r - 0.01, b.r - 0.01]]
  .some(([ox, oy]) => tiles.has(Math.floor((b.y + oy) / TILE) * N + Math.floor((b.x + ox) / TILE)));
const tileCentre = (i) => ({ x: ((i % N) + 0.5) * TILE, y: (Math.floor(i / N) + 0.5) * TILE });
const centreOf = (t) => ({ x: t.x, y: t.y });

// The open tile (before any fire) next to a rectangle, as a pixel position, or null: where a mob stands to light it.
function standBeside(map, rect) {
  for (let y = rect.y0 - 1; y <= rect.y1 + 1; y++) for (let x = rect.x0 - 1; x <= rect.x1 + 1; x++) {
    const inside = x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    if (!inside && x > 2 && y > 2 && x < N - 3 && y < N - 3 && !W.solidAt(map, x, y)) return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
  }
  return null;
}

// A fresh game and its parked vehicle number `index`, with a spot beside it for a mob; null if there is no such vehicle.
function stage(opts, index) {
  const g = play(opts), G = g.state;
  const v = G.supporterProps.filter((t) => t.kind === 'vehicle')[index];
  const stand = v && standBeside(G.map, v.rect);
  return stand ? { g, G, P: G.player, map: G.map, v, stand, ring: new Set(W.fireTiles(v.rect)) } : null;
}
const VEHICLES = play({ police: false, goons: false, civilians: 0 }).state.supporterProps.filter((t) => t.kind === 'vehicle').length;

// Runs until a rioting mob lights the vehicle. Before each step the mob stands beside the vehicle with the candidate in its
// sight and `arrange` puts the rest of the scene where it should be. Only the vehicle can burn: every other house and
// vehicle is charred already. Returns after the step in which the 'fire' event came.
function light(sc, arrange) {
  const { g, G, v, stand } = sc;
  for (const t of G.supporterProps) if (t !== v) t.state = 'burnt';
  const mob = G.mobs[0], members = G.ents.filter((e) => e.kind === 'mob' && e.mob === mob.id);
  G.ents = G.ents.filter((e) => e.kind !== 'mob' || e.mob === mob.id);
  assert.ok(members.length >= 5, 'a mob of at least 5');
  for (let k = 0; k < 90; k++) {
    members.forEach((m, j) => place(m, stand.x + (j % 3 - 1) * 8, stand.y + (j % 2 ? 6 : -6)));
    arrange();
    g.step(NONE);
    const fire = g.drainEvents().find((e) => e.t === 'fire');
    if (fire) { assert.equal(fire.id, v.id, 'the vehicle is the one that burns'); return members; }
  }
  assert.fail('the mob did not light the vehicle in 3 s');
}

// ------------------------------------------------------------------------------------------------ nobody is pinned
test('bodies standing in the tiles of a new fire are moved to the nearest open tile outside them', () => {
  let found = false;
  for (let index = 0; index < VEHICLES && !found; index++) {
    const sc = stage({ police: true, goons: true, civilians: 40 }, index);
    if (!sc) continue;
    const { g, G, P, map, v, ring } = sc;
    const spots = [...ring].filter((i) => !W.solidAt(map, i % N, Math.floor(i / N))).map(tileCentre);
    if (spots.length < 4) continue;

    // the candidate stands on the vehicle; a supporter, a townsperson, a policeman and a goon stand in the other open tiles
    const civs = G.ents.filter((e) => e.kind === 'civ').slice(0, 2);
    assert.ok(g._test.join(civs[0]), 'a follower');
    const bodies = { candidate: P, follower: civs[0], civilian: civs[1], cop: G.ents.find((e) => e.kind === 'cop'), goon: G.ents.find((e) => e.kind === 'goon') };
    assert.ok(bodies.cop && bodies.goon, 'the game has police and goons');
    const where = { candidate: centreOf(v) };
    Object.keys(bodies).filter((k) => k !== 'candidate').forEach((k, j) => { where[k] = spots[j % spots.length]; });
    const arrange = () => { for (const k of Object.keys(bodies)) place(bodies[k], where[k].x, where[k].y); };
    arrange();
    for (const k of Object.keys(bodies)) assert.ok(touches(ring, bodies[k]), `the ${k} stands in the tiles the fire will close`);

    const members = light(sc, arrange);
    for (const m of members) assert.ok(!touches(ring, m), 'a mob member stands outside the tiles of the fire');
    for (const k of Object.keys(bodies)) {
      const b = bodies[k];
      assert.ok(!touches(ring, b), `the ${k} is outside the tiles of the fire right after it starts`);
      assert.ok(openBox(map, b.x, b.y, b.r), `the ${k} touches no blocked tile`);
      assert.ok(Math.hypot(b.x - where[k].x, b.y - where[k].y) <= 4 * TILE, `the ${k} was moved to a tile close by, not across the town`);
      assert.equal(b.px, b.x, `the ${k} is not drawn sliding across the street`);
    }
    found = true;
  }
  assert.ok(found, 'a parked vehicle with open ground round it');
});

test('a candidate who stood on a vehicle when it caught fire can walk away from it', () => {
  let walked = false;
  for (let index = 0; index < VEHICLES && !walked; index++) {
    const sc = stage({ police: false, goons: false, civilians: 0 }, index);
    if (!sc) continue;
    const { g, G, P, map, v, ring } = sc;
    light(sc, () => place(P, v.x, v.y));
    assert.ok(!touches(ring, P), 'the candidate is outside the tiles of the fire right after it starts');

    // the way with the most open tiles in a row
    const tx = Math.floor(P.x / TILE), ty = Math.floor(P.y / TILE);
    let best = null, bestRun = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let run = 0;
      while (run < 5 && !W.solidAt(map, tx + dx * (run + 1), ty + dy * (run + 1))) run++;
      if (run > bestRun) { bestRun = run; best = { mx: dx, my: dy }; }
    }
    if (bestRun < 3) continue;

    // the mob has done its work: no stone may knock the candidate about while we test walking
    G.ents = G.ents.filter((e) => e.kind !== 'mob'); G.stones.length = 0;
    const from = { x: P.x, y: P.y };
    for (let i = 0; i < 30; i++) {
      g.step(inp(best));
      assert.ok(G.fires.some((f) => f.id === v.id), 'the fire is still burning while the candidate walks');
      assert.ok(!touches(ring, P), `tick ${i}: the candidate walks on open ground`);
    }
    const moved = Math.hypot(P.x - from.x, P.y - from.y);
    assert.ok(moved > TILE, `the candidate moved ${moved.toFixed(1)} px in 1 s, one tile is ${TILE}`);
    walked = true;
  }
  assert.ok(walked, 'a parked vehicle with a street to walk away along');
});

// ---------------------------------------------------------------------------- people near a fire (decision D-20)
// A point `d` px from the nearest edge of the vehicle's tile, straight out from its middle, or null if a body does not fit.
function pointOut(map, v, dir, d) {
  const half = ((v.rect.x1 - v.rect.x0 + 1) * TILE) / 2, x = v.x + dir[0] * (half + d), y = v.y + dir[1] * (half + d);
  return openBox(map, x, y, R) ? { x, y } : null;
}

test('a supporter within leaveR px of a burning vehicle leaves the crowd; one 80 px from it stays', () => {
  const NEAR = FIRE.leaveR - 6, FAR = 80;
  assert.ok(NEAR < FIRE.leaveR && FAR > FIRE.leaveR);
  let done = false;
  for (let index = 0; index < VEHICLES && !done; index++) {
    const sc = stage({ police: false, goons: false, civilians: 30 }, index);
    if (!sc) continue;
    const { g, G, P, map, v } = sc;
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find((d) => pointOut(map, v, d, NEAR) && pointOut(map, v, d, FAR));
    if (!dir) continue;
    const near = pointOut(map, v, dir, NEAR), far = pointOut(map, v, dir, FAR);
    const [a, b] = G.ents.filter((e) => e.kind === 'civ');
    assert.ok(g._test.join(a) && g._test.join(b), 'two followers');
    assert.equal(P.followers.length, 2);
    assert.ok(Math.abs(edgeDist(near.x, near.y, v.rect) - NEAR) < 0.01 && Math.abs(edgeDist(far.x, far.y, v.rect) - FAR) < 0.01);

    light(sc, () => { place(P, v.x, v.y); place(a, near.x, near.y); place(b, far.x, far.y); });
    assert.equal(G.supporterProps[v.id].state, 'burning');
    assert.ok(P.followers.includes(a) && P.followers.includes(b), 'both supporters are still in the crowd when the fire starts');

    // hold everyone still (a detained candidate's crowd stands where it is) and let the fire work on the crowd
    P.state = 'held'; P.heldT = 100;
    for (let i = 0; i < 5; i++) g.step(NONE);
    assert.equal(P.followers.includes(a), false, `the supporter ${NEAR} px from the burning vehicle left the crowd`);
    assert.equal(a.mode, 'flee', 'and runs');
    assert.equal(P.followers.includes(b), true, `the supporter ${FAR} px from it stayed`);
    assert.equal(b.mode, 'follow');
    done = true;
  }
  assert.ok(done, 'a parked vehicle with room on one side for two supporters');
});

test('a townsperson within scareR px of a new fire runs from it; one 200 px away does not', () => {
  const NEAR = FIRE.scareR - 20, FAR = 200;
  assert.ok(NEAR < FIRE.scareR && FAR > FIRE.scareR);
  // an open spot with its edge distance in [lo, hi] from the vehicle and room to run 40 px further away from it
  function spot(sc, lo, hi, roomToRun) {
    const { map, v } = sc, reach = Math.ceil(hi / TILE) + 2;
    for (let y = v.rect.y0 - reach; y <= v.rect.y1 + reach; y++) for (let x = v.rect.x0 - reach; x <= v.rect.x1 + reach; x++) {
      if (x < 3 || y < 3 || x > N - 4 || y > N - 4) continue;
      const p = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }, d = edgeDist(p.x, p.y, v.rect);
      if (d < lo || d > hi || !openBox(map, p.x, p.y, R)) continue;
      const away = W.norm(p.x - v.x, p.y - v.y);
      if (!roomToRun || (openBox(map, p.x + away.x * 40, p.y + away.y * 40, R) && openBox(map, p.x + away.x * 20, p.y + away.y * 20, R))) return p;
    }
    return null;
  }
  let done = false;
  for (let index = 0; index < VEHICLES && !done; index++) {
    const sc = stage({ police: false, goons: false, civilians: 30 }, index);
    if (!sc) continue;
    const { g, G, v } = sc;
    const near = spot(sc, NEAR - 6, NEAR + 6, true), far = spot(sc, FAR - 6, FAR + 6, false);
    if (!near || !far) continue;
    const [a, b] = G.ents.filter((e) => e.kind === 'civ');

    light(sc, () => { place(G.player, v.x, v.y); place(a, near.x, near.y); place(b, far.x, far.y); });
    assert.equal(a.mode, 'flee', `the townsperson ${Math.round(edgeDist(near.x, near.y, v.rect))} px from the new fire runs`);
    assert.notEqual(b.mode, 'flee', `the townsperson ${Math.round(edgeDist(far.x, far.y, v.rect))} px from it does not`);
    const before = Math.hypot(a.x - v.x, a.y - v.y);
    for (let i = 0; i < 10; i++) { g.step(NONE); assert.notEqual(b.mode, 'flee', 'the far townsperson is not scared by the fire'); }
    const after = Math.hypot(a.x - v.x, a.y - v.y);
    assert.ok(after > before + 20, `the townsperson ran from ${before.toFixed(0)} to ${after.toFixed(0)} px from the fire`);
    done = true;
  }
  assert.ok(done, 'a parked vehicle with open ground 120 and 200 px from it');
});

// ------------------------------------------------------------------------------------- a burning game replays
// Kadapa, seed 7, everything on, the same scripted walk as T-12 in test/mob.test.js. T-12 compares the fires at the end,
// when they have burnt out; here the games are also compared while a fire burns.
function replay(ticks) {
  const g = S.createGame({ seed: 7, town: 'kadapa', mode: 'nomination', police: true, goons: true, mobs: true });
  const G = g.state, P = G.player;
  const blocked = () => { const out = []; G.map.dyn.forEach((d, i) => { if (d >> 1) out.push([i, d >> 1]); }); return out; };
  const snap = () => ({
    tick: G.tick, fires: JSON.parse(JSON.stringify(G.fires)), props: G.supporterProps.map((t) => [t.id, t.state]), blocked: blocked(),
    player: [P.x, P.y, P.papers, P.followers.length], ents: G.ents.map((e) => [e.id, e.kind, e.mode, e.x, e.y]),
  });
  const samples = [];
  let placed = false, fireAt = -1;
  for (let i = 0; i < ticks; i++) {
    if (!placed && G.mode === 'play') {
      placed = true;
      const m = G.ents.find((e) => e.kind === 'mob' && e.mob === G.mobs[0].id);
      let spot = null;
      for (let a = 0; a < 16 && !spot; a++) {
        const x = m.x + Math.cos(a * Math.PI / 8) * 130, y = m.y + Math.sin(a * Math.PI / 8) * 130;
        if (!W.solidPx(G.map, x, y) && W.lineOfSight(G.map, m.x, m.y, x, y)) spot = { x, y };
      }
      assert.ok(spot, 'a clear spot near the mob');
      place(P, spot.x, spot.y);
    }
    const k = i < 300 ? 0.15 : 1;
    g.step({ mx: Math.sin(i / 37) * k, my: Math.cos(i / 53) * k, run: i % 240 < 90, act: i % 45 === 0 });
    const events = g.drainEvents();
    if (fireAt < 0 && events.some((e) => e.t === 'fire')) fireAt = G.tick;
    if (fireAt >= 0 && (G.tick === fireAt || G.tick === fireAt + 300)) samples.push(snap());
  }
  samples.push(snap());
  return samples;
}

test('two identical games agree on the fires, the burning props and the blocked tiles while a fire burns, and after it', () => {
  const a = replay(900), b = replay(900);
  assert.ok(a.length >= 3, 'a fire started, was sampled while it burnt and again at 900 ticks');
  const [atFire, midFire, end] = [a[0], a[1], a[a.length - 1]];
  assert.ok(atFire.fires.length >= 1 && atFire.props.some(([, s]) => s === 'burning'), 'a fire is burning at the first sample');
  assert.ok(atFire.blocked.length > 0, 'and it blocks tiles');
  assert.ok(midFire.fires.length >= 1 && midFire.fires.every((f) => f.left <= f.ticks && f.ticks === FIRE.ticks), 'a fire still burns 300 ticks later');
  assert.equal(end.tick, 900);
  assert.deepEqual(b, a);
});
