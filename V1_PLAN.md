# Kingdom of Stone — V1 Plan

## Goal
Evolve Pocket RTS into a complete single-player FFA experience with a proper main menu, configurable AI, and the technical foundation for map depth, unit intelligence, and visual polish.

---

## Phase 0 — Foundation (current sprint)

### Main Menu
- **New Game**: starts a fresh match with current settings; clears any saved state.
- **Continue**: resumes from `localStorage` snapshot (disabled if no save exists).
- **Difficulty selector**: Easy / Medium / Hard — controls AI tick rate, army size threshold, and build priority weights.
- **AI Count (1–5)**: spawns N independent AI players in a free-for-all. No teams. Last Town Center standing wins.

### FFA Conversion
- Remove hardcoded `TEAM_ENEMY = 1`. All non-player civilizations get dynamic team IDs (1…N).
- Each AI has its own gold pool and independent `updateAI()` brain.
- Color palette: player = blue, AI 1 = red, AI 2 = orange, AI 3 = purple, AI 4 = pink, AI 5 = teal.
- Map spawn points distributed evenly around the perimeter (player at west, AIs spread clockwise).
- Win condition: `aliveTCs.length === 1 && aliveTCs[0].team === 0`.

### Persistence
- On each significant event (building placed, unit trained, gold change) debounce-serialize world state to `localStorage`.
- Continue button activates only when a valid save exists.

---

## Phase 0.5 — Build Tooling (Vite)

### Why Vite
Importing npm packages (PixiJS, Pathfinding.js, Howler, etc.) without a build step means CDN script tags and no tree-shaking. Vite solves both and adds cache-busting automatically — production builds emit content-hashed filenames (`script.BxK92f.js`) so browsers never serve stale files.

### Setup
```bash
npm create vite@latest . -- --template vanilla
npm install
```
- Move `src/script.js` → `src/main.js` (Vite convention).
- Replace the Tailwind CDN `<script>` with the `@tailwindcss/vite` plugin.
- `npm run dev` for HMR during development; `npm run build` outputs `dist/` ready to serve from root.
- All subsequent library installs are `npm install <pkg>` — no CDN tags needed.

---

## Phase 1 — Map & Navigation

### A* Pathfinding (`pathfinding.js`)
- Maintain a 2D nav-grid (cell size ~40px) that rebuilds dirty cells when a building is placed or destroyed.
- Units request paths on state change; follow waypoints instead of straight-line steering.
- Keep the existing avoidance force layer for micro-separation between units on the same path.

### Procedural Maps (`simplex-noise`)
- Replace the hardcoded mine array with a seeded 2D noise pass.
- High-noise cells spawn gold mines; medium-noise cells become stone terrain that blocks pathing.
- Poisson-disk sampling ensures minimum spacing between resources.
- Seed derived from `Date.now()` at New Game; saved alongside state for Continue.

---

## Phase 2 — Rendering

### PixiJS Migration
- Replace `<canvas>` + 2D context with a PixiJS `Application` and `WebGLRenderer`.
- Entities become `PIXI.Sprite` or `PIXI.Graphics` objects in a world `Container` scaled by camera zoom/pan.
- Batch rendering handles 500+ units at 60 fps.
- Fog of War: secondary `RenderTexture` mask updated each frame per explored-cell bitmask.

---

## Phase 3 — Audio

### Howler.js
- Audio sprite: one bundled file with unit acknowledgements, combat hits, building complete, and ambient wind loop.
- Spatial falloff: sounds outside camera viewport play at reduced volume.

---

## Phase 4 — State & UI

### Zustand (ESM build)
- Central store: `{ gold, population, maxPop, units, buildings, techs }`.
- HUD components subscribe directly — no manual `updateGoldUI()` calls.
- Population cap enforced before training.

---

## Phase 5 — Gameplay Depth

### Villager FSM
States: `find_gold → move_to_gold → mine → return_to_base → deposit → find_gold`.
Replaces the current "attack the mine" hack with proper carry/deposit loop.

### Control Groups
- `Ctrl+1–9`: save current selection to group slot.
- `1–9` (no modifier): recall group. Double-tap: recall + center camera.

### Unit Stance
Three buttons in command card when units selected:
- **Aggressive** (current default): attack anything in range while moving.
- **Defensive**: hold position, attack only if attacked.
- **Hold Ground**: never move, attack anything in range.

### Tech Tree (stub)
Town Center upgrades unlock: improved mining rate, archer damage, soldier HP. Cost in gold; one research at a time.

---

## Milestone Summary

| Milestone | Key Deliverables | Status |
|-----------|-----------------|--------|
| M0        | Main menu, FFA multi-AI, Continue/save | ✅ Done |
| M0.5      | Vite build tooling, npm pipeline | ✅ Done |
| M1        | A* pathfinding, procedural maps | ✅ Done |
| M2        | PixiJS renderer, fog of war | ✅ Done |
| M3        | Howler audio | ✅ Done |
| M4        | Zustand state, population cap | ✅ Done |
| M5        | Villager FSM, control groups, unit stance, tech tree stub | ✅ Done |
| M6        | Character sprites (Minifolks outlined), walk animation | ✅ Done |
| M7        | Isometric grid — tile renderer, iso coordinate system | 🔄 In Progress |

---

## Phase 7 — Isometric Rendering

### Goal
Replace the top-down flat view with a 2:1 isometric perspective using the pixel-art tileset (`public/tiles/tile_000.png` … `tile_114.png`, each 32×32 RGBA).

### Coordinate system
All game logic (positions, pathfinding, collision, AI) stays in flat world space `(0..3000, 0..3000)`. Only the render layer converts world → iso screen.

```
ISO_TW = 32   // diamond pixel width
ISO_TH = 16   // diamond pixel height
ISO_CELL = 40 // world units per tile (= NAV_CELL)
ISO_SX = 0.4  // (ISO_TW/2) / ISO_CELL
ISO_SY = 0.2  // (ISO_TH/2) / ISO_CELL

worldToIso(wx, wy) → { x: (wx−wy)·ISO_SX, y: (wx+wy)·ISO_SY }
isoToWorld(ix, iy) → { x: ix/(2·ISO_SX) + iy/(2·ISO_SY),
                        y: iy/(2·ISO_SY) − ix/(2·ISO_SX) }
```

The 3000×3000 world maps to an iso diamond: top (0,0), right (3000,0), bottom (3000,3000), left (0,3000). ISO screen extents: X ∈ [−1200, 1200], Y ∈ [0, 1200].

### Tile layer
- Replace `gridGfx` + `stoneGfx` (Graphics) with a `tileContainer` (Container of Sprites).
- Built once per map in `_buildTileLayer()`, called from `_generateMap()` after stoneGrid is ready.
- 75×75 grid (3000/40). Tiles rendered in diagonal order (`depth = col+row`, ascending) for correct painter's ordering.
- **Ground**: single grass tile (tile_016.png) with minor deterministic variation (tiles 16–19) based on `col × 5 + row × 11`.
- **Stone cells**: rock tile variants (tiles 40–43) drawn over stone grid cells (stoneGrid cell size = 120 world units = 3 iso tiles).
- Sprite anchor `(0.5, 0)` — top-centre aligns with the diamond peak at `worldToIso(col·40, row·40)`.
- No explicit PixiJS scale on tile sprites; the worldContainer zoom handles everything.

### Render layer changes (game.ts only — no logic changes)
| Method | Change |
|--------|--------|
| `_applyCamera()` | Convert `camera.(x,y)` through `worldToIso` before computing container offset |
| `screenToWorld()` | Compute iso coords from screen offset, then `isoToWorld` to get world coords |
| `_drawEntities()` | `container.position.set(isoX, isoY)`; sort by `e.x + e.y`; buildings/resources drawn as iso diamond (poly) instead of roundRect |
| `_drawProjectiles()` | `worldToIso(p.x, p.y)` before drawing |
| `_drawEffects()` | `worldToIso` + ellipse scaled by ISO_SX/ISO_SY for ground-plane ring |
| `_drawGhost()` | Diamond poly at iso-converted snap position |
| `_redrawFog()` | Each fog cell drawn as iso quad (4 corners worldToIso'd) instead of axis-aligned rect |
| `createFloatingText()` | Store iso coords in `ft.x/ft.y`; text drifts upward in iso Y each frame |
| `_clampCamera()` | Simplified: clamp `camera.x` and `camera.y` to `[0, MAP_SIZE]` |

### Asset loading
115 tile PNGs loaded in `Game.create()` with `scaleMode: 'nearest'` (no blur).

### What doesn't change
Characters (Minifolks) are already isometric and look correct as-is. All game logic, pathfinding, collision, AI, saving, and audio are untouched.

### M8 candidates
- Building sprites (iso pixel-art structures replace colored diamonds)
- 8-direction unit facing based on movement vector
- Elevated terrain (cliff tiles, height layers)

---

### M6 — Done
- MinifolksHumans outlined sprite sheets copied to `public/sprites/`
- `UNIT_SPRITES` in constants.ts maps builder→MiniPrinceMan, soldier→MiniSwordMan, archer→MiniArcherMan
- `PIXI.AnimatedSprite` per unit; 4 frames from row 0 (south-facing walk), scale=2×; pre-loaded in `Game.create()`
- Team-color shadow ellipse drawn at unit feet; HP bar + selection ring sized to sprite visual extent
- M7 candidate: 8-direction facing (switch row based on movement vector), distinct sprite rows for attack/idle

### M5 — Done
- Villager FSM: builders carry gold (CARRY_CAP=25) via `moving_to_mine → mining → moving_to_base` states; deposit at TC triggers `+N` floating text; mine depleted when goldLeft=0
- Builders default to `defensive` stance; don't auto-attack or auto-mine without player/AI command
- AI builders use `moving_to_mine` (shared code path per CLAUDE.md)
- Control Groups: Ctrl+1–9 saves selection, 1–9 recalls; double-tap centers camera on group
- Unit Stance: Aggressive (chase in 220 range), Defensive/Hold (attack in strike range only, don't chase); Hold blocks auto-generated movement; stance buttons in command card with active highlight
- Tech Tree stub: Mining Speed (2× carry cap), Archer Dmg (+8 dmg), Soldier HP (+80 HP applied to existing + new soldiers); all researched at TC for 200g

## Progress Notes

### M0 — Done
Main menu, difficulty selector, AI count slider, FFA multi-AI (teams 1–N), Continue/save via localStorage, game over screen.

### M0.5 — Done
- Vite 8 + `@tailwindcss/vite` (Tailwind v4)
- TypeScript (src/*.ts) replaces plain JS
- `src/style.css` combines Tailwind + existing custom CSS
- CDN `<script>` removed from index.html
- `npm run dev` serves on http://localhost:5173/
- `pathfinding` and `simplex-noise` installed

### M1 — Done
- A* nav grid (NAV_CELL=40) built from stone terrain, rebuilt on building placed/destroyed
- Units follow A* waypoints; avoidance force layer handles micro-separation
- Procedural map: seeded simplex-noise stone terrain, zone-based gold mine placement
- Seed saved in localStorage for Continue; spawn areas kept clear

### M2 — Done
- PixiJS v8 `Application` replaces `<canvas>` + 2D context; WebGL renderer
- World `Container` with zoom/pan camera transform applied each frame
- Per-entity `Container` (shape + selection ring + HP bar) pooled by entity id; sorted by y each frame
- Projectiles, effects, floating texts all rendered via PixiJS Graphics/Text
- Static stone + grid graphics drawn once on map generation
- Fog of war: `fogGrid` bitmask, `FOG_CELL=80`, semi-transparent Graphics overlay redrawn only when new cells explored; player units reveal `FOG_SIGHT=260px` radius each frame

### M3 — Done
- `howler` installed; `scripts/gen-audio.cjs` synthesises all sounds into `public/sounds/sprite.wav` (457 KB, no external assets)
- Sprite layout: `ack` (0–200 ms) · `hit` (300–400 ms) · `build` (500–1000 ms) · `wind` (1200–5200 ms, looping)
- `src/audio.ts` — `Audio.ack/hit/build/startWind/stopWind/spatialVol`
- Triggers: `ack` on player right-click orders; `hit` on melee strike and projectile impact (spatially attenuated); `build` on player building completion; `wind` loops from `init()`, stops on game over

### M4 — Done
- `zustand` v5 (vanilla) installed; `src/store.ts` exposes `playerStore` with `{ gold, population, maxPop }`
- Constructor subscribes once: store changes drive `goldDisplay` and `popDisplay` DOM updates — no scattered manual DOM calls
- `updateGoldUI()` now delegates to `_syncPlayerStore()` so all existing call sites continue to work
- `_recomputeMaxPop(team)` sums `popCap` of fully-constructed buildings for a team; triggered on building complete, building death, and after `init()` entity setup
- `addEntity()` increments `population[team]` for unit spawns; dead-entity cleanup decrements it
- `popCap` added to STATS: `town_center=10`, `barracks=5`, `archery_range=5`; `popCost=1` on all units
- Player training and AI unit queuing both check population cap before allowing training
- HUD shows new green Population widget (`population / maxPop`) next to gold
