// Synthesises a single audio sprite WAV for Kingdom of Stone.
// Sprite layout (all times in ms):
//   ack   :    0 –  200   unit acknowledgement (two-tone blip)
//   hit   :  300 –  400   combat hit (noise thud)
//   build :  500 – 1000   building complete (C-E-G arpeggio)
//   wind  : 1200 – 5200   ambient wind loop (3 s filtered noise, fade in/out)

'use strict';
const fs   = require('fs');
const path = require('path');

const SR    = 44100;                           // sample rate (Hz)
const TOTAL = 5300;                            // total sprite length (ms)
const N     = Math.ceil(SR * TOTAL / 1000);
const buf   = new Float32Array(N);

// ── Primitives ────────────────────────────────────────────────────────────────

function ms(t) { return Math.floor(SR * t / 1000); }

function addSine(startMs, durMs, freq, amp, atkMs = 5, relMs = 20) {
    const s = ms(startMs), n = ms(durMs);
    const atkN = ms(atkMs), relN = ms(relMs);
    for (let i = 0; i < n && s + i < N; i++) {
        const t   = i / SR;
        let env = 1;
        if (i < atkN)     env = i / atkN;
        else if (i > n - relN) env = (n - i) / relN;
        buf[s + i] += Math.sin(2 * Math.PI * freq * t) * amp * env;
    }
}

function addNoise(startMs, durMs, amp, decayMs = 40) {
    const s = ms(startMs), n = ms(durMs);
    const tau = ms(decayMs);
    for (let i = 0; i < n && s + i < N; i++) {
        buf[s + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / tau);
    }
}

function addWind(startMs, durMs, amp, cutoff = 350) {
    const s = ms(startMs), n = ms(durMs);
    const alpha = (1 / (2 * Math.PI * cutoff)) / ((1 / (2 * Math.PI * cutoff)) + 1 / SR);
    const fadeN = ms(80);
    let prev = 0;
    for (let i = 0; i < n && s + i < N; i++) {
        prev = prev + (1 - alpha) * ((Math.random() * 2 - 1) * amp - prev);
        let fade = 1;
        if (i < fadeN)     fade = i / fadeN;
        if (i > n - fadeN) fade = (n - i) / fadeN;
        buf[s + i] += prev * fade;
    }
}

// ── Sounds ────────────────────────────────────────────────────────────────────

// ACK (0–200 ms): bright double blip
addSine(  0, 90,  880, 0.40, 4, 50);
addSine(  0, 90, 1320, 0.25, 4, 50);
addSine(100, 80, 1100, 0.35, 3, 60);
addSine(100, 80, 1650, 0.20, 3, 60);

// HIT (300–400 ms): noise burst + low thud
addNoise(300, 100, 0.65, 30);
addSine (300,  60,  180, 0.40, 1, 50);
addSine (300,  40,  240, 0.25, 1, 30);

// BUILD (500–1000 ms): ascending C-E-G arpeggio
addSine(500, 180, 523.25, 0.42, 6, 60);   // C5
addSine(630, 180, 659.25, 0.42, 6, 60);   // E5
addSine(760, 220, 783.99, 0.42, 6, 90);   // G5

// WIND (1200–5200 ms, 4 s loop): two-pass filtered noise layers
addWind(1200, 4000, 0.28, 300);
addWind(1200, 4000, 0.18, 120);

// ── Normalise ─────────────────────────────────────────────────────────────────

let peak = 0;
for (let i = 0; i < N; i++) if (Math.abs(buf[i]) > peak) peak = Math.abs(buf[i]);
const gain = peak > 0 ? 0.90 / peak : 1;
for (let i = 0; i < N; i++) buf[i] *= gain;

// ── Write WAV ─────────────────────────────────────────────────────────────────

const out = Buffer.alloc(44 + N * 2);
out.write('RIFF', 0);
out.writeUInt32LE(36 + N * 2, 4);
out.write('WAVE', 8);
out.write('fmt ', 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);       // PCM
out.writeUInt16LE(1, 22);       // mono
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 2, 28);
out.writeUInt16LE(2, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36);
out.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

const dest = path.join(__dirname, '../public/sounds/sprite.wav');
fs.writeFileSync(dest, out);
console.log(`Wrote ${dest}  (${(out.length / 1024).toFixed(0)} KB)`);
console.log('Sprite map:');
console.log('  ack  :    0 –  200 ms');
console.log('  hit  :  300 –  400 ms');
console.log('  build:  500 – 1000 ms');
console.log('  wind : 1200 – 5200 ms (loop)');
