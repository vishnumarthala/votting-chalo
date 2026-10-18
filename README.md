# Votting Chalo 🗳️

A satirical top-down game set in **your own Andhra Pradesh town**, presented by
[YSRCP Germany](https://www.ysrcpgermany.de/). Walk your YSRCP candidate through the streets, gather a crowd
("Jai Jagan!"), dodge the police and the ruling front's goons, push through the Section 144 barricades and
the police at the gate, and reach the office before it closes.

- **Nomination Day:** you start with your Form-A. Collect the 4 supporting documents around town (affidavit,
  caste certificate, deposit receipt, proposer signatures), then reach the RO office before 3 PM and hold
  the counter until the nomination is filed.
- **Polling Day:** pick up your voter slip at the BLO tent, get past the goons "capturing" the booth, and
  cast your vote before 6 PM.

Enter your **pincode** and the game builds a town for it: the same pincode always gives the same layout.
Post-office names from India Post become the neighbourhood names, and your town, mandal and district
appear in the dialogue.

> Satire by YSRCP Germany supporters. The player's side is the YSRCP (brand colours: navy `#0F1B61`, green
> `#00A651`, gold). The "ruling front", its goons, the officials and all other characters, shops and events
> are fictional; the ruling front stands for no specific real party. The game contains cartoon violence
> against civilians (no blood), shown to criticise it: the player can only protect people, never hurt them.

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
| Town map (pauses the game) | Tab, or click the minimap | tap the minimap |
| Pause · mute · graphics | Esc/P · M · G | ⏸ |

## How it plays

- **Who is who.** Blue shirts are YSRCP (you, and anyone who joins your crowd switches to blue), yellow
  shirts are the ruling front's goons and their "guests", white is the public, khaki is the police.
- **How democracy is being spoiled.** The first time each of 11 tactics shows up (Section 144, barricades,
  stones, attacks on women and children, police looking away, arrests, the police line, the gate shut for you
  but open for friends, the papers check, "server down", the clock trick), a short card explains it. If
  the meter falls low enough, the run ends with democracy killed.
- **Where to go.** The NEXT banner always names your next stop and its distance, glowing arrows on the road
  show the walking route, and a pin marks the spot. The corner minimap follows you; tap it for the whole
  town with every document shop, the office and the police stations.
- **Crowd.** Walk into townspeople to recruit them; the bigger your crowd, the wider your pull (up to 30).
  They follow you through the streets.
- **Police** patrol between intersections and chase you when they see you (buildings block their view).
  - A cop has to **hold on to you for about a second** to arrest you. Running breaks free.
  - With **3+ supporters close by**, your crowd lifts the cop out of the way, but he takes one supporter with him.
  - Lathi charges scatter supporters. Inspectors throw **tear gas** at big crowds.
  - Each arrest is a case; **3 cases and you're jailed**. After an arrest you're released at a police station.
  - Backup arrives over time, and sooner if your crowd is large.
- **Goons** tear your papers (25% per hit). If your papers hit 0%, the document you collected most
  recently is ruined and you must fetch it again (your starting Form-A or Voter ID is safe).
  - They also **throw stones, sticks and chappals**. A shadow grows where each one will land and turns into a
    red ring just before it hits, so keep moving: zig-zagging dodges most throws. A hit tears your papers,
    knocks you back and dazes you, drains stamina and scatters the supporters next to you. With 3+
    supporters close, one may take the stone for you.
  - Against a crowd of 8 or more they won't come close; they pelt you from a distance instead.
  - The gang at the office gate pelts the **women queuing outside**. Stray stones hit **women and children**
    in your procession and on the street: they sit down hurt, another woman runs over to help, and they
    are led home with a bandage. Nearby police turn their backs ("No complaint received.").
  - **Protect them:** step in front of a stone aimed at them, or raise a slogan so your crowd closes ranks
    around the women and children for 3 seconds. Each save scores points and lifts the meter.
- **The gate.** Escaping the goons is not the end. Near the RO office (or the booth):
  1. **Police line.** Cops link arms across the street. Push through with your crowd (alone it barely
     moves) while they lathi your supporters.
  2. **Gate shut "for lunch".** Chant it open with 4 slogans and 8+ supporters, sneak round to the side
     wicket they "forgot" to lock, or slip in behind the ruling front's guests. The gate and the police line
     part for them, and the police salute.
  3. **"Only candidate + 4."** The rest of your crowd waits outside chanting and rejoins when you come out.
  4. **Papers check.** A frisk at the gate costs time and papers; the wicket check is harsher.
  5. **Clerk stalls at the counter** ("server down", "lunch break", "photo size wrong"). 4 proposers inside
     halve each stall.
  6. **The office clock jumps** once: "It is 3 PM by our clock." It never leaves less than 25 seconds.
  Once you are checked and inside, the gate police step back and the officials take over.
- **Democracy meter.** Starts at 100% and drops with every stone (more when it hits a woman or child),
  lathi charge, tear gas shell and arrest, and when you enter the Section 144 zone. Broken barricades and
  protected people raise it. Its stages are Unwell, In hospital, In ICU and On ventilator.
- **The Daily Ballot.** If you don't make it (time runs out or you're jailed), a satirical front page
  spins in. It shows a headline, a cartoon of the shuttered office with the ballot box on a stretcher, your
  numbers, and "How to stop an election without cancelling it". **Share front page** sends it as an image
  (or downloads it).
- **Section 144 ring.** The streets around the destination are barricaded, with a few manned checkposts.
  Walk into a barricade to push it; every supporter nearby speeds it up.
- **Score:** recruits, documents, barricades, lifted cops, scared goons, combos ("Nice!", "Mass!",
  "Mass Jathara!"), three rotating missions ("Today's tasks"), and time, crowd and paper bonuses. There's a
  local top-10 per mode.

## Architecture

The structure follows the mantarjantar.com approach: plain JavaScript, Canvas 2D, no framework or bundler,
and a deterministic simulation shared between browser and Node. All code, text and art here are original.

```
index.html          menu, pause, touch buttons, CSS
shared/             DOM-free UMD modules (browser + Node)
  world.js          seeded town generator, tile collision, BFS flow fields, line of sight, barricade ring
  content.js        all text and modes; {town} {mandal} {district} templating
  sim.js            30 Hz deterministic game: crowd, police, goons, thrown stones, bystanders, Democracy meter, gas, barricades, documents, filing
client/
  pincode.js        India Post lookup + Andhra Pradesh check + cache + offline district fallback
  render.js         cached map chunks, people, sites, ring, gas, ambient autos, route guide, radar + town map, bubbles
  hud.js            status, Democracy meter, NEXT banner, radar, documents, objective arrow, missions, toasts, intro, map overlay
  frontpage.js      "The Daily Ballot" satirical front page (1080x1350 canvas) with Web Share / download
  input.js          keyboard, mouse steering, touch joystick, minimap taps
  audio.js          Web Audio synthesized effects (no audio files)
  main.js           loop, menu, events -> effects, leaderboard
test/               world (40 seeds), sim rules, bot completion of both modes, pincode parsing
```

### Town generator

A 128×128-tile map (4096 px) built from the pincode seed:

- arterial roads with sidewalks, split into blocks by lanes;
- a winding canal, with bridges wherever roads cross it;
- houses with rooftop water tanks, parks, a temple, Rythu Bazar, bus stand and hospital;
- walled compounds for the RO office and the polling booth, police stations, and the YSRCP party office
  where you start;
- four document shops spread across town, and the Section 144 ring.

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
