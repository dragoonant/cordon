# CORDON
### Ogre Battle 64's real-time squad-war loop × Super Robot Wars' heart × a roguelite sector journey. Web-based. SD mecha.

Version 3 — 2026-09-04

---

## 0. Decisions Locked So Far

| Question | Decision |
|---|---|
| Tone | Super Robot Wars — heroic, dramatic, big attack callouts, pilots you love |
| Setting | Original IP. Colony war, human vs human. Space *and* planetary maps |
| Structure | Roguelite. One run = a sector journey (FTL-style branching node map) |
| Map length | Short: 8–12 minutes each |
| Persistence | Unlocks only. Every run starts fresh; new pilots/mechs/parts join the pool |
| Pilot death | Permadeath *within a run*. Dead pilots return to the pool next run |
| Cast | Named hero cast, 8–15 written characters with portraits and banter |
| Progression | **Pilots** grow and certify (no mech classes). Mechs are swappable hardware |
| Customization | Frame + slots: fixed frames with 2 weapon slots and 1 system slot |
| Objectives | Rescue colonies, stations, convoys — **no town liberation** |
| Battle scene | Full SRW spectacle (cut-ins, callouts, finishers), always skippable |
| Commands | Original pilot command system ("Callouts"), pre-battle + overworld. Not SRW's spirits |
| Cast size | **8 named pilots** at launch; more via post-launch unlocks |
| Player | Unseen commander. The *Lantern's* **captain** is a named character who speaks for you |
| Antagonist | **One rival Compact ace**, recurring every run with escalating dialogue |
| Music | **Orchestral-heroic** — SRW OG / classic mecha anime |
| Post-clear | **Ascension modifiers** — stackable difficulty unlocked per clear |
| Voice | ElevenLabs: **Callouts + Last Transmissions** voiced, generated at build time. Banter is text |
| Placeholder art | Hugging Face image models for frame sprites and portrait references pre-artist |
| Title | **CORDON** |

---

## 1. The Pitch

A colony system has been sealed off by an authoritarian bloc. You command a rescue carrier and its squadrons of SD mecha, cutting a path through occupied space and hostile planets to reach the colonies still transmitting. Every run is a new route through the blockade. Every pilot who dies on the way stays dead until the next run.

You do not control the fighting. You control the *squad*, the *hardware*, the *route*, and the *moment you commit* — and then you watch your pilots earn it in a full-screen SRW-style battle scene.

**The promise:** OB64's "preparation is the game" tactical layer, SRW's pilot-driven spectacle, roguelite stakes.

---

## 2. Setting Sketch (original IP — names are proposals)

**The Cordon.** A single star system: a habitable inner world, an industrialized moon, an asteroid belt of mining colonies, and a ring of orbital stations and O'Neill cylinders. Fifteen years ago the **Meridian Compact** — the system's dominant bloc — declared a "stabilization cordon" and sealed the outer colonies behind a blockade. Officially it's quarantine. In practice it's a slow strangulation: supply drops stopped, comms are jammed, colonies that resist go dark.

**You** are **Relay Group** — a rescue-and-salvage outfit operating one aging carrier, the *Lantern*. You weren't soldiers. You became them.

**The enemy** is professional, disciplined, and has aces of its own with names and faces. They think they're keeping order. Some of them are right about some things. This is a human war.

**The Captain** of the *Lantern* is your voice. You (the player) are the unseen commander; the Captain relays your orders, argues with the pilots, and takes the heat when a colony is left behind. This gives the cast someone to bounce off without locking you into an avatar.

**The Rival.** One Compact ace — a named pilot in a signature frame — who intercepts you in every run. Their dialogue escalates across runs: contempt, then curiosity, then something closer to respect. Beating them is a run highlight; losing a pilot to them is personal. Over enough runs, they get their own Last Transmission.

### Cast — 8 pilots at launch

Roles, not names yet. Each pilot needs: 4 portrait expressions, ~15 voiced Callout lines, 1 voiced Last Transmission, ~25 text banter lines, a finisher with a cut-in, and an orchestral leitmotif sting (2–4 bars) for their finisher.

| # | Archetype | Squad role | Story hook |
|---|---|---|---|
| 1 | The veteran | Wing Lead, Heavy cert | Was Compact once. Knows the rival. |
| 2 | The hotshot | Vanguard, front row | Redlines everything. Will die first if you let them. |
| 3 | The marksman | Marksman, back row | Quiet. Highest Systems. "Eyes On" specialist. |
| 4 | The rookie | Light frames only | Lowest stats, fastest growth. Everyone protects them. |
| 5 | The engineer | Field Tech | Repairs mid-battle. Talks to the frames like they're people. |
| 6 | The scout | Recon | Overworld Callouts. Sees the map others don't. |
| 7 | The salvager | Any | Civilian pilot from a lost colony. Fights for what's left. |
| 8 | The wildcard | Any | Unlockable. Tied to the rival's story. |

Bonds between specific pairs (1–2, 3–4, 5–7, 6–8) unlock Tandem Callouts and story scenes.

**Why this setting serves the design:**
- Rescue objectives are native: colonies, stations, refugee convoys, mining platforms, derelicts.
- Space vs planet maps have a diegetic reason (orbital blockade, ground occupation).
- Salvage is thematically central → justifies looting enemy weapons and, rarely, whole Compact frames.
- Named enemy aces → recurring rivals across runs, SRW's best feature.
- A blockade is a natural "run" structure: you're going *through* something.

---

## 3. Art Direction — SD / Chibi Mecha, SRW Energy

**The look:** 2–3 head-tall proportions. Oversized torso and head, stubby limbs, exaggerated pauldrons and thrusters. Readable silhouette above all.

**Reference vocabulary:** SD Gundam G Generation, Super Robot Wars battle sprites, Gachapon Senshi, Into the Breach's silhouette discipline. Pilot portraits: clean anime linework, expressive, cut-in ready.

**Palette:** desaturated industrial base (gunmetal, rust, olive, bone) with **one saturated faction accent** — Relay Group amber-orange (rescue beacon color), Compact steel-blue/white, salvage-tech violet. The accent is the only saturated thing on a sprite; allegiance reads instantly.

**Three sprite contexts:**
- **Map (32×32):** squad = one chibi leader icon + pips for squad size.
- **Battle (96–128px):** individual mecha. Idle bob, attack, hit flash, destruction burst. **Every weapon part carries its own attack animation** — the battle scene composes them.
- **Cut-ins (portrait):** pilot face, 3–4 expressions per pilot (neutral, shout, strained, grin). Finisher cut-ins use a dedicated dramatic frame.

**The production rule that makes this shippable:** a mech sprite is a **frame body** plus **weapon overlays** drawn on shared attachment points. Frames are bespoke (that's where the personality lives — a Bastion frame should look nothing like a Skirmish frame), but weapons are drawn once and mount on any frame of the right weight. Ten frames × twenty weapons is thirty sprite assets, not two hundred. The customization system and the art pipeline are the same decision.

---

## 4. Run Structure — The Sector Journey

A run is a journey from the outer blockade line to a final Compact stronghold.

- **3 sectors**, each a branching node map of ~4 nodes plus a sector boss. ~10–13 maps per run. Target run length: **~2 hours**, resumable.
- **Node types:** Battle (space or surface), Rescue (battle with a protection objective), Distress Call (event, choice-driven), Salvage Field (parts, risk of ambush), Depot (repair/trade), Rival Encounter (a named Compact ace), Boss.
- **The carrier** *Lantern* is your base. On space maps it's on the map and can be attacked. On planetary maps it's in orbit; squads drop from it and the deployment point is your landing zone.
- **Routes are visible one sector ahead.** Choosing a route is choosing which colonies you can save — and which you're abandoning. The game says this out loud.

**Between runs:** unlock screen. New pilots recruited, new parts and frames enter the salvage pool, new events and rival aces appear, story fragments unlock. Deeper runs reveal more of *why* the Cordon exists.

---

## 5. The Overworld Map (OB64 core, kept)

Real-time, **freely paused** (spacebar), 1×/2×/4× speed. Map pauses during battle scenes so spectacle never costs you strategic time.

- **Deployment:** squads launch from the *Lantern* or landing zone. Each has a **fuel/supply** budget draining with movement; refilled at the carrier or a captured depot.
- **Contact:** two squads meeting triggers the Forecast → Battle sequence.
- **Rescue targets** replace towns:
  - **Colony / Station:** hold it for N seconds to evacuate. Gives salvage, Nerve, Standing, sometimes a recruit.
  - **Convoy:** escort a moving target across the map.
  - **Derelict:** salvage rare parts; may be a trap.
  - **Comm relay:** capture to reveal enemy movement across the map.
  - Fail a rescue and it is destroyed — *for the run*. The map remembers.
- **Space vs Surface maps** — the big differentiator:
  - **Space:** no terrain in the ground sense; instead debris fields (cover), radiation belts (damage over time), gravity wells (movement), station structures (chokepoints). **Space-rated frames move freely; ground frames are sluggish and lose evasion.**
  - **Surface:** forest / urban / open / mountain / water. Weather replaces day/night. **Ground frames get terrain bonuses; space frames are top-heavy and slow.**
  - Every frame has a **mobility rating: Space, Ground, or Aerospace.** A squad of space frames is a poor squad in gravity. Routes tell you what's coming; the player picks frames for the sector ahead. Aerospace frames do both, and they're rare and light-armored.

---

## 6. Squads, Pilots, and Mechs

### 6.1 Squads
A **Squad** = 1 leader + up to 4 mecha in a **2×3 grid**: front row (melee, absorbs hits) and back row (ranged, support, protected). Weapon parts have **row behavior** — a lance is a two-hit rush in front and useless in back; a railgun is precise in back and rushed in front.

### 6.2 Pilots — the progression layer (replaces classes)

Pilots are people. Mechs are hardware. Growth lives entirely in pilots.

**Five Aptitudes**, each 0–100, grown by use:
- **Gunnery** (ranged accuracy/crit) · **Melee** (close damage/counters) · **Evasion** (dodge) · **Systems** (part efficiency, sensor range, forecast accuracy) · **Command** (squad morale, leader bonuses, Nerve regen)

**Certifications** — the "class change" replacement. At aptitude thresholds a pilot certifies into new frame weights and specializations, *with requirements shown on screen*:
- Weight certs: **Light → Medium → Heavy → Superheavy** (gates which torsos they can pilot)
- Specialty certs: **Vanguard** (front-row melee bonuses), **Marksman** (back-row ranged), **Field Tech** (repairs mid-battle), **Recon** (map vision, overworld speed), **Wing Lead** (squad-wide buffs as leader)
- Certs unlock new **Callouts** (see §7) and new banter.

**Ace status:** at a kill threshold a pilot earns a personal **Ace Trait** and a **finisher attack** with a unique cut-in. Aces are what you're building toward each run.

**Within a run, death is permanent.** A dead pilot's portrait goes dark. Their squad is orphaned. Their friends say something. Next run, they're in the pool again — but the run you lost them in is the one you'll remember.

**Bonds:** pilots who fight in the same squad build a bond level. Bonds unlock **Tandem Callouts** (§7.4) and support attacks in battle. Bonds reset each run, but story scenes unlocked by reaching bond milestones persist.

### 6.3 Mechs — frames with slots

A mech is a **frame** — a complete, named machine with its own look, HP, armor, evasion, weight class, mobility rating (Space / Ground / Aerospace), and generator output — plus **three slots**:

| Slot | What goes in it | Examples |
|---|---|---|
| **Weapon A** | Primary. Determines the mech's row behavior. | Lance (front, 2-hit rush), Assault rifle (either row), Railgun (back, precise), Shield-blade (front, counters) |
| **Weapon B** | Secondary. Often a different range than A so the mech isn't dead in the wrong row. | Missile pod (back), Vulcans (any), Grapple (front), Flare launcher (support) |
| **System** | One special. The "what makes this mech *mine*" slot. | Shield generator, Booster, ECM jammer, Repair drone bay, Recon array, Ejection assist |

**Weight vs. generator:** total slot weight must stay under the frame's generator output or the mech loses evasion and speed. That's the whole build tension in one number.

**Frame families** (launch target ~10 frames, more via unlocks):
- **Light** — Skirmish, Recon, Interceptor. Fast, fragile, 1 system slot bonus on some.
- **Medium** — Line, Trooper, Aerospace Line. The backbone.
- **Heavy** — Bastion, Siege, Assault. Slow, huge HP, high generator output.
- **Salvaged Compact frames** — excellent, heavy, distinctive silhouettes. Rare drops; the enemy's aces fly these.

**Salvage:** destroyed enemy mechs drop **weapons and systems** frequently, and **whole frames** rarely (more often from bosses and rivals). Compact weapons are better than yours and heavier.

**Losing a mech** = losing the frame and everything in it. If the squad wins the battle, one slot item can be recovered from the wreck.

**Pilots and frames:** weight certifications (§6.2) gate which frames a pilot can fly. A rookie in a Bastion is not allowed; a rookie in a Skirmish frame with an Ejection assist is how you keep rookies alive.

---

## 7. Callouts — the command system (original; not SRW spirits)

**Fiction:** every pilot has a radio. A Callout is a pilot keying the squad channel and *committing* to something. Callouts are voiced (text + portrait) and named in pilot speech, not ability-menu speech.

**Resource: Nerve.** Each pilot has a Nerve pool. Nerve regenerates when battles are won, rescues succeed — and **when things go wrong**. Taking losses, watching a colony fall, or losing a squadmate spikes Nerve for the survivors. This is the comeback engine and it's thematically right: people dig in when it gets bad.

**Design rules that make these *not* SRW:**
1. Many Callouts are **relational** — they involve a squadmate or the whole squad, not just the caster. The game is about squads.
2. Many are **gambles or trades**, not pure buffs. Roguelite decisions should have a cost you feel.
3. Several manipulate **information and the forecast itself** — the preparation layer is where our skill lives.
4. The best ones are **unique to a pilot**, including one that only fires when they die.

### 7.1 Pre-battle Callouts (used on the Forecast screen)

| Callout | Effect | Cost / Trade |
|---|---|---|
| **"Eyes On."** | Reveal the enemy's full loadout and formation. Forecast becomes *exact* — no variance band. | Nerve. Information is a resource. |
| **"Break Formation!"** | Your squad ignores row rules this battle: back row can melee, front row can fire. | Squad loses its defensive row bonus. Turns a bad matchup into a chosen one. |
| **"Redline it."** | Caster's mech: +60% damage this battle. | Frame takes permanent structural damage for the run (−max HP). Reckless, ace-like. |
| **"On me!"** | Caster draws all attacks aimed at a chosen squadmate this battle. | Caster takes the hits. Protect the rookie with the veteran — or the reverse. |
| **"Punch out if it goes bad."** | If the caster's mech is destroyed this battle, the pilot ejects safely. Guaranteed. | Nerve, and the mech is still lost. This is how you *manage* permadeath. |
| **"First one's mine."** | Caster attacks first, before the enemy's opening round, regardless of speed. | Caster's evasion is zero for round one. |
| **"Chain it!"** | The first kill this battle grants every squadmate a free follow-up attack. | High Nerve. Snowball play. |
| **"Sell it."** | Enemy targets the *wrong row* for round one. | Requires Command aptitude. Feint, not a buff. |
| **"We hold."** | Squad cannot be routed this battle and fights every round to the end. Survivors gain permanent morale. | Nobody retreats — including the ones who should. |

### 7.2 Overworld Callouts (used on the real-time map)

| Callout | Effect | Cost / Trade |
|---|---|---|
| **"Burn hard."** | Squad moves at 2× for 30s. | Fuel drains 3× and the squad must idle 15s after. |
| **"Ping the sector."** | Reveal all enemy squads and headings in a radius for 20s. | Enemy squads in that radius are also alerted to *you*. |
| **"Rally on the channel."** | All friendly squads in range recover morale. | Caster's squad *loses* morale — they gave it away. |
| **"Fall back, fall back!"** | Instant disengage to the nearest friendly point, ignoring pursuit. | Every mech takes a flat damage tick. Escaping costs. |
| **"Come get some."** | Enemy squads in range are drawn to the caster's squad for 20s. | You'd better win. Bait for protecting a rescue. |
| **"Stay with them."** | Attach caster's squad to a convoy or evac target; they move together and the target takes no damage while the squad lives. | Squad can't disengage until the escort completes. |

### 7.3 Last Transmissions — fire when a pilot dies

Every named pilot has **one unique Callout that only triggers on their death.** Free. Automatic. Voiced in full with a dedicated portrait frame.

Examples:
- *"Don't you dare stop for me."* — Every friendly squad on the map gains 2× speed for 30s and full Nerve. The map keeps moving.
- *"Marking them. All of them."* — The squad that killed this pilot is permanently revealed and takes +30% damage from all sources for the run.
- *"Take the frame. It's a good frame."* — Their mech survives destruction as a recoverable wreck: frame and all three slots salvageable.
- *"I've got the shot. Tell them I—"* — Their final attack fires anyway, at full power, ignoring evasion.

Last Transmissions make permadeath *a moment* instead of a punishment. Players will lose pilots on purpose exactly once, and feel terrible about it.

### 7.4 Tandem Callouts — bond-gated, two pilots

Unlock at bond milestones between two specific pilots. Both spend Nerve. Both cut-ins appear.

- **"Cross-fire!"** — Two back-row pilots fire simultaneously at one target: combined damage, guaranteed hit.
- **"Switch!"** — Front and back pilots swap rows mid-battle, after round one. Enemy's targeting is wasted.
- **"I've got your six."** — Any attack that would kill Pilot A is intercepted by Pilot B at half damage. Once per battle.

---

## 8. Battle Scene — Full SRW Spectacle

Map pauses. Screen cuts to the battle stage: your squad left, theirs right, background matching the map biome (debris field, station interior, forest, city).

- **Exchange structure:** a fixed number of rounds. Each round, every active mech attacks once per its row rules. Callouts and Tandems resolve on their declared triggers.
- **Presentation:** camera pushes and pans, weapon attack animations composed from parts, hit flashes, pilot **cut-ins** on crits, kills, Callouts, and finishers. **Attack callout lines** appear as speech text. Named finishers get a full-screen dramatic frame with the pilot's ace portrait.
- **Banter:** pilots react — to killing a rival, to a squadmate going down, to a Compact ace taunting. Pulled from a per-pilot line pool keyed to battle events. Text only.
- **Voice:** Callouts and Last Transmissions are **voiced** (ElevenLabs, one voice per pilot). A Callout on the forecast screen plays its line; a Last Transmission plays in full over a held portrait frame. Voice is the SRW spice on the two moments that matter most.
- **Music:** orchestral-heroic. Map theme per biome, battle theme per sector, a boss theme, the rival's theme. Each pilot's finisher plays a short **leitmotif sting** over the battle music.
- **Duration:** 20–40s. **Always skippable.** Hold-to-fast-forward. A "results only" toggle for players who've seen it all. Never hide the spectacle from the player who wants it; never force it on the player who doesn't.
- **Player input during battle:** none, except **Retreat** if the squad isn't under "We hold."

**Scope reality:** this is the most expensive feature in the game and the one you asked for most. The plan is to build it *data-driven* — attack animations are scripts composed of sprite actions, camera moves, and effect triggers — so each new weapon part or finisher is a data file, not a new hand-animated sequence. Milestone plan stages the spectacle up rather than blocking on it.

---

## 9. Forecast Screen

Before every battle: predicted damage exchange per mech, kill probability, terrain/biome and weather modifiers, mobility-rating and overweight penalties, which pilots are at risk of death. Callout buttons live here. **Nothing is hidden**, except what "Eyes On" would reveal.

Under the hood: the battle resolver is pure and deterministic, so the forecast is *the same function run 500 times with different seeds*. Systems aptitude and head sensors narrow the variance band. The information layer is a real mechanic.

---

## 10. Technical Plan (web)

- **TypeScript**, strict. **Vite**.
- **PixiJS v8** for the map, battle stage, and sprite composition. Not a full engine — we own the loop.
- **React** for UI only (forecast, hangar/build screen, node map, roster, unlock screen), mounted over the Pixi canvas.
- **Zustand** for UI state. Simulation state lives outside React entirely.
- **Howler.js** for audio.
- **No backend for v1.** Runs and unlocks saved in IndexedDB; JSON export/import. Mid-run save on every node transition.

**Architecture rule:** the simulation is a pure, deterministic, headless module. Renderers read from it; they never write to it.

```
src/
  sim/                  # pure TS, no DOM, seeded RNG
    run.ts              # sector graph, node generation, unlock state
    world.ts            # real-time map: tick loop, fuel, rescue timers, space/surface rules
    squad.ts            # formation, morale, Nerve
    pilot.ts            # aptitudes, certs, bonds, callouts, death
    mech.ts             # frames, slots, weight/generator, mobility rating, salvage
    battle.ts           # deterministic resolver; emits an event log
    forecast.ts         # runs battle.ts N times → distribution
    callouts/           # each callout as data + hook into battle/world events
    data/               # JSON: frames, weapons, systems, pilots, callouts, nodes, maps, dialogue
  render/
    map/                # PixiJS overworld scene
    battle/             # PixiJS battle stage; plays the battle event log as spectacle
    sprites/            # frame + weapon-overlay compositor, atlas management
  ui/                   # React screens
  save/                 # IndexedDB
```

**The battle stage plays back an event log.** `battle.resolve()` returns a list of events (attack, hit, crit, kill, callout, cut-in trigger). The spectacle renderer consumes that log with timing and camera scripts. This is what makes "skip" trivial — you just stop consuming — and what lets the same sim run headless for forecasts and balance.

**Fixed timestep:** 30Hz sim ticks; render interpolated at display rate.

### Content pipelines (build-time, never in the browser)

```
tools/
  voice/      # reads data/pilots/*.json lines → ElevenLabs → public/audio/voice/<pilot>/<line>.ogg
  art/        # HF image model prompts → placeholder frame sprites & portrait refs → public/sprites/placeholder/
  balance/    # headless sim harness: runs N battles per loadout, outputs win-rate tables
```

- **Voice:** `tools/voice` is a Node script. Input is the pilot dialogue JSON (line id, text, emotion tag); output is compressed audio committed as assets. Runs only when lines change. The ElevenLabs key lives in `.elevenlabs_key` (gitignored) and is read by the script — the browser never sees it. ~130 lines at launch (8 pilots × ~15 Callouts + 8 Last Transmissions + rival).
- **Placeholder art:** `tools/art` generates SD-mecha frame sprites and pilot portrait references from prompt templates via Hugging Face inference. These are **placeholders**: they let the game look like itself during M1–M2 and become the brief for a real artist. Key in `.hf_token`, gitignored, build-time only. Generated sprites will need manual cleanup for silhouette consistency — budget for it.
- **Audio weight:** ~130 short voice clips at ~30KB each is ~4MB. Fine for web. If voice ever expands to full banter, switch to lazy-loading per pilot.

---

## 11. Milestones

### M0 — Is the loop fun? (placeholder art, 2–3 weeks)
- One space map, one surface map. Two squads each side. Colored shapes.
- Real-time, pause, fuel, contact detection, one rescue timer objective.
- Pure battle resolver + text event log. Forecast as raw numbers.
- 3 pre-battle Callouts, 2 overworld Callouts, working Nerve.
- **Gate:** deploy → intercept → forecast → commit → reposition must be *tense* with zero art. If not, fix here.

### M1 — It looks like the game
- Frame + weapon-overlay sprite compositor. 4 frames (one per weight + one Compact), 8 weapons, 4 systems.
- Compact battle stage: attack animations, hit flashes, **cut-ins on kills and Callouts.** (Spectacle v1.)
- Hangar screen: pick frame, drag weapons/system into slots, see weight/generator and mobility rating.
- Forecast screen with variance band.
- 6 of the 8 pilots with placeholder portraits (HF), aptitudes, first cert tier, Last Transmissions. `tools/art` and `tools/voice` pipelines stood up; first voiced Callouts in.

### M2 — The run
- Sector node map: 3 sectors, node types, route choice, one boss.
- Rescue variants: station, convoy, derelict, relay.
- Space vs surface mobility rules in full. Roster to 10 frames.
- Bonds and Tandems. Full Callout set.
- Between-run unlock screen. Persistence.

### M3 — Spectacle and cast
- Full SRW battle stage: camera scripting, finishers, ace cut-ins, banter pools.
- All 8 pilots complete: portraits, finishers, full voiced Callouts, leitmotif stings. The Captain. The Rival with escalating encounters.
- Story fragments across unlocks. Orchestral score.

### M4 — Polish
- Balance via headless mass simulation (10,000 auto-battles per frame/loadout set).
- Tutorial run, accessibility, touch layout, results-only toggle, save robustness.
- **Ascension modifiers:** ~10 stackable post-clear modifiers (rival appears one sector earlier, salvage −30%, Nerve regen halved, no "Punch out," Compact frames drop nothing, etc.).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Spectacle scope** | Data-driven attack scripts; stage it (M1 compact → M3 full). The sim never depends on it. |
| **Art volume** | Bespoke frames, shared weapon overlays. Frames are where the art budget goes; weapons multiply them for free. |
| **Permadeath + named cast feels punishing** | "Punch out" makes death manageable; Last Transmissions make it meaningful; unlocks-only means it's never permanent-permanent. |
| **Real-time feels stressful** | Free pause, no penalty, map pauses during battles. Test in M0. |
| **Space/surface split makes builds feel bad** | Routes visible one sector ahead; carry a mixed hangar and reassign pilots between maps; aerospace frames exist. Test the *feel* of a bad-fit squad in M2. |
| **Callouts become "always cast the best one"** | Every Callout has a trade, and Nerve is scarce. Balance harness in M4. |

---

## 13. Open Questions — Deferred (not blocking M0)

1. **Pilot names and the Captain's name.** Write the cast once the tone doc exists; placeholders are fine for M0–M1.
2. **Setting proper nouns** — *Cordon*, *Meridian Compact*, *Relay Group*, *Lantern* are proposals. Keep or rename before M3.
3. **Rival's arc** — how many runs until their Last Transmission unlocks? Depends on average clears per player; decide in M4 with data.
4. **Music sourcing** — composer, licensed library, or generated? Orchestral is the most expensive direction to source well. Decide by M3.
5. **Squad size** — 5 mecha per squad (OB64) or 4? Fewer means each death matters more and battle scenes are shorter. Test both in M0.

---

## 14. Immediate Next Step

Scaffold **M0**. It's the cheapest possible test of the core loop and it forces the sim architecture into place before any art or spectacle exists.
