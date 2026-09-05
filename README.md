# CORDON

Ogre Battle 64's real-time squad-war loop × Super Robot Wars' pilot-driven spectacle × roguelite sector journey. A web-based SD mecha game.

A colony system has been sealed off by an authoritarian bloc. You command a rescue carrier and its squadrons of SD mecha, cutting a path through occupied space and hostile planets to reach the colonies still transmitting. Every run is a new route through the blockade. Every pilot who dies on the way stays dead until the next run. You do not control the fighting — you control the squad, the hardware, the route, and the moment you commit, then you watch your pilots earn it in a full-screen battle scene.

## Run it

**Requires:** Node 24 or later.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run preview
```

## How to play

**New Run:** start a new roguelite attempt with 6 unlocked pilots and 2 starter squads. **Node Map:** the sector branches before you — pick your route, then click a glowing node. **Briefing:** see what's waiting. **Launch:** deploy squads from the *Lantern* (the carrier). **Real-time Map:** click a squad to select it, then click the map to move. Fuel drains with movement; refuel at the carrier. **Contact:** when a squad touches an enemy squad, the **Forecast** screen appears. **Callouts:** pre-battle powers that cost Nerve. Pick them, study the variance band, commit. **Battle:** watch your squads fight — it's full-screen and skippable. **Objectives:** hold waypoints inside the ring while enemies stay out. Complete all required objectives = victory. **Back to the Map:** win the node and return to the sector. **The Hangar** (between maps) lets you repair, reassign pilots to mechs, swap weapons and systems, and manage loadouts. **Death is permanent for the run:** when a pilot is destroyed in battle, they stay gone until the next run — their squad is orphaned, and their friends know it. **Reach the boss:** the sector ends with one final stronghold.

## Keyboard

| Key | Action |
|---|---|
| **Space** | Pause / unpause the map |
| **1, 2, 3** | Map speed: 1×, 2×, 4× |
| **Tab** | Cycle selected squad |
| **R** | Recall selected squad to the carrier |
| **Escape** | Deselect squad |
| **H** | Toggle help |

## Content pipelines

Three build-time scripts generate voice and art:

- **Voice:** `npm run voice` — reads pilot Callout and Last Transmission lines from `src/data/`, calls ElevenLabs TTS, writes MP3s to `public/audio/voice/`. Reads `.elevenlabs_key` (gitignored). Use `--dry-run` to preview without costs; `--force` to regenerate existing files; `--only id,id` to generate specific pilots.
- **Art:** `npm run art -- --only frames` — generates placeholder frame sprites via Hugging Face. Add `--publish` to install PNGs to `public/sprites/`. Reads `.hf_token` (gitignored). Sprites use a green (`#00ff00`) chroma key; until you review and run with `--publish`, the game uses procedural placeholders.
- **Balance:** `npx tsx tools/balance/run.ts 200` — runs 200 headless battles per frame/loadout combo to build win-rate tables. Helps tune difficulty.

Both secret files (`.elevenlabs_key` and `.hf_token`) are gitignored and read only by these build-time scripts — never imported by the browser, never logged.

## Project layout

```
src/sim/              Pure simulation — battle resolver, forecast, world state, run graph
src/data/             JSON content — frames, weapons, pilots, callouts, maps, dialogue
src/render/           PixiJS scenes — map, battle stage, sprite compositor
src/ui/               React screens — forecast, hangar, node map, roster
src/save/             IndexedDB persistence
src/audio/            Howler.js wrappers and voice manifest
tools/                Build-time scripts — voice (ElevenLabs), art (Hugging Face), balance
public/               Static assets — sprites, audio, portraits
```

## Known gaps (v0.1)

- **No music yet.** Battle has procedural SFX only. To add a track, drop an MP3 into `public/audio/music/<track>.mp3` named one of: `title`, `map_space`, `map_surface`, `battle`, `boss`, `result`.
- **One sector per run.** Full roguelite route choice across three sectors is coming.
- **Mid-map progress isn't saved.** Quitting during a map restarts that map. Full save on node completion works.
- **Placeholder procedural sprites.** Until the art pipeline publishes generated frames and portraits, the game uses simple shapes. `npm run art -- --only frames --publish` to install them.
- **balance is a first pass — the boss wing is deliberately brutal (a fresh squad loses to it ~100%); bring grown pilots, salvaged Compact gear, and Callouts. `npx tsx tools/balance/playthrough.ts 20 1` runs 20 full simulated runs with a scripted commander.** Use the balance script to tune frame/weapon/system loadouts as the cast and item pool expand.

See **GDD.md** for the full design document and feature roadmap. See **docs/PLAYING.md** for a player-friendly systems guide.
