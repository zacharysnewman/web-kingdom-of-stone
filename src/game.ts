import * as PIXI from 'pixi.js';
import { createNoise2D } from 'simplex-noise';
import PF from 'pathfinding';
import { Audio } from './audio';
import {
    CONSTANTS, TEAM_COLORS, DIFFICULTY, STATS, SPAWN_POINTS,
    type Difficulty, type DifficultyConfig, type SubType,
} from './constants';
import { Entity } from './entity';
import { Projectile } from './projectile';
import { dist, angle, mulberry32 } from './utils';
import type { Effect, FloatingText, DragSelect, PointerState, IGameContext } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const FOG_CELL   = 80;
const FOG_SIGHT  = 260; // world-px radius a unit reveals
const FOG_ALPHA  = 0.88;

function hexColor(css: string): number {
    return parseInt(css.replace('#', ''), 16);
}

// ── Game ──────────────────────────────────────────────────────────────────────

export class Game implements IGameContext {
    readonly TEAM_PLAYER = CONSTANTS.TEAM_PLAYER;

    private app: PIXI.Application;

    // PixiJS scene graph layers (world space inside worldContainer)
    private worldContainer!: PIXI.Container;
    private gridGfx!: PIXI.Graphics;
    private stoneGfx!: PIXI.Graphics;
    private entityLayer!: PIXI.Container;
    private projectileGfx!: PIXI.Graphics;
    private effectGfx!: PIXI.Graphics;
    private textLayer!: PIXI.Container;
    private fogGfx!: PIXI.Graphics;   // fog overlay (updated when fogDirty)
    private ghostGfx!: PIXI.Graphics; // placement ghost
    private dragGfx!: PIXI.Graphics;  // drag-select box

    // Per-entity display containers  keyed by entity id
    private entityDisplays = new Map<number, PIXI.Container>();
    // Per-floating-text display objects
    private textDisplays = new Map<FloatingText, PIXI.Text>();

    private camera = { x: 0, y: 0, zoom: 0.75 };
    private _inputController: AbortController | null = null;
    private pointers = new Map<number, PointerState>();
    private lastClickTime = 0;
    private lastClickedId: number | null = null;
    private settings: { difficulty: Difficulty; aiCount: number } = { difficulty: 'medium', aiCount: 2 };
    private state: 'menu' | 'playing' | 'gameover' = 'menu';

    private mouseScreenX = window.innerWidth  / 2;
    private mouseScreenY = window.innerHeight / 2;

    // Game state — initialised in init()
    private gold: number[] = [];
    private aiTimers: number[] = [];
    private aiCount = 0;
    private diff!: DifficultyConfig;
    private entities: Entity[] = [];
    private projectiles: Projectile[] = [];
    private effects: Effect[] = [];
    private floatingTexts: FloatingText[] = [];
    private nextId = 1;
    private selectedIds = new Set<number>();
    private dragSelect: DragSelect | null = null;
    private placementMode: SubType | null = null;
    private passiveGoldTimer = 0;
    private stoneGrid: boolean[][] | null = null;
    private mapCellSize = 0;
    private navGrid: PF.Grid | null = null;
    private navFinder: PF.AStarFinder | null = null;
    private mapSeed: number | null = null;
    private lastTime = 0;
    private _pendingSeed: number | null = null;

    // Fog of war
    private fogGrid: boolean[][] = [];
    private fogDirty = false;
    private fogCols = 0;
    private fogRows = 0;

    // ── Factory ───────────────────────────────────────────────────────────────

    static async create(): Promise<Game> {
        const app = new PIXI.Application();
        await app.init({
            background: 0x111827,
            antialias:  true,
            resizeTo:   window,
        });
        // Insert canvas before the first UI element so it sits beneath the HUD
        document.body.insertBefore(app.canvas, document.body.firstChild);
        app.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;touch-action:none;z-index:0;';
        return new Game(app);
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    private constructor(app: PIXI.Application) {
        this.app = app;
        this._buildSceneGraph();
        window.addEventListener('mousemove', e => { this.mouseScreenX = e.clientX; this.mouseScreenY = e.clientY; });
        this._bindMenuUI();
        this._setupInputs();
        // PixiJS handles its own resize via resizeTo:window; keep camera clamped
        window.addEventListener('resize', () => this._clampCamera());
        app.ticker.add(() => {
            const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000);
            this.update(dt);
            this.draw();
        });
    }

    // ── Scene graph setup ─────────────────────────────────────────────────────

    private _buildSceneGraph(): void {
        this.worldContainer  = new PIXI.Container();
        this.gridGfx         = new PIXI.Graphics();
        this.stoneGfx        = new PIXI.Graphics();
        this.entityLayer     = new PIXI.Container();
        this.projectileGfx   = new PIXI.Graphics();
        this.effectGfx       = new PIXI.Graphics();
        this.textLayer       = new PIXI.Container();
        this.fogGfx          = new PIXI.Graphics();
        this.ghostGfx        = new PIXI.Graphics();
        this.dragGfx         = new PIXI.Graphics();

        this.worldContainer.addChild(
            this.gridGfx,
            this.stoneGfx,
            this.entityLayer,
            this.projectileGfx,
            this.effectGfx,
            this.textLayer,
            this.fogGfx,
            this.ghostGfx,
            this.dragGfx,
        );
        this.app.stage.addChild(this.worldContainer);

        // Draw map border and grid lines once (static)
        this._drawGrid();
    }

    private _drawGrid(): void {
        const g = this.gridGfx;
        g.clear();
        const MS = CONSTANTS.MAP_SIZE;

        for (let i = 0; i <= MS; i += 20) {
            g.moveTo(i, 0).lineTo(i, MS);
            g.moveTo(0, i).lineTo(MS, i);
        }
        g.stroke({ color: 0xffffff, alpha: 0.04, width: 1 });

        for (let i = 0; i <= MS; i += 200) {
            g.moveTo(i, 0).lineTo(i, MS);
            g.moveTo(0, i).lineTo(MS, i);
        }
        g.stroke({ color: 0xffffff, alpha: 0.12, width: 1 });

        g.rect(0, 0, MS, MS).stroke({ color: 0x334155, width: 5 });
    }

    private _drawStone(): void {
        if (!this.stoneGrid) return;
        const g   = this.stoneGfx;
        const C   = this.mapCellSize;
        const pad = 3;
        g.clear();
        for (let cy = 0; cy < this.stoneGrid.length; cy++)
            for (let cx = 0; cx < this.stoneGrid[cy].length; cx++)
                if (this.stoneGrid[cy][cx])
                    g.roundRect(cx * C + pad, cy * C + pad, C - pad * 2, C - pad * 2, 5)
                     .fill({ color: 0x374151 })
                     .stroke({ color: 0x4b5563, width: 1.5 });
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    private _bindMenuUI(): void {
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.difficulty = (btn as HTMLElement).dataset['diff'] as Difficulty;
                document.querySelectorAll('.diff-btn').forEach(b => {
                    b.classList.remove('bg-blue-700', 'ring-2', 'ring-blue-400', 'hover:bg-blue-600');
                    b.classList.add('bg-gray-800', 'hover:bg-gray-700');
                });
                btn.classList.remove('bg-gray-800', 'hover:bg-gray-700');
                btn.classList.add('bg-blue-700', 'ring-2', 'ring-blue-400', 'hover:bg-blue-600');
            });
        });

        const slider = document.getElementById('aiCountSlider') as HTMLInputElement;
        const label  = document.getElementById('aiCountLabel')!;
        slider.addEventListener('input', () => {
            this.settings.aiCount = parseInt(slider.value);
            label.textContent = slider.value;
        });

        document.getElementById('newGameBtn')!.addEventListener('click', () => {
            localStorage.removeItem('kosave');
            this._hideMenu();
            this.init(false);
        });

        const contBtn = document.getElementById('continueBtn') as HTMLButtonElement;
        if (localStorage.getItem('kosave')) contBtn.removeAttribute('disabled');
        else contBtn.setAttribute('disabled', '');
        contBtn.addEventListener('click', () => {
            if (!localStorage.getItem('kosave')) return;
            this._hideMenu();
            this.init(true);
        });

        document.getElementById('restartBtn')!.addEventListener('click', () => {
            document.getElementById('gameOverScreen')!.classList.add('hidden');
            localStorage.removeItem('kosave');
            this.init(false);
        });
        document.getElementById('menuBtn')!.addEventListener('click', () => {
            document.getElementById('gameOverScreen')!.classList.add('hidden');
            this._showMenu();
        });
    }

    private _hideMenu(): void { document.getElementById('mainMenu')!.classList.add('hidden'); }
    private _showMenu(): void {
        document.getElementById('mainMenu')!.classList.remove('hidden');
        const contBtn = document.getElementById('continueBtn') as HTMLButtonElement;
        if (localStorage.getItem('kosave')) contBtn.removeAttribute('disabled');
        else contBtn.setAttribute('disabled', '');
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    init(loadSave: boolean): void {
        this.state = 'playing';
        this.lastTime = performance.now();
        this.aiCount  = this.settings.aiCount;
        this.diff     = DIFFICULTY[this.settings.difficulty];

        this.gold     = Array.from({ length: this.aiCount + 1 }, () => 1000);
        this.aiTimers = Array.from({ length: this.aiCount }, () => 0);

        this.entities = []; this.projectiles = []; this.effects = [];
        this.floatingTexts = []; this.nextId = 1;
        this.selectedIds = new Set();
        this.dragSelect = null; this.placementMode = null;
        this.passiveGoldTimer = 0;
        this.stoneGrid = null; this.mapSeed = null;
        this.pointers.clear();

        // Clear display objects from previous game
        this.entityLayer.removeChildren();
        this.textLayer.removeChildren();
        this.entityDisplays.clear();
        this.textDisplays.clear();
        this.stoneGfx.clear();
        this.fogGfx.clear();

        if (loadSave && localStorage.getItem('kosave')) {
            try { this._loadState(); return; } catch { console.warn('Save corrupt, starting fresh.'); }
        }

        const ps = SPAWN_POINTS[0];
        this.addEntity('building', 'town_center', ps.x, ps.y, 0);
        for (let i = 0; i < 3; i++)
            this.addEntity('unit', 'builder', ps.x + 80, ps.y + (i - 1) * 50, 0);

        for (let ai = 1; ai <= this.aiCount; ai++) {
            const sp = SPAWN_POINTS[ai];
            this.addEntity('building', 'town_center', sp.x, sp.y, ai);
            for (let i = 0; i < 3; i++)
                this.addEntity('unit', 'builder', sp.x - 80, sp.y + (i - 1) * 50, ai);
        }

        const seed = this._pendingSeed ?? Date.now();
        this._pendingSeed = null;
        this.mapSeed = seed;
        this._generateMap(seed);

        this.camera.x = ps.x; this.camera.y = ps.y; this._clampCamera();
        this.updateGoldUI(); this.updateUI(); this._updateOpponentsHUD();
        this._saveState();
        Audio.startWind();
    }

    // ── Camera ────────────────────────────────────────────────────────────────

    private get _canvasWidth()  { return this.app.canvas.width; }
    private get _canvasHeight() { return this.app.canvas.height; }
    private get _viewRadius()   { return Math.max(this._canvasWidth, this._canvasHeight) / this.camera.zoom / 2; }

    private _clampCamera(): void {
        const z = this.camera.zoom;
        const topH    = (document.querySelector('.ui-layer.top-0') as HTMLElement | null)?.offsetHeight ?? 72;
        const bottomH = (document.getElementById('actionMenu')?.closest('.ui-layer') as HTMLElement | null)?.offsetHeight ?? 120;
        const hw = this._canvasWidth  / 2 / z;
        const hh = this._canvasHeight / 2 / z;
        const tw = topH    / z;
        const bw = bottomH / z;
        const half = CONSTANTS.MAP_SIZE / 2;

        this.camera.x = hw >= half
            ? half
            : Math.max(hw, Math.min(CONSTANTS.MAP_SIZE - hw, this.camera.x));

        const usableHH = (this._canvasHeight - topH - bottomH) / 2 / z;
        if (usableHH >= half) {
            this.camera.y = half + (bw - tw) / 2;
        } else {
            this.camera.y = Math.max(hh - tw, Math.min(CONSTANTS.MAP_SIZE - hh + bw, this.camera.y));
        }
    }

    private _applyCamera(): void {
        const { x, y, zoom } = this.camera;
        this.worldContainer.scale.set(zoom);
        this.worldContainer.position.set(
            this._canvasWidth  / 2 - x * zoom,
            this._canvasHeight / 2 - y * zoom,
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    addGold(team: number, amount: number): void {
        if (team < 0 || team >= this.gold.length) return;
        this.gold[team] += amount;
        if (team === CONSTANTS.TEAM_PLAYER) this.updateGoldUI();
    }

    addEntity(type: Entity['type'], subType: SubType, x: number, y: number, team: number): Entity {
        const e = new Entity(this, this.nextId++, type, subType, x, y, team);
        this.entities.push(e);
        this._createEntityDisplay(e);
        if (type === 'building' && this.navGrid)
            this._rebuildNavGrid();
        return e;
    }

    private _createEntityDisplay(e: Entity): void {
        const container = new PIXI.Container();
        container.label = `entity_${e.id}`;
        const shape = new PIXI.Graphics();
        shape.label = 'shape';
        const ring  = new PIXI.Graphics();
        ring.label  = 'ring';
        ring.visible = false;
        const hpBar = new PIXI.Graphics();
        hpBar.label = 'hp';
        hpBar.visible = false;
        container.addChild(ring, shape, hpBar);

        // Resource gold label
        if (e.type === 'resource') {
            const label = new PIXI.Text({ text: '', style: { fill: '#ffffff', fontSize: 12, fontFamily: 'sans-serif', fontWeight: 'bold', align: 'center' } });
            label.label = 'goldLabel';
            label.anchor.set(0.5, 0.5);
            container.addChild(label);
        }

        this.entityLayer.addChild(container);
        this.entityDisplays.set(e.id, container);
    }

    notify(msg: string, color = 'text-white'): void {
        const nc = document.getElementById('notificationCenter')!;
        const el = document.createElement('div');
        el.className = `bg-gray-800/90 border border-gray-600 px-4 py-2 rounded-full text-sm font-bold shadow-lg ${color} transition-all duration-300`;
        el.innerText = msg; nc.appendChild(el);
        setTimeout(() => { el.classList.add('opacity-0'); setTimeout(() => el.remove(), 300); }, 2000);
    }

    private screenToWorld(sx: number, sy: number): { x: number; y: number } {
        return {
            x: (sx - this._canvasWidth  / 2) / this.camera.zoom + this.camera.x,
            y: (sy - this._canvasHeight / 2) / this.camera.zoom + this.camera.y,
        };
    }

    private getEntityAt(wx: number, wy: number): Entity | null {
        for (let i = this.entities.length - 1; i >= 0; i--) {
            const e = this.entities[i];
            if (dist(wx, wy, e.x, e.y) <= e.radius * 1.5) return e;
        }
        return null;
    }

    private getSelectedEntities(): Entity[] { return this.entities.filter(e => this.selectedIds.has(e.id)); }

    createEffect(x: number, y: number, color: string): void {
        this.effects.push({ x, y, radius: 0, color, alpha: 1, isDead: false });
    }

    createFloatingText(text: string, x: number, y: number, color: string): void {
        const ft: FloatingText = { text, x, y, alpha: 1, color, isDead: false };
        this.floatingTexts.push(ft);
        const t = new PIXI.Text({ text, style: { fill: color, fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'bold' } });
        t.anchor.set(0.5, 1);
        t.position.set(x, y);
        this.textLayer.addChild(t);
        this.textDisplays.set(ft, t);
    }

    updateGoldUI(): void { document.getElementById('goldDisplay')!.innerText = String(Math.floor(this.gold[0])); }

    // ── Collision / placement helpers ─────────────────────────────────────────

    private _pushOutOfRect(entity: Entity, left: number, top: number, right: number, bottom: number): void {
        const r = entity.radius;
        const nearX = Math.max(left, Math.min(right, entity.x));
        const nearY = Math.max(top,  Math.min(bottom, entity.y));
        const dx = entity.x - nearX, dy = entity.y - nearY;
        const d = Math.hypot(dx, dy);
        if (d < r) {
            if (d > 0) {
                const push = r - d;
                entity.x += (dx / d) * push;
                entity.y += (dy / d) * push;
            } else {
                const dists = [entity.x - left, right - entity.x, entity.y - top, bottom - entity.y];
                const min = Math.min(...dists);
                if      (dists[0] === min) entity.x = left  - r;
                else if (dists[1] === min) entity.x = right + r;
                else if (dists[2] === min) entity.y = top   - r;
                else                       entity.y = bottom + r;
            }
        }
    }

    private _resolveWorldCollisions(entity: Entity): void {
        if (this.stoneGrid?.length) {
            const C = this.mapCellSize, r = entity.radius;
            const cols = this.stoneGrid[0].length, rows = this.stoneGrid.length;
            const minCx = Math.max(0, Math.floor((entity.x - r) / C));
            const maxCx = Math.min(cols - 1, Math.floor((entity.x + r) / C));
            const minCy = Math.max(0, Math.floor((entity.y - r) / C));
            const maxCy = Math.min(rows - 1, Math.floor((entity.y + r) / C));
            for (let cy = minCy; cy <= maxCy; cy++)
                for (let cx = minCx; cx <= maxCx; cx++)
                    if (this.stoneGrid[cy][cx])
                        this._pushOutOfRect(entity, cx * C, cy * C, (cx + 1) * C, (cy + 1) * C);
        }
        for (const other of this.entities) {
            if (other === entity || other.isDead) continue;
            if (other.type !== 'building' && other.type !== 'resource') continue;
            const r2 = other.radius;
            this._pushOutOfRect(entity, other.x - r2, other.y - r2, other.x + r2, other.y + r2);
        }
    }

    private _isOnStone(wx: number, wy: number, r: number): boolean {
        if (!this.stoneGrid?.length) return false;
        const C = this.mapCellSize, cols = this.stoneGrid[0].length, rows = this.stoneGrid.length;
        const minCx = Math.max(0, Math.floor((wx - r) / C));
        const maxCx = Math.min(cols - 1, Math.floor((wx + r) / C));
        const minCy = Math.max(0, Math.floor((wy - r) / C));
        const maxCy = Math.min(rows - 1, Math.floor((wy + r) / C));
        for (let cy = minCy; cy <= maxCy; cy++)
            for (let cx = minCx; cx <= maxCx; cx++)
                if (this.stoneGrid[cy][cx]) return true;
        return false;
    }

    private _isAdjacentToBuilding(unit: Entity, building: Entity): boolean {
        return dist(unit.x, unit.y, building.x, building.y) <= unit.radius + building.radius + 8;
    }

    private _isBlockedPlacement(wx: number, wy: number, type: SubType): boolean {
        const r = STATS[type].radius;
        if (this._isOnStone(wx, wy, r)) return true;
        for (const e of this.entities)
            if ((e.type === 'building' || e.type === 'resource') && dist(wx, wy, e.x, e.y) < r + e.radius + 5)
                return true;
        return false;
    }

    // ── Map generation ────────────────────────────────────────────────────────

    private _generateMap(seed: number): void {
        const { MAP_SIZE } = CONSTANTS;
        const CELL = 120;
        const GW   = Math.ceil(MAP_SIZE / CELL);
        const GH   = Math.ceil(MAP_SIZE / CELL);
        const noise2D = createNoise2D(mulberry32(seed));
        const activeSpawns = SPAWN_POINTS.slice(0, this.aiCount + 1);
        const nearSpawn = (wx: number, wy: number, r: number) =>
            activeSpawns.some(s => dist(wx, wy, s.x, s.y) < r);

        this.stoneGrid   = Array.from({ length: GH }, () => new Array(GW).fill(false));
        this.mapCellSize = CELL;
        for (let cy = 0; cy < GH; cy++) {
            for (let cx = 0; cx < GW; cx++) {
                const wx = cx * CELL + CELL / 2;
                const wy = cy * CELL + CELL / 2;
                if (nearSpawn(wx, wy, 260)) continue;
                const v = (noise2D(cx * 0.18, cy * 0.18) * 0.7 +
                           noise2D(cx * 0.40, cy * 0.40) * 0.3 + 1) / 2;
                if (v > 0.65) this.stoneGrid[cy][cx] = true;
            }
        }

        const ZONES = 5, step = MAP_SIZE / ZONES;
        const candidates: { wx: number; wy: number; score: number }[] = [];
        for (let gy = 0; gy < ZONES; gy++) {
            for (let gx = 0; gx < ZONES; gx++) {
                const jx = noise2D(gx * 1.3 + 50, gy * 1.3 + 50) * step * 0.33;
                const jy = noise2D(gx * 1.3 + 60, gy * 1.3 + 60) * step * 0.33;
                const wx = Math.max(200, Math.min(MAP_SIZE - 200, (gx + 0.5) * step + jx));
                const wy = Math.max(200, Math.min(MAP_SIZE - 200, (gy + 0.5) * step + jy));
                if (!nearSpawn(wx, wy, 340))
                    candidates.push({ wx, wy, score: noise2D(wx / 800, wy / 800) });
            }
        }
        candidates.sort((a, b) => b.score - a.score);
        const mines: { wx: number; wy: number }[] = [];
        for (const c of candidates) {
            if (mines.length >= 9) break;
            if (!mines.some(m => dist(m.wx, m.wy, c.wx, c.wy) < 330)) mines.push(c);
        }

        for (const { wx, wy } of mines) {
            const minCx = Math.max(0, Math.floor((wx - CELL) / CELL));
            const maxCx = Math.min(GW - 1, Math.ceil((wx + CELL) / CELL));
            const minCy = Math.max(0, Math.floor((wy - CELL) / CELL));
            const maxCy = Math.min(GH - 1, Math.ceil((wy + CELL) / CELL));
            for (let cy = minCy; cy <= maxCy; cy++)
                for (let cx = minCx; cx <= maxCx; cx++)
                    this.stoneGrid[cy][cx] = false;
        }

        this._initNavGrid();
        this._initFogGrid();
        this._drawStone();

        for (const { wx, wy } of mines)
            this.addEntity('resource', 'gold_mine', Math.round(wx / 20) * 20, Math.round(wy / 20) * 20, -1);
    }

    // ── Fog of war ────────────────────────────────────────────────────────────

    private _initFogGrid(): void {
        const { MAP_SIZE } = CONSTANTS;
        this.fogCols = Math.ceil(MAP_SIZE / FOG_CELL);
        this.fogRows = Math.ceil(MAP_SIZE / FOG_CELL);
        this.fogGrid = Array.from({ length: this.fogRows }, () => new Array(this.fogCols).fill(false));
        this.fogDirty = true;
    }

    private _updateFog(): void {
        const playerUnits = this.entities.filter(e => e.team === CONSTANTS.TEAM_PLAYER && !e.isDead);
        let changed = false;
        for (const u of playerUnits) {
            const cx0 = Math.max(0, Math.floor((u.x - FOG_SIGHT) / FOG_CELL));
            const cx1 = Math.min(this.fogCols - 1, Math.floor((u.x + FOG_SIGHT) / FOG_CELL));
            const cy0 = Math.max(0, Math.floor((u.y - FOG_SIGHT) / FOG_CELL));
            const cy1 = Math.min(this.fogRows - 1, Math.floor((u.y + FOG_SIGHT) / FOG_CELL));
            for (let cy = cy0; cy <= cy1; cy++) {
                for (let cx = cx0; cx <= cx1; cx++) {
                    const cellCX = cx * FOG_CELL + FOG_CELL / 2;
                    const cellCY = cy * FOG_CELL + FOG_CELL / 2;
                    if (dist(u.x, u.y, cellCX, cellCY) <= FOG_SIGHT && !this.fogGrid[cy][cx]) {
                        this.fogGrid[cy][cx] = true;
                        changed = true;
                    }
                }
            }
        }
        if (changed) this.fogDirty = true;
    }

    private _redrawFog(): void {
        if (!this.fogDirty) return;
        this.fogDirty = false;
        const g = this.fogGfx;
        g.clear();
        // Draw dark cells only for unexplored areas
        for (let cy = 0; cy < this.fogRows; cy++) {
            for (let cx = 0; cx < this.fogCols; cx++) {
                if (!this.fogGrid[cy][cx]) {
                    g.rect(cx * FOG_CELL, cy * FOG_CELL, FOG_CELL, FOG_CELL)
                     .fill({ color: 0x000000, alpha: FOG_ALPHA });
                }
            }
        }
    }

    // ── Pathfinding ───────────────────────────────────────────────────────────

    private _initNavGrid(): void {
        const { MAP_SIZE, NAV_CELL } = CONSTANTS;
        const NW = Math.ceil(MAP_SIZE / NAV_CELL), NH = Math.ceil(MAP_SIZE / NAV_CELL);
        this.navGrid   = new PF.Grid(NW, NH);
        this.navFinder = new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles });
        if (!this.stoneGrid) return;
        const SC = this.mapCellSize;
        for (let sy = 0; sy < this.stoneGrid.length; sy++) {
            for (let sx = 0; sx < this.stoneGrid[sy].length; sx++) {
                if (!this.stoneGrid[sy][sx]) continue;
                const nx0 = Math.max(0, Math.floor(sx * SC / NAV_CELL));
                const nx1 = Math.min(NW - 1, Math.ceil((sx + 1) * SC / NAV_CELL) - 1);
                const ny0 = Math.max(0, Math.floor(sy * SC / NAV_CELL));
                const ny1 = Math.min(NH - 1, Math.ceil((sy + 1) * SC / NAV_CELL) - 1);
                for (let ny = ny0; ny <= ny1; ny++)
                    for (let nx = nx0; nx <= nx1; nx++)
                        this.navGrid.setWalkableAt(nx, ny, false);
            }
        }
    }

    private _markEntityOnGrid(entity: Entity, walkable: boolean): void {
        if (!this.navGrid) return;
        const { MAP_SIZE, NAV_CELL } = CONSTANTS;
        const NW = Math.ceil(MAP_SIZE / NAV_CELL), NH = Math.ceil(MAP_SIZE / NAV_CELL);
        const r = entity.radius;
        const nx0 = Math.max(0, Math.floor((entity.x - r) / NAV_CELL));
        const nx1 = Math.min(NW - 1, Math.floor((entity.x + r) / NAV_CELL));
        const ny0 = Math.max(0, Math.floor((entity.y - r) / NAV_CELL));
        const ny1 = Math.min(NH - 1, Math.floor((entity.y + r) / NAV_CELL));
        for (let ny = ny0; ny <= ny1; ny++) {
            for (let nx = nx0; nx <= nx1; nx++) {
                if (walkable) {
                    const scx = Math.floor(nx * NAV_CELL / this.mapCellSize);
                    const scy = Math.floor(ny * NAV_CELL / this.mapCellSize);
                    const onStone = this.stoneGrid?.[scy]?.[scx];
                    if (!onStone) this.navGrid.setWalkableAt(nx, ny, true);
                } else {
                    this.navGrid.setWalkableAt(nx, ny, false);
                }
            }
        }
    }

    private _rebuildNavGrid(): void {
        this._initNavGrid();
        for (const e of this.entities)
            if (e.type === 'building' && !e.isDead)
                this._markEntityOnGrid(e, false);
    }

    private _computePath(unit: Entity, destX: number, destY: number): { x: number; y: number }[] {
        if (!this.navGrid) return [];
        const { MAP_SIZE, NAV_CELL } = CONSTANTS;
        const NW = Math.ceil(MAP_SIZE / NAV_CELL), NH = Math.ceil(MAP_SIZE / NAV_CELL);
        const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v / NAV_CELL)));
        const sx = clamp(unit.x, NW), sy = clamp(unit.y, NH);
        let   ex = clamp(destX,  NW), ey = clamp(destY,  NH);
        if (sx === ex && sy === ey) return [];

        const grid = this.navGrid.clone();
        if (!grid.isWalkableAt(sx, sy)) grid.setWalkableAt(sx, sy, true);

        if (!grid.isWalkableAt(ex, ey)) {
            let bestX = -1, bestY = -1;
            for (let rad = 1; rad <= 6 && bestX === -1; rad++) {
                let bestD = Infinity;
                for (let dy = -rad; dy <= rad; dy++) {
                    for (let dx = -rad; dx <= rad; dx++) {
                        if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
                        const nx = ex + dx, ny = ey + dy;
                        if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
                        if (!grid.isWalkableAt(nx, ny)) continue;
                        const d = Math.hypot(nx - sx, ny - sy);
                        if (d < bestD) { bestD = d; bestX = nx; bestY = ny; }
                    }
                }
            }
            if (bestX === -1) return [];
            ex = bestX; ey = bestY;
        }

        const raw = this.navFinder!.findPath(sx, sy, ex, ey, grid);
        if (raw.length < 2) return [];
        return raw.slice(1).map(([gx, gy]) => ({
            x: gx * NAV_CELL + NAV_CELL / 2,
            y: gy * NAV_CELL + NAV_CELL / 2,
        }));
    }

    private _updateOpponentsHUD(): void {
        const alive = this.entities.filter(e => e.subType === 'town_center' && e.team !== 0).length;
        document.getElementById('opponentsCount')!.textContent = `${alive} TC${alive !== 1 ? 's' : ''} alive`;
    }

    // ── Inputs ────────────────────────────────────────────────────────────────

    private _setupInputs(): void {
        // Cancel any previous listeners (safe to call multiple times)
        this._inputController?.abort();
        this._inputController = new AbortController();
        const { signal } = this._inputController;
        const fresh = this.app.canvas;

        fresh.addEventListener('contextmenu', e => e.preventDefault(), { signal });
        fresh.addEventListener('wheel', e => {
            e.preventDefault();
            const zd = e.deltaY > 0 ? 0.9 : 1.1;
            const wb = this.screenToWorld(e.clientX, e.clientY);
            this.camera.zoom = Math.max(0.2, Math.min(3.0, this.camera.zoom * zd));
            const wa = this.screenToWorld(e.clientX, e.clientY);
            this.camera.x -= wa.x - wb.x; this.camera.y -= wa.y - wb.y;
            this._clampCamera();
        }, { passive: false, signal });

        fresh.addEventListener('pointerdown', e => {
            fresh.setPointerCapture(e.pointerId);
            const w = this.screenToWorld(e.clientX, e.clientY);
            const ptr: PointerState = {
                sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y,
                startX: e.clientX, startY: e.clientY, startWx: w.x, startWy: w.y,
                intent: 'unknown', button: e.button,
            };
            this.pointers.set(e.pointerId, ptr);
            if (e.button === 2) { this.handleRightClick(w.x, w.y); ptr.intent = 'done'; }
        }, { signal });

        fresh.addEventListener('pointermove', e => {
            if (!this.pointers.has(e.pointerId)) return;
            const ptr = this.pointers.get(e.pointerId)!;
            const oldSx = ptr.sx, oldSy = ptr.sy;
            ptr.sx = e.clientX; ptr.sy = e.clientY;
            const w = this.screenToWorld(e.clientX, e.clientY);
            ptr.wx = w.x; ptr.wy = w.y;
            if (ptr.button !== 0 || ptr.intent === 'done') return;
            if (this.pointers.size === 1) {
                const moved = dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy);
                if (ptr.intent === 'unknown' && moved > 10) {
                    if (this.placementMode) {
                        ptr.intent = 'done';
                    } else {
                        const hit = this.getEntityAt(ptr.startWx, ptr.startWy);
                        if (!hit || hit.team !== 0) {
                            ptr.intent = 'box';
                            this.dragSelect = { startX: ptr.startWx, startY: ptr.startWy, currentX: ptr.wx, currentY: ptr.wy, active: true };
                        } else {
                            ptr.intent = 'pan';
                        }
                    }
                }
                if (ptr.intent === 'box' && this.dragSelect) {
                    this.dragSelect.currentX = ptr.wx; this.dragSelect.currentY = ptr.wy;
                } else if (ptr.intent === 'pan') {
                    this.camera.x -= (ptr.sx - oldSx) / this.camera.zoom;
                    this.camera.y -= (ptr.sy - oldSy) / this.camera.zoom;
                    this._clampCamera();
                }
            }
        }, { signal });

        fresh.addEventListener('pointerup', e => {
            const ptr = this.pointers.get(e.pointerId); if (!ptr) return;
            if (ptr.button === 0 && ptr.intent !== 'done') {
                if (ptr.intent === 'box' && this.dragSelect?.active) this._performBoxSelect();
                else if (dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy) < 10) this._handleTap(ptr.wx, ptr.wy);
            }
            this.pointers.delete(e.pointerId); this.dragSelect = null;
        }, { signal });
    }

    private _performBoxSelect(): void {
        const { startX, startY, currentX, currentY } = this.dragSelect!;
        const minX = Math.min(startX, currentX), maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY), maxY = Math.max(startY, currentY);
        const inBox = (e: Entity) => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY;
        const units = this.entities.filter(e => e.team === 0 && e.type === 'unit' && inBox(e));
        this.selectedIds.clear();
        (units.length > 0 ? units : this.entities.filter(e => e.team === 0 && inBox(e)))
            .forEach(e => this.selectedIds.add(e.id));
        this.updateUI();
    }

    handleRightClick(wx: number, wy: number): void {
        if (!this.selectedIds.size) return;
        const units = this.getSelectedEntities().filter(e => e.type === 'unit');
        if (!units.length) return;
        const clicked = this.getEntityAt(wx, wy);
        if (clicked) {
            if (clicked.team !== 0) {
                units.forEach(u => { u.target = clicked; u.state = 'moving_to_attack'; u.waypoints = null; });
                this.createEffect(clicked.x, clicked.y, clicked.type === 'resource' ? '#fbbf24' : '#ef4444');
            } else if (clicked.isConstructing) {
                units.filter(u => u.subType === 'builder').forEach(u => { u.target = clicked; u.state = 'moving_to_build'; u.waypoints = null; });
                this.createEffect(clicked.x, clicked.y, '#3b82f6');
            } else {
                this._formationMove(units, wx, wy);
                this.createEffect(wx, wy, '#4ade80');
            }
        } else {
            this._formationMove(units, wx, wy);
            this.createEffect(wx, wy, '#4ade80');
        }
        Audio.ack();
    }

    private _handleTap(wx: number, wy: number): void {
        if (this.placementMode) {
            const sx = Math.round(wx / 20) * 20, sy = Math.round(wy / 20) * 20;
            if (this.gold[0] < STATS[this.placementMode].cost) { this.notify('Not enough gold!', 'text-red-400'); this.cancelPlacement(); return; }
            if (this._isBlockedPlacement(sx, sy, this.placementMode)) { this.notify("Can't build here!", 'text-red-400'); return; }
            const bldrs = this.getSelectedEntities().filter(e => e.subType === 'builder');
            if (bldrs.length > 0) {
                this.gold[0] -= STATS[this.placementMode].cost; this.updateGoldUI();
                const b = this.addEntity('building', this.placementMode, sx, sy, 0);
                b.isConstructing = true; b.hp = 1;
                bldrs.forEach(u => { u.target = b; u.state = 'moving_to_build'; u.waypoints = null; });
                this.cancelPlacement();
            }
            return;
        }
        const clicked = this.getEntityAt(wx, wy);
        const now = performance.now();
        if (clicked && clicked.team === 0) {
            if (now - this.lastClickTime < 300 && this.lastClickedId === clicked.id) {
                this.selectedIds.clear();
                this.entities.forEach(e => {
                    if (e.team === 0 && e.subType === clicked.subType &&
                        dist(e.x, e.y, this.camera.x, this.camera.y) < this._canvasWidth / this.camera.zoom)
                        this.selectedIds.add(e.id);
                });
            } else {
                this.selectedIds.clear(); this.selectedIds.add(clicked.id);
            }
            this.lastClickTime = now; this.lastClickedId = clicked.id;
        } else {
            this.selectedIds.clear();
        }
        this.updateUI();
    }

    selectAllUnits(): void {
        this.selectedIds.clear();
        this.entities.forEach(e => {
            if (e.team === 0 && (e.subType === 'soldier' || e.subType === 'archer'))
                this.selectedIds.add(e.id);
        });
        this.updateUI();
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

    // ── Update ────────────────────────────────────────────────────────────────

    private update(dt: number): void {
        if (this.state !== 'playing') return;

        const EDGE = 48, EDGE_SPEED = 900;
        const { mouseScreenX: mx, mouseScreenY: my } = this;
        const W = this._canvasWidth, H = this._canvasHeight;
        let ex = 0, ey = 0;
        if (mx <= EDGE) ex = -1 * (1 - mx / EDGE);
        else if (mx >= W - EDGE) ex = (mx - (W - EDGE)) / EDGE;
        if (my <= EDGE) ey = -1 * (1 - my / EDGE);
        else if (my >= H - EDGE) ey = (my - (H - EDGE)) / EDGE;
        if (ex !== 0 || ey !== 0) {
            this.camera.x += ex * EDGE_SPEED * dt / this.camera.zoom;
            this.camera.y += ey * EDGE_SPEED * dt / this.camera.zoom;
            this._clampCamera();
        }

        this.passiveGoldTimer += dt;
        if (this.passiveGoldTimer >= 1.0) {
            for (let t = 0; t < this.gold.length; t++) this.gold[t] += 1.5;
            this.passiveGoldTimer = 0; this.updateGoldUI();
        }

        for (let ai = 1; ai <= this.aiCount; ai++) {
            this.aiTimers[ai - 1] -= dt;
            if (this.aiTimers[ai - 1] <= 0) {
                this.aiTimers[ai - 1] = this.diff.tickRate;
                this._updateAI(ai);
            }
        }

        for (const p of this.projectiles) {
            const wasDead = p.isDead;
            p.update(dt);
            if (!wasDead && p.isDead && !p.target.isDead) {
                Audio.hit(Audio.spatialVol(p.x, p.y, this.camera.x, this.camera.y, this._viewRadius));
            }
        }
        this.projectiles = this.projectiles.filter(p => !p.isDead);

        // Unit steering
        for (const e of this.entities) {
            if (e.type !== 'unit') continue;
            if (e.state === 'idle' || e.state === 'moving') {
                let nearest: Entity | null = null, best = 220;
                for (const o of this.entities) {
                    if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                        const score = dist(e.x, e.y, o.x, o.y) + (o.type === 'building' ? 100 : 0);
                        if (score < best) { best = score; nearest = o; }
                    }
                }
                if (nearest) { e.target = nearest; e.state = 'moving_to_attack'; e.waypoints = null; }
            }
            const stats = STATS[e.subType];
            let tvx = 0, tvy = 0;
            if (e.state.startsWith('moving')) {
                const destX = e.state === 'moving' ? e.targetX : (e.target?.x ?? e.targetX);
                const destY = e.state === 'moving' ? e.targetY : (e.target?.y ?? e.targetY);
                if (destX != null && destY != null) {
                    if (e.waypoints == null)
                        e.waypoints = this._computePath(e, destX, destY);

                    if (e.state === 'moving_to_attack' && e.target && !e.target.isDead && e.waypoints.length > 0) {
                        e.pathTimer = (e.pathTimer ?? 1.5) - dt;
                        if (e.pathTimer <= 0) {
                            e.waypoints = this._computePath(e, destX, destY);
                            e.pathTimer = 1.5;
                        }
                    }

                    if (e.waypoints.length === 0) {
                        const d0       = dist(e.x, e.y, destX, destY);
                        const isRng0   = (stats.range ?? 0) > 50;
                        const stop0    = e.state === 'moving_to_attack'
                            ? (isRng0 ? (stats.range ?? 0) + (e.target?.radius ?? 0) : e.radius + (e.target?.radius ?? 0) + 5)
                            : 5;
                        const adj0     = e.state === 'moving_to_build' && e.target && this._isAdjacentToBuilding(e, e.target);
                        if (d0 <= stop0 || adj0) {
                            e.state = e.state === 'moving_to_attack' ? 'attacking'
                                    : e.state === 'moving_to_build'  ? 'building' : 'idle';
                        } else if (e.state === 'moving_to_build' && e.target && !e.target.isDead) {
                            const a = angle(e.x, e.y, e.target.x, e.target.y);
                            tvx = Math.cos(a) * (stats.speed ?? 0);
                            tvy = Math.sin(a) * (stats.speed ?? 0);
                        } else if (e.state === 'moving_to_attack' && e.target && !e.target.isDead
                                   && d0 <= CONSTANTS.NAV_CELL * 3) {
                            // Direct-steer the final gap between last waypoint and target
                            const a = angle(e.x, e.y, destX, destY);
                            tvx = Math.cos(a) * (stats.speed ?? 0);
                            tvy = Math.sin(a) * (stats.speed ?? 0);
                        } else {
                            e.pathTimer = (e.pathTimer ?? 1.0) - dt;
                            if (e.pathTimer <= 0) { e.waypoints = null; e.pathTimer = 1.0; }
                        }
                    } else {
                        while (e.waypoints.length > 1 &&
                               dist(e.x, e.y, e.waypoints[0].x, e.waypoints[0].y) < CONSTANTS.NAV_CELL)
                            e.waypoints.shift();
                        const finalApproach = e.state === 'moving_to_build' && e.target && e.waypoints.length === 1;
                        const immX = finalApproach ? e.target!.x : e.waypoints[0].x;
                        const immY = finalApproach ? e.target!.y : e.waypoints[0].y;
                        const d    = dist(e.x, e.y, destX, destY);
                        const isRanged = (stats.range ?? 0) > 50;
                        const stop = e.state === 'moving_to_attack'
                            ? (isRanged ? (stats.range ?? 0) + (e.target?.radius ?? 0) : e.radius + (e.target?.radius ?? 0) + 5)
                            : 5;
                        const atTarget = d <= stop ||
                            (e.state === 'moving_to_build' && e.target && this._isAdjacentToBuilding(e, e.target));
                        if (atTarget) {
                            e.state = e.state === 'moving_to_attack' ? 'attacking'
                                    : e.state === 'moving_to_build'  ? 'building' : 'idle';
                            e.waypoints = [];
                        } else {
                            const a = angle(e.x, e.y, immX, immY);
                            tvx = Math.cos(a) * (stats.speed ?? 0);
                            tvy = Math.sin(a) * (stats.speed ?? 0);
                        }
                    }
                } else {
                    e.state = 'idle';
                }
            }
            let avx = 0, avy = 0;
            for (const o of this.entities) {
                if (o === e || o === e.target) continue;
                const d = dist(e.x, e.y, o.x, o.y);
                const safe = (e.radius + o.radius) * CONSTANTS.AVOIDANCE_RADIUS_MULT;
                if (d < safe) {
                    const str = (1 - d / safe) * CONSTANTS.AVOIDANCE_FORCE;
                    const a = angle(o.x, o.y, e.x, e.y);
                    avx += Math.cos(a) * str; avy += Math.sin(a) * str;
                }
            }
            e.velX = tvx + avx; e.velY = tvy + avy;
        }

        // Entity logic
        for (const e of this.entities) {
            if (e.timer > 0) e.timer -= dt;

            if (e.subType === 'town_center' && !e.isConstructing && e.timer <= 0) {
                let nearest: Entity | null = null, best = STATS.town_center.range!;
                for (const o of this.entities) {
                    if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                        const d = dist(e.x, e.y, o.x, o.y);
                        if (d < best) { best = d; nearest = o; }
                    }
                }
                if (nearest) {
                    this.projectiles.push(new Projectile(e.x, e.y, nearest, STATS.town_center.damage!, e.team));
                    e.timer = STATS.town_center.cooldown!;
                }
            }

            if (e.type === 'unit') {
                e.x += e.velX * dt; e.y += e.velY * dt;
                this._resolveWorldCollisions(e);

                if (e.state === 'attacking') {
                    if (!e.target || e.target.isDead) { e.state = 'idle'; e.target = null; }
                    else if (dist(e.x, e.y, e.target.x, e.target.y) > ((STATS[e.subType].range ?? 0) > 50 ? (STATS[e.subType].range ?? 0) + e.target.radius + 30 : e.radius + e.target.radius + 25)) {
                        e.state = 'moving_to_attack'; e.waypoints = null;
                    } else if (e.timer <= 0) {
                        const s = STATS[e.subType];
                        if ((s.range ?? 0) > 50) {
                            this.projectiles.push(new Projectile(e.x, e.y, e.target, s.damage!, e.team));
                        } else {
                            e.target.damage(s.damage!, e.team);
                            Audio.hit(Audio.spatialVol(e.x, e.y, this.camera.x, this.camera.y, this._viewRadius));
                        }
                        e.timer = s.cooldown!;
                    }
                }
                if (e.state === 'building') {
                    if (!e.target || e.target.isDead || !e.target.isConstructing) { e.state = 'idle'; }
                    else if (e.timer <= 0) {
                        e.target.hp += 60; e.timer = 0.5;
                        if (e.target.hp >= e.target.maxHp) {
                            e.target.hp = e.target.maxHp; e.target.isConstructing = false; e.state = 'idle';
                            if (e.target.team === 0) Audio.build();
                        }
                    }
                }
            }

            if (e.type === 'building' && !e.isConstructing && e.buildQueue.length > 0 && e.timer <= 0) {
                const unit = e.buildQueue.shift()!;
                this.addEntity('unit', unit, e.x, e.y + e.radius + 20, e.team);
                if (e.buildQueue.length > 0) e.timer = this.diff.buildDelay * 3;
            }
        }

        let tcDied = false, navDirty = false;
        for (let i = this.entities.length - 1; i >= 0; i--) {
            const dead = this.entities[i];
            if (dead.isDead) {
                if (dead.subType === 'town_center') tcDied = true;
                if (dead.type === 'building') navDirty = true;
                this.selectedIds.delete(dead.id);
                const disp = this.entityDisplays.get(dead.id);
                if (disp) { this.entityLayer.removeChild(disp); this.entityDisplays.delete(dead.id); }
                this.entities.splice(i, 1);
            }
        }
        if (navDirty) this._rebuildNavGrid();
        if (tcDied)   this._checkWinCondition();

        this.effects.forEach(ef => { ef.radius += 80 * dt; ef.alpha -= 2 * dt; if (ef.alpha <= 0) ef.isDead = true; });
        this.effects = this.effects.filter(ef => !ef.isDead);
        this.floatingTexts.forEach(ft => {
            ft.y -= 40 * dt; ft.alpha -= 1 * dt;
            const t = this.textDisplays.get(ft);
            if (t) { t.position.y = ft.y; t.alpha = ft.alpha; }
            if (ft.alpha <= 0) {
                ft.isDead = true;
                if (t) { this.textLayer.removeChild(t); this.textDisplays.delete(ft); }
            }
        });
        this.floatingTexts = this.floatingTexts.filter(ft => !ft.isDead);

        this._updateFog();
    }

    private _checkWinCondition(): void {
        const tcs = this.entities.filter(e => e.subType === 'town_center');
        const playerAlive = tcs.some(e => e.team === 0);
        const aiAlive     = tcs.some(e => e.team !== 0);
        this._updateOpponentsHUD();
        if (!playerAlive) { this._endGame(false); return; }
        if (!aiAlive)     { this._endGame(true);  return; }
    }

    // ── AI ────────────────────────────────────────────────────────────────────

    private _updateAI(team: number): void {
        const units    = this.entities.filter(e => e.team === team);
        const tc       = units.find(e => e.subType === 'town_center'); if (!tc) return;
        const gold     = this.gold[team];
        const builders = units.filter(e => e.subType === 'builder');
        const idleB    = builders.filter(e => e.state === 'idle');

        if (idleB.length > 0) {
            const mines = this.entities.filter(e => e.type === 'resource' && !e.isDead);
            if (mines.length > 0) idleB.forEach(b => {
                const closest = mines.reduce((prev, curr) =>
                    dist(b.x, b.y, curr.x, curr.y) < dist(b.x, b.y, prev.x, prev.y) ? curr : prev);
                b.target = closest; b.state = 'moving_to_attack'; b.waypoints = null;
            });
        }

        if (builders.length < 4 && gold >= 50) { tc.buildQueue.push('builder'); this.gold[team] -= 50; if (tc.timer <= 0) tc.timer = 2; }

        const bar = units.find(e => e.subType === 'barracks');
        if (!bar && gold >= 150) {
            const b = builders.find(e => e.state !== 'moving_to_build');
            if (b) {
                this.gold[team] -= 150;
                const bld = this.addEntity('building', 'barracks', Math.round((tc.x + (team % 2 === 0 ? 1 : -1) * 140) / 20) * 20, Math.round((tc.y + 140) / 20) * 20, team);
                bld.isConstructing = true; bld.hp = 1;
                b.target = bld; b.state = 'moving_to_build'; b.waypoints = null;
            }
        }

        if (bar && !bar.isConstructing && gold >= 75 && bar.buildQueue.length < 3) {
            bar.buildQueue.push('soldier'); this.gold[team] -= 75; if (bar.timer <= 0) bar.timer = 2.5;
        }

        const army = units.filter(e => e.subType === 'soldier' && e.state === 'idle');
        if (army.length >= this.diff.armyThreshold) {
            const enemyTCs = this.entities.filter(e => e.subType === 'town_center' && e.team !== team);
            if (enemyTCs.length > 0) {
                const targetTC = enemyTCs.reduce((prev, curr) =>
                    dist(tc.x, tc.y, curr.x, curr.y) < dist(tc.x, tc.y, prev.x, prev.y) ? curr : prev);
                army.forEach(u => { u.target = targetTC; u.state = 'moving_to_attack'; u.waypoints = null; });
            }
        }
    }

    // ── Draw ──────────────────────────────────────────────────────────────────

    private draw(): void {
        if (this.state !== 'playing') return;

        this._applyCamera();
        this._drawEntities();
        this._drawProjectiles();
        this._drawEffects();
        this._drawGhost();
        this._drawDragSelect();
        this._redrawFog();
    }

    private _drawEntities(): void {
        // Sort by y for painter's order
        const sorted = [...this.entities].sort((a, b) => a.y - b.y);
        // Re-sort entityLayer children to match
        for (let i = 0; i < sorted.length; i++) {
            const disp = this.entityDisplays.get(sorted[i].id);
            if (disp) this.entityLayer.setChildIndex(disp, Math.min(i, this.entityLayer.children.length - 1));
        }

        for (const e of this.entities) {
            const container = this.entityDisplays.get(e.id);
            if (!container) continue;
            container.position.set(e.x, e.y);

            const shape  = container.getChildByLabel('shape')  as PIXI.Graphics;
            const ring   = container.getChildByLabel('ring')   as PIXI.Graphics;
            const hpBar  = container.getChildByLabel('hp')     as PIXI.Graphics;

            const color  = hexColor(e.color);
            const border = e.team === -1 ? 0xfbbf24 : hexColor(TEAM_COLORS[e.team] ?? '#ffffff');
            const r      = e.radius;

            // Main shape
            shape.clear();
            shape.alpha = e.isConstructing ? 0.5 : 1;
            if (e.type === 'building' || e.type === 'resource') {
                shape.roundRect(-r, -r, r * 2, r * 2, 8)
                     .fill({ color })
                     .stroke({ color: border, width: 3 });
            } else {
                shape.circle(0, 0, r)
                     .fill({ color })
                     .stroke({ color: border, width: 3 });
            }

            // Resource gold label
            if (e.type === 'resource') {
                const lbl = container.getChildByLabel('goldLabel') as PIXI.Text | undefined;
                if (lbl) lbl.text = `${Math.floor(e.goldLeft ?? 0)}G`;
            }

            // Selection ring
            const selected = this.selectedIds.has(e.id);
            ring.visible = selected;
            if (selected) {
                ring.clear();
                ring.ellipse(0, r * 0.3, r * 1.3, r * 0.7)
                    .stroke({ color: 0x4ade80, width: 3 });
            }

            // HP bar
            const showHp = e.hp < e.maxHp || selected || e.isConstructing;
            hpBar.visible = showHp;
            if (showHp) {
                const w = r * 2;
                const barColor = e.isConstructing ? 0xfbbf24
                               : e.type === 'resource' ? 0xfbbf24
                               : hexColor(TEAM_COLORS[e.team] ?? '#ffffff');
                hpBar.clear();
                hpBar.rect(-w / 2, -r - 12, w, 4).fill({ color: 0x000000, alpha: 0.5 });
                hpBar.rect(-w / 2, -r - 12, w * (e.hp / e.maxHp), 4).fill({ color: barColor });
            }
        }
    }

    private _drawProjectiles(): void {
        const g = this.projectileGfx;
        g.clear();
        for (const p of this.projectiles) {
            g.circle(p.x, p.y, 4).fill({ color: hexColor(TEAM_COLORS[p.team] ?? '#ffffff') });
        }
    }

    private _drawEffects(): void {
        const g = this.effectGfx;
        g.clear();
        for (const ef of this.effects) {
            g.circle(ef.x, ef.y, ef.radius)
             .stroke({ color: hexColor(ef.color), alpha: ef.alpha, width: 2 });
        }
    }

    private _drawGhost(): void {
        const g = this.ghostGfx;
        g.clear();
        if (!this.placementMode) return;
        const wp = this.screenToWorld(this.mouseScreenX, this.mouseScreenY);
        const gx = Math.round(wp.x / 20) * 20, gy = Math.round(wp.y / 20) * 20;
        const r  = STATS[this.placementMode].radius;
        const blocked = this._isBlockedPlacement(gx, gy, this.placementMode);
        const color   = blocked ? 0xef4444 : 0x4ade80;
        g.roundRect(gx - r, gy - r, r * 2, r * 2, 8)
         .fill({ color, alpha: 0.4 })
         .stroke({ color, width: 2 });
    }

    private _drawDragSelect(): void {
        const g = this.dragGfx;
        g.clear();
        if (!this.dragSelect?.active) return;
        const { startX: bx, startY: by, currentX, currentY } = this.dragSelect;
        g.rect(bx, by, currentX - bx, currentY - by)
         .fill({ color: 0x3b82f6, alpha: 0.15 })
         .stroke({ color: 0x60a5fa, width: 1 });
    }

    // ── UI ────────────────────────────────────────────────────────────────────

    updateUI(): void {
        const menu = document.getElementById('actionMenu')!; menu.innerHTML = '';
        const sel  = this.getSelectedEntities();
        document.getElementById('selectionInfo')!.innerText = sel.length ? `${sel.length} selected` : 'No selection';
        const hasBuilders = sel.some(e => e.subType === 'builder' && e.team === 0);
        if (sel.length === 1 && sel[0].team === 0 && !sel[0].isConstructing) {
            const b = sel[0];
            if      (b.subType === 'town_center')  menu.appendChild(this._btn('Train Builder (50g)',     () => this._trainUnit(b, 'builder')));
            else if (b.subType === 'barracks')      menu.appendChild(this._btn('Train Soldier (75g)',    () => this._trainUnit(b, 'soldier')));
            else if (b.subType === 'archery_range') menu.appendChild(this._btn('Train Archer (100g)',    () => this._trainUnit(b, 'archer')));
        }
        if (hasBuilders) {
            menu.appendChild(this._btn('Build Barracks (150g)',      () => this.startPlacement('barracks')));
            menu.appendChild(this._btn('Build Archery Range (200g)', () => this.startPlacement('archery_range')));
        }
    }

    private _btn(text: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'whitespace-nowrap px-4 py-2 bg-blue-600 rounded-lg text-sm font-bold shadow-md active:scale-95 transition-transform interactive hover:bg-blue-500';
        btn.innerText = text;
        btn.onclick = e => { e.stopPropagation(); onClick(); };
        return btn;
    }

    private _trainUnit(building: Entity, type: SubType): void {
        if (this.gold[0] >= STATS[type].cost) {
            this.gold[0] -= STATS[type].cost; building.buildQueue.push(type);
            if (building.timer <= 0) building.timer = 2; this.updateGoldUI();
        } else this.notify('Low Gold!', 'text-red-400');
    }

    startPlacement(type: SubType): void {
        this.placementMode = type;
        document.getElementById('placementHint')!.classList.remove('hidden');
        document.getElementById('actionMenu')!.classList.add('hidden');
    }

    cancelPlacement(): void {
        this.placementMode = null;
        document.getElementById('placementHint')!.classList.add('hidden');
        document.getElementById('actionMenu')!.classList.remove('hidden');
    }

    private _endGame(win: boolean): void {
        this.state = 'gameover';
        Audio.stopWind();
        localStorage.removeItem('kosave');
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

    // ── Save / Load ───────────────────────────────────────────────────────────

    private _saveState(): void {
        try {
            localStorage.setItem('kosave', JSON.stringify({
                difficulty: this.settings.difficulty,
                aiCount:    this.settings.aiCount,
                mapSeed:    this.mapSeed,
            }));
            const contBtn = document.getElementById('continueBtn') as HTMLButtonElement | null;
            if (contBtn) contBtn.removeAttribute('disabled');
        } catch { /* storage full or blocked */ }
    }

    private _loadState(): void {
        const data = JSON.parse(localStorage.getItem('kosave')!);
        this.settings.difficulty = data.difficulty ?? 'medium';
        this.settings.aiCount    = data.aiCount    ?? 2;
        this.aiCount = this.settings.aiCount;
        this.diff    = DIFFICULTY[this.settings.difficulty];
        this._pendingSeed = data.mapSeed ?? null;
        this.init(false);
    }
}
