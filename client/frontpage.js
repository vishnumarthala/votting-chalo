// "The Daily Ballot": a satirical front page shown when the candidate doesn't make it. Drawn on one
// 1080x1350 canvas so what you see is exactly the image you share.
'use strict';
(function () {
  const W = 1080, H = 1350, INK = '#1d1a16', PAPER = '#f3ecdc', RED = '#b71c1c';
  const SERIF = 'Georgia,"Times New Roman",serif', SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';
  let root = null, cv = null, ctx = null, headline = '', onAgain = null, shownAt = 0;

  function wrap(s, maxW) {
    const words = String(s).split(' '), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  function txt(s, x, y, font, color, align) {
    ctx.font = font; ctx.fillStyle = color || INK; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }
  function rule(y, x0, x1, w) { ctx.fillStyle = INK; ctx.fillRect(x0 || 40, y, (x1 || W - 40) - (x0 || 40), w || 2); }
  const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

  // ---------------------------------------------------------------- cartoon panel
  function missile(kind, x, y, rot, s) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.lineWidth = 1.2; ctx.strokeStyle = INK;
    if (kind === 0) { ctx.fillStyle = '#9e9e9e'; ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-2, -4.5); ctx.lineTo(3.5, -3.5); ctx.lineTo(5, 1); ctx.lineTo(1.5, 4.5); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (kind === 1) { ctx.strokeStyle = '#5d4037'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke(); }
    else { ctx.fillStyle = '#ef6c00'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  function cartoon(x, y, w, h, vote) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#e9e1cc'; ctx.fillRect(x, y, w, h);
    // sun (sad), road
    const sunX = x + 64, sunY = y + 40;
    ctx.fillStyle = '#f6d36b'; ctx.beginPath(); ctx.arc(sunX, sunY, 28, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sunX, sunY + 16, 10, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(sunX - 9, sunY - 5, 3, 0, Math.PI * 2); ctx.arc(sunX + 9, sunY - 5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#bdb6a6'; ctx.fillRect(x, y + h - 120, w, 120);
    ctx.fillStyle = '#d7cfbc'; for (let i = 0; i < w; i += 60) ctx.fillRect(x + i + 10, y + h - 64, 34, 6);
    // the office, shutter down
    const bx = x + 30, by = y + 70, bw = w * 0.52, bh = h - 190;
    ctx.fillStyle = '#d9cdb2'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#1e3a6e'; ctx.fillRect(bx + 20, by + 14, bw - 40, 44);
    txt(vote ? 'POLLING BOOTH' : 'RO OFFICE', bx + bw / 2, by + 46, `bold 28px ${SANS}`, '#fff', 'center');
    const sx = bx + 34, sy = by + 78, sw = bw - 68, sh = bh - 78;
    ctx.fillStyle = '#9ea7ad'; ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = '#7d868c'; for (let i = sy + 8; i < sy + sh; i += 14) ctx.fillRect(sx, i, sw, 3);
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(sx, sy, sw, sh);
    // hanging CLOSED board and a clock at 3
    ctx.save(); ctx.translate(sx + sw / 2 + 10, sy + 36); ctx.rotate(-0.08);
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-36, -24); ctx.lineTo(0, -40); ctx.lineTo(36, -24); ctx.stroke();
    ctx.fillStyle = '#fff8e1'; ctx.fillRect(-70, -24, 140, 48); ctx.strokeRect(-70, -24, 140, 48);
    txt('CLOSED', 0, 11, `900 30px ${SANS}`, RED, 'center');
    ctx.restore();
    const cx = bx + bw - 40, cy = by + 100;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 15); ctx.moveTo(cx, cy); ctx.lineTo(cx + 11, cy); ctx.stroke();
    // ballot box on a stretcher with a drip and a flat ECG
    const tx = x + w * 0.58, ty = y + h - 150;
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.fillStyle = '#fafafa'; ctx.fillRect(tx, ty, w * 0.38, 16); ctx.strokeRect(tx, ty, w * 0.38, 16);
    for (const lx of [tx + 14, tx + w * 0.38 - 14]) { ctx.beginPath(); ctx.moveTo(lx, ty + 16); ctx.lineTo(lx, ty + 44); ctx.stroke(); ctx.beginPath(); ctx.arc(lx, ty + 50, 7, 0, Math.PI * 2); ctx.stroke(); }
    const bbx = tx + 30, bby = ty - 74, bbw = 110, bbh = 74;
    ctx.fillStyle = '#5c7cb8'; ctx.fillRect(bbx, bby, bbw, bbh); ctx.strokeRect(bbx, bby, bbw, bbh);
    ctx.fillStyle = INK; ctx.fillRect(bbx + 28, bby + 8, 54, 7);
    txt('X', bbx + 35, bby + 52, `bold 26px ${SANS}`, '#fff', 'center'); txt('X', bbx + 75, bby + 52, `bold 26px ${SANS}`, '#fff', 'center');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bbx + 55, bby + 66, 12, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(bbx - 6, bby + 30, bbw + 12, 10); // blanket edge
    const px = tx + w * 0.38 - 30;
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, ty); ctx.lineTo(px, ty - 170); ctx.lineTo(px - 26, ty - 170); ctx.stroke();
    ctx.fillStyle = '#e3f2fd'; ctx.fillRect(px - 44, ty - 166, 30, 40); ctx.strokeRect(px - 44, ty - 166, 30, 40);
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px - 29, ty - 126); ctx.quadraticCurveTo(px - 50, ty - 90, bbx + bbw - 6, bby + 20); ctx.stroke();
    const mx = tx + 10, my = ty - 190;
    ctx.fillStyle = '#263238'; ctx.fillRect(mx, my, 120, 70); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(mx, my, 120, 70);
    ctx.strokeStyle = '#69f0ae'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(mx + 8, my + 40); ctx.lineTo(mx + 30, my + 40); ctx.lineTo(mx + 36, my + 22); ctx.lineTo(mx + 42, my + 52); ctx.lineTo(mx + 48, my + 40); ctx.lineTo(mx + 112, my + 40); ctx.stroke();
    txt('BEEEEEP', mx + 60, my - 10, `bold 18px ${SANS}`, INK, 'center');
    // stones, sticks and chappals on the road
    for (let i = 0; i < 16; i++) missile(i % 3, x + 30 + ((i * 97) % (w - 60)), y + h - 100 + ((i * 53) % 70), i * 1.7, 2.2);
    // a cop with his back turned
    const kx = x + 40, ky = y + h - 80;
    ctx.fillStyle = '#c8ab72'; ctx.beginPath(); ctx.ellipse(kx + 30, ky, 22, 30, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#a88a52'; ctx.beginPath(); ctx.arc(kx + 30, ky - 38, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(kx + 112, ky - 52, 84, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kx + 50, ky - 36); ctx.lineTo(kx + 40, ky - 22); ctx.lineTo(kx + 64, ky - 32); ctx.fill();
    txt('No complaint', kx + 112, ky - 56, `italic bold 19px ${SERIF}`, INK, 'center');
    txt('received.', kx + 112, ky - 36, `italic bold 19px ${SERIF}`, INK, 'center');
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
  }

  // ---------------------------------------------------------------- page
  function render(o) {
    const C = window.Content, NEWS = C.NEWS, r = o.result, vote = r.mode === 'vote';
    const seed = (r.score | 0) + (r.thrown | 0) * 7 + (r.closest | 0);
    const fill = (s) => C.fill(s, Object.assign({}, r.place || {}, { name: o.name, stop: r.closest, goal: r.goal }));
    const key = r.demo < 20 ? 'low' : r.gateStops > 0 && r.reason !== 'jailed' ? 'gate' : (r.reason === 'jailed' ? 'jailed' : 'time') + (vote ? 'Vote' : '');
    headline = pick(NEWS.headlines[key] || NEWS.headlines.time, seed);
    const sub = fill(NEWS.sub[r.reason === 'jailed' ? 'jailed' : 'time']);
    const town = (r.place && r.place.town) || C.DEFAULT_PLACE.town;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(80,60,30,.035)'; for (let i = 0; i < H; i += 4) ctx.fillRect(0, i, W, 1);
    // masthead
    rule(36, 40, W - 40, 3);
    const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    txt(date, 40, 62, `16px ${SERIF}`); txt(town.toUpperCase() + ' EDITION', W - 40, 62, `bold 16px ${SERIF}`, INK, 'right');
    txt(NEWS.masthead, W / 2, 140, `900 86px ${SERIF}`, INK, 'center');
    rule(156, 40, W - 40, 1.5);
    txt(NEWS.tagline, W / 2, 178, `italic 18px ${SERIF}`, INK, 'center');
    rule(190, 40, W - 40, 4);
    // headline: largest size that fits in three lines
    let size = 74, lines;
    for (; size > 44; size -= 2) { ctx.font = `900 ${size}px ${SERIF}`; lines = wrap(headline, W - 80); if (lines.length <= 3) break; }
    let y = 196;
    for (const l of lines.slice(0, 3)) { y += size * 1.02; txt(l, W / 2, y, `900 ${size}px ${SERIF}`, INK, 'center'); }
    ctx.font = `italic 28px ${SERIF}`;
    y += 14;
    for (const l of wrap(sub, W - 140).slice(0, 2)) { y += 34; txt(l, W / 2, y, `italic 28px ${SERIF}`, '#3e2f22', 'center'); }
    y += 18;
    rule(y, 40, W - 40, 2);
    // cartoon + numbers
    const top = y + 18, ch = Math.min(400, H - 100 - 300 - 40 - top), cw = 640;
    cartoon(40, top, cw, ch, vote);
    ctx.save(); ctx.translate(40 + cw - 108, top + ch - 44); ctx.rotate(-0.16); // SATIRE stamp
    ctx.strokeStyle = RED; ctx.lineWidth = 5; ctx.strokeRect(-88, -28, 176, 56);
    ctx.fillStyle = 'rgba(243,236,220,.75)'; ctx.fillRect(-85, -25, 170, 50);
    txt('SATIRE', 0, 14, `900 38px ${SANS}`, RED, 'center');
    ctx.restore();
    txt('Democracy, ' + (r.demo <= 10 ? 'on a ventilator' : r.demo <= 25 ? 'in the ICU' : 'in hospital') + ', ' + town + '.', 40 + cw / 2, top + ch + 24, `italic 18px ${SERIF}`, '#3e2f22', 'center');
    const sx = 40 + cw + 30, sw = W - 40 - sx;
    txt('BY THE NUMBERS', sx, top + 24, `900 25px ${SANS}`);
    rule(top + 36, sx, W - 40, 2);
    const rows = [
      [r.thrown, 'stones, sticks & chappals thrown'],
      [r.civHurt, 'women & children hurt'],
      [r.hits, 'times the candidate was hit'],
      [r.arrests, r.arrests === 1 ? 'arrest' : 'arrests'],
      [r.gateStops || 0, 'times stopped at the gate'],
      [r.stalls || 0, '"server down" moments at the counter'],
      [r.protected, 'times the crowd protected people'],
      [r.demo + '%', 'democracy left'],
    ];
    const step = Math.min(56, (ch - 50) / rows.length);
    let ry = top + 36 + step * 0.8;
    for (const [n, lbl] of rows) {
      txt(String(n), sx, ry, `900 36px ${SERIF}`, lbl === 'democracy left' || lbl === 'women & children hurt' ? RED : INK);
      ctx.font = `900 36px ${SERIF}`;
      const lx = sx + Math.max(84, ctx.measureText(String(n)).width + 12);
      ctx.font = `16px ${SANS}`;
      wrap(lbl, W - 40 - lx).forEach((l, i) => txt(l, lx, ry - 13 + i * 19, `16px ${SANS}`, '#3e2f22'));
      ry += step;
    }
    // bottom stories
    const by = top + ch + 50, bottom = H - 104;
    rule(by - 12, 40, W - 40, 2);
    const colW = (W - 80 - 40) / 2, lx = 40, rx = 40 + colW + 40;
    ctx.font = `900 23px ${SANS}`;
    let ly = by + 20;
    for (const l of wrap(NEWS.explainer.title, colW)) { txt(l, lx, ly, `900 23px ${SANS}`, RED); ly += 27; }
    ly += 4;
    NEWS.explainer.steps.forEach((s, i) => { txt((i + 1) + '.', lx, ly, `900 20px ${SERIF}`, INK); txt(s, lx + 30, ly, `20px ${SERIF}`, INK); ly += 27; });
    ctx.font = `italic 17px ${SERIF}`;
    for (const l of wrap(NEWS.explainer.footer, colW)) { if (ly + 22 > bottom) break; txt(l, lx, ly + 4, `italic 17px ${SERIF}`, '#3e2f22'); ly += 21; }
    ctx.fillStyle = INK; ctx.fillRect(rx - 20, by, 1.5, bottom - by);
    let qy = by + 20;
    ctx.font = `900 25px ${SERIF}`;
    for (const l of wrap(pick(NEWS.police, seed + 1), colW)) { txt(l, rx, qy, `900 25px ${SERIF}`); qy += 30; }
    qy += 2;
    const story = (r.civHurt ? r.civHurt + (r.civHurt === 1 ? ' woman or child was' : ' women and children were') + ' hit by stones on the road to the ' + r.goal + '. ' : 'Stones flew all morning on the road to the ' + r.goal + '. ') +
      (r.gateStops ? 'At the gate, police linked arms and the gate was shut "for lunch", but it swung open for the ruling front\u2019s guests, and officers saluted them. ' : 'The gang at the gate was not stopped. The candidate was. ') +
      (r.clockJump ? 'The office clock also ran fast, only today. ' : '') +
      'Officials said the election was "free and fair".';
    ctx.font = `19px ${SERIF}`;
    for (const l of wrap(story, colW)) { if (qy > bottom) break; txt(l, rx, qy, `19px ${SERIF}`, INK); qy += 25; }
    // footer
    rule(H - 90, 40, W - 40, 2);
    ctx.font = `15px ${SANS}`;
    wrap(NEWS.disclaimer, W - 80).slice(0, 2).forEach((l, i) => txt(l, W / 2, H - 64 + i * 19, `15px ${SANS}`, '#5b4a3a', 'center'));
    txt('Play: votting-chalo.vercel.app', W / 2 - 230, H - 20, `bold 18px ${SANS}`, '#0f1b61', 'center');
    ctx.fillStyle = '#0f1b61'; ctx.fillRect(W / 2 + 40, H - 34, 30, 6); ctx.fillStyle = '#fff'; ctx.fillRect(W / 2 + 40, H - 28, 30, 5); ctx.fillStyle = '#00a651'; ctx.fillRect(W / 2 + 40, H - 23, 30, 6);
    txt(NEWS.credit, W / 2 + 80, H - 20, `bold 18px ${SANS}`, '#00a651', 'left');
  }

  // ---------------------------------------------------------------- overlay
  function build() {
    root = document.createElement('div');
    root.id = 'fp'; root.tabIndex = -1; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'The Daily Ballot front page');
    root.innerHTML = '<div class="fp-paper"><canvas width="' + W + '" height="' + H + '"></canvas></div>' +
      '<div class="fp-actions"><button type="button" class="fp-share">📤 Share front page</button><button type="button" class="fp-again">Play again ▶</button><button type="button" class="fp-close">Close</button></div>';
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
    root.querySelector('.fp-close').addEventListener('click', hide);
    // ignore clicks until the buttons have faded in, so a slogan key still held at game over can't skip the page
    const ready = () => performance.now() - shownAt > 1200;
    root.querySelector('.fp-again').addEventListener('click', () => { if (!ready()) return; hide(); if (onAgain) onAgain(); });
    root.querySelector('.fp-share').addEventListener('click', () => { if (ready()) share(); });
    addEventListener('keydown', (e) => { if (root.classList.contains('on') && e.key === 'Escape') { e.preventDefault(); hide(); } });
  }
  function share() {
    cv.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'the-daily-ballot.png', { type: 'image/png' });
      const text = headline + ' (satire) #VottingChalo https://votting-chalo.vercel.app';
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'The Daily Ballot', text }).catch(() => {}); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
  function show(o) {
    if (!root) build();
    onAgain = o.onPlayAgain || null;
    render(o);
    root.classList.remove('on'); void root.offsetWidth; // restart the spin-in animation
    root.classList.add('on');
    shownAt = performance.now();
    root.focus({ preventScroll: true });
  }
  function hide() { if (root) root.classList.remove('on'); }

  window.FrontPage = { show, hide, get open() { return !!root && root.classList.contains('on'); }, get canvas() { return cv; } };
})();
