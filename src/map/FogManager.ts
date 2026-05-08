import { CONSTANTS } from '../constants';
import { dist } from '../utils';
import type { Entity } from '../entity';

export const FOG_CELL  = 80;
export const FOG_SIGHT = 260;
export const FOG_ALPHA = 0.88;

export class FogManager {
    fogGrid: boolean[][] = [];
    fogDirty = false;
    fogCols = 0;
    fogRows = 0;

    init(): void {
        const { MAP_SIZE } = CONSTANTS;
        this.fogCols = Math.ceil(MAP_SIZE / FOG_CELL);
        this.fogRows = Math.ceil(MAP_SIZE / FOG_CELL);
        this.fogGrid = Array.from({ length: this.fogRows }, () => new Array(this.fogCols).fill(false));
        this.fogDirty = true;
    }

    update(entities: Entity[]): void {
        const playerUnits = entities.filter(e => e.team === CONSTANTS.TEAM_PLAYER && !e.isDead);
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
}
