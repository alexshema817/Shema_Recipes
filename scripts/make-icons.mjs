// Generates the PWA icons (PNG) with no dependencies: a green rounded square
// with a white plate. Run: npm run icons
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size, { padding = 0 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [0x2f, 0x6f, 0x4e];
  const white = [0xff, 0xff, 0xff];
  const cream = [0xf3, 0xf0, 0xe6];
  const r = size * (padding ? 0 : 0.22); // corner radius (0 for maskable-style full bleed)
  const cx = size / 2;
  const cy = size / 2;
  const plateR = size * 0.33;
  const innerR = size * 0.23;
  const sides = padding ? size : size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded square mask
      const dx = Math.max(r - x, 0, x - (sides - 1 - r));
      const dy = Math.max(r - y, 0, y - (sides - 1 - r));
      const inside = dx * dx + dy * dy <= r * r;
      if (!inside) {
        px[i + 3] = 0;
        continue;
      }
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      let c = bg;
      if (d <= innerR) c = cream;
      else if (d <= plateR) c = white;
      // fork tines + knife hint on the plate (simple bars)
      if (d <= innerR) {
        const fx = x - cx;
        const fy = y - cy;
        const barW = size * 0.028;
        const fork = Math.abs(fx + size * 0.07) < barW && fy > -innerR * 0.75 && fy < innerR * 0.75;
        const knife = Math.abs(fx - size * 0.07) < barW * (fy < 0 ? 1.8 : 1) && fy > -innerR * 0.75 && fy < innerR * 0.75;
        if (fork || knife) c = bg;
      }
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return png(size, size, px);
}

for (const [name, size, opts] of [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, { padding: 1 }],
  ["apple-touch-icon.png", 180, { padding: 1 }],
]) {
  const file = path.join(outDir, name);
  writeFileSync(file, draw(size, opts));
  console.log("wrote", file);
}
