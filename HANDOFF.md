# CORDON — Handoff / Continuation Notes

Last updated: 2026-09-06. Read this first when picking the project back up. Companion docs: `GDD.md` (design, v3), `CONVENTIONS.md` (engineering rules), `src/sim/API.md` (sim contract), `docs/PLAYING.md` (how the game plays), `README.md`.

Run it: `npm run dev` → http://localhost:5173. Tests: `npx vitest run` (288 passing at last check). Typecheck: `npm run typecheck`.

---

## 1. Honest status of Anthony's open items (2026-09-06)

Legend: **VERIFIED** = Fable saw it working in the browser. **COMMITTED, NOT PLAY-VERIFIED** = code landed and tests pass but nobody played it. **IN PROGRESS** = an agent was working on it when this doc was written; check `git log`/`git status` — if the tree has uncommitted `src/ui/**` changes, that work may be partial. **OPEN** = not started.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | New items can't be equipped — hangar dropdowns show items but they look greyed/unselectable | **VERIFIED FIXED** (Fable, in browser, 2026-09-06) | Two real bugs: (a) Chromium renders native `<option>` popups OS-side, ignoring the dark theme → options looked washed-out/"greyed"; (b) `HangarScreen` never subscribed to `hudTick`, so a successful `equip()` didn't re-render — the pick looked like it did nothing. Fix: custom `Dropdown` component (`src/ui/components/Dropdown.tsx`) with "Railgun · 22 PWR" labels and "(over budget)" marks, inline red rejection reason under the slot, `useHud()` in `HangarScreen`. Verified: equipped a Railgun into Halberd WPN B; sim state showed `wpn_lance/wpn_railgun` and the Assault Rifle returned to inventory. |
| 2 | Nerve is unexplained | **COMMITTED; bars + tooltip mechanism verified, Forecast "NERVE x/y" not eyeballed** | Nerve = the resource that pays for Callouts. Regen: +1 per 20s while deployed, +5 on objective complete, +8 to survivors when a squadmate dies, +3 to winners. Now: `NerveBar` component with tooltip and "-N NERVE" flash on spend (roster, squad detail, node map); Callout chips show "NERVE x/y" and "need N more"; Help overlay + `docs/PLAYING.md` updated. Re-check the Forecast modal in play. |
| 3 | Can't move mechs between squadrons; unseating a unit loses it | **VERIFIED FIXED** (Fable, in browser) | Unit model in `src/ui/hangar/`: empty cell → `UnitAssignModal` picker; seated cell → `UnitActionsModal` (MOVE TO…/swap, MAKE LEADER, UNSEAT); `BenchStrip` lists unseated pilots with a SEAT button that remembers their last mech. Verified: unseated Halo → she appeared on the bench → SEAT → chose Lantern One BACK → sim slot shows `pilot_marksman@frame_interceptor`. Note: the Modal looked translucent in the emulated-viewport screenshot but the DOM has a solid panel + dimmed backdrop; confirm at native size once. |
| 4 | Rival fight impossible (0–2%) | **COMMITTED, NOT PLAY-VERIFIED** (`3d254bb`) | Root cause was a bug in `buildRivalSquad` (`src/sim/run.ts`): all three enemies were in the Compact **ace** frame with +10/+20 to every aptitude. Now only the rival flies the ace frame; wingmen fly `frame_compact_line` (one ranged, back row); bonus halved to +5/threat. Still to do (design, see §3): Forecast "Fall back" option at low WIN%, and scale rival to the player's best pilot rather than node threat. Also: progression was effectively broken by item 1. |
| 5 | Hover tooltips for weapons/systems (damage, heal, etc.) | **VERIFIED FIXED** (Fable, in browser) | `Tooltip` + `ItemTooltip` in `src/ui/components/`; wired into hangar slots/inventory, depot offers, salvage results (store gained `salvageDrop`), forecast mech cards, squad detail, callout chips. Verified on the inventory's Barrier Capacitor: "Shield: absorbs the first 60 damage each battle. Power 16 · Weight 8". Weapons show damage × hits, accuracy, crit, front/back multipliers, power, weight, repair. |
| 6 | Maps are small; no territory/strategy — "a rush to the map points" | **OPEN — design proposal in §3** | Biggest remaining design item. Sim + content work (~a night). |
| 7 | How to get more pilots/mechs? | **PARTLY IN, badly signposted — see §3** | Mechs: Depot FRAMES column → BUILD in hangar inventory panel; Compact frames drop from salvage (8%, more from boss/rival). Pilots: salvager recruits via the "stranded miner crew" distress event; 7th/8th pilots unlock permanently by reaching the boss / beating the rival. No rescue objective currently recruits (the `recruitPilotId` reward field exists in `ObjectiveDef` but no map uses it). |

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
- Terrain plates for `urban` are photoreal-aerial rather than cel-shaded; a style pass (regenerate with stronger "painted, flat colors" prompt or a different model via fal-ai) would help. Same for some `terrain_*` textures (now unused by the plate renderer but still in `public/sprites/map/`).
- Benign Pixi warning on map switch ("textureSource destroyed while still bound") from the render-texture mask pattern in `src/render/map/tiles.ts`. No visual effect.
- Quitting mid-map restarts that map (no mid-map save).
- Boss wing is very hard for a fresh squad by design; with equipping fixed it should be beatable with salvaged Compact gear + Callouts. Re-check after item 1.
- Balance harness (`npx tsx tools/balance/playthrough.ts 20 1`) uses a dumb scripted commander; its 0% boss win rate is mostly the commander.
- The in-app Browser pane pauses rendering when it loses focus (`document.hidden`); drive the sim via `window.__cordon` and `tick()` when QA'ing there.

---

## 3. Design proposals Anthony asked for (not yet built)

### 3a. Rival (item 4) — beyond the bug fix
- Forecast: when WIN% < ~20%, offer **FALL BACK** (costs Standing, squad routed toward home) instead of forcing the fight.
- Scale the rival to the player: rival aptitudes = player's best pilot + 8 (not node threat), so the duel is close but never hopeless.
- Give the rival a signature Callout and a taunt line on contact (data exists in `pilots.json` `rivalContact`).

### 3b. Territory maps (item 6) — the big one
Goal: bring back OB64's "hold and take ground" instead of "rush the points."
1. **Bigger maps** ~40×26 tiles with 5–7 objectives.
2. **Capturable/re-capturable sites**: relay posts, supply depots, fuel dumps, colonies. Holding one yields scrap/min, vision radius, and refuel for adjacent squads. Enemy `intercept_objective` AI retakes them.
3. **Reinforcement gates**: enemy squads keep spawning from 1–2 gates until the gate is captured → cut the flow first.
4. **Fuel as the leash**: forward depots matter because squads can't cross the map on one tank.
5. **3–4 deployable squads** with roles (interceptor wing, heavy line, support squad guarding a depot). Needs more pilots (3c).
6. **Fog + scouting**: enemies hidden until scouted; Recon frames / "Ping the sector" matter.
7. **Two win conditions**: hold N of M sites for T seconds, or destroy the boss.
Implementation touches: `src/sim/types.ts` (new ObjectiveKind e.g. `capture_site`, income fields), `src/sim/world.ts` (capture/recapture, income tick, gates), `src/data/maps.json` (new big maps as ASCII rows), `src/ui/map/ObjectivesPanel.tsx` (control %), `src/render/map/objectiveView.ts` (ownership color).

### 3c. Pilots and mechs (item 7)
- Rescue objectives that recruit a survivor pilot (set `reward.recruitPilotId` on colony/derelict objectives in `maps.json`; `finishMap` already handles it).
- **RECRUIT** tab at Depot nodes: hire an unlocked-but-absent pilot for scrap.
- Hangar: explicit **BUILD** call-to-action banner when an unbuilt frame is in inventory; Depot FRAMES column labelled "buy → build in hangar".
- Consider 2 more starting pilots (8 at launch) so 3 squads are possible from turn 1.

---

## 4. How the work has been done (process notes)
- Fable (Opus-class) does architecture, integration, QA in the browser; Sonnet agents do code/content/art; Haiku for docs/boilerplate. Anthony wants **Fable to personally verify with screenshots** before claiming anything is fixed — several agent "verified" claims were wrong (facing, cut-ins, seams).
- Art generation: `npx tsx tools/art/generate.ts --only <frames|portraits|poses|backdrops|terrain|terrain-variants|objects|decor|plates> [--publish]` via fal-ai FLUX schnell (HF router). `.hf_token` in repo root (gitignored). Always view outputs before publishing.
- Voice: `npx tsx tools/voice/generate.ts` (ElevenLabs; `.elevenlabs_key` gitignored). 117 clips published.
- Agents die on session rate limits mid-task: after a failure, check `git status` for partial edits and revert before relaunching.
- Commit early, small; the tree should be clean between tasks.

---

## 5. Suggested next session order
1. Anthony plays: equip salvage, move units between squads, hover items, read Nerve — confirm items 1–3, 5 feel right at native window size (Fable verified them in the emulated pane).
2. Play one run through the rival node; confirm it's winnable with salvaged gear (item 4 is committed but not play-verified).
3. Build 3b (territory maps) — the strategy layer.
4. Then 3c (recruits) and 3a (Fall back / rival scaling).
5. Art style pass on urban plate/terrain if it still clashes.
