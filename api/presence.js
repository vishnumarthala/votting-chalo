// Live player count: every open game pings POST /api/presence every 60 s with a random per-tab id, and gets
// back how many tabs pinged in the last 90 s. Sized for free tiers: one function call and ~2 Redis commands
// per player per minute. On Vercel the ids live in a Redis sorted set (Upstash, via its
// REST API: no npm packages); `npm run serve` uses an in-memory store instead.
'use strict';

const WINDOW_MS = 90000;
const KEY = 'presence:online';
const ID = /^[A-Za-z0-9_-]{8,40}$/;

function memoryStore() {
  const seen = new Map();
  return {
    async beat(id, now, leave) {
      if (leave) seen.delete(id); else seen.set(id, now);
      let n = 0;
      for (const [k, t] of seen) { if (t < now - WINDOW_MS) seen.delete(k); else n++; }
      return n;
    },
  };
}

function upstashStore(url, token, fetchFn) {
  const call = fetchFn || fetch;
  return {
    async beat(id, now, leave) {
      const cmds = [leave ? ['ZREM', KEY, id] : ['ZADD', KEY, String(now), id], ['ZCOUNT', KEY, String(now - WINDOW_MS), '+inf']];
      if (Math.random() < 0.05) cmds.push(['ZREMRANGEBYSCORE', KEY, '-inf', String(now - WINDOW_MS)]); // prune now and then
      const r = await call(url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(cmds),
      });
      if (!r.ok) throw new Error('redis ' + r.status);
      const out = await r.json();
      return Number(out[1] && out[1].result) || 0;
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
  return async function presence(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const s = store === undefined ? envStore() : store;
    if (!s) return send(res, 503, { error: 'live count not configured' });
    const body = await readBody(req);
    if (!body || typeof body.id !== 'string' || !ID.test(body.id)) return send(res, 400, { error: 'bad id' });
    try {
      const online = await s.beat(body.id, clock(), body.leave === true);
      return send(res, 200, { online });
    } catch (e) {
      return send(res, 502, { error: 'store unavailable' });
    }
  };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
module.exports.memoryStore = memoryStore;
module.exports.upstashStore = upstashStore;
module.exports.WINDOW_MS = WINDOW_MS;
