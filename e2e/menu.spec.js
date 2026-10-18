'use strict';
// Menu seam: the real page in headless Chromium. Run with `npm run e2e`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withMenu } = require('./support.js');

const DISCLAIMER = 'Satire. All characters and the events shown are fictional; no real person is depicted. Map data © OpenStreetMap contributors.';
const TOWNS = ['Pulivendula', 'Kadapa', 'Punganur'];

// Runs in the page. Every visible text in the menu (text nodes, plus the value and placeholder of the form fields)
// with its colour and the opaque backgrounds that can sit behind it; a gradient contributes each of its stops.
function menuTexts() {
  const parse = (css) => {
    const m = /rgba?\(([^)]*)\)/.exec(css);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const behind = (el) => {
    if (!el) return [{ r: 255, g: 255, b: 255, a: 1 }];
    const cs = getComputedStyle(el), colour = parse(cs.backgroundColor);
    let out = behind(el.parentElement);
    if (colour && colour.a > 0) out = out.map((below) => over(colour, below));
    const stops = cs.backgroundImage === 'none' ? [] : [...cs.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map((s) => parse(s[0]));
    if (stops.length) out = stops.flatMap((stop) => out.map((below) => over(stop, below)));
    return out;
  };
  const shown = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getClientRects().length > 0;
  const entry = (what, el, colour) => ({ what, colour: parse(colour), backgrounds: behind(el) });

  const found = [];
  const walker = document.createTreeWalker(document.getElementById('menu'), NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const el = node.parentElement, text = node.textContent.trim();
    if (!text || el.closest('option, script, style') || !shown(el)) continue;
    found.push(entry(text, el, getComputedStyle(el).color));
  }
  for (const el of document.querySelectorAll('#menu select, #menu input')) {
    if (!shown(el)) continue;
    if (el.tagName === 'SELECT' || el.value) found.push(entry(el.value || el.id, el, getComputedStyle(el).color));
    else if (el.placeholder) found.push(entry(el.placeholder, el, getComputedStyle(el, '::placeholder').color));
  }
  return found;
}

// Runs in the page: how a control looks (its outline and box-shadow), to compare its focused look with its resting one.
// 'all' gives every control of the menu, 'focused' the one with focus.
function controlLooks(which) {
  const look = (el) => {
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !/rgba\(.*, 0\)$/.test(cs.outlineColor);
    return { key: el.id || (el.dataset.m ? 'mode:' + el.dataset.m : el.tagName.toLowerCase()), outline: outline ? [cs.outlineStyle, cs.outlineWidth, cs.outlineColor].join(' ') : 'none', boxShadow: cs.boxShadow };
  };
  return which === 'focused' ? look(document.activeElement) : [...document.querySelectorAll('#menu :is(input, select, button, summary)')].map(look);
}

const luminance = ({ r, g, b }) => {
  const [lr, lg, lb] = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });

test('T-7 the menu is keyboard-operable with visible focus, readable text and the OpenStreetMap disclaimer', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    assert.deepEqual(await page.getByRole('combobox', { name: 'Town' }).locator('option').allTextContents(), TOWNS, 'the picker lists the three towns');

    // Tab from the page start until Play: the town picker, both modes and Play come in that order
    const resting = await page.evaluate(controlLooks, 'all');
    const stops = [];
    for (let i = 0; i < 10 && !stops.some((s) => s.key === 'play'); i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(controlLooks, 'focused'));
    }
    const keys = stops.map((s) => s.key);
    const at = ['town', 'mode:nomination', 'mode:vote', 'play'].map((k) => keys.indexOf(k));
    assert.ok(at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1])), `tab order reaches the picker, both modes and Play in order: ${keys.join(' > ')}`);
    // each stop shows focus: a drawn outline that its resting look lacks, or a box-shadow that differs from its resting one
    for (const s of stops) {
      const rest = resting.find((r) => r.key === s.key);
      assert.ok(rest, `${s.key} is a control of the menu`);
      assert.ok((s.outline !== 'none' && s.outline !== rest.outline) || s.boxShadow !== rest.boxShadow,
        `focus on ${s.key} looks like rest: outline "${s.outline}" (rest "${rest.outline}"), shadow "${s.boxShadow}" (rest "${rest.boxShadow}")`);
    }

    // text contrast, measured on what is on screen
    const texts = await page.evaluate(menuTexts);
    assert.ok(texts.length >= 12, 'the check sees the title, tagline, form fields, modes, Play and disclaimer: ' + texts.length);
    for (const t of texts) {
      for (const bg of t.backgrounds) {
        const ratio = contrast(blend(t.colour, bg), bg);
        assert.ok(ratio >= 4.5, `"${t.what}" has contrast ${ratio.toFixed(2)}:1`);
      }
    }

    assert.equal((await page.locator('.disc').innerText()).trim(), DISCLAIMER);
  });
});

test('T-8 the menu fits a 375 px phone with Play inside the viewport width', async () => {
  await withMenu({ width: 375, height: 667 }, async (page) => {
    assert.ok((await page.evaluate(() => document.scrollingElement.scrollWidth)) <= 375, 'the page scrolls sideways');
    // the menu is a fixed overlay and its card clips what overflows it, so look at the card and everything in it
    const fit = await page.evaluate(() => {
      const card = document.querySelector('#menu .card'), spill = [];
      for (const el of card.querySelectorAll('*')) {
        if (!el.checkVisibility() || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.left < -0.01 || r.right > 375.01) spill.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} spans ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
      }
      return { spill, scrollWidth: card.scrollWidth, clientWidth: card.clientWidth };
    });
    assert.deepEqual(fit.spill, [], 'elements of the menu card leave the 375 px viewport');
    assert.ok(fit.scrollWidth <= fit.clientWidth, `the card clips its content: ${fit.scrollWidth} px of content in ${fit.clientWidth} px`);
    const play = await page.locator('#play').boundingBox();
    assert.ok(play.x >= 0 && play.x + play.width <= 375, `Play spans ${play.x}..${play.x + play.width}`);
  });
});
