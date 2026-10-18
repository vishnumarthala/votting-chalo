# The Death of Democracy 🗳️

A satirical top-down game set in **your own Andhra Pradesh town**. It is nomination day: walk your YSRCP
candidate through the streets of a small town to the RO Office, gather a crowd ("Jai Jagan!"), dodge the police
and the ruling front's goons, and push through the Section 144 barricades and the police at the gate.

**Democracy starts at 100%.** Every goon attack, stone and police lathi charge takes a piece of it. At 0% the
run ends. If you do reach the counter and hold it, the clerk rejects the nomination anyway. Every run ends
on the same title:

> **Democracy is killed in broad daylight. Welcome to Andhra Pradesh.**

Enter your **pincode** and the game builds a town for it: the same pincode always gives the same town.
Post-office names from India Post become the neighbourhood names, and your town, mandal and district
appear in the dialogue.

> Satire. The player's side is the YSRCP (brand colours: navy `#0F1B61`, green
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
- **How democracy is being spoiled.** The first time each of 10 tactics shows up (Section 144, barricades,
  stones, attacks on women and children, police looking away, arrests, the police line, the gate shut for you
  but open for friends, the papers check, "server down"), a short card explains it.
- **Where to go.** There is one destination: the RO Office. The NEXT banner shows its distance, glowing arrows
  on the road show the way through town, and a pin marks the spot. The corner minimap follows you; tap it
  for the whole town with the office, the police station and your party office.
- **Crowd.** Walk into townspeople to recruit them; the bigger your crowd, the wider your pull (up to 30).
  They follow you through the streets.
- **Police** patrol between intersections and chase you when they see you (buildings block their view).
  - A cop has to **hold on to you for about a second** to arrest you. Running breaks free.
  - With **3+ supporters close by**, your crowd lifts the cop out of the way, but he takes one supporter with him.
  - Lathi charges scatter supporters. Inspectors throw **tear gas** at big crowds.
  - Each arrest is a case and costs democracy 10%; **3 cases and you're jailed**. After an arrest you're released at the police station.
  - Backup arrives over time, and sooner if your crowd is large.
- **Goons** rush you and knock you back (democracy −8%). With 3+ supporters close, they run off instead.
  - They also **throw stones, sticks and chappals**. A shadow grows where each one will land and turns into a
    red ring just before it hits, so keep moving: zig-zagging dodges most throws. A hit (democracy −6%)
    knocks you back and dazes you, drains stamina and scatters the supporters next to you. With 3+
    supporters close, one may take the stone for you.
  - Against a crowd of 8 or more they won't come close; they pelt you from a distance instead.
  - The gang at the office gate pelts the **women queuing outside**. Stray stones hit **women and children**
    in your procession and on the street: they sit down hurt, another woman runs over to help, and they
    are led home with a bandage. Nearby police turn their backs ("No complaint received.").
  - **Protect them:** step in front of a stone aimed at them, or raise a slogan so your crowd closes ranks
    around the women and children for 3 seconds. Each save lifts the meter.
- **The gate.** Escaping the goons is not the end. Near the RO office:
  1. **Police line.** Cops link arms across the street. Push through with your crowd (alone it barely
     moves) while they lathi your supporters.
  2. **Gate shut "for lunch".** Chant it open with 4 slogans and 8+ supporters, sneak round to the side
     wicket they "forgot" to lock, or slip in behind the ruling front's guests. The gate and the police line
     part for them, and the police salute.
  3. **"Only candidate + 4."** The rest of your crowd waits outside chanting and rejoins when you come out.
  4. **Papers check.** A frisk at the gate costs time and democracy; the wicket check is harsher.
  5. **Clerk stalls at the counter** ("server down", "lunch break", "photo size wrong"). 4 proposers inside
     halve each stall.
  6. **Rejected anyway.** Hold the counter until the filing completes and the clerk rejects it
     ("signature does not match"). Democracy flatlines.
  Once you are checked and inside, the gate police step back and the officials take over.
- **Democracy meter.** Starts at 100% and drops with every goon attack (−8%), stone (−6%), lathi charge on
  your crowd (−4% to −5%), tear gas shell, arrest, gate trick and stall, more when a woman or child is hurt, and
  when you enter the Section 144 zone. Broken barricades, an opened gate and protected people raise it a
  little. Its stages are Unwell, In hospital, In ICU and On ventilator; at 0% the run ends.
- **The end title.** Every run (rejected at the counter, bled out on the road, or jailed) ends on the front
  page of *The Daily Ballot*: just the headline "Democracy is killed in broad daylight. Welcome to Andhra
  Pradesh." over a cartoon of the shuttered RO office. **Share front page** sends it as an image (or
  downloads it).
- **On screen.** The top-left panel shows only the Democracy meter. Near the RO office the NEXT banner turns
  into a step guide (1/4 police line, 2/4 gate, 3/4 papers check, 4/4 hold the counter) and everything else
  goes quiet: one toast at a time, no tactic cards, and only the candidate, police and clerk speak.
- **Section 144 ring.** The streets around the office are barricaded, with a few manned checkposts.
  Walk into a barricade to push it; every supporter nearby speeds it up.
- There is no clock, no score and no documents to collect: just the walk, and what it costs.

## Architecture

The structure follows the mantarjantar.com approach: plain JavaScript, Canvas 2D, no framework or bundler,
and a deterministic simulation shared between browser and Node. All code, text and art here are original.

```
index.html          menu, pause, touch buttons, CSS
shared/             DOM-free UMD modules (browser + Node)
  world.js          seeded town generator, tile collision, BFS flow fields, line of sight, barricade ring
  content.js        all text, the end title; {town} {mandal} {district} templating
  sim.js            30 Hz deterministic game: crowd, police, goons, thrown stones, bystanders, Democracy meter, gas, barricades, gate, filing
client/
  pincode.js        India Post lookup + Andhra Pradesh check + cache + offline district fallback
  render.js         cached map chunks, people, sites, ring, gas, ambient autos, route guide, radar + town map, bubbles
  hud.js            Democracy meter, NEXT banner / gate step guide, radar, objective arrow, toasts, intro, map overlay
  frontpage.js      "The Daily Ballot" end-title front page (1080x1350 canvas) with Web Share / download
  input.js          keyboard, mouse steering, touch joystick, minimap taps
  audio.js          Web Audio synthesized effects (no audio files)
  main.js           loop, menu, events -> effects
test/               world (40 seeds), sim rules, bot walk to the office, pincode parsing
```

### Town generator

A small Andhra town, 56×56 tiles (1792 px, about two screens across), built from the pincode seed. From top
to bottom:

- paddy fields and a ring of coconut palms around the town (the paddy carries on past the edge);
- the walled **RO Office** compound (gate, side wicket, counter) with galis down both sides, the Govt Hospital
  on one side and a temple park on the other;
- **Collectorate Road**, which leaves town both ways (autos and bikes drive along it), where the Section 144
  cordon goes up;
- houses and lanes down to a **canal** with embankment paths and **two bridges**, the natural chokepoints;
- **Bazaar Street**, lined with striped stalls, where a third of the townspeople are out shopping (the place
  to build your crowd), with **Gandhi Circle** (a statue on a garden island) where a lane crosses it;
- **Station Road** with the YSRCP party office where you start, the RTC bus stand and the police station.

Half the towns are mirrored, and the compound, both bridges, the lanes and Gandhi Circle shift with the seed.
Blocks are split into house plots of different sizes, with the odd dead-end gali, tree or small park.

Tests check 40 seeds to confirm every site exists and is reachable from the start, that every town has the
canal with two bridges, stalls, Gandhi Circle and palms, that the walk is short, and that the office can
still be reached with either bridge closed.

### Simulation

`Sim.createGame({ seed, mapSeed, place, names })` advances with `step(input)`, where `input` is
`{ mx, my, run, act }`. The client reads `game.state` and drains `game.drainEvents()` for sounds, particles
and toasts. The simulation never calls `Math.random`, so the same seed and inputs replay exactly. That
makes it ready to run on a Node WebSocket server for online rooms, the way the original's sim does.

## Roadmap

- Online multiplayer: one `sim.js` instance per room on a Node `ws` server, with snapshot diffs to clients.
  Players could join as candidate, supporter or police.
- Android WebView wrapper for an offline APK.
- More district flavour: dialects and local landmarks.
