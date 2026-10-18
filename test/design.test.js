'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const rule = (sel) => { const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, 'missing rule ' + sel); return m[1]; };
const prop = (body, name) => { const m = body.match(new RegExp('(?:^|;)' + name + ':([^;]+)')); return m && m[1].trim(); };
const luminance = (hex) => {
  const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('T1 disclaimer text is at least 12px and meets WCAG AA contrast on the card', () => {
  const disc = rule('.disc');
  const paper = prop(rule(':root'), '--paper');
  assert.ok(parseFloat(prop(disc, 'font-size')) >= 12, 'font-size ' + prop(disc, 'font-size'));
  const ratio = contrast(prop(disc, 'color'), paper);
  assert.ok(ratio >= 4.5, 'contrast ' + ratio.toFixed(2) + ':1 against ' + paper);
});
