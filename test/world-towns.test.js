'use strict';
// Kadapa and Punganur through the World.buildTown seam: map invariants, real landmarks, place names, the bot.
// Tile positions are derived from the town files' metre coordinates (128 tiles over data.size metres).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const W = require('../shared/world.js');
const S = require('../shared/sim.js');
const { convert, convertFile } = require('../scripts/osm-to-town.js');
const { townData } = require('./towns.js');
const { makeBot } = require('./bot.js');
const { checkMapInvariants } = require('./map-invariants.js');
const { N, TILE } = W;

const REAL_TOWNS = ['pulivendula', 'kadapa', 'punganur'];
const NEW_TOWNS = ['kadapa', 'punganur'];
const PLACE = { kadapa: { town: 'Kadapa', mandal: 'Kadapa', district: 'Kadapa' }, punganur: { town: 'Punganur', mandal: 'Punganur', district: 'Chittoor' } };

// A mapped point in tile units.
const tileOfPoint = (data, p) => [(p.x * N) / data.size, (p.y * N) / data.size];
const landmarks = (data, kind) => data.landmarks.filter((l) => l.kind === kind);
// Distance in tiles from a mapped point to a site (in pixels).
const toSite = (data, p, s) => { const [tx, ty] = tileOfPoint(data, p); return Math.hypot(s.x / TILE - tx, s.y / TILE - ty); };

for (const id of NEW_TOWNS) {
  test(`T-6 ${id} passes the map invariants`, () => {
    checkMapInvariants(townData(id), id);
  });

  for (const mode of ['nomination', 'vote']) {
    test(`T-6 the bot completes ${mode} in ${id} when police, goons and mobs are off`, () => {
      for (const seed of [1, 404]) {
        const g = S.createGame({ seed, town: id, mode, police: false, goons: false, mobs: false });
        assert.deepEqual(g.state.place, PLACE[id]);
        const bot = makeBot(g);
        let n = 0;
        while ((g.state.mode === 'intro' || g.state.mode === 'play') && n < 30 * 600) { g.step(bot()); g.drainEvents(); n++; }
        assert.equal(g.state.mode, 'won', `seed ${seed}: ${g.state.result && g.state.result.reason}`);
        assert.equal(g.state.result.won, true);
      }
    });
  }
}

test('T-6 Kadapa has a police station within 3 tiles of the 1 Town Police Station', () => {
  const data = townData('kadapa'), m = W.buildTown(data);
  const points = landmarks(data, 'police').filter((l) => /1 town/i.test(l.name));
  assert.equal(points.length, 2, 'the export maps the 1 Town Police Station as a node and as a building');
  assert.ok(points.some((p) => m.stations.some((s) => toSite(data, p, s) <= 3)),
    `stations at ${m.stations.map((s) => [s.x / TILE, s.y / TILE].map((v) => v.toFixed(1)))} are all more than 3 tiles from both points`);
});

test('T-6 Kadapa builds a station at the S.P. Bunglow but not at the police parade ground', () => {
  const data = townData('kadapa'), m = W.buildTown(data);
  const bunglow = landmarks(data, 'police').find((l) => l.name === 'S.P. Bunglow');
  assert.ok(bunglow, 'the S.P. Bunglow is mapped inside the square');
  assert.ok(m.stations.some((s) => toSite(data, bunglow, s) <= 3), 'a station stands at the S.P. Bunglow');
  assert.ok(!data.landmarks.some((l) => /ground/i.test(l.name || '') && l.kind === 'police'), 'the parade ground is not a police landmark');
});

test('T-6 labels carry the OSM neighbourhood names', () => {
  assert.ok(W.buildTown(townData('kadapa')).labels.some((l) => l.text === 'Nagarajupeta'), 'Nagarajupeta');
  assert.ok(W.buildTown(townData('punganur')).labels.some((l) => l.text === 'Kotapeta'), 'Kotapeta');
});

test('T-6 the converter leaves out the landmarks it is told to skip', () => {
  const osm = `<osm version="0.6"><bounds minlat="14.39" minlon="78.19" maxlat="14.41" maxlon="78.21"/>
    <node id="1" lat="14.4" lon="78.2"><tag k="amenity" v="police"/><tag k="name" v="Town Police Station"/></node>
    <node id="2" lat="14.4003" lon="78.2003"><tag k="amenity" v="police"/><tag k="name" v="Police Ground"/></node></osm>`;
  const opts = { centre: [14.4, 78.2], size: 500 };
  assert.deepEqual(convert(osm, opts).landmarks.map((l) => l.name), ['Town Police Station', 'Police Ground']);
  assert.deepEqual(convert(osm, Object.assign({ skip: ['police ground'] }, opts)).landmarks.map((l) => l.name), ['Town Police Station'], 'matched by name, ignoring case');
});

for (const id of REAL_TOWNS) {
  test(`T-6 ${id} puts every document shop in an existing house`, () => {
    const m = W.buildTown(townData(id));
    const shops = m.buildings.filter((b) => b.shop);
    assert.equal(shops.length, W.DOC_SHOPS.length, 'five document shops');
    for (const b of shops) assert.ok(b.kind === 'house' && !b.newPlot, `${b.name} is a house added just to hold a shop`);
  });
}

test('T-6 a sparse fixture does add houses for its shops, so the check above can fail', () => {
  const data = convertFile(path.join(__dirname, 'fixtures', 'mini.osm'), { centre: [14.4, 78.2], size: 500 });
  const added = W.buildTown(data).buildings.filter((b) => b.shop && b.newPlot);
  assert.ok(added.length >= 1, 'the fixture has too few houses for five shops');
});
