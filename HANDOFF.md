# CORDON — Handoff / Continuation Notes

Last updated: 2026-09-07 (overnight session). Read this first when picking the project back up. Companion docs: `GDD.md` (design, v3), `CONVENTIONS.md` (engineering rules), `src/sim/API.md` (sim contract), `docs/PLAYING.md` (how the game plays), `README.md`.

Run it: `npm run dev` (the port is no longer pinned — Vite reads `PORT`, default 5173). Tests: `npx vitest run` (309 passing at last check). Typecheck: `npm run typecheck`.

---

## 1. Honest status of Anthony's open items (2026-09-06)

Legend: **VERIFIED** = Fable saw it working in the browser. **COMMITTED, NOT PLAY-VERIFIED** = code landed and tests pass but nobody played it. **IN PROGRESS** = an agent was working on it when this doc was written; check `git log`/`git status` — if the tree has uncommitted `src/ui/**` changes, that work may be partial. **OPEN** = not started.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | New items can't be equipped — hangar dropdowns show items but they look greyed/unselectable | **VERIFIED FIXED** (Fable, in browser, 2026-09-06) | Two real bugs: (a) Chromium renders native `<option>` popups OS-side, ignoring the dark theme → options looked washed-out/"greyed"; (b) `HangarScreen` never subscribed to `hudTick`, so a successful `equip()` didn't re-render — the pick looked like it did nothing. Fix: custom `Dropdown` component (`src/ui/components/Dropdown.tsx`) with "Railgun · 22 PWR" labels and "(over budget)" marks, inline red rejection reason under the slot, `useHud()` in `HangarScreen`. Verified: equipped a Railgun into Halberd WPN B; sim state showed `wpn_lance/wpn_railgun` and the Assault Rifle returned to inventory. |
| 2 | Nerve is unexplained | **COMMITTED; bars + tooltip mechanism verified, Forecast "NERVE x/y" not eyeballed** | Nerve = the resource that pays for Callouts. Regen: +1 per 20s while deployed, +5 on objective complete, +8 to survivors when a squadmate dies, +3 to winners. Now: `NerveBar` component with tooltip and "-N NERVE" flash on spend (roster, squad detail, node map); Callout chips show "NERVE x/y" and "need N more"; Help overlay + `docs/PLAYING.md` updated. Re-check the Forecast modal in play. |
| 3 | Can't move mechs between squadrons; unseating a unit loses it | **VERIFIED FIXED** (Fable, in browser) | Unit model in `src/ui/hangar/`: empty cell → `UnitAssignModal` picker; seated cell → `UnitActionsModal` (MOVE TO…/swap, MAKE LEADER, UNSEAT); `BenchStrip` lists unseated pilots with a SEAT button that remembers their last mech. Verified: unseated Halo → she appeared on the bench → SEAT → chose Lantern One BACK → sim slot shows `pilot_marksman@frame_interceptor`. Note: the Modal looked translucent in the emulated-viewport screenshot but the DOM has a solid panel + dimmed backdrop; confirm at native size once. |
| 4 | Rival fight impossible (0–2%) | **VERIFIED FIXED** (Fable, in browser, 2026-09-06) — see note below | `3d254bb` was not enough — a starting squad still won 1–3%. Probed with the new `tools/balance/rival_probe.ts`: the odds were a **step function on the engaging squad's headcount** (2% at 3 pilots, 19% at 4, 74% at 5, 100% at 6), because only one player squad is in any contact and Compact frames outweigh Relay ones. Pilot aptitude was nearly irrelevant (a 3× sweep moved it under 5 points) and lighter wingman frames made it *worse* (the resolver weights evasion over HP). So tonnage is now the dial (`3eb2398`): the wing matches the player's headcount, its total effective HP is trimmed via `maxHpPenalty` to `RIVAL_HP_RATIO` (1.15) × the player's best squad, and rival aptitude tracks the player's best pilot (+12) rather than node threat. Now **20–36% cold, ~65% with three Callouts** — don't walk in unprepared, and Callouts are what win it. Plus `ef18c72`: **FALL BACK** in the Forecast modal below 25% win (costs 6 Standing, squad routs home) — the weak support squad still forecasts 0% and had no counterplay. Verified in browser: wing spawns 3 mechs vs the player's 3 at 434 vs 377 HP, live contact reads 35%, FALL BACK took Standing 50→44 with no battle and no re-contact. |
| 5 | Hover tooltips for weapons/systems (damage, heal, etc.) | **VERIFIED FIXED** (Fable, in browser) | `Tooltip` + `ItemTooltip` in `src/ui/components/`; wired into hangar slots/inventory, depot offers, salvage results (store gained `salvageDrop`), forecast mech cards, squad detail, callout chips. Verified on the inventory's Barrier Capacitor: "Shield: absorbs the first 60 damage each battle. Power 16 · Weight 8". Weapons show damage × hits, accuracy, crit, front/back multipliers, power, weight, repair. |
| 6 | Maps are small; no territory/strategy — "a rush to the map points" | **BUILT, PLAY-VERIFIED by Fable; NOT played by Anthony** (2026-09-07) | The territory layer from §3b is in. `capture_site` objectives that either side can take and re-take, income while held, site vision, reinforcement gates, and a `controlWin` alternative victory. Two 40×26 maps — **Ashline Corridor** (surface) and **Kessler Anchorage** (space) — each with 5 sites, 2 gates, and two win conditions: hold 3 of 5 for 90s, or kill the enemy commander. New `territory` NodeKind (weight 12) so these are a deliberate beat rather than a random battle. HUD: CONTROL panel (sites held / needed + hold clock) and per-site rows (HELD / COMPACT / UNCLAIMED, capture meter, CONTESTED, income, gate). Verified by playing: took the relay post at t=16, held three sites for 90s and **won on control rather than by killing the commander**, 258 scrap banked. See §6 for what is deliberately *not* built yet. |
| 7 | How to get more pilots/mechs? | **ADDRESSED** (2026-09-07) — see §3c | Three routes now, all signposted. (a) **RECRUIT column at depots** — hire an unlocked-but-absent pilot for 150 scrap (`recruitableAt`/`recruitPilot` in run.ts); the rival and captain are never offered. (b) **Rescue-a-survivor objectives** — `reward.recruitPilotId` existed and `finishMap` already honoured it, but no map set it; the two optional derelicts now carry Wraith (Halcyon hauler) and Scrapper (salt-flats rig). (c) **Hangar hint strip** — says when you have unbuilt frames needing BUILD, and separately distinguishes "benched pilot with a spare machine, go SEAT them" from "benched with nothing to fly". Verified: hired Scrapper, roster 6→7, scrap 400→250. |

### Things claimed fixed earlier that Anthony should re-verify
Fable verified these with screenshots, but a fresh eye is worth it:
- Voice lines play (Callouts, finishers, Last Transmissions) — `import { Howl }` fix in `src/audio/index.ts`.
- Map no longer goes black after battles — shared Pixi Application in `BattleStage`, canvas-backed sprite cache.
- Cut-in portraits legible; battle comms feed lingers/stacks (`src/ui/map/SpeechStack.tsx`).
- Mechs face the enemy; one combat-pose sprite per mech; formation rows don't overlap labels.
- Losers knocked back ~2.5 tiles after a battle (`src/sim/world.ts` `finalizeSquadAfterBattle`).
- Isometric overworld: painted ground plate + light grid + cubes + shadows (SRW style). Battle backdrops: 20 painted images, 2 per terrain.
- Real music: 6 CC-licensed tracks in `public/audio/music/` (credits in `CREDITS.md` there).
- Last Transmissions only fire for named cast + rival (not grunts).

---

## 2. Known bugs / rough edges (not yet addressed)

### Fixed overnight 2026-09-07
- **Black map on any map with no blocked/structure tiles.** `MapScene.resetSceneForMap` called `entitiesLayer.addChild(...this.blockedCubes)`; with an empty array that is `addChild()` with no arguments, which Pixi answers by dereferencing `children[0].parent` and throwing — aborting the whole scene load. Latent since forever; every shipped map happened to have at least one such tile until Ashline Corridor. Also clamped `bakeTiles`' texture resolution to a 4000px budget (a 40×26 map on a dPR-2 display would ask for 6336×3168, past the common 4096 GPU limit).
- **Routed squads re-engaged every 8 seconds.** A squad routs on morale rather than dying and walks straight back in. Each rout now keeps a squad out longer (10s +12s per prior rout, capped 60s), and an enemy squad broken 3 times and under 30% HP withdraws for good. Same territory map: 10 battles → 5.
- **Dev server pinned to port 5173** (`--strictPort` + a hardcoded port in `vite.config.ts`), so the preview failed outright whenever a server was already running. Now `autoPort` + `PORT`.
- **Break Formation's cost was undocumented.** It removes your own back row's 0.6× damage reduction (`battle.ts:467`) — measured at −13 percentage points of win chance in a rival duel — but the description advertised only the upside. Text now states the trade.
- **A stalled convoy gave no feedback.** Convoys only advance while a squad is within 2 tiles; the briefing said so but nothing did mid-map, and a stopped convoy looks identical to a moving one. The objective row now says "NOT ESCORTED".
- Terrain plates for `urban` are photoreal-aerial rather than cel-shaded; a style pass (regenerate with stronger "painted, flat colors" prompt or a different model via fal-ai) would help. Same for some `terrain_*` textures (now unused by the plate renderer but still in `public/sprites/map/`).
- Benign Pixi warning on map switch ("textureSource destroyed while still bound") from the render-texture mask pattern in `src/render/map/tiles.ts`. No visual effect.
- Quitting mid-map restarts that map (no mid-map save).
- **Territory maps are trivially easy at threat 1** — every contact on Ashline Corridor forecast 100% for a starting squad. `buildEnemySquad` scales with node threat, and a territory node in column 1 is threat 1; the map's 8 squads are individually 2-mech garrisons. Either restrict `territory` nodes to columns 3+ or give the map's spawns a threat floor.
- **Rival and territory nodes are rare enough to be hard to test.** Rival weight is 5, territory 12, out of ~102. Getting an early one took ~25 run rerolls. Consider a debug/QA way to force a node kind.
- Boss wing is very hard for a fresh squad by design; with equipping fixed it should be beatable with salvaged Compact gear + Callouts. Re-check after item 1.
- Balance harness (`npx tsx tools/balance/playthrough.ts 20 1`) uses a dumb scripted commander; its 0% boss win rate is mostly the commander.
- The in-app Browser pane pauses rendering when it loses focus (`document.hidden`); drive the sim via `window.__cordon` and `tick()` when QA'ing there.

---

## 3. Design proposals Anthony asked for (not yet built)

### 3a. Rival (item 4) — beyond the bug fix
- ~~Forecast FALL BACK below ~20% win~~ — **DONE** (`ef18c72`), threshold 25%, costs 6 Standing.
- ~~Scale the rival to the player~~ — **DONE** (`3eb2398`), but note the lever turned out to be *effective HP*, not aptitude; aptitude alone barely moves the resolver.
- ~~Taunt line on contact~~ — **DONE**. `lines.rivalContact` existed for 8 pilots and had **no consumer at all**; `world.ts` `emitRivalContact()` now fires a `rival_contact` event once per map when a squad first meets the rival wing: one of yours speaks, Duskfang answers (3 new lines added for him). Text-only — the 117 voice clips are pre-generated and these lines have no audio. Verified in browser: Ferrous "You haven't changed. I have." / Duskfang "You have been busy. It will not be enough."
- Still open: the rival's *signature Callout* (he only has `co_redline`/`co_come_get_some`).
- **Not** a balance bug (checked 2026-09-06 with the new `tools/balance/squad_probe.ts`): the support squad's 0% against the ace looked broken, but it beats `patrol` and `hunt` spawns (89–100% at threat 2, 59–71% at threat 3) and only loses to `guard` spawns — which are two 190 HP line frames, the heaviest ordinary squad. So Lantern Two screens light contacts and must avoid hard points, which reads as intended. No buff applied; FALL BACK is the right answer for when it gets cornered.

### 3b. Territory maps (item 6) — **BUILT 2026-09-07**, see item 6 above
Delivered: bigger maps (40×26), capturable/re-capturable sites with income and vision, reinforcement gates, and two win conditions (hold N of M, or kill the commander).

**Deliberately not built yet** — the remaining items from the original proposal, in the order I'd do them:
1. **Fuel as the leash** (proposal item 4). Sites have no refuel effect; `ObjectiveDef` would need a `refuelPerSec` and `world.ts` a proximity tick. This is the single biggest missing piece — without it, forward depots are worth income but not *reach*, and the map doesn't force you to work outward from what you hold.
2. **Fog + scouting** (proposal item 6). Site vision is in, but enemies are still revealed by the ordinary vision rules; there's no true fog, so Recon frames and "Ping the sector" don't pay off the way the proposal wanted.
3. **3–4 deployable squads** (proposal item 5). Blocked on pilot count — see 3c. With 6 pilots you get two squads of three, and a 40×26 map really wants three.
4. Enemy `intercept_objective` AI does not specifically target *sites*; the two gate waves use it, but they path at objectives generally rather than retaking what you just took.

### 3c. Pilots and mechs (item 7) — **BUILT 2026-09-07**, see item 7 above
Delivered: depot RECRUIT column, two rescue-a-survivor derelicts, hangar hint strip.

**Still open, and it needs your call:** the proposal's last bullet — *"Consider 2 more starting pilots (8 at launch) so 3 squads are possible from turn 1."* I did **not** do this. It changes baseline difficulty across the whole game, and now that a 40×26 territory map exists the case is stronger (three squads to cover five sites) but so is the risk of trivialising the smaller maps. It is a design decision, not a fix, so it is yours to make. If you want it: add `unlockedByDefault: true` to two pilots in `pilots.json` and give them starting mechs in `run.ts` `newRun`.

## 4. How the work has been done (process notes)
- Fable (Opus-class) does architecture, integration, QA in the browser; Sonnet agents do code/content/art; Haiku for docs/boilerplate. Anthony wants **Fable to personally verify with screenshots** before claiming anything is fixed — several agent "verified" claims were wrong (facing, cut-ins, seams).
- Art generation: `npx tsx tools/art/generate.ts --only <frames|portraits|poses|backdrops|terrain|terrain-variants|objects|decor|plates> [--publish]` via fal-ai FLUX schnell (HF router). `.hf_token` in repo root (gitignored). Always view outputs before publishing.
- Voice: `npx tsx tools/voice/generate.ts` (ElevenLabs; `.elevenlabs_key` gitignored). 117 clips published.
- Agents die on session rate limits mid-task: after a failure, check `git status` for partial edits and revert before relaunching.
- Commit early, small; the tree should be clean between tasks.

---

## 5. Suggested next session order
1. **Anthony plays a territory map.** Everything in §3b was verified by Fable driving the sim, not by a human playing with a mouse. The feel — whether 5 sites on a 40×26 map is the right density, whether 90s is the right hold, whether the CONTROL panel reads at a glance — is exactly what a machine can't check.
2. **Decide the 8-pilot question** (§3c). It gates three-squad play, which the big maps want.
3. **Fuel as the leash** (§3b item 1). The biggest missing piece of the territory design.
4. Threat floor for territory nodes (see §2) — they're currently a walkover in column 1.
5. Then fog/scouting, and the rival's signature Callout.


---

## 6. Overnight session log (2026-09-07)

Everything below was committed with tests and typecheck green; 309 tests passing at the end.

| Commit | What |
|---|---|
| `0287d3b` | Territory sim: capture_site, income, gates, control victory (11 tests) |
| `856af3e` | Ashline Corridor + `territory` NodeKind |
| `ef2a9fb` | Rout escalation + territory income cap |
| `b4c3e84` | Black-map render fix + territory HUD |
| `7361971` | Recruits, rescue-survivor objectives, hangar hints |
| `32b7201` | Kessler Anchorage (space) + win-condition signposting |

**Traps worth remembering** (each cost real time):
- `updateObjectives` skips objectives whose status is `complete`. A player-held site reads `complete`, so sites had to be *exempted* from that skip or they could never be contested again once taken.
- `checkWinLose` computes `requiredComplete` with `.every()` over required objectives — on an **empty** array that is vacuously `true`, so a map with no required objective wins the instant it loads. Every territory map therefore keeps one required objective (the commander).
- The fixture surface map's evac station sits at (10,6); a test capture_site placed there silently completed the required objective and ended the map mid-test.
