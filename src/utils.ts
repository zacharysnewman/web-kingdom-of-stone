export const dist  = (x1: number, y1: number, x2: number, y2: number): number => Math.hypot(x2 - x1, y2 - y1);
export const angle = (x1: number, y1: number, x2: number, y2: number): number => Math.atan2(y2 - y1, x2 - x1);

export function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
