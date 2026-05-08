import { STATS } from '../constants';
import type { Difficulty, SubType } from '../constants';
import type { Entity } from '../entity';
import type { UnitStance } from '../types';
import { playerStore } from '../store';

export interface UICallbacks {
    onTrainUnit: (building: Entity, type: SubType) => void;
    onStartPlacement: (type: SubType) => void;
    onResearchTech: (key: string, cost: number) => void;
    onStanceChange: (units: Entity[], stance: UnitStance) => void;
}

export interface MenuCallbacks {
    onNewGame: () => void;
    onContinue: () => void;
    onRestart: () => void;
    onMenu: () => void;
}

export class UIManager {
    private _difficulty: Difficulty = 'medium';
    private _aiCount = 2;

    constructor() {
        playerStore.subscribe(s => {
            document.getElementById('goldDisplay')!.innerText = String(Math.floor(s.gold));
            document.getElementById('popDisplay')!.innerText = `${s.population} / ${s.maxPop}`;
        });
    }

    get difficulty(): Difficulty { return this._difficulty; }
    get aiCount(): number        { return this._aiCount; }

    applySettings(difficulty: Difficulty, aiCount: number): void {
        this._difficulty = difficulty;
        this._aiCount    = aiCount;
    }

    bindMenuUI(callbacks: MenuCallbacks): void {
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._difficulty = (btn as HTMLElement).dataset['diff'] as Difficulty;
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
            this._aiCount = parseInt(slider.value);
            label.textContent = slider.value;
        });

        document.getElementById('newGameBtn')!.addEventListener('click', callbacks.onNewGame);

        const contBtn = document.getElementById('continueBtn') as HTMLButtonElement;
        this._updateContinueBtn(contBtn);
        contBtn.addEventListener('click', callbacks.onContinue);

        document.getElementById('restartBtn')!.addEventListener('click', () => {
            document.getElementById('gameOverScreen')!.classList.add('hidden');
            callbacks.onRestart();
        });
        document.getElementById('menuBtn')!.addEventListener('click', () => {
            document.getElementById('gameOverScreen')!.classList.add('hidden');
            callbacks.onMenu();
        });
    }

    hideMenu(): void { document.getElementById('mainMenu')!.classList.add('hidden'); }

    showMenu(): void {
        document.getElementById('mainMenu')!.classList.remove('hidden');
        this._updateContinueBtn(document.getElementById('continueBtn') as HTMLButtonElement);
    }

    markSaveExists(exists: boolean): void {
        this._updateContinueBtn(document.getElementById('continueBtn') as HTMLButtonElement, exists);
    }

    notify(msg: string, color = 'text-white'): void {
        const nc = document.getElementById('notificationCenter')!;
        const el = document.createElement('div');
        el.className = `bg-gray-800/90 border border-gray-600 px-4 py-2 rounded-full text-sm font-bold shadow-lg ${color} transition-all duration-300`;
        el.innerText = msg;
        nc.appendChild(el);
        setTimeout(() => { el.classList.add('opacity-0'); setTimeout(() => el.remove(), 300); }, 2000);
    }

    updateOpponentsHUD(aliveCount: number): void {
        document.getElementById('opponentsCount')!.textContent =
            `${aliveCount} TC${aliveCount !== 1 ? 's' : ''} alive`;
    }

    refreshTrainingProgress(
        building: Entity | null,
        population: number,
        maxPop: number,
    ): void {
        const progressEl = document.getElementById('trainingProgress')!;
        const statusEl   = document.getElementById('trainingStatus')!;
        const barEl      = document.getElementById('trainingBar') as HTMLElement;
        const queueCount = document.getElementById('trainingQueueCount')!;

        if (!building || building.buildQueue.length === 0) {
            progressEl.classList.add('hidden');
            return;
        }

        progressEl.classList.remove('hidden');
        const front     = building.buildQueue[0];
        const buildTime = STATS[front].buildTime ?? 10;
        const atCap     = building.timer <= 0 && population >= maxPop;

        if (atCap) {
            statusEl.textContent = `⏸ Population limit reached — ${STATS[front].label} ready`;
            statusEl.className   = 'text-xs font-semibold text-orange-400';
            barEl.style.width    = '100%';
            barEl.className      = 'bg-orange-500 h-2 rounded-full';
        } else {
            const pct = building.timer <= 0 ? 100 : Math.max(0, (1 - building.timer / buildTime) * 100);
            statusEl.textContent = `Training: ${STATS[front].label}`;
            statusEl.className   = 'text-xs font-semibold text-gray-300';
            barEl.style.width    = `${pct.toFixed(1)}%`;
            barEl.className      = 'bg-blue-500 h-2 rounded-full';
        }

        queueCount.textContent = building.buildQueue.length > 1 ? `+${building.buildQueue.length - 1} queued` : '';
    }

    updateUI(
        selectedEntities: Entity[],
        techs: Set<string>,
        callbacks: UICallbacks,
    ): void {
        const menu = document.getElementById('actionMenu')!;
        menu.innerHTML = '';

        document.getElementById('selectionInfo')!.innerText =
            selectedEntities.length ? `${selectedEntities.length} selected` : 'No selection';

        const sel = selectedEntities;
        const hasBuilders = sel.some(e => e.subType === 'builder' && e.team === 0);

        if (sel.length === 1 && sel[0].team === 0 && !sel[0].isConstructing) {
            const b = sel[0];
            if (b.subType === 'town_center') {
                menu.appendChild(this._btn('Train Builder (50g)', () => callbacks.onTrainUnit(b, 'builder')));
                if (!techs.has('mining_efficiency')) menu.appendChild(this._btn('Mining Speed (200g)', () => callbacks.onResearchTech('mining_efficiency', 200)));
                if (!techs.has('archer_damage'))     menu.appendChild(this._btn('Archer Dmg (200g)',   () => callbacks.onResearchTech('archer_damage', 200)));
                if (!techs.has('soldier_hp'))        menu.appendChild(this._btn('Soldier HP (200g)',   () => callbacks.onResearchTech('soldier_hp', 200)));
            } else if (b.subType === 'barracks') {
                menu.appendChild(this._btn('Train Soldier (75g)', () => callbacks.onTrainUnit(b, 'soldier')));
            } else if (b.subType === 'archery_range') {
                menu.appendChild(this._btn('Train Archer (100g)', () => callbacks.onTrainUnit(b, 'archer')));
            }
        }

        if (hasBuilders) {
            menu.appendChild(this._btn('Build Barracks (150g)',      () => callbacks.onStartPlacement('barracks')));
            menu.appendChild(this._btn('Build Archery Range (200g)', () => callbacks.onStartPlacement('archery_range')));
        }

        const combatUnits = sel.filter(e => e.type === 'unit' && e.subType !== 'builder' && e.team === 0);
        if (combatUnits.length > 0) {
            const stances: [UnitStance, string][] = [['aggressive', 'Aggressive'], ['defensive', 'Defensive'], ['hold', 'Hold Ground']];
            for (const [s, label] of stances) {
                const active = combatUnits.every(u => u.stance === s);
                menu.appendChild(this._stanceBtn(label, active, () => {
                    callbacks.onStanceChange(combatUnits, s);
                    this.updateUI(selectedEntities, techs, callbacks);
                }));
            }
        }
    }

    private _updateContinueBtn(btn: HTMLButtonElement, exists = !!localStorage.getItem('kosave')): void {
        if (exists) btn.removeAttribute('disabled');
        else        btn.setAttribute('disabled', '');
    }

    private _btn(text: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'whitespace-nowrap px-4 py-2 bg-blue-600 rounded-lg text-sm font-bold shadow-md active:scale-95 transition-transform interactive hover:bg-blue-500';
        btn.innerText = text;
        btn.onclick = e => { e.stopPropagation(); onClick(); };
        return btn;
    }

    private _stanceBtn(text: string, active: boolean, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = `whitespace-nowrap px-4 py-2 rounded-lg text-sm font-bold shadow-md active:scale-95 transition-transform interactive ${
            active ? 'bg-blue-600 hover:bg-blue-500 ring-2 ring-blue-400' : 'bg-gray-700 hover:bg-gray-600'
        }`;
        btn.innerText = text;
        btn.onclick = e => { e.stopPropagation(); onClick(); };
        return btn;
    }
}
