# CORDON — Engineering Conventions

Read this before touching any file. The design doc is `GDD.md`; the type contract is `src/sim/types.ts`.

## Non-negotiables

1. **`src/sim/` is pure.** No DOM, no Pixi, no React, no `Math.random`, no `Date.now`, no `setTimeout`. All randomness comes from `Rng` (`src/sim/rng.ts`). All time comes from tick/dt parameters. If a sim function is given the same inputs and seed it returns the same output, every time.
2. **Sim functions don't mutate their inputs** unless the function name says so (`applyX`, `stepX`, `mutateX`). Battle resolver returns deep copies.
3. **Types live in `src/sim/types.ts`.** Do not redefine them locally. If you need a new type, add it there with a comment and mention it in your final report.
4. **`npm run typecheck` must pass** before you report done. `npm test` must pass.
5. **Data is JSON in `src/data/`**, loaded by `src/data/index.ts` into a `GameData`. Never hardcode a frame/weapon/pilot in code.
6. **Renderers read, never write.** `src/render/` consumes `WorldState` / `BattleResult.events`. It dispatches player intents through the store, which calls sim functions.
7. **The battle stage plays back `BattleEvent[]`.** It never computes outcomes.
8. **Every runtime asset URL goes through `assetUrl()`** (`src/assetUrl.ts`). A bare `/sprites/...` or `/audio/...` string works under `npm run dev` and silently 404s on GitHub Pages, which serves the game from `/cordon/`, not the domain root. Write the path root-absolute as before and wrap it — the helper is idempotent, and the shared loaders (`probeAsset`, `probeFirstExisting`) already apply it, so anything reached through them needs nothing extra.

## Layout

```
src/sim/          pure simulation (battle, forecast, world, run, pilots, callouts, rules)
src/data/         JSON content + index.ts loader
src/render/       PixiJS scenes (map, battle, sprites)
src/ui/           React screens + zustand store
src/save/         IndexedDB (idb-keyval)
src/audio/        Howler wrappers, voice manifest
tools/            build-time scripts: voice (ElevenLabs), art (HF), balance (headless sim)
public/           static assets (sprites, audio, portraits)
```

Path aliases: `@sim/*`, `@render/*`, `@ui/*`, `@data/*`, `@save/*`, `@audio/*`.

## Style

- TypeScript strict. Named exports. No default exports except React lazy screens.
- Small files. One concern per file. Prefer functions over classes except where state genuinely benefits (Rng, Pixi scene controllers).
- Comments explain *why*, not what. Doc-comment every exported sim function with its contract (mutates? deterministic? units?).
- Units: map positions in **tiles** (fractional). Time in **seconds**. Speeds in tiles/second. HP integers.
- Ids are lowercase snake_case strings: `frame_skirmish_a`, `pilot_veteran`, `co_eyes_on`.

## Testing

- Vitest. Tests beside the file: `battle.test.ts` next to `battle.ts`.
- Every sim module ships with tests that: (a) prove determinism (same seed → identical output), (b) cover each branch of any `switch` on a closed union, (c) exercise at least one degenerate input (empty squad, zero HP, missing weapon).

## Secrets

`.hf_token` and `.elevenlabs_key` in the repo root are gitignored. Only `tools/` scripts read them, at build time. Never import them from `src/`, never log them, never write them anywhere else.

## Reporting back

When you finish a task, report: files created/changed, what's tested, any type additions, and **anything you were unsure about or left stubbed**. Do not claim tests pass unless you ran them.
