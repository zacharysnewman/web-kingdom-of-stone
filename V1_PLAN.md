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

| Milestone | Key Deliverables |
|-----------|-----------------|
| M0 (now)  | Main menu, FFA multi-AI, Continue/save |
| M0.5      | Vite build tooling, npm pipeline |
| M1        | A* pathfinding, procedural maps |
| M2        | PixiJS renderer, fog of war |
| M3        | Howler audio |
| M4        | Zustand state, population cap |
| M5        | Villager FSM, control groups, unit stance, tech tree stub |
