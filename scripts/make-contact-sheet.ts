import sharp from "sharp";
import { ADVISOR_REGIONS } from "./make-masks";

const advisors = Object.keys(ADVISOR_REGIONS);
const frames = [
  "neutral",
  "excited",
  "worried",
  "smug",
  "annoyed",
  "blink",
  "mouth-open",
  "mouth-wide",
  "mouth-round",
  "mouth-fv",
];

const cellW = 160;
const cellH = 120;
const composites: { input: Buffer; left: number; top: number }[] = [];

for (let row = 0; row < advisors.length; row++) {
  const id = advisors[row]!;
  for (let col = 0; col < frames.length; col++) {
    const f = frames[col]!;
    const buf = await sharp(`public/advisors/${id}/${f}.webp`)
      .resize(cellW, cellH, { kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();
    composites.push({
      input: buf,
      left: col * cellW,
      top: row * cellH,
    });
  }
}

await sharp({
  create: {
    width: cellW * frames.length,
    height: cellH * advisors.length,
    channels: 4,
    background: { r: 10, g: 10, b: 10, alpha: 1 },
  },
})
  .composite(composites)
  .png()
  .toFile(process.env.HIGH_COUNCIL_SHEET_OUT ?? ".scratch/sprite-sheet-preview.png");

console.log("Saved sprite-sheet-preview.png");
