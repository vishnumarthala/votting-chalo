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
  Render.resize(store.get('vc_q', 'hi'));
  Input.bind(cv);
  document.body.classList.toggle('touch', Input.isTouch);

  const menu = $('menu'), nameEl = $('name'), townEl = $('town'), townStatus = $('townStatus');
  const playBtn = $('play'), lbEl = $('lb'), resultEl = $('result'), pauseEl = $('pause');
  let game = null, running = false, paused = false, acc = 0, last = performance.now(), endT = 0, view = null, lastTick = -1;
  let town = store.get('vc_town', Ct.DEFAULT_TOWN), mode = store.get('vc_mode', 'nomination'), starting = false, townSeq = 0;
  const isTown = (id) => Object.prototype.hasOwnProperty.call(Ct.TOWNS, id);
  if (!isTown(town)) town = Ct.DEFAULT_TOWN;

  // ------------------------------------------------------------ town maps
  // Each town's map file is fetched from this site once and kept: the in-flight request is shared, so a quick Play
  // does not fetch twice, and a failed fetch is forgotten so the next try starts again.
  const maps = new Map(), loading = new Map(), MAP_TIMEOUT_MS = 15000;
  function loadMap(id) {
    if (maps.has(id)) return Promise.resolve(maps.get(id));
    if (loading.has(id)) return loading.get(id);
    const p = (async () => {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), MAP_TIMEOUT_MS);
      try {
        const res = await fetch('data/towns/' + id + '.json', { signal: ctl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        maps.set(id, data);
        return data;
      } finally { clearTimeout(timer); loading.delete(id); }
    })();
    loading.set(id, p);
    return p;
  }
  const placeLabel = (t) => [t.town, t.mandal && t.mandal !== t.town ? t.mandal + ' mandal' : '', t.district && t.district !== t.mandal ? t.district + ' district' : ''].filter(Boolean).join(', ');
  function say(msg, cls) { townStatus.textContent = msg; townStatus.className = cls || ''; }

  // ------------------------------------------------------------ menu
  nameEl.value = store.get('vc_name', '');
  for (const id of Object.keys(Ct.TOWNS)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = Ct.TOWNS[id].town;
    townEl.appendChild(opt);
  }
  townEl.value = town;
  function setMode(m) {
    mode = m === 'vote' ? 'vote' : 'nomination';
    store.set('vc_mode', mode);
    for (const b of document.querySelectorAll('.mode')) b.classList.toggle('sel', b.dataset.m === mode);
    playBtn.textContent = mode === 'vote' ? 'CHALO, VOTE VEYYI ▶' : 'CHALO, NOMINATION ▶';
    renderLb();
  }
  for (const b of document.querySelectorAll('.mode')) b.addEventListener('click', () => setMode(b.dataset.m));

  // Shows the chosen town and, while the menu is up, plays its map behind the card.
  async function showTown() {
    const id = town, seq = ++townSeq;
    store.set('vc_town', id);
    say('Loading the map of ' + Ct.TOWNS[id].town + '…');
    try {
      await loadMap(id);
    } catch {
      if (seq === townSeq) say('Could not load the map of ' + Ct.TOWNS[id].town + '. Check your connection and press Play to try again.', 'err');
      return;
    }
    if (seq !== townSeq) return;
    say('📍 ' + placeLabel(Ct.TOWNS[id]), 'ok');
    if (!running) game = newGame(id, mode, 7);
  }
  townEl.addEventListener('change', () => { town = isTown(townEl.value) ? townEl.value : Ct.DEFAULT_TOWN; renderLb(); showTown(); });

  const lbKey = () => 'vc_lb_' + town + '_' + mode;
  function readLb() { try { return JSON.parse(store.get(lbKey(), '[]')) || []; } catch (e) { return []; } }
  function renderLb() {
    const lb = readLb();
    lbEl.innerHTML = '';
    if (!lb.length) { lbEl.innerHTML = '<li class="none">No runs yet. Be the first from ' + Ct.TOWNS[town].town + '!</li>'; return; }
    lb.forEach((r, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${r.n} (${r.t}) · ${r.s.toLocaleString('en-IN')} · ${r.w ? '✅' : '❌'} · crowd ${r.c}`; lbEl.appendChild(li); });
  }
  function saveLb(res) {
    const lb = readLb();
    lb.push({ n: (nameEl.value.trim() || 'Candidate').slice(0, 18), s: res.score, w: res.won, c: res.crowd, t: res.place.town, d: Date.now() });
    lb.sort((a, b) => b.s - a.s);
    store.set(lbKey(), JSON.stringify(lb.slice(0, 10)));
  }
  setMode(mode);

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
  function newGame(id, m, seed) {
    const g = window.Sim.createGame({ seed, town: id, townData: maps.get(id), mode: m });
    Render.setGame(g);
    return g;
  }
  async function start() {
    if (starting) return;
    starting = true; playBtn.disabled = true;
    SFX.init();
    store.set('vc_name', nameEl.value.trim());
    const id = town;
    try {
      await loadMap(id);
    } catch {
      say('Could not load the map of ' + Ct.TOWNS[id].town + '. Check your connection and press Play to try again.', 'err');
      starting = false; playBtn.disabled = false;
      return;
    }
    game = newGame(id, mode, hashStr(id + '|' + nameEl.value + '|' + Date.now()));
    Hud.reset();
    menu.classList.add('hide'); resultEl.innerHTML = '';
    running = true; paused = false; acc = 0; endT = 0; last = performance.now();
    starting = false; playBtn.disabled = false;
    Input.setEnabled(true);
    document.body.classList.add('playing');
    cv.focus();
  }
  playBtn.addEventListener('click', start);
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } });

  function stopPlaying() {
    running = false; paused = false;
    pauseEl.classList.remove('on');
    Input.setEnabled(false);
    document.body.classList.remove('playing');
    menu.classList.remove('hide');
  }
  function finish() {
    const G = game.state, res = G.result;
    saveLb(res);
    const why = { jailed: 'Three cases filed against you, and you spent the day in the lock-up.', time: G.gameMode === 'vote' ? 'Polling closed at 6 PM before you got in.' : 'The RO office closed at 3 PM. "Come tomorrow." (The deadline was today.)' }[res.reason] || '';
    resultEl.innerHTML = res.won
      ? `<b class="win">${game.text(G.M.win)}</b><br>Score <b>${res.score.toLocaleString('en-IN')}</b> · biggest crowd ${res.crowd} · missions ${res.missions}`
      : `<b class="lose">❌ ${G.gameMode === 'vote' ? 'Vote not cast.' : 'Nomination not filed.'}</b> ${why}<br>Score <b>${res.score.toLocaleString('en-IN')}</b> · documents ${res.docs}/${G.M.docs.length + (G.M.given || []).length} · biggest crowd ${res.crowd}`;
    playBtn.textContent = 'PLAY AGAIN ▶';
    renderLb();
    stopPlaying();
  }
  function setPaused(on) {
    if (!running) return;
    paused = on;
    pauseEl.classList.toggle('on', on);
    Input.setEnabled(!on);
    if (!on) last = performance.now();
  }
  $('resume').addEventListener('click', () => setPaused(false));
  $('quit').addEventListener('click', stopPlaying);
  $('bPause').addEventListener('click', () => setPaused(!paused));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  Input.onMeta((e) => {
    if (e.code === 'KeyM') { toggleMute(); return true; }
    if (e.code === 'KeyG') { toggleQuality(); return true; }
    if ((e.code === 'Escape' || e.code === 'KeyP') && running) { setPaused(!paused); return true; }
    return false;
  });

  // ------------------------------------------------------------ events
  function handle(evs) {
    const P = game.state.player;
    for (const ev of evs) {
      switch (ev.t) {
        case 'say': Render.say(ev); break;
        case 'toast': Hud.toast(ev.text, ev.color); break;
        case 'tier': if (ev.name) { Hud.tier(ev.name); SFX.tier(); } break;
        case 'mission': Hud.toast('🎯 ' + ev.text + '  +' + ev.rew, '#b2ff59', 3.2); SFX.mission(); break;
        case 'join': SFX.join(); Render.popup(ev.x, ev.y - 30, '+' + ev.n + ' 👥', '#bbdefb'); break;
        case 'slogan': SFX.slogan(); Render.burst(ev.x, ev.y, 14, ['#1e5bd8', '#fff', '#90caf9'], 220, 4); break;
        case 'doc':
          SFX.doc(); Render.burst(ev.x, ev.y, 18, ['#fff59d', '#fff'], 200, 5); Render.popup(ev.x, ev.y - 40, '+' + ev.pts, '#ffd54f');
          Hud.toast('📄 Got ' + ev.doc + ' (' + ev.have + '/' + ev.need + ')' + (ev.have === ev.need ? ' → now go to the ' + game.state.M.goal + '!' : ''), '#fff59d', 3.4);
          break;
        case 'lathi': SFX.lathi(); Render.shake(4); Render.burst(ev.x, ev.y, 8, ['#8d6e63', '#fff'], 180, 3); break;
        case 'grab': SFX.grab(); Render.shake(6); break;
        case 'detained': SFX.detained(); Render.shake(14); Hud.toast('🚓 Detained! Case ' + ev.cases + ' of ' + game.CASES, '#ff8a80', 3.4); break;
        case 'released': SFX.released(); break;
        case 'lift': SFX.lift(); Render.popup(ev.x, ev.y - 30, 'Crowd lifted the cop! +' + ev.pts, '#b9f6ca'); Render.shake(6); break;
        case 'scare': SFX.scare(); Render.popup(ev.x, ev.y - 30, '+' + ev.pts, '#ffd54f'); break;
        case 'torn': SFX.torn(); Render.shake(6); Render.burst(ev.x, ev.y, 12, ['#fff', '#eceff1'], 220, 5); Render.popup(ev.x, ev.y - 34, '📄 −' + ev.amount + '%', '#ff8a80'); break;
        case 'stone':
          SFX.stone();
          Render.burst(ev.x, ev.y, ev.hit ? 14 : 6, ev.hit ? ['#bdbdbd', '#f2c200', '#fff'] : ['#bcaaa4', '#d7ccc8'], 160, 3);
          if (ev.hit) { Render.shake(8); Render.popup(ev.x, ev.y - 52, 'Stoned! −' + ev.amount + '%', '#ffe082'); }
          break;
        case 'fire':
          SFX.fire(); Render.shake(5);
          Render.burst(ev.x, ev.y, 16, ['#ff7043', '#ffca28', '#ffe082'], 190, 4);
          Hud.toast(ev.text, '#ffab91', 3.4);
          break;
        case 'burnt': Render.burst(ev.x, ev.y, 10, ['#9e9e9e', '#616161', '#bdbdbd'], 70, 6); break;
        case 'riot': SFX.riot(); Hud.toast('⚠️ ' + ev.text, '#ffe082', 3.6); break;
        case 'lostdoc': SFX.lostdoc(); break;
        case 'gas': SFX.gas(); Hud.toast('💨 Tear gas! Supporters are scattering', '#eeeeee'); break;
        case 'break': SFX.break(); Render.shake(12); Render.burst(ev.x, ev.y, 28, ['#ffca28', '#212121', '#90a4ae'], 300, 6); Render.popup(ev.x, ev.y - 30, 'Barricade down! +' + ev.pts, '#ffd54f'); break;
        case 'filing': SFX.stamp(); break;
        case 'backup': SFX.backup(); break;
        case 'won': SFX.won(); for (let i = 0; i < 6; i++) Render.burst(P.x + (i - 3) * 30, P.y - 30, 20, ['#1e5bd8', '#ffd54f', '#fff', '#66bb6a', '#ff7043'], 320, 6); Hud.tier(game.state.gameMode === 'vote' ? 'VOTE CAST! ☑️' : 'NOMINATION FILED! ✅'); break;
        case 'over': SFX.over(); break;
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
    const live = running && !paused;
    if (live) {
      acc += dt;
      let n = 0;
      const ps = view ? Render.worldToScreen(G.player.x, G.player.y, view) : null;
      while (acc >= DT && n < 5) { game.step(Input.frame(ps)); handle(game.drainEvents()); acc -= DT; n++; }
      if (n === 5) acc = 0;
      if (G.mode === 'play' && G.timer < 20 && Math.ceil(G.timer) !== lastTick) { lastTick = Math.ceil(G.timer); SFX.tick(); }
      if (G.mode === 'won' || G.mode === 'over') { endT += dt; if (endT > (G.mode === 'won' ? 3.5 : 2.5)) finish(); }
    }
    view = Render.draw(live ? acc / DT : 1, live ? dt : 0);
    if (running) Hud.draw(Render.ctx, game, view, live ? dt : 0, { DPR: Render.DPR, W: Render.W, H: Render.H, isTouch: Input.isTouch });
  }

  addEventListener('resize', () => Render.resize());
  requestAnimationFrame(frame);
  showTown(); // attract mode: the chosen town plays behind the menu once its map has loaded

  // read-only hook for automated playtests
  window.__vc = { get game() { return game; }, get running() { return running; } };
})();
