'use strict';
// Game to panel: a real run in the real page (headless Chromium) ends in the scrutiny panel, and the leaderboard keeps the run.
// The run is played through the page's read-only hook window.__vc: it puts the nomination documents in the candidate's hands and the
// candidate at the counter one step from the end of the hold, then lets the page's own loop do the rest. Run with `npm run e2e`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withMenu } = require('./support.js');

const SCENE_MS = 20000; // the scripted scene (7.5 s) and the pause after it (2.2 s) fit in this with room to spare
const LINES = ['10 YSRCP nominations filed', '6 snatched and torn', '4 accepted'];

// Collects what the page throws or logs as an error from now on.
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

// Picks the town and mode, presses Play, and brings the run to the last step of the counter hold.
async function fileNomination(page, { town, mode = 'nomination' }) {
  await page.selectOption('#town', town);
  await page.locator(`.mode[data-m="${mode}"]`).click();
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__vc.running);
  await page.evaluate(() => {
    const G = window.__vc.game.state, P = G.player;
    G.mode = 'play'; // skips the intro card
    P.docs = G.M.docs.slice();
    P.x = P.px = G.target.x; P.y = P.py = G.target.y;
    P.submitT = G.hold - 0.01;
  });
  await page.waitForFunction(() => window.__vc.game.state.mode === 'won');
}

const panelOpen = (page) => page.evaluate(() => document.getElementById('scrutiny').classList.contains('on'));
const sceneState = (page) => page.evaluate(() => { const sc = window.__vc.game.state.scrutiny; return sc && { done: sc.done, snatched: sc.snatched }; });
const leaderboard = (page, town, mode) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), `vc_lb_${town}_${mode}`);

test('filing a nomination plays the scrutiny scene, then opens the scrutiny panel by itself with the town and the three numbers; the run is saved once', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    const errors = watchErrors(page);
    await fileNomination(page, { town: 'punganur' });

    // the run is won at the filing; the scene plays first and the panel waits for it
    const dialog = page.getByRole('dialog', { name: /scrutiny/i });
    assert.equal((await sceneState(page)).done, false, 'the scrutiny scene has just begun');
    assert.equal(await panelOpen(page), false, 'the panel is not open while the scene plays');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.evaluate(() => window.__vc.running), true, 'the game is still running the scene');
    const early = await leaderboard(page, 'punganur', 'nomination');
    assert.equal(early.length, 1, 'the win is already on the leaderboard');
    assert.equal(early[0].w, true);

    await dialog.waitFor({ timeout: SCENE_MS });
    assert.deepEqual(await sceneState(page), { done: true, snatched: 6 }, 'the panel came after the whole scene');
    assert.equal(await page.evaluate(() => window.__vc.running), false, 'the run has been wrapped up');

    const text = await dialog.innerText();
    for (const s of ['Punganur', ...LINES]) assert.ok(text.includes(s), `the panel says "${s}" in: ${JSON.stringify(text)}`);
    assert.equal((await leaderboard(page, 'punganur', 'nomination')).length, 1, 'wrapping up the run did not save it a second time');
    assert.equal(await page.locator('#lb li').count(), 1, 'the menu lists the run once');
    assert.deepEqual(errors, [], 'the page threw no errors');
  });
});

test('quitting from the pause card during the scene keeps the won run on the leaderboard and never opens the panel', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    const errors = watchErrors(page);
    await fileNomination(page, { town: 'pulivendula' });
    assert.equal((await sceneState(page)).done, false, 'the scene is still playing');

    await page.keyboard.press('Escape');
    await page.locator('#quit').click();
    assert.equal(await page.evaluate(() => window.__vc.running), false, 'back at the menu');

    const lb = await leaderboard(page, 'pulivendula', 'nomination');
    assert.equal(lb.length, 1, 'the won run is on the leaderboard');
    assert.equal(lb[0].w, true);
    const rows = await page.locator('#lb li').allTextContents();
    assert.ok(rows.length === 1 && rows[0].includes('✅'), `the menu shows the won run: ${JSON.stringify(rows)}`);
    assert.equal(await panelOpen(page), false);
    assert.deepEqual(errors, []);
  });
});

test('Polling Day ends as before: the run is won and wrapped up without a scrutiny panel', async () => {
  await withMenu({ width: 1280, height: 800 }, async (page) => {
    const errors = watchErrors(page);
    await fileNomination(page, { town: 'pulivendula', mode: 'vote' });
    assert.equal(await page.evaluate(() => window.__vc.game.state.scrutiny), null, 'Polling Day has no scrutiny scene');
    await page.waitForFunction(() => !window.__vc.running, null, { timeout: 8000 });
    assert.equal(await panelOpen(page), false, 'no scrutiny panel');
    assert.ok((await page.locator('#result').innerText()).includes('Score'), 'the result line is shown');
    assert.equal((await leaderboard(page, 'pulivendula', 'vote')).length, 1, 'the vote run is on its leaderboard once');
    assert.deepEqual(errors, []);
  });
});
