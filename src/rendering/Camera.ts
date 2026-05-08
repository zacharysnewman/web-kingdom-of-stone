import * as PIXI from 'pixi.js';
import { CONSTANTS } from '../constants';

export class Camera {
    x = 0;
    y = 0;
    zoom = 0.75;

    clamp(canvasWidth: number, canvasHeight: number): void {
        const z = this.zoom;
        const topH    = (document.querySelector('.ui-layer.top-0') as HTMLElement | null)?.offsetHeight ?? 72;
        const bottomH = (document.getElementById('actionMenu')?.closest('.ui-layer') as HTMLElement | null)?.offsetHeight ?? 120;
        const hw = canvasWidth  / 2 / z;
        const hh = canvasHeight / 2 / z;
        const tw = topH    / z;
        const bw = bottomH / z;
        const half = CONSTANTS.MAP_SIZE / 2;

        this.x = hw >= half
            ? half
            : Math.max(hw, Math.min(CONSTANTS.MAP_SIZE - hw, this.x));

        const usableHH = (canvasHeight - topH - bottomH) / 2 / z;
        if (usableHH >= half) {
            this.y = half + (bw - tw) / 2;
        } else {
            this.y = Math.max(hh - tw, Math.min(CONSTANTS.MAP_SIZE - hh + bw, this.y));
        }
    }

    apply(worldContainer: PIXI.Container, canvasWidth: number, canvasHeight: number): void {
        worldContainer.scale.set(this.zoom);
        worldContainer.position.set(
            canvasWidth  / 2 - this.x * this.zoom,
            canvasHeight / 2 - this.y * this.zoom,
        );
    }

    screenToWorld(sx: number, sy: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
        return {
            x: (sx - canvasWidth  / 2) / this.zoom + this.x,
            y: (sy - canvasHeight / 2) / this.zoom + this.y,
        };
    }

    viewRadius(canvasWidth: number, canvasHeight: number): number {
        return Math.max(canvasWidth, canvasHeight) / this.zoom / 2;
    }
}
