# Spec: real-towns

## Problem Statement

Votting Chalo builds a made-up town from a pincode, with a fictional party and generic "goons". The player wants the game set in three real Andhra Pradesh towns (Pulivendula, Kadapa, Punganur). In it, a YSRCP candidate in a blue shirt tries to file a nomination while a TDP mob, backed by the police, throws stones and burns YSRCP supporters' houses and vehicles. Even a successful filing ends with most nominations snatched and torn.

## Solution

The menu offers the three towns instead of a pincode. Each town's map is built from the user's OpenStreetMap export: real streets, real building outlines where mapped, and real landmarks such as bus stations and police stations. Generated houses fill blocks with no mapped buildings.

The hero party is YSRCP (blue flag with a three-blade fan). The rival is TDP (yellow flag):
- TDP workers tear papers.
- TDP mobs throw stones and set fire to supporters' houses and parked vehicles.
- Police escort the mobs and use lathis on the candidate's crowd.

Each town has an invented YSRCP ally who joins and shields the candidate, and an invented TDP leader at the head of the largest mob.

After the candidate holds the RO counter, a scrutiny scene plays: 10 YSRCP nominations were filed, 6 are snatched from the RO's table and torn, and 4 are accepted. Every character and event is fictional and the disclaimer says so; the map data is credited to OpenStreetMap contributors.

## User Stories

1. As a player, I want to pick Pulivendula, Kadapa or Punganur from the menu, so that I play in a town I know.
2. As a player, I want the streets to match the real town's layout, so that I recognise where I am.
3. As a player, I want real landmarks (bus station, police station) where they really are, so that the town feels real.
4. As a player, I want neighbourhood names from the real town on the map, so that I can find my way.
5. As a player, I want my candidate in a blue shirt and my supporters carrying the blue fan flag, so that my side is clear.
6. As a player, I want TDP workers in yellow, so that I can tell the rival side apart.
7. As a player, I want TDP mobs to throw stones that tear my papers and scatter my supporters, so that the danger feels real.
8. As a player, I want the police to escort the mob and charge my crowd instead of stopping the mob, so that the game shows police taking the rival's side.
9. As a player, I want a big crowd to drive a mob back, so that recruiting supporters pays off.
10. As a player, I want mobs to set fire to YSRCP supporters' houses and vehicles, so that the arson is part of the story.
11. As a player, I want burning houses and vehicles to block streets for a while, so that I have to route around them.
12. As a player, I want a local YSRCP ally to join me with supporters and protect me, so that my party helps me file.
13. As a player, I want a named TDP leader heading the largest mob near the RO office, so that the final approach is the hardest.
14. As a player, I want to see 6 of my party's 10 filed nominations snatched and torn after I file, so that the ending tells the story of the scrutiny.
15. As a player, I want the scrutiny result shown clearly as 10 filed, 6 torn, 4 accepted, so that I understand the outcome.
16. As a player who prefers reduced motion, I want the scrutiny panel without animation, so that it is comfortable to read.
17. As a phone player, I want the menu to fit a 375 px wide screen without sideways scrolling, so that I can start quickly.
18. As a keyboard player, I want to reach the town picker, mode buttons and Play with Tab and see where focus is, so that I can play without a mouse.
19. As a player, I want Polling Day to work in all three towns as before, with the new mob, so that both modes stay playable.
20. As a player, I want the game to work offline once loaded, so that a weak connection does not stop me.
21. As a player, I want a leaderboard per town, so that I can compare runs with people from my town.
22. As a sharer, I want the disclaimer to say the characters and events are fictional and to credit OpenStreetMap, so that the satire is clearly labelled.

## Implementation Decisions

**Data.**
- The user's three osm.org exports are stored compressed in the repo.
- A dependency-free offline converter turns each one into a town file:
  - a 2.0 km square on the game's 128×128 grid, at about 15.6 m per tile, with points in metres from the crop's corner;
  - kept: roads with their class, building footprints, water, landmarks and place names;
  - also recorded: the source bounds and the attribution.
- Kadapa's square is centred on the old town (14.4695, 78.8240).

**Town building.**
- `World.buildTown(townData)` replaces the procedural generator. It returns the same map shape the simulation already reads; road centre-lines replace the axis-aligned arterials.
- Road widths: trunk, primary and secondary 3 tiles plus pavements; tertiary 2; residential, unclassified and living-street 1. Service roads, tracks, paths and footways are dropped.
- Water becomes water tiles, with bridges where roads cross. Mapped buildings become solid; blocks with no mapped buildings get generated house plots.
- The RO office and polling booth are walled compounds placed in the largest clear rectangle nearest an anchor:
  - Kadapa: the Old Collector Office;
  - Pulivendula and Punganur: the town's centre point.
- The party office (the start) is more than half the map away from the RO office.
- Mapped police stations, bus stations, temples and hospitals take their real positions where they fall inside the square.
- Building a town is deterministic.

**Content.**
- Towns are keyed by id (pulivendula, kadapa, punganur), each with its town, mandal and district.
- The hero party is YSR Congress Party (YSRCP, blue `#1e5bd8`, fan flag). The rival is Telugu Desam Party (TDP, yellow `#f2c200`).
- Per town, an invented ally and TDP leader:

  | Town | YSRCP ally | TDP leader |
  | --- | --- | --- |
  | Pulivendula | Ramanna | Madhu Toogutla |
  | Kadapa | Lakshmi Devi | Chaitanya |
  | Punganur | Sivanna | Bhupal |

- All dialogue is original. No real person appears.

**Simulation.**
- `createGame({ seed, town, mode, police, goons, mobs })`.
- Goons become TDP workers.
- Mobs of 5 to 8 TDP workers throw stones. A stone hit costs 10 percentage points of papers, makes up to 2 nearby supporters leave, and stuns the candidate for 0.5 s.
- A crowd of 8 or more within 150 px makes a mob retreat.
- Police within 260 px of a rioting mob never detain its members and target the candidate's crowd.
- Mobs set fire only to supporters' houses and parked vehicles. A fire blocks its footprint plus one ring of tiles for 20 s, then frees them.
- The ally waits at the party office:
  - on joining, they bring 6 supporters;
  - while they are in the crowd, stone damage is halved and the RO counter hold is 2 s shorter.
- The TDP leader heads the largest mob, which gathers within 8 tiles of the target.
- In nomination mode, a finished counter hold starts a scrutiny phase:
  - it emits 6 snatch events and a tear event;
  - it ends the run as won with `{ filed: 10, torn: 6, accepted: 4 }`.
- Polling Day keeps its current ending.
- New events: stone, riot, fire, burnt, snatch, tear, ally.

**Client.**
- A town picker replaces the pincode field, and the India Post lookup is removed.
- Rendering:
  - autos and centre-lines follow road centre-lines;
  - yellow shirts, the fan flag and a plain yellow flag;
  - stones, flames, smoke and charred remains.
- A scrutiny panel in the menu card's style, with a torn-paper animation that respects `prefers-reduced-motion`.
- The leaderboard is kept per town.

**Constraints.**
- No build step and no runtime dependencies. `playwright-core` is the only devDependency, used by `npm run e2e`.
- The simulation stays deterministic (no `Math.random`).
- `design_check` stays at 0 findings.

## Testing Decisions

Tests go through four seams:
- **The simulation's public interface** (`createGame`, `step`, `state`, `drainEvents`): gameplay rules.
- **`World.buildTown` and the converter:** map invariants and how faithfully the data is drawn onto the grid.
- **`Content`:** text templating.
- **The real page in headless Chromium:** the journey, accessibility and phone width.

Expected values come from this spec (10/6/4, 10 points, 20 s, 6 supporters, 3/2/1 tile widths, 375 px), not from the code. Map invariants run on all three real towns. A small hand-made OSM fixture checks the converter and the road widths.

## Out of Scope

- Real people as characters, and the quoted threat lines.
- Online multiplayer and new modes.
- Pincode or any town beyond the three.
- Fetching map data at runtime.
- Exact real positions for the RO office in Pulivendula and Punganur (no mapped government office).

## Acceptance criteria

- **AC-1 (town data drawn onto the grid):** each town's map is built from its town file.
  - On the fixture, a primary road is 3 road tiles wide, a tertiary 2 and a residential 1.
  - Footways are absent.
  - At least 80% of the tiles under mapped trunk/primary/secondary centre-lines are road or bridge.
- **AC-2 (map invariants):** in all three towns:
  - the RO office, booth, start and BLO tent exist, plus 5 document shops and at least 3 police stations;
  - every site can be reached from the start and none stands on a solid tile;
  - the office is more than 0.5 × the map width from the start;
  - no solid building covers a road tile;
  - building the same town twice gives identical tiles and sites.
- **AC-3 (bot):** with police, goons and mobs off, the bot completes Nomination Day and Polling Day in all three towns.
- **AC-4 (offline, attribution):**
  - the page makes no request to any other site during menu and play;
  - there is no pincode field;
  - the disclaimer reads "Satire. All characters and the events shown are fictional; no real person is depicted. Map data © OpenStreetMap contributors."
- **AC-5 (stones):** a stone hit lowers papers by 10 points, makes up to 2 supporters within 120 px leave, and stuns the candidate for 0.5 s.
- **AC-6 (police escort):**
  - police within 260 px of a rioting mob never detain a mob member;
  - they target the candidate or the crowd instead (chase or lathi within 3 s).
- **AC-7 (crowd vs mob):** a crowd of 8 or more within 150 px of a mob makes it retreat (it moves away for at least 2 s).
- **AC-8 (arson):**
  - only supporters' houses and parked vehicles catch fire;
  - a fire blocks its footprint plus one ring of tiles for 20 s and frees them afterwards;
  - while it burns, flow fields route around it.
- **AC-9 (ally):** the ally joins with 6 supporters; while the ally is in the crowd, stone damage is 5 points and the counter hold is 2 s shorter.
- **AC-10 (TDP leader and lines):**
  - each town's TDP leader leads the largest mob, which is within 8 tiles of the target after 20 s;
  - every Content line fills `{town}`, `{short}`, `{rival}` and the leader and ally names with no leftover braces.
- **AC-11 (scrutiny):**
  - in nomination mode, finishing the hold emits 6 snatch events and 1 tear event;
  - it ends won with result.scrutiny `{ filed: 10, torn: 6, accepted: 4 }`;
  - Polling Day ends as before, with no scrutiny.
- **AC-12 (scrutiny panel):**
  - the panel shows "10 YSRCP nominations filed", "6 snatched and torn" and "4 accepted" with the town name;
  - with `prefers-reduced-motion: reduce`, it has no animation.
- **AC-13 (menu accessibility and phone width):**
  - Tab reaches the town picker, both modes and Play, each with a visible focus style;
  - menu text has 4.5:1 contrast or better;
  - at 375 × 667 the page has no horizontal scroll.
- **AC-14 (determinism):** two games with the same seed, town, mode and input sequence, including mobs and fires, produce identical state after 900 ticks.
- **AC-15 (robust conversion):**
  - the converter keeps a way with some of its nodes missing, using only the nodes present;
  - it drops a way with fewer than 2 known nodes;
  - it rejects a file with no `<osm>` root, with the message 'not an OSM export'.

`design_check` at 0 findings is enforced by the design gate on the ui checkpoints, not by a test case.
