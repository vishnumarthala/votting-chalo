// Main loop and menu: fixed 30 Hz simulation with interpolated rendering; sim events -> sound, particles, HUD.
'use strict';
(function () {
  const { DT, hashStr } = window.World;
  const Ct = window.Content;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage disabled */ } },
  };
  const $ = (id) => document.getElementById(id);

  const cv = $('c');
  Render.init(cv);
  // low-memory phones (Chromium reports deviceMemory in GB) start on fast graphics unless the player chose
  const lowEnd = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
  Render.resize(store.get('vc_q', lowEnd ? 'lo' : 'hi'));
  Input.bind(cv);
  document.body.classList.toggle('touch', Input.isTouch);

  const menu = $('menu'), nameEl = $('name'), pinEl = $('pin'), pinStatus = $('pinStatus'), townEl = $('town');
  const playBtn = $('play'), pauseEl = $('pause');
  let game = null, running = false, paused = false, mapOpen = false, acc = 0, last = performance.now(), endT = 0, view = null;
  let place = null, placeErr = null, lookupSeq = 0;

  // ------------------------------------------------------------ menu
  nameEl.value = store.get('vc_name', '');
  pinEl.value = store.get('vc_pin', '');
  const placeLabel = (pl) => [pl.town, pl.mandal && pl.mandal !== pl.town ? pl.mandal + ' mandal' : '', pl.district && pl.district !== pl.mandal ? pl.district + ' district' : ''].filter(Boolean).join(', ');
  function showPlace(res) {
    townEl.innerHTML = ''; townEl.style.display = 'none';
    if (!res) { place = null; placeErr = null; pinStatus.textContent = 'No pincode: you will play in the fictional town of ' + Ct.DEFAULT_PLACE.town + '.'; pinStatus.className = ''; return; }
    if (!res.ok) { place = null; placeErr = res.message; pinStatus.textContent = '⚠️ ' + res.message; pinStatus.className = 'err'; return; }
    place = res.place; placeErr = null;
    pinStatus.textContent = '📍 ' + placeLabel(place) + (res.warning ? ' · ' + res.warning : '');
    pinStatus.className = res.warning ? 'warn' : 'ok';
    const offices = (place.offices || []).filter(Boolean);
    if (offices.length > 1) {
      for (const o of offices) { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; if (o === place.town) opt.selected = true; townEl.appendChild(opt); }
      townEl.style.display = '';
    }
  }
  townEl.addEventListener('change', () => { if (place) { place = Object.assign({}, place, { town: townEl.value }); pinStatus.textContent = '📍 ' + placeLabel(place); } });
  async function lookupPin() {
    const raw = pinEl.value.trim(), seq = ++lookupSeq;
    if (!raw) { showPlace(null); return; }
    const v = Pincode.validate(raw);
    if (!v.ok) { showPlace(raw.length < 6 ? { ok: false, message: 'Enter all 6 digits.' } : v); return; }
    pinStatus.textContent = '🔎 Looking up ' + v.pin + '…'; pinStatus.className = '';
    playBtn.disabled = true;
    const res = await Pincode.lookup(v.pin, { storage: window.localStorage });
    if (seq !== lookupSeq) return;
    playBtn.disabled = false;
    showPlace(res);
    if (res.ok) store.set('vc_pin', v.pin);
  }
  let pinTimer = 0;
  pinEl.addEventListener('input', () => {
    pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 6);
    clearTimeout(pinTimer);
    pinTimer = setTimeout(lookupPin, pinEl.value.length === 6 ? 50 : 600);
  });
  lookupPin();

  function syncOpts() {
    $('optMute').textContent = SFX.muted ? '🔇 Sound off' : '🔊 Sound on';
    $('optQ').textContent = Render.quality === 'hi' ? '✨ Graphics: high' : '⚡ Graphics: fast';
  }
  const toggleMute = () => { SFX.toggleMute(); syncOpts(); };
  const toggleQuality = () => { const q = Render.quality === 'hi' ? 'lo' : 'hi'; store.set('vc_q', q); Render.resize(q); syncOpts(); };
  $('optMute').addEventListener('click', toggleMute);
  $('optQ').addEventListener('click', toggleQuality);
  syncOpts();

  // ------------------------------------------------------------ lifecycle
  function newGame(pl, seed) {
    const g = window.Sim.createGame({ seed, mapSeed: hashStr('town:' + (pl.pin || pl.town)), place: pl, names: pl.offices });
    Render.setGame(g);
    return g;
  }
  function start() {
    if (placeErr) { menu.classList.remove('hide'); pinEl.focus(); return; }
    FrontPage.hide();
    SFX.init();
    store.set('vc_name', nameEl.value.trim());
    const pl = place ? { town: place.town, mandal: place.mandal, district: place.district, pin: place.pin, offices: (place.offices || []).filter((o) => o !== place.town) } : Object.assign({}, Ct.DEFAULT_PLACE);
    game = newGame(pl, hashStr(pl.pin + '|' + nameEl.value + '|' + Date.now()));
    Hud.reset();
    menu.classList.add('hide');
    running = true; paused = false; acc = 0; endT = 0; last = performance.now();
    Input.setEnabled(true);
    document.body.classList.add('playing');
    cv.focus();
  }
  playBtn.addEventListener('click', start);
  [nameEl, pinEl].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } }));

  function stopPlaying(toMenu) {
    running = false; paused = false; mapOpen = false;
    document.body.classList.remove('mapopen');
    pauseEl.classList.remove('on');
    Input.setEnabled(false);
    document.body.classList.remove('playing');
    if (toMenu !== false) menu.classList.remove('hide');
  }
  // Every run ends on the front page of "The Daily Ballot", headlined with the end title.
  function finish() {
    stopPlaying(false);
    SFX.flatline();
    FrontPage.show({
      result: game.state.result, tactics: Hud.tacticsSeen, name: nameEl.value.trim() || 'Our candidate',
      onPlayAgain: start, onMenu: () => menu.classList.remove('hide'),
    });
  }
  function setPaused(on) {
    if (!running) return;
    if (on) { mapOpen = false; document.body.classList.remove('mapopen'); }
    paused = on;
    pauseEl.classList.toggle('on', on);
    Input.setEnabled(!on);
    if (!on) last = performance.now();
  }
  function setMap(on) {
    if (!running || paused) return;
    mapOpen = on;
    document.body.classList.toggle('mapopen', on);
    Input.setEnabled(!on);
    if (!on) last = performance.now();
  }
  Input.onTap((x, y) => {
    if (!running || paused) return false;
    if (mapOpen) { setMap(false); return true; }
    const r = Hud.layout.mini;
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { setMap(true); return true; }
    return false;
  });
  $('resume').addEventListener('click', () => setPaused(false));
  $('quit').addEventListener('click', stopPlaying);
  $('bPause').addEventListener('click', () => setPaused(!paused));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  Input.onMeta((e) => {
    if (e.code === 'KeyM') { toggleMute(); return true; }
    if (e.code === 'KeyG') { toggleQuality(); return true; }
    if (e.code === 'Tab' && running && !paused) { if (!e.repeat) setMap(!mapOpen); return true; }
    if (e.code === 'Escape' && mapOpen) { setMap(false); return true; }
    if ((e.code === 'Escape' || e.code === 'KeyP') && running) { setPaused(!paused); return true; }
    return false;
  });

  // ------------------------------------------------------------ events
  // first appearance of each tactic -> "How democracy is being spoiled" card
  const TACTIC_OF = { ring: 'sec144', throw: 'stones', ignore: 'police', detained: 'arrest', line: 'line', gateshut: 'gate', vipgate: 'gate', frisk: 'papers', stall: 'stall' };
  function handle(evs) {
    const P = game.state.player;
    if (P.pushing) Hud.tactic('barricade');
    const near = (ev) => Math.abs(ev.x - P.x) < 700 && Math.abs(ev.y - P.y) < 700;
    for (const ev of evs) {
      if (TACTIC_OF[ev.t] && (ev.t !== 'throw' || near(ev))) Hud.tactic(TACTIC_OF[ev.t]);
      if (ev.t === 'civhit' && ev.type !== 'man') Hud.tactic('women');
      switch (ev.t) {
        case 'say': Render.say(ev); break;
        case 'toast': Hud.toast(ev.text, ev.color); break;
        case 'join': SFX.join(); Render.popup(ev.x, ev.y - 30, '+' + ev.n + ' 👥', '#bbdefb'); break;
        case 'slogan': SFX.slogan(); Render.burst(ev.x, ev.y, 14, ['#00a651', '#fff', '#1a2d8a'], 220, 4); break;
        case 'lathi': SFX.lathi(); Render.shake(4); Render.burst(ev.x, ev.y, 8, ['#8d6e63', '#fff'], 180, 3); break;
        case 'grab': SFX.grab(); Render.shake(6); break;
        case 'detained': SFX.detained(); Render.shake(14); Hud.toast('🚓 Detained! Case ' + ev.cases + ' of ' + game.CASES, '#ff8a80', 3.4); break;
        case 'released': SFX.released(); break;
        case 'lift': SFX.lift(); Render.popup(ev.x, ev.y - 30, 'Crowd lifted the cop!', '#b9f6ca'); Render.shake(6); break;
        case 'scare': SFX.scare(); Render.popup(ev.x, ev.y - 30, 'Goon ran off!', '#ffd54f'); break;
        case 'attacked': SFX.torn(); Render.shake(8); Render.hurtFlash(0.6); Render.burst(ev.x, ev.y, 10, ['#ffca28', '#fff'], 200, 4); break;
        case 'gas': SFX.gas(); Hud.toast('💨 Tear gas! Supporters are scattering', '#eeeeee'); break;
        case 'break': if (ev.kind === 'police') Hud.tier(Ct.GATE.lineBroken); SFX.break(); Render.shake(12); Render.burst(ev.x, ev.y, 28, ['#ffca28', '#212121', '#90a4ae'], 300, 6); Render.popup(ev.x, ev.y - 30, ev.kind === 'police' ? 'Line broken!' : 'Barricade down!', '#ffd54f'); break;
        case 'filing': SFX.stamp(); break;
        case 'backup': SFX.backup(); break;
        case 'rejected': SFX.stall(); Render.shake(10); break;
        case 'over': SFX.over(); Hud.tier(ev.reason === 'rejected' ? 'NOMINATION REJECTED' : ev.reason === 'jailed' ? 'JAILED' : 'DEMOCRACY KILLED'); break;
        case 'throw': if (near(ev)) SFX.whoosh(); break;
        case 'land': Render.addDebris(ev.x, ev.y, ev.kind); if (near(ev)) { (ev.kind === 'stick' ? SFX.crack : ev.kind === 'chappal' ? SFX.slap : SFX.thud)(); Render.burst(ev.x, ev.y, 6, ['#bcaaa4', '#d7ccc8'], 90, 3); } break;
        case 'hit': Render.shake(9); Render.hurtFlash(0.7); Render.popup(ev.x, ev.y - 34, '💫', '#ff8a80'); break;
        case 'civhit': if (near(ev)) SFX.cry(); Render.popup(ev.x, ev.y - 26, ev.type === 'man' ? '💫' : '😢', '#fff'); break;
        case 'shield': SFX.scare(); Render.popup(ev.x, ev.y - 30, '🛡️ took it for you', '#bbdefb'); break;
        case 'protect': SFX.protect(); Render.popup(ev.x, ev.y - 30, ev.crowd ? '🛡️ Crowd protected them!' : '🛡️ You protected them!', '#b9f6ca'); break;
        case 'demo': if (ev.d < 0) Hud.demoHit(); break;
        case 'demostage': SFX.heartbeat(); Render.shake(4); break;
        case 'line': SFX.backup(); Render.shake(3); break;
        case 'gateshut': SFX.clang(); Render.shake(5); break;
        case 'chant': SFX.slogan(); Render.popup(ev.x, ev.y - 40, '📣 ' + ev.n + '/' + ev.need, '#bbdefb'); break;
        case 'gateopen': SFX.mission(); Hud.tier('GATE OPEN! 📣'); break;
        case 'vipgate': if (near(ev)) SFX.whistle(); break;
        case 'frisk': SFX.grab(); Render.burst(P.x, P.y - 6, 10, ['#fff', '#eceff1', '#cfd8dc'], 120, 4); break;
        case 'stall': SFX.stall(); break;
        case 'needcrowd': Render.popup(game.state.target.gate.x, game.state.target.gate.y - 40, 'Need 8+ supporters (' + ev.n + ')', '#ffcc80'); break;
        case 'four': Render.popup(P.x, P.y - 40, 'Only you + 4 allowed in', '#bbdefb'); break;
      }
    }
  }

  // ------------------------------------------------------------ loop
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!game) return;
    const G = game.state;
    const live = running && !paused && !mapOpen;
    if (live) {
      acc += dt;
      let n = 0;
      const ps = view ? Render.worldToScreen(G.player.x, G.player.y, view) : null;
      while (acc >= DT && n < 5) { game.step(Input.frame(ps)); handle(game.drainEvents()); acc -= DT; n++; }
      if (n === 5) acc = 0;
      if (G.mode === 'over') { endT += dt; if (endT > 3) finish(); }
    }
    view = Render.draw(live ? acc / DT : 1, live ? dt : 0);
    if (running) {
      const opts = { DPR: Render.DPR, W: Render.W, H: Render.H, isTouch: Input.isTouch, safe };
      const lay = Hud.draw(Render.ctx, game, view, live ? dt : 0, opts);
      if (mapOpen) Hud.drawMap(Render.ctx, game, opts);
      placePause(lay.pause);
    }
  }

  // safe-area insets (notches, home bar) so the HUD stays clear of them
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  let safe = { t: 0, r: 0, b: 0, l: 0 };
  const readSafe = () => { const cs = getComputedStyle(probe); safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 }; };
  readSafe();
  const pauseBtn = $('bPause');
  let pauseAt = '';
  function placePause(p) {
    if (!p) return;
    const k = Math.round(p.x) + ',' + Math.round(p.y);
    if (k === pauseAt) return;
    pauseAt = k;
    pauseBtn.style.left = Math.round(p.x) + 'px'; pauseBtn.style.top = Math.round(p.y) + 'px';
  }

  // attract mode: the default town behind the menu
  game = newGame(Object.assign({}, Ct.DEFAULT_PLACE), 7);
  addEventListener('resize', () => { Render.resize(); readSafe(); });
  requestAnimationFrame(frame);

  // read-only hook for automated playtests
  window.__vc = { get game() { return game; }, get running() { return running; } };
})();
