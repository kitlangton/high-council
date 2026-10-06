// bun scripts/codec-portraits.ts [set]
// Pixel-locks each caller's open-mouth frame: keep the closed base and feather in only
// the mouth region from the edit, then export 512² webp frames for the stage.
import { mkdirSync } from "node:fs"
import sharp from "sharp"

const sets: Record<string, { out: string; mouths: Record<string, [number, number, number?, number?]> }> = {
  codec: {
    out: "public/codec",
    mouths: { chief: [600, 560], strategist: [552, 665], quartermaster: [579, 573], liaison: [568, 573] },
  },
  codec16: {
    out: "public/codec",
    mouths: { chief: [592, 560], strategist: [560, 600], quartermaster: [544, 592], liaison: [576, 592] },
  },
  starfox: {
    out: "public/starfox",
    mouths: {
      chief: [500, 588, 115, 82],
      strategist: [500, 495, 140, 115],
      quartermaster: [485, 515, 130, 88],
      liaison: [485, 485, 115, 98],
    },
  },
  cabinet: {
    out: "public/cabinet",
    mouths: {
      chief: [512, 385, 110, 78],
      strategist: [508, 395, 118, 82],
      quartermaster: [485, 435, 118, 84],
      liaison: [505, 360, 110, 78],
    },
  },
}

const set = process.argv[2] ?? "codec16"
const cfg = sets[set]
if (!cfg) throw new Error(`Unknown set ${set}`)
const dir = `art/${set}`
mkdirSync(cfg.out, { recursive: true })

for (const [id, [x, y, rx = 120, ry = 88]] of Object.entries(cfg.mouths)) {
  const svg = `<svg width="1024" height="1024"><defs><filter id="f"><feGaussianBlur stdDeviation="14"/></filter></defs><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="white" filter="url(#f)"/></svg>`
  const alpha = await sharp(Buffer.from(svg)).resize(1024, 1024).extractChannel(0).raw().toBuffer()
  const open = await sharp(`${dir}/${id}-open.png`).resize(1024, 1024).removeAlpha().joinChannel(alpha, { raw: { width: 1024, height: 1024, channels: 1 } }).png().toBuffer()
  const mixed = await sharp(`${dir}/${id}-closed.png`).resize(1024, 1024).composite([{ input: open }]).png().toBuffer()
  await sharp(mixed).resize(512, 512).webp({ quality: 92 }).toFile(`${cfg.out}/${id}-open.webp`)
  await sharp(`${dir}/${id}-closed.png`).resize(512, 512).webp({ quality: 92 }).toFile(`${cfg.out}/${id}-closed.webp`)
  console.log(`${set}/${id}`)
}
process.exit(0)
