import type { Difficulty } from '../constants';

export interface SaveData {
    difficulty: Difficulty;
    aiCount: number;
    mapSeed: number | null;
}

export class SaveManager {
    private static readonly KEY = 'kosave';

    save(data: SaveData): void {
        try {
            localStorage.setItem(SaveManager.KEY, JSON.stringify(data));
        } catch { /* storage full or blocked */ }
    }

    load(): SaveData | null {
        const raw = localStorage.getItem(SaveManager.KEY);
        if (!raw) return null;
        return JSON.parse(raw) as SaveData;
    }

    hasSave(): boolean {
        return !!localStorage.getItem(SaveManager.KEY);
    }

    clear(): void {
        localStorage.removeItem(SaveManager.KEY);
    }
}
