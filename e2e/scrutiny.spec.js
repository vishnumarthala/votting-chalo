'use strict';
// Scrutiny result panel: the real page in headless Chromium. Run with `npm run e2e`.
// The panel is handed a result object, as the game does when a nomination run ends, so no game has to be played.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withMenu } = require('./support.js');

const KADAPA_WIN = {
  won: true, reason: 'filed', mode: 'nomination', town: 'kadapa', place: { town: 'Kadapa', mandal: 'Kadapa', district: 'Kadapa' },
  score: 4210, crowd: 14, docs: 5, missions: 2, scrutiny: { filed: 10, torn: 6, accepted: 4 },
};
const LINES = ['10 YSRCP nominations filed', '6 snatched and torn', '4 accepted'];

// Runs in the page: every element of the panel (and its ::before and ::after) with a CSS animation or transition declared,
// plus the animations the browser is running for the panel.
function motionIn(root) {
  const declared = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      const where = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (pseudo || '');
      if (cs.animationName !== 'none') declared.push(where + ' animation ' + cs.animationName);
      if (cs.transitionProperty !== 'none' && cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) declared.push(where + ' transition ' + cs.transitionProperty + ' ' + cs.transitionDuration);
    }
  }
  return { declared, running: root.getAnimations({ subtree: true }).length };
}

// Runs in the page: each text element of the panel with its size, colour and the opaque colour behind it.
function panelTexts(root) {
  const parse = (css) => {
    const m = /rgba?\(([^)]*)\)/.exec(css);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const behind = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a === 1) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const el = node.parentElement, text = node.textContent.trim();
    if (!text || el.closest('[aria-hidden="true"]') || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const cs = getComputedStyle(el);
    out.push({ text, size: parseFloat(cs.fontSize), colour: parse(cs.color), background: behind(el) });
  }
  return out;
}

const luminance = ({ r, g, b }) => {
  const [lr, lg, lb] = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

async function openPanel(page, result = KADAPA_WIN) {
  assert.equal(await page.evaluate(() => typeof (window.ScrutinyPanel && window.ScrutinyPanel.open)), 'function', 'the page offers ScrutinyPanel.open(result)');
  await page.evaluate((r) => window.ScrutinyPanel.open(r), result);
  const panel = page.getByRole('dialog', { name: /scrutiny/i });
  await panel.waitFor();
  return panel;
}

test('T-18 the scrutiny panel shows the town and the 10 / 6 / 4 result, with no animation under reduced motion', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true, 'the page sees the reduced-motion preference');

    const panel = await openPanel(page);
    const text = await panel.innerText();
    for (const s of ['Kadapa', ...LINES]) assert.ok(text.includes(s), `the panel says "${s}" in: ${JSON.stringify(text)}`);

    const motion = await panel.evaluate(motionIn);
    assert.deepEqual(motion.declared, [], 'no element in the panel declares a CSS animation or transition');
    assert.equal(motion.running, 0, 'the browser runs no animation in the panel');
  });
});

test('T-18 without the reduced-motion preference the torn papers do animate (so the check above is not vacuous)', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const panel = await openPanel(page);
    const motion = await panel.evaluate(motionIn);
    assert.ok(motion.running > 0, 'the panel plays its torn-paper animation');
  });
});

test('T-18 the panel is keyboard-operable: Tab stays inside it with a visible focus, Escape closes it', async () => {
  await withMenu({ width: 375, height: 700 }, async (page) => {
    const panel = await openPanel(page);
    const buttons = panel.getByRole('button');
    const names = await buttons.allTextContents();
    assert.ok(names.length >= 2, `the panel has its buttons: ${names}`);

    const stops = [];
    for (let i = 0; i < names.length + 1; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const el = document.activeElement, cs = getComputedStyle(el);
        return { name: el.textContent.trim(), inside: !!el.closest('[role="dialog"]'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
      }));
    }
    assert.ok(stops.every((s) => s.inside), `Tab never leaves the panel: ${JSON.stringify(stops)}`);
    assert.ok(stops.every((s) => s.outline), `every stop shows a focus outline: ${JSON.stringify(stops)}`);
    assert.deepEqual(stops[0].name, stops[names.length].name, 'Tab wraps round to the first button');
    assert.equal(new Set(stops.map((s) => s.name)).size, names.length, 'every button is reachable');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll at 375 px');
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'play', 'focus goes back to Play');
  });
});

test('T-18 the panel text is at least 12px and meets WCAG AA contrast', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    const panel = await openPanel(page);
    const texts = await panel.evaluate(panelTexts);
    assert.ok(texts.length >= 6, 'the panel has text to check');
    for (const t of texts) {
      assert.ok(t.size >= 12, `"${t.text}" is ${t.size}px`);
      const ratio = contrast(t.colour, t.background);
      assert.ok(ratio >= 4.5, `"${t.text}" has contrast ${ratio.toFixed(2)}:1`);
    }
  });
});
