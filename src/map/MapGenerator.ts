import { createNoise2D } from 'simplex-noise';
import { CONSTANTS, SPAWN_POINTS } from '../constants';
import { dist, mulberry32 } from '../utils';

export interface MapResult {
    stoneGrid: boolean[][];
    mapCellSize: number;
    mines: { wx: number; wy: number }[];
}

export function generateMap(seed: number, aiCount: number): MapResult {
    const { MAP_SIZE } = CONSTANTS;
    const CELL = 120;
    const GW   = Math.ceil(MAP_SIZE / CELL);
    const GH   = Math.ceil(MAP_SIZE / CELL);
    const noise2D = createNoise2D(mulberry32(seed));
    const activeSpawns = SPAWN_POINTS.slice(0, aiCount + 1);
    const nearSpawn = (wx: number, wy: number, r: number) =>
        activeSpawns.some(s => dist(wx, wy, s.x, s.y) < r);

    const stoneGrid: boolean[][] = Array.from({ length: GH }, () => new Array(GW).fill(false));
    for (let cy = 0; cy < GH; cy++) {
        for (let cx = 0; cx < GW; cx++) {
            const wx = cx * CELL + CELL / 2;
            const wy = cy * CELL + CELL / 2;
            if (nearSpawn(wx, wy, 260)) continue;
            const v = (noise2D(cx * 0.18, cy * 0.18) * 0.7 +
                       noise2D(cx * 0.40, cy * 0.40) * 0.3 + 1) / 2;
            if (v > 0.65) stoneGrid[cy][cx] = true;
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
                stoneGrid[cy][cx] = false;
    }

    return { stoneGrid, mapCellSize: CELL, mines };
}
