// Generates resources/icon.png (1024x1024) with no dependencies: a dark rounded square with a
// simple white "fin" mark. Replace icon.png with real artwork any time; build.sh only needs the PNG.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const S = 1024
// Apple's icon grid: the rounded square occupies 824 of 1024 px, centred, with transparent margins.
// Filling the whole canvas makes the icon look oversized next to system icons in the Dock.
const TILE = 824, OFF = (S - TILE) / 2, RADIUS = 185
const px = new Uint8Array(S * S * 4)
const inRounded = (x, y, r) => {
  const lx = x - OFF, ly = y - OFF
  if (lx < 0 || ly < 0 || lx >= TILE || ly >= TILE) return false
  const cx = Math.min(Math.max(lx, r), TILE - r), cy = Math.min(Math.max(ly, r), TILE - r)
  return (lx - cx) ** 2 + (ly - cy) ** 2 <= r * r
}
// fin: a quarter-ellipse sweeping up and right, offset to the lower middle
const inFin = (x, y) => {
  const u = (x - 340) / 340, v = (720 - y) / 420
  if (u < 0 || v < 0) return false
  const outer = u * u + v * v <= 1
  const inner = ((u - 0.18) ** 2) / 0.9 + ((v - 0.14) ** 2) / 1.0 <= 0.52
  return outer && !inner && v > u * 0.25
}
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4
  // soft drop shadow below the tile
  if (!inRounded(x, y, RADIUS)) {
    if (inRounded(x, y - 14, RADIUS + 10)) { px[i + 3] = 46 }
    else if (inRounded(x, y - 22, RADIUS + 22)) { px[i + 3] = 18 }
    continue
  }
  const t = (y - OFF) / TILE
  let r = 18 + 10 * t, g = 24 + 14 * t, b = 38 + 26 * t
  if (inFin(x, y)) { r = g = b = 240 }
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
}
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
const out = join(dirname(fileURLToPath(import.meta.url)), 'icon.png')
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
