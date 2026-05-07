import { Howl } from 'howler';

// Sprite layout (see scripts/gen-audio.cjs)
const SPRITE = {
    ack:   [0,    200]         as [number, number],
    hit:   [300,  100]         as [number, number],
    build: [500,  500]         as [number, number],
    wind:  [1200, 4000, true]  as [number, number, boolean],
} as const;

let _howl: Howl | null = null;
let _windId: number | null = null;

function howl(): Howl {
    if (!_howl) {
        _howl = new Howl({
            src: [`${import.meta.env.BASE_URL}sounds/sprite.wav`],
            sprite: SPRITE as Record<string, [number, number] | [number, number, boolean]>,
        });
    }
    return _howl;
}

// vol: 0–1 (spatially attenuated by caller)
export const Audio = {
    ack(vol = 1): void {
        const id = howl().play('ack');
        howl().volume(Math.min(1, vol), id);
    },

    hit(vol = 1): void {
        const id = howl().play('hit');
        howl().volume(Math.min(1, vol * 0.7), id);
    },

    build(): void {
        howl().play('build');
    },

    startWind(): void {
        if (_windId !== null) return;
        _windId = howl().play('wind');
        howl().volume(0.35, _windId);
    },

    stopWind(): void {
        if (_windId === null) return;
        howl().stop(_windId);
        _windId = null;
    },

    // Returns 0–1 based on world distance from camera centre.
    // viewRadius: half-diagonal of the visible world area.
    spatialVol(wx: number, wy: number, camX: number, camY: number, viewRadius: number): number {
        const d = Math.hypot(wx - camX, wy - camY);
        return Math.max(0, 1 - d / viewRadius);
    },
};
