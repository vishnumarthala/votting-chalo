// Offline converter: an osm.org export (.osm or .osm.gz) -> data/towns/<id>.json. No dependencies.
//
//   node scripts/osm-to-town.js pulivendula      reads data/osm/pulivendula.osm.gz, writes data/towns/pulivendula.json
//
//   const { convertFile } = require('./scripts/osm-to-town.js');
//   const town = convertFile('data/osm/x.osm.gz', { centre: [14.4197, 78.2249], size: 2000 });
//
// The town file is a square of `size` metres cut from the export. Every point is in metres from the square's
// north-west corner (x east, y south), rounded to 0.1 m. Roads and water lines are clipped to the square;
// polygons whose centre lies outside are dropped. Kept: roads by class, building footprints, water, landmarks
// and place names. Everything else in the export is ignored.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { TOWNS } = require('../shared/towns.js');

const ATTRIBUTION = 'Map data © OpenStreetMap contributors, ODbL';
const ROAD_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'road']);
const WATERWAYS = new Set(['river', 'canal', 'stream']);
const PLACES = new Set(['quarter', 'neighbourhood', 'hamlet', 'suburb']);
const AMENITY_LANDMARKS = {
  police: 'police', bus_station: 'bus_station', place_of_worship: 'place_of_worship', hospital: 'hospital',
  marketplace: 'marketplace', school: 'school', townhall: 'townhall',
};

// ------------------------------------------------------------------ reading the export
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : all;
}));
const attrs = (text) => {
  const out = {};
  for (const m of text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
};

// Streams through the XML tags of an OSM export. Relations are skipped.
function parseOsm(text) {
  if (!/<osm[\s>]/.test(text)) throw new Error('not an OSM export: no <osm> root element');
  const nodes = new Map(), ways = [];
  let bounds = null, latest = '', cur = null;
  const sink = { tags: {}, refs: [] }; // swallows the children of relations
  const stamp = (a) => { if (a.timestamp && a.timestamp > latest) latest = a.timestamp; };
  const tag = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;
  for (let m; (m = tag.exec(text));) {
    const [, closing, name, body, selfClosing] = m;
    if (closing) { if (name === 'node' || name === 'way' || name === 'relation') cur = null; continue; }
    if (name === 'bounds') {
      const a = attrs(body);
      bounds = { minlat: +a.minlat, minlon: +a.minlon, maxlat: +a.maxlat, maxlon: +a.maxlon };
    } else if (name === 'node') {
      const a = attrs(body), lat = +a.lat, lon = +a.lon;
      stamp(a);
      cur = { lat, lon, tags: {} };
      if (a.id !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(a.id, cur);
      if (selfClosing) cur = null;
    } else if (name === 'way') {
      stamp(attrs(body));
      cur = { refs: [], tags: {} };
      ways.push(cur);
      if (selfClosing) cur = null;
    } else if (name === 'relation') {
      cur = selfClosing ? null : sink;
    } else if (name === 'nd' && cur) {
      cur.refs.push(attrs(body).ref);
    } else if (name === 'tag' && cur) {
      const a = attrs(body);
      if (a.k !== undefined) cur.tags[a.k] = a.v === undefined ? '' : a.v;
    }
  }
  return { nodes, ways, bounds, date: latest ? latest.slice(0, 10) : null };
}

// ------------------------------------------------------------------ geometry
// Equirectangular projection around the crop centre: metres per degree from the WGS84 series.
function projector([lat0, lon0], size) {
  const phi = (lat0 * Math.PI) / 180;
  const perLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const perLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return (lat, lon) => [(lon - lon0) * perLon + size / 2, (lat0 - lat) * perLat + size / 2];
}
const round1 = (v) => Math.round(v * 10) / 10;
const inside = ([x, y], size) => x >= 0 && x <= size && y >= 0 && y <= size;

// The part of segment a-b inside [0,size]^2 (Liang-Barsky), or null.
function clipSegment(a, b, size) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0]], [dx, size - a[0]], [-dy, a[1]], [dy, size - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return { a: t0 > 0 ? [a[0] + t0 * dx, a[1] + t0 * dy] : a, b: t1 < 1 ? [a[0] + t1 * dx, a[1] + t1 * dy] : b, startCut: t0 > 0, endCut: t1 < 1 };
}
// A polyline can leave and re-enter the square, so clipping may return several pieces.
function clipPolyline(pts, size) {
  const pieces = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const s = clipSegment(pts[i - 1], pts[i], size);
    if (!s) { cur = null; continue; }
    if (!cur || s.startCut) { cur = [s.a]; pieces.push(cur); }
    cur.push(s.b);
    if (s.endCut) cur = null;
  }
  return pieces;
}
// Sutherland-Hodgman against the four sides of the square.
function clipPolygon(ring, size) {
  const sides = [[(p) => p[0] >= 0, 0, 0], [(p) => p[0] <= size, 0, size], [(p) => p[1] >= 0, 1, 0], [(p) => p[1] <= size, 1, size]];
  let out = ring;
  for (const [keep, axis, edge] of sides) {
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const ka = keep(a), kb = keep(b);
      if (ka !== kb) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        const cut = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        cut[axis] = edge;
        next.push(cut);
      }
      if (kb) next.push(b);
    }
    out = next;
    if (!out.length) break;
  }
  return out;
}
const centroid = (ring) => ring.reduce((c, p) => [c[0] + p[0] / ring.length, c[1] + p[1] / ring.length], [0, 0]);
const finish = (pts) => {
  const out = [];
  for (const p of pts) {
    const q = [round1(p[0]), round1(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out;
};

// ------------------------------------------------------------------ conversion
// text: the contents of an .osm file. opts: { centre: [lat, lon], size: metres, anchor?: [lat, lon], id? }.
function convert(text, opts) {
  opts = opts || {};
  const { centre } = opts, size = opts.size || 2000;
  if (!Array.isArray(centre) || centre.length !== 2 || !centre.every(Number.isFinite)) throw new Error('convert needs opts.centre = [lat, lon]');
  if (!(size > 0)) throw new Error('convert needs a positive opts.size in metres');
  const { nodes, ways, bounds, date } = parseOsm(text);
  const project = projector(centre, size);
  const at = (n) => project(n.lat, n.lon);
  const points = (refs) => refs.map((r) => nodes.get(r)).filter(Boolean).map(at);
  const isRing = (w) => w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1];

  const town = { id: opts.id || null, size, centre, anchor: null, source: { bounds, date }, attribution: ATTRIBUTION, roads: [], water: [], buildings: [], landmarks: [], places: [] };
  const anchor = opts.anchor ? project(opts.anchor[0], opts.anchor[1]) : [size / 2, size / 2];
  town.anchor = { x: round1(anchor[0]), y: round1(anchor[1]) };

  const landmark = (kind, tags, [x, y]) => {
    if (!inside([x, y], size)) return;
    const l = { kind, x: round1(x), y: round1(y) };
    if (tags.name) l.name = tags.name;
    town.landmarks.push(l);
  };
  const landmarkKind = (t) => AMENITY_LANDMARKS[t.amenity] || (t.office === 'government' && 'government') || (t.highway === 'bus_station' && 'bus_station') || null;

  for (const n of nodes.values()) {
    const kind = landmarkKind(n.tags);
    if (kind) landmark(kind, n.tags, at(n));
    if (PLACES.has(n.tags.place) && n.tags.name && inside(at(n), size)) {
      const [x, y] = at(n);
      town.places.push({ kind: n.tags.place, name: n.tags.name, x: round1(x), y: round1(y) });
    }
  }

  for (const w of ways) {
    const t = w.tags, pts = points(w.refs);
    if (ROAD_CLASSES.has(t.highway)) {
      for (const piece of clipPolyline(pts, size)) {
        const line = finish(piece);
        if (line.length >= 2) town.roads.push({ class: t.highway, pts: line });
      }
      continue;
    }
    if (WATERWAYS.has(t.waterway)) {
      for (const piece of clipPolyline(pts, size)) {
        const line = finish(piece);
        if (line.length >= 2) town.water.push({ kind: t.waterway, pts: line });
      }
      continue;
    }
    if (!isRing(w)) continue;
    const ring = points(w.refs.slice(1));
    if (ring.length < 3) continue;
    if (t.natural === 'water' || t.landuse === 'reservoir') {
      const area = finish(clipPolygon(ring, size));
      if (area.length >= 3) town.water.push({ kind: 'area', pts: area });
      continue;
    }
    const c = centroid(ring);
    if (t.building && t.building !== 'no' && inside(c, size)) {
      const outline = finish(clipPolygon(ring, size));
      if (outline.length >= 3) town.buildings.push({ pts: outline });
    }
    const kind = landmarkKind(t);
    if (kind) landmark(kind, t, c);
  }
  return town;
}

function convertFile(file, opts) {
  let data = fs.readFileSync(file);
  if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
  return convert(data.toString('utf8'), opts);
}

// One road, building or landmark per line keeps the committed file small and its diffs readable.
function serialize(town) {
  const block = (list) => (list.length ? '[\n' + list.map((e) => JSON.stringify(e)).join(',\n') + '\n]' : '[]');
  const fields = ['id', 'size', 'centre', 'anchor', 'source', 'attribution'].map((k) => `${JSON.stringify(k)}:${JSON.stringify(town[k])}`);
  for (const k of ['roads', 'water', 'buildings', 'landmarks', 'places']) fields.push(`${JSON.stringify(k)}:${block(town[k])}`);
  return '{\n' + fields.join(',\n') + '\n}\n';
}

function main(argv) {
  const id = argv[0];
  if (!id || !Object.prototype.hasOwnProperty.call(TOWNS, id)) throw new Error(`usage: node scripts/osm-to-town.js <${Object.keys(TOWNS).join('|')}>`);
  const root = path.resolve(__dirname, '..');
  const source = ['.osm.gz', '.osm'].map((ext) => path.join(root, 'data', 'osm', id + ext)).find((f) => fs.existsSync(f));
  if (!source) throw new Error(`no export found: put data/osm/${id}.osm.gz in place`);
  const cfg = TOWNS[id];
  const town = convertFile(source, { id, centre: cfg.centre, anchor: cfg.anchor, size: cfg.size });
  const out = path.join(root, 'data', 'towns', id + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialize(town));
  console.log(`${path.relative(root, out)}: ${town.roads.length} roads, ${town.water.length} water, ${town.buildings.length} buildings, ${town.landmarks.length} landmarks, ${town.places.length} places`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = { convert, convertFile, serialize };
