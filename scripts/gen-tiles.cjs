'use strict';
// Generates isometric diamond tile PNGs for Kingdom of Stone.
// Tiles are 32×32 RGBA. The diamond face occupies the top 16 rows;
// rows 16–31 are transparent (flat ground, no side faces needed).
//
// Grass tiles: 16–19  (green variants)
// Stone tiles: 40–43  (dark gray variants)

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── PNG helpers ───────────────────────────────────────────────────────────────

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    const lenBuf  = Buffer.alloc(4);
    const typeBuf = Buffer.from(type, 'ascii');
    lenBuf.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf   = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(pixels, width, height) {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width,  0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8]  = 8;  // bit depth
    ihdr[9]  = 6;  // RGBA
    ihdr[10] = ihdr[11] = ihdr[12] = 0;

    const rows = [];
    for (let y = 0; y < height; y++) {
        const row = Buffer.alloc(1 + width * 4);
        row[0] = 0; // None filter
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            row[1 + x * 4]     = pixels[src];
            row[1 + x * 4 + 1] = pixels[src + 1];
            row[1 + x * 4 + 2] = pixels[src + 2];
            row[1 + x * 4 + 3] = pixels[src + 3];
        }
        rows.push(row);
    }
    const raw        = Buffer.concat(rows);
    const compressed = zlib.deflateSync(raw, { level: 9 });

    return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Tile drawing ──────────────────────────────────────────────────────────────

// For a 32×32 tile, the 2:1 iso diamond occupies rows 0–15.
// Left edge:  x = max(0, 15 - 2y)   for y 0..8
//             x = 2*(y-8)            for y 8..15
// Right edge: x = min(31, 16 + 2y)  for y 0..8
//             x = 31 - 2*(y-8)      for y 8..15

function makeTile(baseR, baseG, baseB, variant) {
    const pixels = new Uint8Array(32 * 32 * 4); // all transparent

    // Slight per-variant brightness offset
    const bv = [0, 12, -12, 6][variant] ?? 0;
    const cr = Math.max(0, Math.min(255, baseR + bv));
    const cg = Math.max(0, Math.min(255, baseG + bv));
    const cb = Math.max(0, Math.min(255, baseB + bv));

    // Highlight (slightly brighter, for top-left facing pixels)
    const hr = Math.min(255, cr + 30);
    const hg = Math.min(255, cg + 30);
    const hb = Math.min(255, cb + 30);

    for (let y = 0; y <= 15; y++) {
        let xLeft, xRight;
        if (y <= 8) {
            xLeft  = Math.max(0,  15 - 2 * y);
            xRight = Math.min(31, 16 + 2 * y);
        } else {
            xLeft  = 2 * (y - 8);
            xRight = 31 - 2 * (y - 8);
        }

        for (let x = xLeft; x <= xRight; x++) {
            const idx = (y * 32 + x) * 4;
            // Left-facing edge pixels get the highlight
            const onLeftEdge = (y <= 8 && x === xLeft) || (y > 8 && x === xLeft);
            if (onLeftEdge && y < 8) {
                pixels[idx]     = hr;
                pixels[idx + 1] = hg;
                pixels[idx + 2] = hb;
            } else {
                pixels[idx]     = cr;
                pixels[idx + 1] = cg;
                pixels[idx + 2] = cb;
            }
            pixels[idx + 3] = 255;
        }
    }

    // 1-pixel dark outline on the diamond edges
    for (let y = 0; y <= 15; y++) {
        let xLeft, xRight;
        if (y <= 8) {
            xLeft  = Math.max(0,  15 - 2 * y);
            xRight = Math.min(31, 16 + 2 * y);
        } else {
            xLeft  = 2 * (y - 8);
            xRight = 31 - 2 * (y - 8);
        }
        // Paint border at left and right edge pixels
        for (const x of [xLeft, xRight]) {
            const idx = (y * 32 + x) * 4;
            pixels[idx]     = Math.round(cr * 0.55);
            pixels[idx + 1] = Math.round(cg * 0.55);
            pixels[idx + 2] = Math.round(cb * 0.55);
            pixels[idx + 3] = 255;
        }
        // Also top row (y=0) and bottom pixels (y=15)
        if (y === 0 || y === 15) {
            for (let x = xLeft; x <= xRight; x++) {
                const idx = (y * 32 + x) * 4;
                pixels[idx]     = Math.round(cr * 0.55);
                pixels[idx + 1] = Math.round(cg * 0.55);
                pixels[idx + 2] = Math.round(cb * 0.55);
                pixels[idx + 3] = 255;
            }
        }
    }

    return pixels;
}

// ── Tile definitions ──────────────────────────────────────────────────────────

const GRASS_BASE = [74,  124, 47];
const STONE_BASE = [96,  104, 116];

const TILES = {
    16: makeTile(...GRASS_BASE, 0),
    17: makeTile(...GRASS_BASE, 1),
    18: makeTile(...GRASS_BASE, 2),
    19: makeTile(...GRASS_BASE, 3),
    40: makeTile(...STONE_BASE, 0),
    41: makeTile(...STONE_BASE, 1),
    42: makeTile(...STONE_BASE, 2),
    43: makeTile(...STONE_BASE, 3),
};

// ── Write ─────────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '../public/tiles');
fs.mkdirSync(outDir, { recursive: true });

for (const [idx, pixels] of Object.entries(TILES)) {
    const fname = `tile_${String(idx).padStart(3, '0')}.png`;
    const dest  = path.join(outDir, fname);
    fs.writeFileSync(dest, makePNG(pixels, 32, 32));
    console.log(`Wrote ${fname}`);
}
console.log(`Done — ${Object.keys(TILES).length} tiles in ${outDir}`);
