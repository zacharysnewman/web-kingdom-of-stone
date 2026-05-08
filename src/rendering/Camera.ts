import * as PIXI from 'pixi.js';
import { CONSTANTS } from '../constants';
import { worldToIso, isoToWorld } from '../utils';

export class Camera {
    x = 0;
    y = 0;
    zoom = 0.75;

    clamp(): void {
        const MS = CONSTANTS.MAP_SIZE;
        this.x = Math.max(0, Math.min(MS, this.x));
        this.y = Math.max(0, Math.min(MS, this.y));
    }

    apply(worldContainer: PIXI.Container, canvasWidth: number, canvasHeight: number): void {
        const iso = worldToIso(this.x, this.y);
        worldContainer.scale.set(this.zoom);
        worldContainer.position.set(
            canvasWidth  / 2 - iso.x * this.zoom,
            canvasHeight / 2 - iso.y * this.zoom,
        );
    }

    screenToWorld(sx: number, sy: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
        const isoCenter = worldToIso(this.x, this.y);
        const ix = (sx - canvasWidth  / 2) / this.zoom + isoCenter.x;
        const iy = (sy - canvasHeight / 2) / this.zoom + isoCenter.y;
        return isoToWorld(ix, iy);
    }

    viewRadius(canvasWidth: number, canvasHeight: number): number {
        return Math.max(canvasWidth, canvasHeight) / this.zoom / 2;
    }
}
