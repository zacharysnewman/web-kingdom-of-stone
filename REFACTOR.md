Refactoring Plan: game.ts1. Overview and Current StateCurrently, game.ts consists of a massive, monolithic Game class (~1000 lines). This class is acting as a "God Object", meaning it knows too much and does too much.Violations of Best Practices:Single Responsibility Principle (SRP): The class handles rendering, input, AI, map generation, collision detection, pathfinding, DOM manipulation (UI), and game loop logic.Tight Coupling: Game logic is tightly coupled to rendering (PixiJS) and UI (direct document.getElementById calls).Testing Difficulty: Because everything is intertwined, unit testing individual components (like pathfinding or economy logic) is virtually impossible without mocking the entire DOM and PixiJS.Goal: Refactor the architecture into a modular, maintainable, and scalable structure using a Manager/System-based Architecture.2. Target Directory StructureWe will split game.ts into a feature-based folder structure:src/
├── core/
│ ├── Game.ts # Main orchestrator, simplified loop
│ ├── GameState.ts # Holds entities, gold, population, etc.
│ └── SaveManager.ts # Handles localStorage (save/load)
├── rendering/
│ ├── Renderer.ts # PixiJS setup, Scene Graph, Draw calls
│ ├── Camera.ts # Camera panning, zooming, clamping
│ └── FogRenderer.ts # Rendering fog of war
├── input/
│ ├── InputManager.ts # Mouse/Keyboard listeners, raycasting
│ └── SelectionManager.ts # Box selection, grouping logic
├── map/
│ ├── MapGenerator.ts # Simplex noise, stone/resource placement
│ ├── Pathfinding.ts # NavGrid, PF.AStarFinder logic
│ └── FogManager.ts # Visibility logic (math, not rendering)
├── systems/ # Game Logic loops
│ ├── AISystem.ts # Enemy AI logic
│ ├── CombatSystem.ts # Projectiles, damage, targeting
│ ├── MovementSystem.ts # Path following, steering, avoidance
│ └── EconomySystem.ts # Mining, passive gold, building
└── ui/
└── UIManager.ts # DOM manipulation, menus, HUD 3. Step-by-Step Refactoring StrategyStep 1: Decouple the UI (DOM Manipulation)Problem: Game directly accesses the DOM (document.getElementById).Action: 1. Create src/ui/UIManager.ts.2. Move all \_bindMenuUI, \_hideMenu, updateUI, and \_refreshTrainingProgress logic here.3. Use an Event Emitter or Callbacks to communicate from the UI back to the Game (e.g., uiManager.onStartPlacement((type) => game.startPlacement(type))).Step 2: Extract Rendering (PixiJS) and CameraProblem: Scene graph setup, textures, and update logic are mixed with game rules.Action:Create src/rendering/Renderer.ts. Move \_buildSceneGraph, \_drawEntities, \_drawProjectiles, etc., into this class.The Renderer should take the GameState as an argument and blindly draw what it sees.Extract \_clampCamera and \_applyCamera into a dedicated src/rendering/Camera.ts class.Step 3: Isolate Input & Selection LogicProblem: Pointer events and keyboard events clutter the initialization.Action:Create src/input/InputManager.ts. Move \_setupInputs, drag selection tracking, and right-click interpretation here.The InputManager will translate raw DOM events into game commands (e.g., emit('COMMAND_MOVE', { x, y, entities })).Move controlGroups and selectedIds logic to a SelectionManager.Step 4: Extract Map Generation & PathfindingProblem: \_generateMap and \_computePath are massive functions inside Game.Action:Create src/map/MapGenerator.ts. Move the simplex-noise logic and spawn calculations here. It should return a static stoneGrid and spawn points.Create src/map/Pathfinding.ts to encapsulate PF.Grid and PF.AStarFinder. Expose a clean findPath(start, end, grid) method.Step 5: Refactor the Update Loop into SystemsProblem: The update(dt) method handles AI, steering, combat, and mining all at once.Action:Break update(dt) into distinct systems that iterate over entities.MovementSystem: Handles \_computePath, collision resolution (\_resolveWorldCollisions), and avoidance forces.CombatSystem: Handles attacking state, projectile spawning, and damage application.EconomySystem: Handles passive gold ticking and mining state logic.AISystem: Move \_updateAI into its own file.Step 6: Consolidate StateProblem: Game variables (entities, gold, aiTimers, techs) are loose properties on the Game class.Action:Create a GameState class or interface.Pass this state object to the respective systems and renderers. This creates a clean boundary between Data and Logic.4. Key Design Patterns to ImplementObserver Pattern (Event Emitter): Use for UI/Game communication. Instead of the UI updating the game state directly, the UI emits a onTrainUnit event, which the EconomySystem listens for.Dependency Injection (DI): Instead of instantiating everything inside Game, instantiate managers in a bootstrap function and inject them.const state = new GameState();
const renderer = new Renderer(app);
const ui = new UIManager();
const game = new GameLoop(state, renderer, ui);
State Machine: Explicitly define the Entity states (idle, moving, mining, attacking) using a Typescript enum or discriminated union rather than magic strings, moving the state transitions into dedicated functions.5. Execution Order SummaryTo prevent breaking the game during the rewrite, execute the refactor in this order:Extract UIManager (Safest, purely visual/DOM).Extract SaveManager.Extract MapGenerator & Pathfinding.Extract Camera and InputManager.Extract Renderer.Split remaining Game.update() into logic Systems.
