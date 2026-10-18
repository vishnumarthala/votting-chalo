# Votting Chalo 🗳️

A satirical top-down game set in **a real Andhra Pradesh town**. You play a YSRCP candidate (blue shirt, blue flag
with a white ceiling fan). Walk through the streets, gather a crowd, dodge the police and the TDP workers (yellow),
push through the Section 144 barricades, and reach the office before it closes.

- **Nomination Day:** collect 5 documents from shops around town (Form-A, affidavit, caste certificate,
  deposit receipt, proposer signatures). Then reach the RO office before 3 PM and hold the counter until
  the nomination is filed.
- **Polling Day:** pick up your voter slip at the BLO tent, get past the goons "capturing" the booth, and
  cast your vote before 6 PM.

Pick your **town** in the menu. The map is built from OpenStreetMap data: the real streets, building
outlines, river, bus station and neighbourhood names. Blocks with no mapped buildings are filled with
generated houses. Your town, mandal and district appear in the dialogue. Pulivendula, Kadapa (its old town) and
Punganur are playable.

> Satire. All characters and the events shown are fictional; no real person is depicted.
> Map data © OpenStreetMap contributors (ODbL).

## Play

No build step and no dependencies. You need Node 18 or newer for the dev server and tests.

```bash
npm run serve   # http://localhost:8080
npm test        # node:test suites (no dependencies)
npm run e2e     # the page in headless Chromium (needs `npm install` for playwright-core and a Chromium)
```

`npm run e2e` uses Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; set `CHROMIUM_PATH` to use another one.
No browser is downloaded.

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
- **TDP mobs** (groups of 5 to 8 workers in yellow shirts, some with a plain yellow TDP flag) march on you when
  they see you and throw stones. A stone that lands on you costs 10 points of papers, scatters up to 2
  supporters and stuns you for half a second; keep walking and they miss. A **crowd of 8 or more** within 150 px of a mob drives
  it back. **Police near a rioting mob escort it** and go for you and your crowd instead.
- **Arson.** Some houses are YSRCP supporters' homes (a blue fan flag on the roof) and bikes, autos and cars are
  parked near them and the party office. A rioting mob sets fire only to these as it passes. A fire burns for 20 s
  and blocks its footprint plus one ring of tiles, so streets close and paths go round it (anyone standing in those
  tiles when it starts is moved to the nearest open one); then the house or vehicle stays charred. Townspeople
  within 140 px run from a new fire and supporters within 56 px of a burning one leave your crowd. Smoke is drawn
  on the high graphics setting only.
- **The ally and the TDP leader.** Each town has an invented YSRCP ally (Pulivendula: Ramanna, Kadapa: Lakshmi Devi,
  Punganur: Sivanna) who waits beside the party office. Walk up to them and they join your crowd with 6 supporters.
  While the ally is in your crowd a stone costs 5 points of papers instead of 10 and the counter hold is 2 s shorter;
  if a lathi charge, fire or stone scatters the ally the bonuses stop until you walk up to them again. The mob that
  waits near the destination is the largest and is headed by an invented TDP leader (Madhu Toogutla, Chaitanya,
  Bhupal), who throws stones like the rest. Both wear name tags: the ally a blue shirt and fan flag, the leader a
  yellow shirt and white cap. No real person is depicted.
- **Goons** (lone TDP workers) tear your papers (25% per hit). If your papers hit 0%, your Form-A (or voter slip) is
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
  towns.js          the playable towns: names, invented ally and TDP leader, map crop centre, RO office anchor, landmarks to skip
  world.js          town builder, supporters' houses and parked vehicles, tile collision, BFS flow fields, line of sight, barricade ring, fire tiles
  content.js        all text and modes (parties YSRCP and TDP); {town} {mandal} {district} {short} {rival} {ally} {leader} templating
  sim.js            30 Hz deterministic game: crowd, ally and TDP leader, police, goons, TDP mobs, stones and arson, gas, barricades, documents, filing
client/
  render.js         cached map chunks (roof flags, parked vehicles), people, sites, ring, gas, flames, smoke and charred remains, ambient autos on the roads, minimap, bubbles
  hud.js            status, minimap, documents, objective arrow, missions, toasts, intro
  input.js          keyboard, mouse steering, touch joystick
  audio.js          Web Audio synthesized effects (no audio files)
  main.js           loop, town picker and menu, events -> effects, leaderboard per town
data/
  osm/              the osm.org exports, gzipped (input of the converter)
  towns/            the town files the game loads (output of the converter); README.md has the ODbL note and sources
scripts/
  osm-to-town.js    offline converter: data/osm/<id>.osm.gz -> data/towns/<id>.json
  serve.js          static dev server
test/               converter, town builder, sim rules, bot completion of both modes
e2e/                the menu-to-play journey, menu keyboard focus, contrast and phone width in headless Chromium
```

### Town data

`node scripts/osm-to-town.js pulivendula` (or `kadapa`, `punganur`) crops a 2.0 km square from the town's export and writes
`data/towns/pulivendula.json`: roads with their class, building footprints, water, landmarks (police and bus
stations, temples, hospitals, schools, government offices) and place names, in metres from the square's corner,
plus the export's bounds and the OpenStreetMap attribution. The crop centre and the RO office anchor of each
town are in `shared/towns.js`. The converter needs no dependencies. Ways with missing nodes keep the nodes
that exist; input that is not an OSM export is rejected.

The page loads its scripts and the town file from its own server and makes no other requests; once a game is running it needs no connection.

### Town builder

`World.buildTown(townData)` draws the 128×128-tile map (4096 px, about 15.6 m per tile) from a town file:

- road centre-lines become road tiles: trunk, primary and secondary roads 3 tiles wide with pavements,
  tertiary 2, residential and the rest 1-tile lanes; footways, paths and service roads are left out;
- water becomes water tiles, with bridges wherever a road crosses;
- mapped buildings become solid tiles, one block of tiles per footprint; blocks with no mapped building get generated
  house plots, parks or, at the edge of town, open land;
- the RO office and the polling booth are walled compounds placed in the largest clear space near their anchors,
  and the party office (where you start) is in the corner of town farthest from the RO office. Kadapa's RO office sits
  about 500 m east of the Old Collector Office, its anchor, because the dense old town has no clear space for a walled
  compound nearer;
- mapped police and bus stations keep their real positions (within 3 tiles where the map allows): a police yard, or a
  small station building beside the street where wide roads leave no room, and a bus stand; a station mapped twice is
  built once, and the Kadapa police parade ground is not a station;
- five document shops are spread across town, with the BLO tent and the patrol posts at road junctions.

Building a town is deterministic: the same file always gives the same map.

### Simulation

`Sim.createGame({ seed, town, mode, police, goons })` advances with `step(input)`, where `input` is
`{ mx, my, run, act }`. The client reads `game.state` and drains `game.drainEvents()` for sounds, particles
and toasts. Node loads `data/towns/<town>.json` itself; the browser passes the fetched file as `townData`.
The simulation never calls `Math.random`, so the same seed and inputs replay exactly. That
makes it ready to run on a Node WebSocket server for online rooms, the way the original's sim does.

## Roadmap

- Online multiplayer: one `sim.js` instance per room on a Node `ws` server, with snapshot diffs to clients.
  Players could join as candidate, supporter or police.
- Android WebView wrapper for an offline APK.
- More district flavour: dialects and local landmarks.
