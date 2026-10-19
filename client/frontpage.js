// "The Daily Ballot": the satirical front page every run ends on. Headline: the end title. Drawn on one
// 1080x1350 canvas so what you see is exactly the image you share.
'use strict';
(function () {
  const W = 1080, H = 1350, INK = '#1d1a16', PAPER = '#f3ecdc', RED = '#b71c1c';
  const SERIF = 'Georgia,"Times New Roman",serif', SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';
  let root = null, cv = null, ctx = null, headline = '', onAgain = null, onMenu = null, shownAt = 0;

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

  // ---------------------------------------------------------------- cartoon panel
  function missile(kind, x, y, rot, s) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.lineWidth = 1.2; ctx.strokeStyle = INK;
    if (kind === 0) { ctx.fillStyle = '#9e9e9e'; ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-2, -4.5); ctx.lineTo(3.5, -3.5); ctx.lineTo(5, 1); ctx.lineTo(1.5, 4.5); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (kind === 1) { ctx.strokeStyle = '#5d4037'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke(); }
    else { ctx.fillStyle = '#ef6c00'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  function cartoon(x, y, w, h, board) {
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
    txt('RO OFFICE', bx + bw / 2, by + 46, `bold 28px ${SANS}`, '#fff', 'center');
    const sx = bx + 34, sy = by + 78, sw = bw - 68, sh = bh - 78;
    ctx.fillStyle = '#9ea7ad'; ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = '#7d868c'; for (let i = sy + 8; i < sy + sh; i += 14) ctx.fillRect(sx, i, sw, 3);
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(sx, sy, sw, sh);
    // hanging board: CLOSED, or REJECTED for those who made it to the counter
    ctx.save(); ctx.translate(sx + sw / 2 + 10, sy + 36); ctx.rotate(-0.08);
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-36, -24); ctx.lineTo(0, -40); ctx.lineTo(36, -24); ctx.stroke();
    ctx.font = `900 30px ${SANS}`;
    const bw2 = Math.max(140, ctx.measureText(board).width + 28);
    ctx.fillStyle = '#fff8e1'; ctx.fillRect(-bw2 / 2, -24, bw2, 48); ctx.strokeRect(-bw2 / 2, -24, bw2, 48);
    txt(board, 0, 11, `900 30px ${SANS}`, RED, 'center');
    ctx.restore();
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
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(mx + 8, my + 40); ctx.lineTo(mx + 112, my + 40); ctx.stroke(); // flatline
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
  // Just the end title on a front page: masthead, headline, the cartoon, a satire stamp.
  function render(o) {
    const C = window.Content, NEWS = C.NEWS, END = C.END, r = o.result;
    const town = (r.place && r.place.town) || C.DEFAULT_PLACE.town;
    headline = END.title + ' ' + END.sub;

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
    // the headline, as large as fits in three lines
    let size = 128, lines;
    for (; size > 60; size -= 2) { ctx.font = `900 ${size}px ${SERIF}`; lines = wrap(END.title.toUpperCase(), W - 80); if (lines.length <= 3) break; }
    let y = 200;
    for (const l of lines.slice(0, 3)) { y += size * 1.0; txt(l, W / 2, y, `900 ${size}px ${SERIF}`, INK, 'center'); }
    y += 84;
    txt(END.sub, W / 2, y, `900 66px ${SERIF}`, RED, 'center');
    y += 36;
    rule(y, 40, W - 40, 2);
    // the cartoon fills the rest of the page
    const top = y + 22, ch = H - 100 - top;
    cartoon(40, top, W - 80, ch, r.reason === 'rejected' ? 'REJECTED' : 'CLOSED');
    ctx.save(); ctx.translate(W - 170, top + ch - 60); ctx.rotate(-0.16);
    ctx.strokeStyle = RED; ctx.lineWidth = 6; ctx.strokeRect(-100, -32, 200, 64);
    ctx.fillStyle = 'rgba(243,236,220,.75)'; ctx.fillRect(-97, -29, 194, 58);
    txt('SATIRE', 0, 16, `900 44px ${SANS}`, RED, 'center');
    ctx.restore();
    // footer
    rule(H - 66, 40, W - 40, 2);
    txt(NEWS.disclaimer, W / 2, H - 28, `15px ${SANS}`, '#5b4a3a', 'center');
  }

  // ---------------------------------------------------------------- overlay
  function build() {
    root = document.createElement('div');
    root.id = 'fp'; root.tabIndex = -1; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'The Daily Ballot front page');
    root.innerHTML = '<div class="fp-paper"><canvas width="' + W + '" height="' + H + '"></canvas></div>' +
      '<div class="fp-actions"><button type="button" class="fp-share">📤 Share front page</button><button type="button" class="fp-again">Play again ▶</button><button type="button" class="fp-close">Menu</button></div>';
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
    root.querySelector('.fp-close').addEventListener('click', () => { hide(); if (onMenu) onMenu(); });
    // ignore clicks until the buttons have faded in, so a slogan key still held at game over can't skip the page
    const ready = () => performance.now() - shownAt > 1200;
    root.querySelector('.fp-again').addEventListener('click', () => { if (!ready()) return; hide(); if (onAgain) onAgain(); });
    root.querySelector('.fp-share').addEventListener('click', () => { if (ready()) share(); });
    addEventListener('keydown', (e) => { if (root.classList.contains('on') && e.key === 'Escape') { e.preventDefault(); hide(); if (onMenu) onMenu(); } });
  }
  function share() {
    cv.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'the-daily-ballot.png', { type: 'image/png' });
      const text = headline + ' (satire) #TheDeathOfDemocracy';
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'The Daily Ballot', text }).catch(() => {}); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
  function show(o) {
    if (!root) build();
    onAgain = o.onPlayAgain || null; onMenu = o.onMenu || null;
    render(o);
    root.classList.remove('on'); void root.offsetWidth; // restart the spin-in animation
    root.classList.add('on');
    shownAt = performance.now();
    root.focus({ preventScroll: true });
  }
  function hide() { if (root) root.classList.remove('on'); }

  window.FrontPage = { show, hide, get open() { return !!root && root.classList.contains('on'); }, get canvas() { return cv; } };
})();
