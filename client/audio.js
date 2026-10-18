// Synthesized sound effects (Web Audio). No audio files.
'use strict';
(function () {
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('vc_mute') === '1'; } catch (e) { /* storage disabled */ }

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(type, f0, f1, dur, vol, delay) {
    if (!ac || muted) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, delay, type) {
    if (!ac || muted) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = type || 'lowpass'; f.frequency.value = freq || 1200;
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur);
  }
  const siren = (n) => { for (let i = 0; i < n; i++) { tone('square', 700, 950, 0.22, 0.06, i * 0.44); tone('square', 950, 700, 0.22, 0.06, i * 0.44 + 0.22); } };

  window.SFX = {
    init,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('vc_mute', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    join: () => { tone('triangle', 523, 523, 0.07, 0.14); tone('triangle', 784, 784, 0.1, 0.12, 0.06); },
    slogan: () => { tone('sawtooth', 220, 330, 0.18, 0.08); tone('sawtooth', 330, 440, 0.22, 0.08, 0.2); noise(0.4, 0.08, 1800, 0, 'bandpass'); },
    lathi: () => { noise(0.08, 0.35, 3000); tone('square', 160, 80, 0.12, 0.1); },
    grab: () => tone('square', 440, 220, 0.2, 0.1),
    detained: () => { siren(3); tone('sawtooth', 300, 90, 0.5, 0.12); },
    released: () => [392, 523].forEach((f, i) => tone('triangle', f, f, 0.15, 0.12, i * 0.1)),
    doc: () => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.1, 0.15, i * 0.06)),
    stone: () => { noise(0.1, 0.3, 700); tone('triangle', 150, 60, 0.12, 0.14); },
    riot: () => { [0, 0.12, 0.24].forEach((d) => tone('square', 110, 80, 0.1, 0.12, d)); tone('sawtooth', 196, 147, 0.5, 0.08, 0.36); },
    fire: () => { noise(0.9, 0.22, 2600, 0, 'bandpass'); noise(0.5, 0.16, 800, 0.1); tone('sawtooth', 180, 80, 0.45, 0.06, 0.05); },
    torn: () => { noise(0.25, 0.3, 5000, 0, 'highpass'); tone('sawtooth', 300, 120, 0.25, 0.08); },
    snatch: () => { noise(0.18, 0.3, 4500, 0, 'highpass'); tone('sawtooth', 380, 160, 0.16, 0.08); },
    tear: () => { noise(0.5, 0.4, 3500, 0, 'highpass'); noise(0.35, 0.3, 6000, 0.12, 'highpass'); tone('sawtooth', 260, 70, 0.5, 0.1); },
    lostdoc: () => [392, 330, 262].forEach((f, i) => tone('triangle', f, f, 0.18, 0.16, i * 0.12)),
    gas: () => noise(1.2, 0.18, 900),
    push: () => noise(0.08, 0.12, 300),
    break: () => { noise(0.4, 0.5, 700); tone('square', 120, 50, 0.3, 0.14); },
    lift: () => { tone('square', 300, 600, 0.15, 0.1); noise(0.1, 0.2, 2500); },
    scare: () => tone('square', 500, 250, 0.15, 0.08),
    filing: () => tone('sine', 880, 880, 0.1, 0.1),
    stamp: () => { tone('sine', 90, 50, 0.25, 0.5); noise(0.06, 0.3, 4000); },
    backup: () => siren(2),
    mission: () => [659, 880, 1319].forEach((f, i) => tone('triangle', f, f, 0.14, 0.16, i * 0.07)),
    tier: () => tone('square', 440, 880, 0.15, 0.1),
    tick: () => tone('square', 1800, 1800, 0.03, 0.05),
    won: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone('square', f, f, 0.18, 0.1, i * 0.1)),
    over: () => [392, 349, 311, 262].forEach((f, i) => tone('sawtooth', f, f, 0.25, 0.1, i * 0.18)),
  };
})();
