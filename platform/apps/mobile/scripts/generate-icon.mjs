// Erzeugt ein 1024×1024 App-Icon als PNG (RGB, ohne Alpha — App-Store-konform):
// grüner Hintergrund mit weißem Kreis (entspricht dem Marken-Punkt der Web-App).
// Kein externes Bild-Tooling nötig — nur node:zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 1024;
const BG = [198, 113, 57]; // Organic accent (Terracotta) #c67139
const FG = [245, 234, 216]; // Organic ground (Creme) #f5ead8

const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
const cx = SIZE / 2;
const cy = SIZE / 2;
const r = SIZE * 0.28;
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 3);
  raw[rowStart] = 0; // Filter: None
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const inside = dx * dx + dy * dy <= r * r;
    const [rr, gg, bb] = inside ? FG : BG;
    const p = rowStart + 1 + x * 3;
    raw[p] = rr;
    raw[p + 1] = gg;
    raw[p + 2] = bb;
  }
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type 2 = truecolor RGB (kein Alpha)
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.png');
writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
