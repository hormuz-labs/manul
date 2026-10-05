// Pack PNGs into a Windows .ico (PNG-compressed entries, supported since Vista). Usage: node ico.mjs out.ico a.png b.png …
import { readFileSync, writeFileSync } from 'node:fs'

const [out, ...pngs] = process.argv.slice(2)
const images = pngs.map(p => {
  const data = readFileSync(p)
  return { data, w: data.readUInt32BE(16), h: data.readUInt32BE(20) }
})
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
let offset = 6 + 16 * images.length
const entries = images.map(({ data, w, h }) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(w >= 256 ? 0 : w, 0); e.writeUInt8(h >= 256 ? 0 : h, 1)
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12)
  offset += data.length
  return e
})
writeFileSync(out, Buffer.concat([header, ...entries, ...images.map(i => i.data)]))
