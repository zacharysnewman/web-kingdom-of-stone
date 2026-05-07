export type EntityType = 'building' | 'unit' | 'resource';
export type EntityState = 'idle' | 'moving' | 'moving_to_attack' | 'moving_to_build' | 'attacking' | 'building';

export interface Point {
    x: number;
    y: number;
}

export interface Effect {
    x: number;
    y: number;
    radius: number;
    color: string;
    alpha: number;
    isDead: boolean;
}

export interface FloatingText {
    text: string;
    x: number;
    y: number;
    alpha: number;
    color: string;
    isDead: boolean;
}

export interface DragSelect {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    active: boolean;
}

export interface PointerState {
    sx: number;
    sy: number;
    wx: number;
    wy: number;
    startX: number;
    startY: number;
    startWx: number;
    startWy: number;
    intent: 'unknown' | 'box' | 'pan' | 'done';
    button: number;
}

export interface IGameContext {
    readonly TEAM_PLAYER: number;
    addGold(team: number, amount: number): void;
    createFloatingText(text: string, x: number, y: number, color: string): void;
}
