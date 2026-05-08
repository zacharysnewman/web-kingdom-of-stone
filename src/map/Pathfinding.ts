import PF from 'pathfinding';
import { CONSTANTS } from '../constants';
import type { Entity } from '../entity';
import type { Point } from '../types';

export class Pathfinding {
    private navGrid: PF.Grid | null = null;
    private navFinder: PF.AStarFinder | null = null;

    init(stoneGrid: boolean[][], mapCellSize: number): void {
        const { MAP_SIZE, NAV_CELL } = CONSTANTS;
        const NW = Math.ceil(MAP_SIZE / NAV_CELL);
        const NH = Math.ceil(MAP_SIZE / NAV_CELL);
        this.navGrid   = new PF.Grid(NW, NH);
        this.navFinder = new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles });
        const SC = mapCellSize;
        for (let sy = 0; sy < stoneGrid.length; sy++) {
            for (let sx = 0; sx < stoneGrid[sy].length; sx++) {
                if (!stoneGrid[sy][sx]) continue;
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

    markEntityOnGrid(entity: Entity, walkable: boolean, stoneGrid: boolean[][], mapCellSize: number): void {
        if (!this.navGrid) return;
        const { MAP_SIZE, NAV_CELL } = CONSTANTS;
        const NW = Math.ceil(MAP_SIZE / NAV_CELL);
        const NH = Math.ceil(MAP_SIZE / NAV_CELL);
        const r = entity.radius;
        const nx0 = Math.max(0, Math.floor((entity.x - r) / NAV_CELL));
        const nx1 = Math.min(NW - 1, Math.floor((entity.x + r) / NAV_CELL));
        const ny0 = Math.max(0, Math.floor((entity.y - r) / NAV_CELL));
        const ny1 = Math.min(NH - 1, Math.floor((entity.y + r) / NAV_CELL));
        for (let ny = ny0; ny <= ny1; ny++) {
            for (let nx = nx0; nx <= nx1; nx++) {
                if (walkable) {
                    const scx = Math.floor(nx * NAV_CELL / mapCellSize);
                    const scy = Math.floor(ny * NAV_CELL / mapCellSize);
                    const onStone = stoneGrid?.[scy]?.[scx];
                    if (!onStone) this.navGrid!.setWalkableAt(nx, ny, true);
                } else {
                    this.navGrid.setWalkableAt(nx, ny, false);
                }
            }
        }
    }

    rebuild(entities: Entity[], stoneGrid: boolean[][], mapCellSize: number): void {
        this.init(stoneGrid, mapCellSize);
        for (const e of entities)
            if (e.type === 'building' && !e.isDead)
                this.markEntityOnGrid(e, false, stoneGrid, mapCellSize);
    }

    computePath(unit: Entity, destX: number, destY: number): Point[] {
        if (!this.navGrid) return [];
        const { MAP_SIZE, NAV_CELL } = CONSTANTS;
        const NW = Math.ceil(MAP_SIZE / NAV_CELL);
        const NH = Math.ceil(MAP_SIZE / NAV_CELL);
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
}
