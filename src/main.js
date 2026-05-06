import './style.css';

const CONSTANTS = {
    MAP_SIZE: 3000,
    TEAM_PLAYER: 0,
    AVOIDANCE_FORCE: 120,
    AVOIDANCE_RADIUS_MULT: 1.8
};

// Per-team colors: index = team id (0 = player blue, 1-5 = AI colors)
const TEAM_COLORS = ['#3b82f6', '#ef4444', '#f97316', '#a855f7', '#ec4899', '#14b8a6'];
const TEAM_UNIT_COLORS = ['#93c5fd', '#fca5a5', '#fdba74', '#d8b4fe', '#f9a8d4', '#99f6e4'];

const DIFFICULTY = {
    easy:   { tickRate: 2.5, armyThreshold: 5,  buildDelay: 1.2 },
    medium: { tickRate: 1.0, armyThreshold: 3,  buildDelay: 1.0 },
    hard:   { tickRate: 0.5, armyThreshold: 2,  buildDelay: 0.7 }
};

const STATS = {
    town_center:  { type: 'building', cost: 0,   hp: 2400, radius: 45, label: 'Town Center', range: 250, damage: 15, cooldown: 0.28 },
    barracks:     { type: 'building', cost: 150,  hp: 700,  radius: 35, label: 'Barracks' },
    archery_range:{ type: 'building', cost: 200,  hp: 550,  radius: 35, label: 'Archery Range' },
    gold_mine:    { type: 'resource', cost: 0,   hp: 2000, goldValue: 500, radius: 40, color: '#d97706', label: 'Gold Mine' },
    builder:      { type: 'unit', cost: 50,  hp: 80,  radius: 10, speed: 70,  range: 30,  damage: 8,  cooldown: 0.8,  label: 'Builder' },
    soldier:      { type: 'unit', cost: 75,  hp: 240, radius: 12, speed: 85,  range: 25,  damage: 18, cooldown: 1.0,  label: 'Soldier' },
    archer:       { type: 'unit', cost: 100, hp: 120, radius: 10, speed: 75,  range: 160, damage: 22, cooldown: 1.4,  label: 'Archer' }
};

// Evenly distributed spawn positions around the map for up to 6 players
const SPAWN_POINTS = [
    { x: 500,                    y: CONSTANTS.MAP_SIZE / 2 },   // West  (player)
    { x: CONSTANTS.MAP_SIZE - 500, y: CONSTANTS.MAP_SIZE / 2 }, // East
    { x: CONSTANTS.MAP_SIZE / 2,  y: 500 },                     // North
    { x: CONSTANTS.MAP_SIZE / 2,  y: CONSTANTS.MAP_SIZE - 500 },// South
    { x: 500,                    y: 500 },                       // NW
    { x: CONSTANTS.MAP_SIZE - 500, y: CONSTANTS.MAP_SIZE - 500 } // SE
];

const MINE_POSITIONS = [
    [1500, 1500], [1500, 1100], [1500, 1900],
    [800,  900],  [800,  2100], [2200, 900], [2200, 2100]
];

const dist  = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const angle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

// ─── Entity ─────────────────────────────────────────────────────────────────

class Entity {
    constructor(id, type, subType, x, y, team) {
        this.id = id; this.type = type; this.subType = subType;
        this.x = x; this.y = y; this.team = team;
        const s = STATS[subType];
        this.hp = s.hp; this.maxHp = s.hp; this.radius = s.radius;
        // color from team palette, except resources which have their own
        if (type === 'resource') {
            this.color = s.color;
            this.goldLeft = s.goldValue; this.initialGold = s.goldValue;
        } else {
            this.color = type === 'unit' ? TEAM_UNIT_COLORS[team] : TEAM_COLORS[team];
        }
        this.state = 'idle'; this.target = null; this.targetX = null; this.targetY = null;
        this.timer = 0; this.isDead = false; this.buildQueue = []; this.isConstructing = false;
        this.velX = 0; this.velY = 0;
    }

    damage(amount, attackerTeam) {
        if (this.type === 'resource' && this.goldLeft > 0) {
            let earned = Math.min(this.goldLeft, amount * (this.initialGold / this.maxHp));
            this.goldLeft -= earned;
            game.addGold(attackerTeam, earned);
            if (attackerTeam === CONSTANTS.TEAM_PLAYER && earned >= 1)
                game.createFloatingText(`+${Math.floor(earned)}`, this.x, this.y - 20, '#fbbf24');
        }
        this.hp -= amount;
        if (this.hp <= 0) { this.hp = 0; this.isDead = true; }
    }
}

// ─── Projectile ──────────────────────────────────────────────────────────────

class Projectile {
    constructor(x, y, target, damage, team) {
        this.x = x; this.y = y; this.target = target; this.damage = damage; this.team = team;
        this.speed = 400; this.isDead = false;
    }
    update(dt) {
        if (!this.target || this.target.isDead) { this.isDead = true; return; }
        const d = dist(this.x, this.y, this.target.x, this.target.y);
        if (d < this.target.radius + 10) { this.target.damage(this.damage, this.team); this.isDead = true; return; }
        const a = angle(this.x, this.y, this.target.x, this.target.y);
        this.x += Math.cos(a) * this.speed * dt;
        this.y += Math.sin(a) * this.speed * dt;
    }
    draw(ctx) {
        ctx.fillStyle = TEAM_COLORS[this.team] ?? '#fff';
        ctx.beginPath(); ctx.arc(this.x, this.y, 4, 0, Math.PI * 2); ctx.fill();
    }
}

// ─── Game ────────────────────────────────────────────────────────────────────

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx    = this.canvas.getContext('2d');
        this.camera = { x: 0, y: 0, zoom: 0.75 };
        this.pointers = new Map();
        this.lastClickTime = 0; this.lastClickedId = null;
        this.settings = { difficulty: 'medium', aiCount: 2 };
        this.state = 'menu';

        this.mouseScreenX = 0; this.mouseScreenY = 0;
        window.addEventListener('mousemove', e => { this.mouseScreenX = e.clientX; this.mouseScreenY = e.clientY; });

        this._bindMenuUI();
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('resize', () => this.resize());
        this.resize();
        requestAnimationFrame(t => this.loop(t));
    }

    // ── Menu wiring ──────────────────────────────────────────────────────────

    _bindMenuUI() {
        // Difficulty buttons
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.settings.difficulty = btn.dataset.diff;
                document.querySelectorAll('.diff-btn').forEach(b => {
                    b.classList.remove('bg-blue-700', 'ring-2', 'ring-blue-400', 'hover:bg-blue-600');
                    b.classList.add('bg-gray-800', 'hover:bg-gray-700');
                });
                btn.classList.remove('bg-gray-800', 'hover:bg-gray-700');
                btn.classList.add('bg-blue-700', 'ring-2', 'ring-blue-400', 'hover:bg-blue-600');
            });
        });

        // AI count slider
        const slider = document.getElementById('aiCountSlider');
        const label  = document.getElementById('aiCountLabel');
        slider.addEventListener('input', () => {
            this.settings.aiCount = parseInt(slider.value);
            label.textContent = slider.value;
        });

        // New Game
        document.getElementById('newGameBtn').addEventListener('click', () => {
            localStorage.removeItem('kosave');
            this._hideMenu();
            this.init(false);
        });

        // Continue
        const contBtn = document.getElementById('continueBtn');
        if (localStorage.getItem('kosave')) contBtn.removeAttribute('disabled');
        else contBtn.setAttribute('disabled', '');
        contBtn.addEventListener('click', () => {
            if (!localStorage.getItem('kosave')) return;
            this._hideMenu();
            this.init(true);
        });

        // Game Over buttons
        document.getElementById('restartBtn').onclick = () => {
            document.getElementById('gameOverScreen').classList.add('hidden');
            localStorage.removeItem('kosave');
            this.init(false);
        };
        document.getElementById('menuBtn').onclick = () => {
            document.getElementById('gameOverScreen').classList.add('hidden');
            this._showMenu();
        };
    }

    _hideMenu() { document.getElementById('mainMenu').classList.add('hidden'); }
    _showMenu()  {
        document.getElementById('mainMenu').classList.remove('hidden');
        const contBtn = document.getElementById('continueBtn');
        if (localStorage.getItem('kosave')) contBtn.removeAttribute('disabled');
        else contBtn.setAttribute('disabled', '');
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    init(loadSave) {
        this.state = 'playing';
        this.lastTime = performance.now();
        this.aiCount  = this.settings.aiCount;
        this.diff     = DIFFICULTY[this.settings.difficulty];

        // gold[team] — player is 0, AIs are 1..aiCount
        this.gold = Array.from({ length: this.aiCount + 1 }, () => 1000);
        this.aiTimers = Array.from({ length: this.aiCount }, () => 0);

        this.entities = []; this.projectiles = []; this.effects = [];
        this.floatingTexts = []; this.nextId = 1;
        this.selectedIds = new Set();
        this.dragSelect = null; this.placementMode = null;
        this.passiveGoldTimer = 0;

        this.resize();
        this._setupInputs();

        if (loadSave && localStorage.getItem('kosave')) {
            try { this._loadState(); return; } catch(e) { console.warn('Save corrupt, starting fresh.'); }
        }

        // Spawn player
        const ps = SPAWN_POINTS[0];
        this.addEntity('building', 'town_center', ps.x, ps.y, 0);
        for (let i = 0; i < 3; i++)
            this.addEntity('unit', 'builder', ps.x + 80, ps.y + (i - 1) * 50, 0);

        // Spawn AIs
        for (let ai = 1; ai <= this.aiCount; ai++) {
            const sp = SPAWN_POINTS[ai];
            this.addEntity('building', 'town_center', sp.x, sp.y, ai);
            for (let i = 0; i < 3; i++)
                this.addEntity('unit', 'builder', sp.x - 80, sp.y + (i - 1) * 50, ai);
        }

        // Resources
        MINE_POSITIONS.forEach(([mx, my]) =>
            this.addEntity('resource', 'gold_mine', mx, my, -1));

        this.camera.x = ps.x; this.camera.y = ps.y; this._clampCamera();
        this.updateGoldUI(); this.updateUI(); this._updateOpponentsHUD();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    resize()  { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; }
    _clampCamera() {
        const z = this.camera.zoom;
        const topH    = document.querySelector('.ui-layer.top-0')?.offsetHeight    ?? 72;
        const bottomH = document.getElementById('actionMenu')?.closest('.ui-layer')?.offsetHeight ?? 120;
        const hw = this.canvas.width  / 2 / z;
        const hh = this.canvas.height / 2 / z;
        const tw = topH    / z;
        const bw = bottomH / z;
        const half = CONSTANTS.MAP_SIZE / 2;

        // X: symmetric (no significant left/right UI)
        this.camera.x = hw >= half
            ? half
            : Math.max(hw, Math.min(CONSTANTS.MAP_SIZE - hw, this.camera.x));

        // Y: world 0 just below top HUD, world MAP_SIZE just above command card
        const usableHH = (this.canvas.height - topH - bottomH) / 2 / z;
        if (usableHH >= half) {
            // Map fits — center it in the usable area
            this.camera.y = half + (bw - tw) / 2;
        } else {
            // world y=0 at screenY=topH  →  camera.y = hh - tw
            // world y=MAP_SIZE at screenY=canvas.height-bottomH  →  camera.y = MAP_SIZE - hh + bw
            this.camera.y = Math.max(hh - tw, Math.min(CONSTANTS.MAP_SIZE - hh + bw, this.camera.y));
        }
    }
    addGold(team, amount) {
        if (team < 0 || team >= this.gold.length) return;
        this.gold[team] += amount;
        if (team === CONSTANTS.TEAM_PLAYER) this.updateGoldUI();
    }
    addEntity(type, subType, x, y, team) {
        const e = new Entity(this.nextId++, type, subType, x, y, team);
        this.entities.push(e); return e;
    }
    notify(msg, color = 'text-white') {
        const nc = document.getElementById('notificationCenter');
        const el = document.createElement('div');
        el.className = `bg-gray-800/90 border border-gray-600 px-4 py-2 rounded-full text-sm font-bold shadow-lg ${color} transition-all duration-300`;
        el.innerText = msg; nc.appendChild(el);
        setTimeout(() => { el.classList.add('opacity-0'); setTimeout(() => el.remove(), 300); }, 2000);
    }
    screenToWorld(sx, sy) {
        return {
            x: (sx - this.canvas.width  / 2) / this.camera.zoom + this.camera.x,
            y: (sy - this.canvas.height / 2) / this.camera.zoom + this.camera.y
        };
    }
    getEntityAt(wx, wy) {
        for (let i = this.entities.length - 1; i >= 0; i--) {
            const e = this.entities[i];
            if (dist(wx, wy, e.x, e.y) <= e.radius * 1.5) return e;
        }
        return null;
    }
    getSelectedEntities() { return this.entities.filter(e => this.selectedIds.has(e.id)); }
    createEffect(x, y, color) { this.effects.push({ x, y, radius: 0, color, alpha: 1, isDead: false }); }
    createFloatingText(text, x, y, color) { this.floatingTexts.push({ text, x, y, alpha: 1, color, isDead: false }); }
    updateGoldUI() { document.getElementById('goldDisplay').innerText = Math.floor(this.gold[0]); }

    _updateOpponentsHUD() {
        const alive = this.entities.filter(e => e.subType === 'town_center' && e.team !== 0).length;
        document.getElementById('opponentsCount').textContent = `${alive} TC${alive !== 1 ? 's' : ''} alive`;
    }

    // ── Inputs ────────────────────────────────────────────────────────────────

    _setupInputs() {
        // Remove old listeners by cloning the canvas
        const old = this.canvas;
        const fresh = old.cloneNode(false);
        old.parentNode.replaceChild(fresh, old);
        this.canvas = fresh; this.ctx = fresh.getContext('2d');

        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const zd = e.deltaY > 0 ? 0.9 : 1.1;
            const wb = this.screenToWorld(e.clientX, e.clientY);
            this.camera.zoom = Math.max(0.2, Math.min(3.0, this.camera.zoom * zd));
            const wa = this.screenToWorld(e.clientX, e.clientY);
            this.camera.x -= wa.x - wb.x; this.camera.y -= wa.y - wb.y;
            this._clampCamera();
        }, { passive: false });

        this.canvas.addEventListener('pointerdown', e => {
            this.canvas.setPointerCapture(e.pointerId);
            const w = this.screenToWorld(e.clientX, e.clientY);
            const ptr = { sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y,
                          startX: e.clientX, startY: e.clientY, startWx: w.x, startWy: w.y,
                          intent: 'unknown', button: e.button };
            this.pointers.set(e.pointerId, ptr);
            if (e.button === 2) { this.handleRightClick(w.x, w.y); ptr.intent = 'done'; }
        });

        this.canvas.addEventListener('pointermove', e => {
            if (!this.pointers.has(e.pointerId)) return;
            const ptr = this.pointers.get(e.pointerId);
            const oldSx = ptr.sx, oldSy = ptr.sy;
            ptr.sx = e.clientX; ptr.sy = e.clientY;
            const w = this.screenToWorld(e.clientX, e.clientY);
            ptr.wx = w.x; ptr.wy = w.y;
            if (ptr.button !== 0 || ptr.intent === 'done') return;
            if (this.pointers.size === 1) {
                const moved = dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy);
                if (ptr.intent === 'unknown' && moved > 10) {
                    if (this.placementMode) { ptr.intent = 'done'; }
                    else {
                        const hit = this.getEntityAt(ptr.startWx, ptr.startWy);
                        if (!hit || hit.team !== 0) {
                            ptr.intent = 'box';
                            this.dragSelect = { startX: ptr.startWx, startY: ptr.startWy, currentX: ptr.wx, currentY: ptr.wy, active: true };
                        } else { ptr.intent = 'pan'; }
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
        });

        this.canvas.addEventListener('pointerup', e => {
            const ptr = this.pointers.get(e.pointerId); if (!ptr) return;
            if (ptr.button === 0 && ptr.intent !== 'done') {
                if (ptr.intent === 'box' && this.dragSelect?.active) this._performBoxSelect();
                else if (dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy) < 10) this.handleTap(ptr.wx, ptr.wy);
            }
            this.pointers.delete(e.pointerId); this.dragSelect = null;
        });
    }

    _performBoxSelect() {
        const { startX, startY, currentX, currentY } = this.dragSelect;
        const minX = Math.min(startX, currentX), maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY), maxY = Math.max(startY, currentY);
        const inBox = e => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY;
        const units = this.entities.filter(e => e.team === 0 && e.type === 'unit' && inBox(e));
        this.selectedIds.clear();
        (units.length > 0 ? units : this.entities.filter(e => e.team === 0 && inBox(e)))
            .forEach(e => this.selectedIds.add(e.id));
        this.updateUI();
    }

    handleRightClick(wx, wy) {
        if (!this.selectedIds.size) return;
        const units = this.getSelectedEntities().filter(e => e.type === 'unit');
        if (!units.length) return;
        const clicked = this.getEntityAt(wx, wy);
        if (clicked) {
            if (clicked.team !== 0) {
                units.forEach(u => { u.target = clicked; u.state = 'moving_to_attack'; });
                this.createEffect(clicked.x, clicked.y, clicked.type === 'resource' ? '#fbbf24' : '#ef4444');
            } else if (clicked.isConstructing) {
                units.filter(u => u.subType === 'builder').forEach(u => { u.target = clicked; u.state = 'moving_to_build'; });
                this.createEffect(clicked.x, clicked.y, '#3b82f6');
            } else { this._formationMove(units, wx, wy); this.createEffect(wx, wy, '#4ade80'); }
        } else { this._formationMove(units, wx, wy); this.createEffect(wx, wy, '#4ade80'); }
    }

    handleTap(wx, wy) {
        if (this.placementMode) {
            if (this.gold[0] < STATS[this.placementMode].cost) { this.notify("Not enough gold!", "text-red-400"); this.cancelPlacement(); return; }
            const bldrs = this.getSelectedEntities().filter(e => e.subType === 'builder');
            if (bldrs.length > 0) {
                this.gold[0] -= STATS[this.placementMode].cost; this.updateGoldUI();
                const b = this.addEntity('building', this.placementMode, wx, wy, 0);
                b.isConstructing = true; b.hp = 1;
                bldrs.forEach(u => { u.target = b; u.state = 'moving_to_build'; });
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
                        dist(e.x, e.y, this.camera.x, this.camera.y) < this.canvas.width / this.camera.zoom)
                        this.selectedIds.add(e.id);
                });
            } else {
                this.selectedIds.clear(); this.selectedIds.add(clicked.id);
            }
            this.lastClickTime = now; this.lastClickedId = clicked.id;
        } else { this.selectedIds.clear(); }
        this.updateUI();
    }

    selectAllUnits() {
        this.selectedIds.clear();
        this.entities.forEach(e => {
            if (e.team === 0 && (e.subType === 'soldier' || e.subType === 'archer'))
                this.selectedIds.add(e.id);
        });
        this.updateUI();
    }

    _formationMove(units, tx, ty) {
        const rows = Math.ceil(Math.sqrt(units.length)), spacing = 35;
        const sx = tx - (rows * spacing) / 2, sy = ty - (rows * spacing) / 2;
        units.forEach((u, i) => {
            u.targetX = sx + (i % rows) * spacing;
            u.targetY = sy + Math.floor(i / rows) * spacing;
            u.target = null; u.state = 'moving';
        });
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(dt) {
        if (this.state !== 'playing') return;

        // Edge scroll
        const EDGE = 48, EDGE_SPEED = 900;
        const { mouseScreenX: mx, mouseScreenY: my } = this;
        const W = this.canvas.width, H = this.canvas.height;
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

        // Passive income for all teams
        this.passiveGoldTimer += dt;
        if (this.passiveGoldTimer >= 1.0) {
            for (let t = 0; t < this.gold.length; t++) this.gold[t] += 1.5;
            this.passiveGoldTimer = 0; this.updateGoldUI();
        }

        // AI ticks
        for (let ai = 1; ai <= this.aiCount; ai++) {
            this.aiTimers[ai - 1] -= dt;
            if (this.aiTimers[ai - 1] <= 0) {
                this.aiTimers[ai - 1] = this.diff.tickRate;
                this._updateAI(ai);
            }
        }

        for (let p of this.projectiles) p.update(dt);
        this.projectiles = this.projectiles.filter(p => !p.isDead);

        // Unit steering
        for (let e of this.entities) {
            if (e.type !== 'unit') continue;
            // Auto-aggro
            if (e.state === 'idle' || e.state === 'moving') {
                let nearest = null, best = 220;
                for (let o of this.entities) {
                    if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                        let score = dist(e.x, e.y, o.x, o.y) + (o.type === 'building' ? 100 : 0);
                        if (score < best) { best = score; nearest = o; }
                    }
                }
                if (nearest) { e.target = nearest; e.state = 'moving_to_attack'; }
            }
            const stats = STATS[e.subType];
            let tvx = 0, tvy = 0;
            if (e.state.startsWith('moving')) {
                const tx = e.state === 'moving' ? e.targetX : (e.target?.x ?? e.targetX);
                const ty = e.state === 'moving' ? e.targetY : (e.target?.y ?? e.targetY);
                if (tx != null) {
                    const d = dist(e.x, e.y, tx, ty);
                    const stop = e.state === 'moving_to_attack' ? stats.range + (e.target?.radius ?? 0)
                               : e.state === 'moving_to_build'  ? 25 + (e.target?.radius ?? 0) : 5;
                    if (d <= stop) {
                        e.state = e.state === 'moving_to_attack' ? 'attacking'
                                : e.state === 'moving_to_build'  ? 'building' : 'idle';
                    } else {
                        const a = angle(e.x, e.y, tx, ty);
                        tvx = Math.cos(a) * stats.speed; tvy = Math.sin(a) * stats.speed;
                    }
                } else e.state = 'idle';
            }
            let avx = 0, avy = 0;
            for (let o of this.entities) {
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
        for (let e of this.entities) {
            if (e.timer > 0) e.timer -= dt;

            // Town center auto-attack
            if (e.subType === 'town_center' && !e.isConstructing && e.timer <= 0) {
                let nearest = null, best = STATS.town_center.range;
                for (let o of this.entities) {
                    if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                        const d = dist(e.x, e.y, o.x, o.y);
                        if (d < best) { best = d; nearest = o; }
                    }
                }
                if (nearest) { this.projectiles.push(new Projectile(e.x, e.y, nearest, STATS.town_center.damage, e.team)); e.timer = STATS.town_center.cooldown; }
            }

            if (e.type === 'unit') {
                e.x += e.velX * dt; e.y += e.velY * dt;

                if (e.state === 'attacking') {
                    if (!e.target || e.target.isDead) { e.state = 'idle'; e.target = null; }
                    else if (dist(e.x, e.y, e.target.x, e.target.y) > STATS[e.subType].range + e.target.radius + 30) e.state = 'moving_to_attack';
                    else if (e.timer <= 0) {
                        const s = STATS[e.subType];
                        if (s.range > 50) this.projectiles.push(new Projectile(e.x, e.y, e.target, s.damage, e.team));
                        else e.target.damage(s.damage, e.team);
                        e.timer = s.cooldown;
                    }
                }
                if (e.state === 'building') {
                    if (!e.target || e.target.isDead || !e.target.isConstructing) { e.state = 'idle'; }
                    else if (e.timer <= 0) {
                        e.target.hp += 60; e.timer = 0.5;
                        if (e.target.hp >= e.target.maxHp) { e.target.hp = e.target.maxHp; e.target.isConstructing = false; e.state = 'idle'; }
                    }
                }
            }

            // Building production
            if (e.type === 'building' && !e.isConstructing && e.buildQueue.length > 0 && e.timer <= 0) {
                const unit = e.buildQueue.shift();
                this.addEntity('unit', unit, e.x, e.y + e.radius + 20, e.team);
                if (e.buildQueue.length > 0) e.timer = this.diff.buildDelay * 3;
            }
        }

        // Remove dead entities
        let tcDied = false;
        for (let i = this.entities.length - 1; i >= 0; i--) {
            if (this.entities[i].isDead) {
                if (this.entities[i].subType === 'town_center') tcDied = true;
                this.selectedIds.delete(this.entities[i].id);
                this.entities.splice(i, 1);
            }
        }
        if (tcDied) this._checkWinCondition();

        this.effects.forEach(ef => { ef.radius += 80 * dt; ef.alpha -= 2 * dt; if (ef.alpha <= 0) ef.isDead = true; });
        this.effects = this.effects.filter(ef => !ef.isDead);
        this.floatingTexts.forEach(ft => { ft.y -= 40 * dt; ft.alpha -= 1 * dt; if (ft.alpha <= 0) ft.isDead = true; });
        this.floatingTexts = this.floatingTexts.filter(ft => !ft.isDead);
    }

    _checkWinCondition() {
        const tcs = this.entities.filter(e => e.subType === 'town_center');
        const playerAlive = tcs.some(e => e.team === 0);
        const aiAlive     = tcs.some(e => e.team !== 0);
        this._updateOpponentsHUD();
        if (!playerAlive) { this._endGame(false); return; }
        if (!aiAlive)     { this._endGame(true);  return; }
    }

    // ── AI ────────────────────────────────────────────────────────────────────

    _updateAI(team) {
        const units   = this.entities.filter(e => e.team === team);
        const tc      = units.find(e => e.subType === 'town_center'); if (!tc) return;
        const gold    = this.gold[team];
        const builders = units.filter(e => e.subType === 'builder');
        const idleB   = builders.filter(e => e.state === 'idle');

        // Idle builders mine
        if (idleB.length > 0) {
            const mines = this.entities.filter(e => e.type === 'resource' && !e.isDead);
            if (mines.length > 0) idleB.forEach(b => {
                const closest = mines.reduce((prev, curr) =>
                    dist(b.x, b.y, curr.x, curr.y) < dist(b.x, b.y, prev.x, prev.y) ? curr : prev);
                b.target = closest; b.state = 'moving_to_attack';
            });
        }

        // Train builders
        if (builders.length < 4 && gold >= 50) { tc.buildQueue.push('builder'); this.gold[team] -= 50; if (tc.timer <= 0) tc.timer = 2; }

        // Build barracks
        const bar = units.find(e => e.subType === 'barracks');
        if (!bar && gold >= 150) {
            const b = builders.find(e => e.state !== 'moving_to_build');
            if (b) {
                this.gold[team] -= 150;
                const bld = this.addEntity('building', 'barracks', tc.x + (team % 2 === 0 ? 1 : -1) * 150, tc.y + 150, team);
                bld.isConstructing = true; bld.hp = 1;
                b.target = bld; b.state = 'moving_to_build';
            }
        }

        // Train soldiers
        if (bar && !bar.isConstructing && gold >= 75 && bar.buildQueue.length < 3) {
            bar.buildQueue.push('soldier'); this.gold[team] -= 75; if (bar.timer <= 0) bar.timer = 2.5;
        }

        // Attack with army
        const army = units.filter(e => e.subType === 'soldier' && e.state === 'idle');
        if (army.length >= this.diff.armyThreshold) {
            // Target nearest enemy TC
            const enemyTCs = this.entities.filter(e => e.subType === 'town_center' && e.team !== team);
            if (enemyTCs.length > 0) {
                const targetTC = enemyTCs.reduce((prev, curr) =>
                    dist(tc.x, tc.y, curr.x, curr.y) < dist(tc.x, tc.y, prev.x, prev.y) ? curr : prev);
                army.forEach(u => { u.target = targetTC; u.state = 'moving_to_attack'; });
            }
        }
    }

    // ── Draw ──────────────────────────────────────────────────────────────────

    draw() {
        if (this.state !== 'playing') return;
        const { ctx, canvas, camera } = this;
        ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        // Grid
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
        for (let i = 0; i <= CONSTANTS.MAP_SIZE; i += 200) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CONSTANTS.MAP_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(CONSTANTS.MAP_SIZE, i); ctx.stroke();
        }
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, CONSTANTS.MAP_SIZE, CONSTANTS.MAP_SIZE);

        this.entities.sort((a, b) => a.y - b.y);
        for (const e of this.entities) {
            // Selection ring
            if (this.selectedIds.has(e.id)) {
                ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.ellipse(e.x, e.y + e.radius * 0.3, e.radius * 1.3, e.radius * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.fillStyle = e.color;
            if (e.isConstructing) ctx.globalAlpha = 0.5;
            ctx.beginPath();
            if (e.type === 'building' || e.type === 'resource')
                ctx.roundRect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2, 8);
            else ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.fill(); ctx.globalAlpha = 1;

            // Border color
            ctx.strokeStyle = e.team === -1 ? '#fbbf24' : TEAM_COLORS[e.team] ?? '#fff';
            ctx.lineWidth = 3; ctx.stroke();

            // Resource label
            if (e.type === 'resource' && e.goldLeft > 0) {
                ctx.fillStyle = 'white'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(`${Math.floor(e.goldLeft)}G`, e.x, e.y + 4);
            }

            // HP bar
            if (e.hp < e.maxHp || this.selectedIds.has(e.id) || e.isConstructing) {
                const w = e.radius * 2;
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 4);
                ctx.fillStyle = e.isConstructing ? '#fbbf24'
                              : e.type === 'resource' ? '#fbbf24'
                              : TEAM_COLORS[e.team] ?? '#fff';
                ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w * (e.hp / e.maxHp), 4);
            }
        }

        for (const p of this.projectiles) p.draw(ctx);

        this.effects.forEach(ef => {
            ctx.strokeStyle = ef.color; ctx.globalAlpha = ef.alpha;
            ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.radius, 0, Math.PI * 2); ctx.stroke();
        });
        ctx.globalAlpha = 1;
        this.floatingTexts.forEach(ft => {
            ctx.globalAlpha = ft.alpha; ctx.fillStyle = ft.color;
            ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(ft.text, ft.x, ft.y);
        });
        ctx.globalAlpha = 1;

        // Building placement ghost
        if (this.placementMode) {
            const wp = this.screenToWorld(this.mouseScreenX, this.mouseScreenY);
            const r  = STATS[this.placementMode].radius;
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = TEAM_COLORS[0];
            ctx.beginPath(); ctx.roundRect(wp.x - r, wp.y - r, r * 2, r * 2, 8); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2; ctx.stroke();
        }

        // Drag-select box
        if (this.dragSelect?.active) {
            const { startX: bx, startY: by, currentX, currentY } = this.dragSelect;
            ctx.fillStyle = 'rgba(59,130,246,0.15)'; ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1;
            ctx.fillRect(bx, by, currentX - bx, currentY - by);
            ctx.strokeRect(bx, by, currentX - bx, currentY - by);
        }
        ctx.restore();
    }

    // ── UI ────────────────────────────────────────────────────────────────────

    updateUI() {
        const menu = document.getElementById('actionMenu'); menu.innerHTML = '';
        const sel  = this.getSelectedEntities();
        document.getElementById('selectionInfo').innerText = sel.length ? `${sel.length} selected` : 'No selection';
        const hasBuilders = sel.some(e => e.subType === 'builder' && e.team === 0);
        if (sel.length === 1 && sel[0].team === 0 && !sel[0].isConstructing) {
            const b = sel[0];
            if      (b.subType === 'town_center')   menu.appendChild(this._btn('Train Builder (50g)',     () => this._trainUnit(b, 'builder')));
            else if (b.subType === 'barracks')       menu.appendChild(this._btn('Train Soldier (75g)',    () => this._trainUnit(b, 'soldier')));
            else if (b.subType === 'archery_range')  menu.appendChild(this._btn('Train Archer (100g)',    () => this._trainUnit(b, 'archer')));
        }
        if (hasBuilders) {
            menu.appendChild(this._btn('Build Barracks (150g)',      () => this.startPlacement('barracks')));
            menu.appendChild(this._btn('Build Archery Range (200g)', () => this.startPlacement('archery_range')));
        }
    }

    _btn(text, onClick) {
        const btn = document.createElement('button');
        btn.className = 'whitespace-nowrap px-4 py-2 bg-blue-600 rounded-lg text-sm font-bold shadow-md active:scale-95 transition-transform interactive hover:bg-blue-500';
        btn.innerText = text;
        btn.onclick = e => { e.stopPropagation(); onClick(); };
        return btn;
    }

    _trainUnit(building, type) {
        if (this.gold[0] >= STATS[type].cost) {
            this.gold[0] -= STATS[type].cost; building.buildQueue.push(type);
            if (building.timer <= 0) building.timer = 2; this.updateGoldUI();
        } else this.notify('Low Gold!', 'text-red-400');
    }

    startPlacement(type) {
        this.placementMode = type;
        document.getElementById('placementHint').classList.remove('hidden');
        document.getElementById('actionMenu').classList.add('hidden');
    }
    cancelPlacement() {
        this.placementMode = null;
        document.getElementById('placementHint').classList.add('hidden');
        document.getElementById('actionMenu').classList.remove('hidden');
    }

    _endGame(win) {
        this.state = 'gameover';
        localStorage.removeItem('kosave');
        document.getElementById('gameOverScreen').classList.remove('hidden');
        const title = document.getElementById('gameOverTitle');
        const desc  = document.getElementById('gameOverDesc');
        if (win) {
            title.innerText = 'VICTORY'; title.className = 'text-5xl font-black mb-2 tracking-tight text-blue-400';
            desc.innerText = 'All enemies have been crushed.';
        } else {
            title.innerText = 'DEFEAT'; title.className = 'text-5xl font-black mb-2 tracking-tight text-red-500';
            desc.innerText = 'Your Town Center was destroyed.';
        }
    }

    // ── Save / Load ───────────────────────────────────────────────────────────

    _saveState() {
        try {
            localStorage.setItem('kosave', JSON.stringify({
                difficulty: this.settings.difficulty,
                aiCount:    this.settings.aiCount
            }));
            const contBtn = document.getElementById('continueBtn');
            if (contBtn) contBtn.removeAttribute('disabled');
        } catch(e) {}
    }

    _loadState() {
        const raw = localStorage.getItem('kosave');
        const data = JSON.parse(raw);
        this.settings.difficulty = data.difficulty ?? 'medium';
        this.settings.aiCount    = data.aiCount    ?? 2;
        this.aiCount = this.settings.aiCount;
        this.diff    = DIFFICULTY[this.settings.difficulty];
        this.init(false);
    }

    // ── Loop ──────────────────────────────────────────────────────────────────

    loop(time) {
        const dt = Math.min(0.05, (time - (this.lastTime ?? time)) / 1000);
        this.lastTime = time;
        this.update(dt); this.draw();
        requestAnimationFrame(t => this.loop(t));
    }
}

window.onload = () => { window.game = new Game(); };
