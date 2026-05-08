import * as PIXI from 'pixi.js';
import { CONSTANTS, DIFFICULTY, SPAWN_POINTS, STATS, UNIT_SPRITES } from '../constants';
import type { Difficulty, SubType } from '../constants';
import { Entity } from '../entity';
import { Projectile } from '../projectile';
import { Audio } from '../audio';
import { dist, worldToIso, isoToWorld } from '../utils';
import type { Effect, FloatingText, IGameContext } from '../types';
import { playerStore } from '../store';

import { GameState } from './GameState';
import { SaveManager } from './SaveManager';
import type { IGameAdapter } from './IGameAdapter';

import { Renderer } from '../rendering/Renderer';
import { Camera } from '../rendering/Camera';

import { UIManager } from '../ui/UIManager';
import type { UICallbacks } from '../ui/UIManager';

import { InputManager } from '../input/InputManager';
import { SelectionManager } from '../input/SelectionManager';

import { generateMap } from '../map/MapGenerator';
import { Pathfinding } from '../map/Pathfinding';
import { FogManager } from '../map/FogManager';

import { updateMovement } from '../systems/MovementSystem';
import { updateCombat } from '../systems/CombatSystem';
import { updateEconomy } from '../systems/EconomySystem';
import { updateAI } from '../systems/AISystem';

// ── Factory ───────────────────────────────────────────────────────────────────

export class Game implements IGameContext, IGameAdapter {
    readonly TEAM_PLAYER = CONSTANTS.TEAM_PLAYER;

    private app: PIXI.Application;
    private state: GameState;
    private renderer: Renderer;
    private camera: Camera;
    private uiManager: UIManager;
    private saveManager: SaveManager;
    private pathfinding: Pathfinding;
    private fogManager: FogManager;
    private inputManager: InputManager;
    private selectionManager: SelectionManager;

    private mouseScreenX = window.innerWidth  / 2;
    private mouseScreenY = window.innerHeight / 2;
    private _pendingSeed: number | null = null;

    static async create(): Promise<Game> {
        const app = new PIXI.Application();
        await app.init({
            background: 0x111827,
            antialias:  true,
            resizeTo:   window,
        });
        document.body.insertBefore(app.canvas, document.body.firstChild);
        app.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;touch-action:none;z-index:0;';
        const spriteUrls = [...new Set(Object.values(UNIT_SPRITES).filter(Boolean).map(s => s!.file))];
        const tileIndices = [16, 17, 18, 19, 40, 41, 42, 43];
        await Promise.all([
            ...spriteUrls.map(url => PIXI.Assets.load({ src: url, data: { scaleMode: 'nearest' } })),
            ...tileIndices.map(i => PIXI.Assets.load({ src: `tiles/tile_${String(i).padStart(3, '0')}.png`, data: { scaleMode: 'nearest' } })),
        ]);
        return new Game(app);
    }

    private constructor(app: PIXI.Application) {
        this.app             = app;
        this.state           = new GameState();
        this.renderer        = new Renderer();
        this.camera          = new Camera();
        this.uiManager       = new UIManager();
        this.saveManager     = new SaveManager();
        this.pathfinding     = new Pathfinding();
        this.fogManager      = new FogManager();
        this.inputManager    = new InputManager();
        this.selectionManager = new SelectionManager();

        this.renderer.buildSceneGraph(app.stage);
        window.addEventListener('mousemove', e => { this.mouseScreenX = e.clientX; this.mouseScreenY = e.clientY; });

        this.uiManager.bindMenuUI({
            onNewGame:  () => { this.saveManager.clear(); this.uiManager.hideMenu(); this.init(false); },
            onContinue: () => { if (this.saveManager.hasSave()) { this.uiManager.hideMenu(); this.init(true); } },
            onRestart:  () => { this.saveManager.clear(); this.init(false); },
            onMenu:     () => this.uiManager.showMenu(),
        });

        this._setupInput();

        window.addEventListener('resize', () => this.camera.clamp());

        app.ticker.add(() => {
            const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000);
            this._update(dt);
            this._draw();
        });
    }

    // ── IGameContext / IGameAdapter ───────────────────────────────────────────

    addGold(team: number, amount: number): void {
        if (team < 0 || team >= this.state.gold.length) return;
        this.state.gold[team] += amount;
        if (team === CONSTANTS.TEAM_PLAYER) this._syncPlayerStore();
    }

    createFloatingText(text: string, x: number, y: number, color: string): void {
        const iso = worldToIso(x, y);
        const ft: FloatingText = { text, x: iso.x, y: iso.y, alpha: 1, color, isDead: false };
        this.state.floatingTexts.push(ft);
        this.renderer.addFloatingText(ft);
    }

    addEntity(type: Entity['type'], subType: SubType, x: number, y: number, team: number): Entity {
        const e = new Entity(this, this.state.nextId++, type, subType, x, y, team);
        this.state.entities.push(e);
        this.renderer.createEntityDisplay(e);
        if (type === 'unit' && team >= 0 && team < this.state.population.length) {
            this.state.population[team]++;
            if (team === CONSTANTS.TEAM_PLAYER) this._syncPlayerStore();
        }
        if (subType === 'soldier' && team === CONSTANTS.TEAM_PLAYER && this.state.techs.has('soldier_hp')) {
            e.maxHp += 80; e.hp = e.maxHp;
        }
        if (type === 'building' && this.pathfinding)
            this.rebuildNavGrid();
        return e;
    }

    notify(msg: string, color = 'text-white'): void {
        this.uiManager.notify(msg, color);
    }

    recomputeMaxPop(team: number): void {
        if (team < 0 || team >= this.state.maxPop.length) return;
        this.state.maxPop[team] = this.state.entities
            .filter(e => e.team === team && e.type === 'building' && !e.isConstructing && !e.isDead)
            .reduce((sum, e) => sum + (STATS[e.subType].popCap ?? 0), 0);
        if (team === CONSTANTS.TEAM_PLAYER) this._syncPlayerStore();
    }

    rebuildNavGrid(): void {
        if (this.state.stoneGrid)
            this.pathfinding.rebuild(this.state.entities, this.state.stoneGrid, this.state.mapCellSize);
    }

    trainUnit(building: Entity, type: SubType): boolean {
        if (building.buildQueue.length >= 5) {
            if (building.team === CONSTANTS.TEAM_PLAYER) this.notify('Queue full!', 'text-orange-400');
            return false;
        }
        const cost = STATS[type].cost;
        if (this.state.gold[building.team] < cost) {
            if (building.team === CONSTANTS.TEAM_PLAYER) this.notify('Low Gold!', 'text-red-400');
            return false;
        }
        this.state.gold[building.team] -= cost;
        const wasEmpty = building.buildQueue.length === 0;
        building.buildQueue.push(type);
        if (wasEmpty) building.timer = STATS[type].buildTime ?? 10;
        if (building.team === CONSTANTS.TEAM_PLAYER) {
            this._syncPlayerStore();
            this._refreshTrainingProgress();
        }
        return true;
    }

    // ── Helpers (public surface used by input) ─────────────────────────────────

    handleRightClick(wx: number, wy: number): void {
        if (!this.state.selectedIds.size) return;
        const units = this._getSelectedEntities().filter(e => e.type === 'unit');
        if (!units.length) return;
        const clicked = this.selectionManager.getEntityAt(wx, wy, this.state.entities);
        if (clicked) {
            if (clicked.team !== 0) {
                units.forEach(u => { u.target = clicked; u.state = 'moving_to_attack'; u.waypoints = null; });
                this._createEffect(clicked.x, clicked.y, clicked.type === 'resource' ? '#fbbf24' : '#ef4444');
            } else if (clicked.isConstructing) {
                units.filter(u => u.subType === 'builder').forEach(u => { u.target = clicked; u.state = 'moving_to_build'; u.waypoints = null; });
                this._createEffect(clicked.x, clicked.y, '#3b82f6');
            } else {
                this._formationMove(units, wx, wy);
                this._createEffect(wx, wy, '#4ade80');
            }
        } else {
            this._formationMove(units, wx, wy);
            this._createEffect(wx, wy, '#4ade80');
        }
        Audio.ack();
    }

    selectAllUnits(): void {
        this.selectionManager.selectAllUnits(this.state.entities, this.state.selectedIds);
        this.updateUI();
    }

    startPlacement(type: SubType): void {
        this.state.placementMode = type;
        document.getElementById('placementHint')!.classList.remove('hidden');
        document.getElementById('actionMenu')!.classList.add('hidden');
    }

    cancelPlacement(): void {
        this.state.placementMode = null;
        document.getElementById('placementHint')!.classList.add('hidden');
        document.getElementById('actionMenu')!.classList.remove('hidden');
    }

    updateUI(): void {
        const sel = this._getSelectedEntities();
        this._refreshTrainingProgress();
        const uiCallbacks: UICallbacks = {
            onTrainUnit:       (b, type) => { this.trainUnit(b, type); this.updateUI(); },
            onStartPlacement:  (type)    => this.startPlacement(type),
            onResearchTech:    (key, cost) => this._researchTech(key, cost),
            onStanceChange:    (units, stance) => { units.forEach(u => u.stance = stance); },
        };
        this.uiManager.updateUI(sel, this.state.techs, uiCallbacks);
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    init(loadSave: boolean): void {
        this.state.gamePhase = 'playing';
        const s = this.state;

        s.aiCount = this.uiManager.aiCount;
        s.diff    = DIFFICULTY[this.uiManager.difficulty];

        s.gold       = Array.from({ length: s.aiCount + 1 }, () => 1000);
        s.population = Array.from({ length: s.aiCount + 1 }, () => 0);
        s.maxPop     = Array.from({ length: s.aiCount + 1 }, () => 0);
        s.aiTimers   = Array.from({ length: s.aiCount },     () => 0);

        s.entities = []; s.projectiles = []; s.effects = [];
        s.floatingTexts = []; s.nextId = 1;
        s.selectedIds = new Set();
        s.dragSelect = null; s.placementMode = null;
        s.passiveGoldTimer = 0;
        s.controlGroups.clear();
        s.techs = new Set();
        s.stoneGrid = null; s.mapSeed = null;
        s.pointers.clear();

        this.renderer.clearEntityDisplays();
        this.renderer.clearTextDisplays();
        this.renderer.clearTileLayer();
        this.renderer.clearFog();

        if (loadSave && this.saveManager.hasSave()) {
            try { this._loadState(); return; } catch { console.warn('Save corrupt, starting fresh.'); }
        }

        const ps = SPAWN_POINTS[0];
        this.addEntity('building', 'town_center', ps.x, ps.y, 0);
        for (let i = 0; i < 3; i++)
            this.addEntity('unit', 'builder', ps.x + 80, ps.y + (i - 1) * 50, 0);

        for (let ai = 1; ai <= s.aiCount; ai++) {
            const sp = SPAWN_POINTS[ai];
            this.addEntity('building', 'town_center', sp.x, sp.y, ai);
            for (let i = 0; i < 3; i++)
                this.addEntity('unit', 'builder', sp.x - 80, sp.y + (i - 1) * 50, ai);
        }

        const seed = this._pendingSeed ?? Date.now();
        this._pendingSeed = null;
        s.mapSeed = seed;
        this._generateMap(seed);

        this.camera.x = ps.x; this.camera.y = ps.y;
        this.camera.clamp();
        for (let t = 0; t <= s.aiCount; t++) this.recomputeMaxPop(t);
        this._syncPlayerStore(); this.updateUI();
        this.uiManager.updateOpponentsHUD(this._aliveAITCCount());
        this._saveState();
        Audio.startWind();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private get _canvasWidth()  { return this.app.canvas.width; }
    private get _canvasHeight() { return this.app.canvas.height; }

    private _syncPlayerStore(): void {
        playerStore.setState({
            gold:       this.state.gold[0],
            population: this.state.population[0] ?? 0,
            maxPop:     this.state.maxPop[0]     ?? 0,
        });
    }

    private _getSelectedEntities(): Entity[] {
        return this.state.entities.filter(e => this.state.selectedIds.has(e.id));
    }

    private _createEffect(x: number, y: number, color: string): void {
        this.state.effects.push({ x, y, radius: 0, color, alpha: 1, isDead: false });
    }

    private _formationMove(units: Entity[], tx: number, ty: number): void {
        const rows = Math.ceil(Math.sqrt(units.length)), spacing = 35;
        const sx = tx - (rows * spacing) / 2, sy = ty - (rows * spacing) / 2;
        units.forEach((u, i) => {
            u.targetX = sx + (i % rows) * spacing;
            u.targetY = sy + Math.floor(i / rows) * spacing;
            u.target = null; u.state = 'moving'; u.waypoints = null;
        });
    }

    private _isOnStone(wx: number, wy: number, r: number): boolean {
        const { stoneGrid, mapCellSize: C } = this.state;
        if (!stoneGrid?.length) return false;
        const cols = stoneGrid[0].length, rows = stoneGrid.length;
        const minCx = Math.max(0, Math.floor((wx - r) / C));
        const maxCx = Math.min(cols - 1, Math.floor((wx + r) / C));
        const minCy = Math.max(0, Math.floor((wy - r) / C));
        const maxCy = Math.min(rows - 1, Math.floor((wy + r) / C));
        for (let cy = minCy; cy <= maxCy; cy++)
            for (let cx = minCx; cx <= maxCx; cx++)
                if (stoneGrid[cy][cx]) return true;
        return false;
    }

    private _isBlockedPlacement(wx: number, wy: number, type: SubType): boolean {
        const r = STATS[type].radius;
        if (this._isOnStone(wx, wy, r)) return true;
        for (const e of this.state.entities)
            if ((e.type === 'building' || e.type === 'resource') && dist(wx, wy, e.x, e.y) < r + e.radius + 5)
                return true;
        return false;
    }

    private _generateMap(seed: number): void {
        const { stoneGrid, mapCellSize, mines } = generateMap(seed, this.state.aiCount);
        this.state.stoneGrid   = stoneGrid;
        this.state.mapCellSize = mapCellSize;
        this.pathfinding.init(stoneGrid, mapCellSize);
        this.fogManager.init();
        this.renderer.buildTileLayer(stoneGrid, mapCellSize);
        for (const { wx, wy } of mines)
            this.addEntity('resource', 'gold_mine', Math.round(wx / 20) * 20, Math.round(wy / 20) * 20, -1);
    }

    private _setupInput(): void {
        this.inputManager.setup(
            this.app.canvas,
            this.state,
            this.camera,
            () => ({ width: this._canvasWidth, height: this._canvasHeight }),
            {
                onRightClick: (wx, wy) => this.handleRightClick(wx, wy),
                onTap:        (wx, wy) => this._handleTap(wx, wy),
                onBoxSelectDone: () => {
                    if (this.state.dragSelect)
                        this.selectionManager.performBoxSelect(this.state.dragSelect, this.state.entities, this.state.selectedIds);
                    this.updateUI();
                },
                onControlGroupSave: (digit) => {
                    this.state.controlGroups.set(digit, [...this.state.selectedIds]);
                    this.notify(`Group ${digit} saved`, 'text-gray-400');
                },
                onControlGroupRecall: (digit, doubleTap) => {
                    const ids = this.state.controlGroups.get(digit);
                    if (!ids || ids.length === 0) return;
                    const alive = ids.filter(id => this.state.entities.some(en => en.id === id && !en.isDead));
                    this.state.selectedIds = new Set(alive);
                    if (doubleTap && this.state.selectedIds.size > 0) {
                        const members = this.state.entities.filter(en => this.state.selectedIds.has(en.id));
                        this.camera.x = members.reduce((s, en) => s + en.x, 0) / members.length;
                        this.camera.y = members.reduce((s, en) => s + en.y, 0) / members.length;
                        this.camera.clamp();
                    }
                    this.updateUI();
                },
            },
        );
    }

    private _handleTap(wx: number, wy: number): void {
        const s = this.state;
        if (s.placementMode) {
            const sx = Math.round(wx / 20) * 20, sy = Math.round(wy / 20) * 20;
            if (s.gold[0] < STATS[s.placementMode].cost) { this.notify('Not enough gold!', 'text-red-400'); this.cancelPlacement(); return; }
            if (this._isBlockedPlacement(sx, sy, s.placementMode)) { this.notify("Can't build here!", 'text-red-400'); return; }
            const bldrs = this._getSelectedEntities().filter(e => e.subType === 'builder');
            if (bldrs.length > 0) {
                s.gold[0] -= STATS[s.placementMode].cost; this._syncPlayerStore();
                const b = this.addEntity('building', s.placementMode, sx, sy, 0);
                b.isConstructing = true; b.hp = 1;
                bldrs.forEach(u => { u.target = b; u.state = 'moving_to_build'; u.waypoints = null; });
                this.cancelPlacement();
            }
            return;
        }
        const clicked = this.selectionManager.getEntityAt(wx, wy, s.entities);
        const now = performance.now();
        if (clicked && clicked.team === 0) {
            if (now - this._lastClickTime < 300 && this._lastClickedId === clicked.id) {
                s.selectedIds.clear();
                s.entities.forEach(e => {
                    if (e.team === 0 && e.subType === clicked.subType &&
                        dist(e.x, e.y, this.camera.x, this.camera.y) < this._canvasWidth / this.camera.zoom)
                        s.selectedIds.add(e.id);
                });
            } else {
                s.selectedIds.clear(); s.selectedIds.add(clicked.id);
            }
            this._lastClickTime = now; this._lastClickedId = clicked.id;
        } else {
            s.selectedIds.clear();
        }
        this.updateUI();
    }

    private _lastClickTime = 0;
    private _lastClickedId: number | null = null;

    // ── Update ────────────────────────────────────────────────────────────────

    private _update(dt: number): void {
        if (this.state.gamePhase !== 'playing') return;
        const s = this.state;

        // Edge scroll
        const EDGE = 48, EDGE_SPEED = 900;
        const { mouseScreenX: mx, mouseScreenY: my } = this;
        const W = this._canvasWidth, H = this._canvasHeight;
        let ex = 0, ey = 0;
        if (mx <= EDGE) ex = -1 * (1 - mx / EDGE);
        else if (mx >= W - EDGE) ex = (mx - (W - EDGE)) / EDGE;
        if (my <= EDGE) ey = -1 * (1 - my / EDGE);
        else if (my >= H - EDGE) ey = (my - (H - EDGE)) / EDGE;
        if (ex !== 0 || ey !== 0) {
            const wd = isoToWorld(ex * EDGE_SPEED * dt / this.camera.zoom, ey * EDGE_SPEED * dt / this.camera.zoom);
            this.camera.x += wd.x;
            this.camera.y += wd.y;
            this.camera.clamp();
        }

        // Passive gold
        s.passiveGoldTimer += dt;
        if (s.passiveGoldTimer >= 1.0) {
            for (let t = 0; t < s.gold.length; t++) s.gold[t] += 1.5;
            s.passiveGoldTimer = 0; this._syncPlayerStore();
        }

        // AI ticks
        for (let ai = 1; ai <= s.aiCount; ai++) {
            s.aiTimers[ai - 1] -= dt;
            if (s.aiTimers[ai - 1] <= 0) {
                s.aiTimers[ai - 1] = s.diff.tickRate;
                updateAI(ai, s.entities, s.gold, s.diff, this);
            }
        }

        // Entity timers
        for (const e of s.entities) if (e.timer > 0) e.timer -= dt;

        // Systems
        updateMovement(s.entities, dt, this.pathfinding, s.stoneGrid, s.mapCellSize, this);
        s.projectiles = updateCombat(
            s.entities, s.projectiles, dt, s.techs,
            this.camera.x, this.camera.y,
            this.camera.viewRadius(this._canvasWidth, this._canvasHeight),
        );
        updateEconomy(s.entities, s.gold, s.population, s.maxPop, dt, s.techs, this);

        // Dead entity cleanup
        let tcDied = false, navDirty = false;
        const deadBuildingTeams = new Set<number>();
        for (let i = s.entities.length - 1; i >= 0; i--) {
            const dead = s.entities[i];
            if (!dead.isDead) continue;
            if (dead.subType === 'town_center') tcDied = true;
            if (dead.type === 'building') { navDirty = true; deadBuildingTeams.add(dead.team); }
            if (dead.type === 'unit' && dead.team >= 0 && dead.team < s.population.length) {
                s.population[dead.team] = Math.max(0, s.population[dead.team] - 1);
                if (dead.team === CONSTANTS.TEAM_PLAYER) this._syncPlayerStore();
            }
            s.selectedIds.delete(dead.id);
            this.renderer.removeEntityDisplay(dead.id);
            s.entities.splice(i, 1);
        }
        if (navDirty) this.rebuildNavGrid();
        for (const team of deadBuildingTeams) this.recomputeMaxPop(team);
        if (tcDied) this._checkWinCondition();

        // Effects
        s.effects.forEach(ef => { ef.radius += 80 * dt; ef.alpha -= 2 * dt; if (ef.alpha <= 0) ef.isDead = true; });
        s.effects = s.effects.filter(ef => !ef.isDead);

        // Floating texts
        s.floatingTexts.forEach(ft => { ft.y -= 40 * dt; ft.alpha -= 1 * dt; if (ft.alpha <= 0) ft.isDead = true; });
        this.renderer.tickFloatingTexts(s.floatingTexts);
        s.floatingTexts = s.floatingTexts.filter(ft => !ft.isDead);

        this.fogManager.update(s.entities);
        this._refreshTrainingProgress();
    }

    private _checkWinCondition(): void {
        const tcs = this.state.entities.filter(e => e.subType === 'town_center');
        const playerAlive = tcs.some(e => e.team === 0);
        const aiAlive     = tcs.some(e => e.team !== 0);
        this.uiManager.updateOpponentsHUD(this._aliveAITCCount());
        if (!playerAlive) { this._endGame(false); return; }
        if (!aiAlive)     { this._endGame(true);  return; }
    }

    private _aliveAITCCount(): number {
        return this.state.entities.filter(e => e.subType === 'town_center' && e.team !== 0).length;
    }

    private _endGame(win: boolean): void {
        this.state.gamePhase = 'gameover';
        Audio.stopWind();
        this.saveManager.clear();
        document.getElementById('gameOverScreen')!.classList.remove('hidden');
        const title = document.getElementById('gameOverTitle')!;
        const desc  = document.getElementById('gameOverDesc')!;
        if (win) {
            title.innerText = 'VICTORY'; title.className = 'text-5xl font-black mb-2 tracking-tight text-blue-400';
            desc.innerText = 'All enemies have been crushed.';
        } else {
            title.innerText = 'DEFEAT'; title.className = 'text-5xl font-black mb-2 tracking-tight text-red-500';
            desc.innerText = 'Your Town Center was destroyed.';
        }
    }

    private _refreshTrainingProgress(): void {
        const sel = this._getSelectedEntities();
        const b   = sel.length === 1 && sel[0].team === 0 && sel[0].type === 'building' ? sel[0] : null;
        this.uiManager.refreshTrainingProgress(b, this.state.population[0] ?? 0, this.state.maxPop[0] ?? 0);
    }

    private _researchTech(key: string, cost: number): void {
        if (this.state.gold[0] < cost) { this.notify('Not enough gold!', 'text-red-400'); return; }
        this.state.gold[0] -= cost;
        this.state.techs.add(key);
        this._syncPlayerStore();
        if (key === 'soldier_hp') {
            this.state.entities
                .filter(e => e.team === 0 && e.subType === 'soldier' && !e.isDead)
                .forEach(e => { e.maxHp += 80; e.hp = Math.min(e.hp + 80, e.maxHp); });
        }
        const labels: Record<string, string> = { mining_efficiency: 'Mining Speed', archer_damage: 'Archer Dmg', soldier_hp: 'Soldier HP' };
        this.notify(`${labels[key] ?? key} researched!`, 'text-blue-400');
        this.updateUI();
    }

    // ── Draw ──────────────────────────────────────────────────────────────────

    private _draw(): void {
        if (this.state.gamePhase !== 'playing') return;
        const s = this.state;
        this.renderer.draw(
            s.entities, s.projectiles, s.effects, s.selectedIds,
            s.dragSelect, s.placementMode,
            this.mouseScreenX, this.mouseScreenY,
            this.camera, this._canvasWidth, this._canvasHeight,
            this.fogManager,
            (wx, wy, type) => this._isBlockedPlacement(wx, wy, type),
        );
    }

    // ── Save / Load ───────────────────────────────────────────────────────────

    private _saveState(): void {
        this.saveManager.save({
            difficulty: this.uiManager.difficulty,
            aiCount:    this.uiManager.aiCount,
            mapSeed:    this.state.mapSeed,
        });
        this.uiManager.markSaveExists(true);
    }

    private _loadState(): void {
        const data = this.saveManager.load();
        if (!data) throw new Error('No save');
        this.uiManager.applySettings(data.difficulty ?? 'medium', data.aiCount ?? 2);
        this._pendingSeed = data.mapSeed ?? null;
        this.init(false);
    }
}
