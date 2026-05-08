import type { Entity } from '../entity';
import type { Projectile } from '../projectile';
import type { Effect, FloatingText, DragSelect, PointerState } from '../types';
import type { SubType, DifficultyConfig } from '../constants';

export class GameState {
    gold: number[] = [];
    population: number[] = [];
    maxPop: number[] = [];
    aiTimers: number[] = [];
    aiCount = 0;
    diff!: DifficultyConfig;

    entities: Entity[] = [];
    projectiles: Projectile[] = [];
    effects: Effect[] = [];
    floatingTexts: FloatingText[] = [];
    nextId = 1;

    selectedIds = new Set<number>();
    dragSelect: DragSelect | null = null;
    placementMode: SubType | null = null;
    controlGroups = new Map<number, number[]>();
    lastGroupTap = { group: -1, time: 0 };

    passiveGoldTimer = 0;
    techs = new Set<string>();

    stoneGrid: boolean[][] | null = null;
    mapCellSize = 0;
    mapSeed: number | null = null;

    pointers = new Map<number, PointerState>();
    gamePhase: 'menu' | 'playing' | 'gameover' = 'menu';
}
