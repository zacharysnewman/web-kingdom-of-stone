export const CONSTANTS = {
    MAP_SIZE: 3000,
    TEAM_PLAYER: 0,
    AVOIDANCE_FORCE: 120,
    AVOIDANCE_RADIUS_MULT: 1.8,
    NAV_CELL: 40,
} as const;

// Isometric projection constants (2:1 iso, 32×16 diamond tiles)
export const ISO = {
    TW: 32,   // diamond pixel width
    TH: 16,   // diamond pixel height
    CELL: 40, // world units per tile (= NAV_CELL)
    SX: 0.4,  // (TW/2) / CELL — world→iso x scale
    SY: 0.2,  // (TH/2) / CELL — world→iso y scale
} as const;

export const TEAM_COLORS: string[] = ['#3b82f6', '#ef4444', '#f97316', '#a855f7', '#ec4899', '#14b8a6'];
export const TEAM_UNIT_COLORS: string[] = ['#93c5fd', '#fca5a5', '#fdba74', '#d8b4fe', '#f9a8d4', '#99f6e4'];

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
    tickRate: number;
    armyThreshold: number;
    buildDelay: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
    easy:   { tickRate: 2.5, armyThreshold: 5,  buildDelay: 1.2 },
    medium: { tickRate: 1.0, armyThreshold: 3,  buildDelay: 1.0 },
    hard:   { tickRate: 0.5, armyThreshold: 2,  buildDelay: 0.7 },
};

export type SubType = 'town_center' | 'barracks' | 'archery_range' | 'gold_mine' | 'builder' | 'soldier' | 'archer';

export interface StatBlock {
    type: 'building' | 'unit' | 'resource';
    cost: number;
    hp: number;
    radius: number;
    label: string;
    speed?: number;
    range?: number;
    damage?: number;
    cooldown?: number;
    goldValue?: number;
    color?: string;
    popCap?: number;   // population capacity provided by this building
    popCost?: number;  // population consumed by this unit
    buildTime?: number; // seconds to train this unit
}

export const STATS: Record<SubType, StatBlock> = {
    town_center:   { type: 'building', cost: 0,   hp: 2400, radius: 45, label: 'Town Center', range: 250, damage: 15, cooldown: 0.28, popCap: 10 },
    barracks:      { type: 'building', cost: 150,  hp: 700,  radius: 35, label: 'Barracks',                                                        popCap: 5  },
    archery_range: { type: 'building', cost: 200,  hp: 550,  radius: 35, label: 'Archery Range',                                                    popCap: 5  },
    gold_mine:     { type: 'resource', cost: 0,   hp: 2000, goldValue: 500, radius: 40, color: '#d97706', label: 'Gold Mine' },
    builder:       { type: 'unit', cost: 50,  hp: 80,  radius: 10, speed: 70,  range: 30,  damage: 8,  cooldown: 0.8,  label: 'Builder',  popCost: 1, buildTime: 10 },
    soldier:       { type: 'unit', cost: 75,  hp: 240, radius: 12, speed: 85,  range: 25,  damage: 18, cooldown: 1.0,  label: 'Soldier',  popCost: 1, buildTime: 14 },
    archer:        { type: 'unit', cost: 100, hp: 120, radius: 10, speed: 75,  range: 160, damage: 22, cooldown: 1.4,  label: 'Archer',   popCost: 1, buildTime: 18 },
};

export interface UnitSpriteConfig {
    file: string;
    frameW: number;
    frameH: number;
    frameCount: number;
    row: number;
    scale: number;
}

export const UNIT_SPRITES: Partial<Record<SubType, UnitSpriteConfig>> = {
    builder: { file: 'sprites/MiniPrinceMan.png', frameW: 32, frameH: 32, frameCount: 4, row: 0, scale: 2 },
    soldier: { file: 'sprites/MiniSwordMan.png',  frameW: 32, frameH: 32, frameCount: 4, row: 0, scale: 2 },
    archer:  { file: 'sprites/MiniArcherMan.png', frameW: 32, frameH: 32, frameCount: 4, row: 0, scale: 2 },
};

export const SPAWN_POINTS: { x: number; y: number }[] = [
    { x: 500,                        y: CONSTANTS.MAP_SIZE / 2 },
    { x: CONSTANTS.MAP_SIZE - 500,   y: CONSTANTS.MAP_SIZE / 2 },
    { x: CONSTANTS.MAP_SIZE / 2,     y: 500 },
    { x: CONSTANTS.MAP_SIZE / 2,     y: CONSTANTS.MAP_SIZE - 500 },
    { x: 500,                        y: 500 },
    { x: CONSTANTS.MAP_SIZE - 500,   y: CONSTANTS.MAP_SIZE - 500 },
];
