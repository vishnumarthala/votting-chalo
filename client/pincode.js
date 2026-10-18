// Pincode -> place names (town / mandal / district) for Andhra Pradesh.
// Uses the public India Post lookup (api.postalpincode.in, CORS-enabled), caches results in localStorage,
// and falls back to an approximate built-in district table when offline or when the lookup fails.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pincode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.postalpincode.in/pincode/';
  const STATE = 'Andhra Pradesh';
  const CACHE_KEY = 'mn_pin_cache_v1';

  // Approximate: a 3-digit prefix can span districts. Used only when the lookup is unavailable.
  const FALLBACK = {
    515: 'Anantapur', 516: 'Kadapa', 517: 'Chittoor', 518: 'Kurnool', 520: 'Krishna', 521: 'Krishna', 522: 'Guntur',
    523: 'Prakasam', 524: 'Nellore', 530: 'Visakhapatnam', 531: 'Visakhapatnam', 532: 'Srikakulam', 533: 'East Godavari',
    534: 'West Godavari', 535: 'Vizianagaram',
  };

  const clean = (s) => String(s == null ? '' : s).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  function validate(pin) {
    const s = String(pin == null ? '' : pin).replace(/\s+/g, '');
    if (!/^[1-9]\d{5}$/.test(s)) return { ok: false, reason: 'format', message: 'Enter a 6-digit pincode.' };
    return { ok: true, pin: s };
  }

  // Parses the India Post response. Never throws; returns {ok, place} or {ok:false, reason, message}.
  function parseResponse(json, pin) {
    const rec = Array.isArray(json) ? json[0] : null;
    if (!rec || typeof rec !== 'object') return { ok: false, reason: 'malformed', message: 'Unexpected lookup response.' };
    if (rec.Status !== 'Success' || !Array.isArray(rec.PostOffice) || !rec.PostOffice.length) {
      return { ok: false, reason: 'notfound', message: 'Pincode ' + pin + ' not found.' };
    }
    const offices = rec.PostOffice.filter((o) => o && typeof o === 'object');
    const inAP = offices.filter((o) => o.State === STATE);
    if (!inAP.length) {
      const st = clean(offices[0] && offices[0].State) || 'another state';
      return { ok: false, reason: 'state', message: 'Pincode ' + pin + ' is in ' + st + ', not ' + STATE + '.' };
    }
    // Prefer a delivery office (usually the main town), else the first one.
    const main = inAP.find((o) => o.DeliveryStatus === 'Delivery') || inAP[0];
    const district = clean(main.District) || clean(main.Division);
    const mandal = clean(main.Block) && clean(main.Block) !== 'NA' ? clean(main.Block) : district;
    const town = clean(main.Name) || mandal;
    return {
      ok: true,
      place: { pin, town, mandal, district, state: STATE, source: 'indiapost', offices: inAP.map((o) => clean(o.Name)).filter(Boolean).slice(0, 12) },
    };
  }

  function fallback(pin) {
    const district = FALLBACK[Number(String(pin).slice(0, 3))];
    if (!district) return { ok: false, reason: 'state', message: 'Pincode ' + pin + ' does not look like an Andhra Pradesh pincode (515xxx–535xxx).' };
    return { ok: true, place: { pin, town: district, mandal: district, district, state: STATE, source: 'fallback', approximate: true, offices: [] } };
  }

  function readCache(storage) {
    try { return JSON.parse((storage && storage.getItem(CACHE_KEY)) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeCache(storage, pin, place) {
    if (!storage) return;
    try {
      const c = readCache(storage);
      c[pin] = place;
      const keys = Object.keys(c);
      if (keys.length > 30) delete c[keys[0]];
      storage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* storage full or disabled */ }
  }

  // deps: { fetch, storage, timeoutMs }
  async function lookup(pinInput, deps) {
    deps = deps || {};
    const v = validate(pinInput);
    if (!v.ok) return v;
    const pin = v.pin;
    const cached = readCache(deps.storage)[pin];
    if (cached && cached.town) return { ok: true, place: cached, cached: true };

    const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch : null);
    let netError = null;
    if (doFetch) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), deps.timeoutMs || 6000) : null;
      try {
        const res = await doFetch(API + pin, ctl ? { signal: ctl.signal } : undefined);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const parsed = parseResponse(await res.json(), pin);
        if (parsed.ok) { writeCache(deps.storage, pin, parsed.place); return parsed; }
        if (parsed.reason !== 'malformed') return parsed;
        netError = parsed.message;
      } catch (e) {
        netError = e && e.name === 'AbortError' ? 'lookup timed out' : (e && e.message) || 'network error';
      } finally {
        if (timer) clearTimeout(timer);
      }
    } else netError = 'no network';

    const fb = fallback(pin);
    if (fb.ok) fb.warning = 'Offline guess (' + netError + '): using district only.';
    return fb;
  }

  return { validate, parseResponse, fallback, lookup, FALLBACK, CACHE_KEY };
});
