'use strict';
// Converter seam: scripts/osm-to-town.js turns an osm.org export into a town file.
// Fixture geometry (metres east/north of the centre 14.4 N, 78.2 E):
//   mini.osm   600 m square: primary y=+150, tertiary y=-10, residential y=-150 (all x -300..300),
//              footway x=+100 (y -120..-30), 20 m building at (-100,-80), bus station (150,80),
//              place=quarter 'Test Quarter' (-150,80) and place=neighbourhood 'Faraway' 2 km east.
//   broken.osm one residential way with 4 refs (1 node missing) and one way with a single known node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { convertFile } = require('../scripts/osm-to-town.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const CROP = { centre: [14.4, 78.2], size: 500 };
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) <= 1, `${what}: ${actual} is not within 1 m of ${expected}`);

test('T-1 converter crops, projects and keeps only tracked features', () => {
  const town = convertFile(path.join(FIXTURES, 'mini.osm'), CROP);

  assert.equal(town.size, 500);
  assert.deepEqual(town.roads.map((r) => r.class).sort(), ['primary', 'residential', 'tertiary']);
  assert.ok(!town.roads.some((r) => r.class === 'footway'), 'footway dropped');

  // the primary road runs 300 m past the crop on both sides and is cut at the crop edge
  const primary = town.roads.find((r) => r.class === 'primary');
  near(primary.pts[0][0], 0, 'primary starts at the west edge');
  near(primary.pts[0][1], 100, 'primary y (250 m from the centre line minus 150 m north)');
  near(primary.pts[primary.pts.length - 1][0], 500, 'primary ends at the east edge');

  assert.equal(town.buildings.length, 1);
  const xs = town.buildings[0].pts.map((p) => p[0]), ys = town.buildings[0].pts.map((p) => p[1]);
  near(Math.min(...xs), 140, 'building west'); near(Math.max(...xs), 160, 'building east');
  near(Math.min(...ys), 320, 'building north'); near(Math.max(...ys), 340, 'building south');

  assert.equal(town.landmarks.length, 1);
  assert.equal(town.landmarks[0].kind, 'bus_station');
  assert.equal(town.landmarks[0].name, 'Test Bus Station');
  near(town.landmarks[0].x, 400, 'bus station x'); near(town.landmarks[0].y, 170, 'bus station y');

  assert.equal(town.places.length, 1, 'the node 2 km outside the crop is dropped');
  assert.equal(town.places[0].name, 'Test Quarter');
  near(town.places[0].x, 100, 'quarter x'); near(town.places[0].y, 170, 'quarter y');

  const all = [];
  for (const r of town.roads) all.push(...r.pts);
  for (const b of town.buildings) all.push(...b.pts);
  for (const l of town.landmarks.concat(town.places)) all.push([l.x, l.y]);
  for (const [x, y] of all) assert.ok(x >= 0 && x <= 500 && y >= 0 && y <= 500, `point ${x},${y} outside 0..500`);

  assert.deepEqual(town.source.bounds, { minlat: 14.3972886, minlon: 78.1972182, maxlat: 14.4027114, maxlon: 78.2027818 });
  assert.match(town.attribution, /OpenStreetMap contributors/);
});

test('T-19 converter keeps ways with missing nodes, drops ways with fewer than 2 known nodes, rejects non-OSM input', () => {
  const town = convertFile(path.join(FIXTURES, 'broken.osm'), CROP);
  assert.equal(town.roads.length, 1, 'the single-node way is dropped');
  assert.equal(town.roads[0].class, 'residential');
  assert.equal(town.roads[0].pts.length, 3, 'the four-ref way keeps its three known nodes');

  const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vc-osm-')), 'page.osm');
  fs.writeFileSync(html, '<html></html>');
  assert.throws(() => convertFile(html, CROP), (e) => e instanceof Error && e.message.includes('not an OSM export'));
});
