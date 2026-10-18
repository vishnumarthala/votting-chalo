// The scrutiny result panel: a torn paper card over the menu that tells how many of the filed nominations survived.
// Example: ScrutinyPanel.open({ won: true, town: 'kadapa', place: { town: 'Kadapa' }, score: 4210, crowd: 14,
// scrutiny: { filed: 10, torn: 6, accepted: 4 } }) shows "10 YSRCP nominations filed", "6 snatched and torn", "4 accepted".
'use strict';
(function () {
  const Ct = window.Content;
  const $ = (id) => document.getElementById(id);
  const root = $('scrutiny'), card = root.querySelector('.scr');
  const buttons = [$('scrAgain'), $('scrClose')];
  const TILTS = [-9, 6, -5, 8, -7, 4]; // degrees: the torn papers lie every which way

  // Fills "{n} …" so that the number can be set big: the line still reads as one piece of text.
  function tally(el, template, n, vars) {
    const [num, ...rest] = Ct.fill(template, Object.assign({ n }, vars)).split(' ');
    const b = document.createElement('b');
    b.textContent = num;
    el.replaceChildren(b, ' ' + rest.join(' '));
  }

  // One paper per filed nomination, the torn ones spread evenly among them.
  function papers(filed, torn) {
    const list = [];
    let ripped = 0;
    for (let i = 0; i < filed; i++) {
      const li = document.createElement('li');
      if (Math.floor(((i + 1) * torn) / filed) > Math.floor((i * torn) / filed)) {
        li.className = 'torn';
        li.style.setProperty('--i', String(ripped));
        li.style.setProperty('--tilt', TILTS[ripped++ % TILTS.length] + 'deg');
      }
      list.push(li);
    }
    $('scrPapers').replaceChildren(...list);
  }

  const isCount = (n) => Number.isInteger(n) && n >= 0;

  // Shows the panel for a run's result; false (and nothing shown) when the result carries no scrutiny.
  function open(res) {
    const sc = res && res.scrutiny;
    if (!sc || !isCount(sc.filed) || !isCount(sc.torn) || !isCount(sc.accepted)) return false;
    const info = Object.assign({}, Ct.TOWNS[res.town], res.place);
    $('scrTitle').textContent = Ct.fill(Ct.SCRUTINY.title, info);
    tally($('scrFiled'), Ct.SCRUTINY.filed, sc.filed, info);
    tally($('scrTorn'), Ct.SCRUTINY.torn, sc.torn, info);
    tally($('scrOk'), Ct.SCRUTINY.accepted, sc.accepted, info);
    $('scrNote').textContent = Ct.fill(Ct.SCRUTINY.note, Object.assign({ n: sc.accepted }, info));
    $('scrScore').textContent = Number.isFinite(res.score) ? 'Score ' + res.score.toLocaleString('en-IN') + (Number.isFinite(res.crowd) ? ' · biggest crowd ' + res.crowd : '') : '';
    $('scrAgain').textContent = Ct.SCRUTINY.again;
    $('scrClose').textContent = Ct.SCRUTINY.close;
    $('scrDisc').textContent = Ct.SCRUTINY.disclaimer;
    papers(sc.filed, sc.torn);
    root.classList.add('on');
    card.focus();
    return true;
  }

  // Hides the panel and puts focus back on Play when the menu is up behind it.
  function close() {
    if (!root.classList.contains('on')) return;
    root.classList.remove('on');
    const play = $('play');
    if (play && play.checkVisibility()) play.focus();
  }

  // The panel is modal: Tab cycles through its two buttons, Escape closes it.
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('on')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const [first, last] = [buttons[0], buttons[buttons.length - 1]];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('scrClose').addEventListener('click', close);
  $('scrAgain').addEventListener('click', () => { close(); $('play').click(); });

  window.ScrutinyPanel = { open };
})();
