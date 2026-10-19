// Running totals: every "File nomination" / "Play again" posts here once. Counts games in total and per day,
// and unique players (a random per-device id, counted with a Redis HyperLogLog: ~12 KB however many players,
// ±1%). GET returns the numbers. 3 Redis commands per game, so it fits Upstash's free tier.
'use strict';

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const day = (t) => new Date(t).toISOString().slice(0, 10);

function memoryStore() {
  const days = new Map(), players = new Set();
  let total = 0;
  return {
    async played(id, now) { total++; const d = day(now); days.set(d, (days.get(d) || 0) + 1); players.add(id); },
    async read(now) { return { games: total, gamesToday: days.get(day(now)) || 0, players: players.size }; },
  };
}

function upstashStore(url, token, fetchFn) {
  const call = fetchFn || fetch;
  async function pipeline(cmds) {
    const r = await call(url.replace(/\/+$/, '') + '/pipeline', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    return (await r.json()).map((x) => x && x.result);
  }
  return {
    async played(id, now) { await pipeline([['INCR', 'stats:games'], ['INCR', 'stats:games:' + day(now)], ['PFADD', 'stats:players', id]]); },
    async read(now) {
      const [g, t, p] = await pipeline([['GET', 'stats:games'], ['GET', 'stats:games:' + day(now)], ['PFCOUNT', 'stats:players']]);
      return { games: Number(g) || 0, gamesToday: Number(t) || 0, players: Number(p) || 0 };
    },
  };
}

function envStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? upstashStore(url, token) : null;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body)); } catch (e) { return null; }
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1024) return null; }
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

// store: undefined = from the environment (Vercel), null = not configured
function makeHandler(store, now) {
  const clock = now || Date.now;
  return async function stats(req, res) {
    const s = store === undefined ? envStore() : store;
    if (!s) return send(res, 503, { error: 'stats not configured' });
    try {
      if (req.method === 'GET') return send(res, 200, Object.assign({ since: 'first game counted', day: day(clock()) }, await s.read(clock())));
      if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
      const body = await readBody(req);
      if (!body || typeof body.id !== 'string' || !ID.test(body.id)) return send(res, 400, { error: 'bad id' });
      await s.played(body.id, clock());
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 502, { error: 'store unavailable' });
    }
  };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
module.exports.memoryStore = memoryStore;
module.exports.upstashStore = upstashStore;
