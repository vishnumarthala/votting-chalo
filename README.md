# Votting Chalo 🗳️

A satirical top-down game set in **your own Andhra Pradesh town**. Walk your candidate through the streets,
gather a crowd, dodge the police and rival goons, push through the Section 144 barricades, and reach the
office before it closes.

- **Nomination Day:** collect 5 documents from shops around town (Form-A, affidavit, caste certificate,
  deposit receipt, proposer signatures). Then reach the RO office before 3 PM and hold the counter until
  the nomination is filed.
- **Polling Day:** pick up your voter slip at the BLO tent, get past the goons "capturing" the booth, and
  cast your vote before 6 PM.

Enter your **pincode** and the game builds a town for it: the same pincode always gives the same layout.
Post-office names from India Post become the neighbourhood names, and your town, mandal and district
appear in the dialogue.

> Satire. The Neelam Praja Party, its rivals and all characters, shops and events are fictional; no real
> person or party is depicted.

## Play

No build step and no dependencies. You need Node 18 or newer for the dev server and tests.

```bash
npm run serve   # http://localhost:8080
npm test        # node:test suites
```

| Action | Desktop | Touch |
| --- | --- | --- |
| Walk | WASD / arrows, or hold left mouse button (walks toward the pointer) | drag on the left half |
| Run (uses stamina) | Shift / hold right mouse button | drag far, or RUN |
| Slogan (pulls nearby people into your crowd, scares goons) | Space / E | SLOGAN, or a second-finger tap |
| Pause · mute · graphics | Esc/P · M · G | ⏸ |

## How it plays

- **Crowd.** Walk into townspeople to recruit them; the bigger your crowd, the wider your pull (up to 30).
  They follow you through the streets.
- **Police** patrol between intersections and chase you when they see you (buildings block their view).
  - A cop has to **hold on to you for about a second** to arrest you. Running breaks free.
  - With **3+ supporters close by**, your crowd lifts the cop out of the way, but he takes one supporter with him.
  - Lathi charges scatter supporters. Inspectors throw **tear gas** at big crowds.
  - Each arrest is a case; **3 cases and you're jailed**. After an arrest you're released at a police station.
  - Backup arrives over time, and sooner if your crowd is large.
- **Goons** tear your papers (25% per hit). If your papers hit 0%, your Form-A (or voter slip) is
  destroyed and you must fetch a new one. Goons back off from a crowd of 8 or more.
- **Section 144 ring.** The streets around the destination are barricaded, with a few manned checkposts.
  Walk into a barricade to push it; every supporter nearby speeds it up.
- **Score:** recruits, documents, barricades, lifted cops, scared goons, combos ("Josh!", "Mass!",
  "Mass Jathara!"), three rotating missions ("Aaj ka kaam"), and time, crowd and paper bonuses. There's a
  local top-10 per mode.

## Architecture

The structure follows the mantarjantar.com approach: plain JavaScript, Canvas 2D, no framework or bundler,
and a deterministic simulation shared between browser and Node. All code, text and art here are original.

```
index.html          menu, pause, touch buttons, CSS
shared/             DOM-free UMD modules (browser + Node)
  world.js          seeded town generator, tile collision, BFS flow fields, line of sight, barricade ring
  content.js        all text and modes; {town} {mandal} {district} templating
  sim.js            30 Hz deterministic game: crowd, police, goons, gas, barricades, documents, filing
client/
  pincode.js        India Post lookup + Andhra Pradesh check + cache + offline district fallback
  render.js         cached map chunks, people, sites, ring, gas, ambient autos, minimap, bubbles
  hud.js            status, minimap, documents, objective arrow, missions, toasts, intro
  input.js          keyboard, mouse steering, touch joystick
  audio.js          Web Audio synthesized effects (no audio files)
  main.js           loop, menu, events -> effects, leaderboard
test/               world (40 seeds), sim rules, bot completion of both modes, pincode parsing
```

### Town generator

A 128×128-tile map (4096 px) built from the pincode seed:

- arterial roads with sidewalks, split into blocks by lanes;
- a winding canal, with bridges wherever roads cross it;
- houses with rooftop water tanks, parks, a temple, Rythu Bazar, bus stand and hospital;
- walled compounds for the RO office and the polling booth, police stations, and the NPP party office
  where you start;
- five document shops spread across town, and the Section 144 ring.

Tests check 40 seeds to confirm every site exists and is reachable from the start.

### Simulation

`Sim.createGame({ seed, mapSeed, place, mode, names })` advances with `step(input)`, where `input` is
`{ mx, my, run, act }`. The client reads `game.state` and drains `game.drainEvents()` for sounds, particles
and toasts. The simulation never calls `Math.random`, so the same seed and inputs replay exactly. That
makes it ready to run on a Node WebSocket server for online rooms, the way the original's sim does.

## Roadmap

- Online multiplayer: one `sim.js` instance per room on a Node `ws` server, with snapshot diffs to clients.
  Players could join as candidate, supporter or police.
- Android WebView wrapper for an offline APK.
- More district flavour: dialects and local landmarks.
