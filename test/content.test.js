'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../shared/content.js');

test('the opponent is named in one place and the parody name reaches the legend, tactics and chants', () => {
  const O = C.OPPONENT;
  assert.ok(O.short && O.full && O.tag && O.leaderTag && O.chant);
  assert.ok(C.LEGEND.some((l) => l.label.includes(O.full)));
  assert.ok(C.TACTICS.some((t) => t.text.includes(O.full)));
  assert.ok(C.LINES.goon.some((l) => l.includes(O.chant)));
  assert.ok(C.MODE.intro.includes(O.full));
});

test('every page carries the parody disclaimer and the not-official notice', () => {
  assert.equal(C.NEWS.disclaimer, C.DISCLAIMER);
  for (const f of ['index.html', 'gamification/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(html.includes(C.OPPONENT.full), f + ': parody name');
    assert.ok(html.includes('Not an official YSRCP website'), f + ': not-official notice');
    assert.ok(!/all characters[^.]*are fictional/i.test(html), f + ': old contradictory disclaimer removed');
  }
});
