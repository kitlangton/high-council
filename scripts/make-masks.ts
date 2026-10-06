import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("masks", { recursive: true });

const W = 1024;
const H = 1024;

export interface AdvisorRegions {
  id: string;
  face: { cx: number; cy: number; rx: number; ry: number };
  eyes: { cx: number; cy: number; rx: number; ry: number };
  mouth: { cx: number; cy: number; rx: number; ry: number };
}

export const ADVISOR_REGIONS: Record<string, AdvisorRegions> = {
  simplifier: {
    id: "simplifier",
    face: { cx: 505, cy: 345, rx: 145, ry: 175 },
    eyes: { cx: 505, cy: 285, rx: 125, ry: 55 },
    mouth: { cx: 505, cy: 425, rx: 85, ry: 55 },
  },
  performance: {
    id: "performance",
    face: { cx: 500, cy: 425, rx: 145, ry: 185 },
    eyes: { cx: 500, cy: 365, rx: 125, ry: 55 },
    mouth: { cx: 500, cy: 520, rx: 90, ry: 60 },
  },
  "bug-hunter": {
    id: "bug-hunter",
    face: { cx: 495, cy: 395, rx: 160, ry: 180 },
    eyes: { cx: 495, cy: 330, rx: 135, ry: 55 },
    mouth: { cx: 495, cy: 480, rx: 95, ry: 60 },
  },
  architect: {
    id: "architect",
    face: { cx: 500, cy: 335, rx: 155, ry: 185 },
    eyes: { cx: 500, cy: 270, rx: 130, ry: 55 },
    mouth: { cx: 505, cy: 415, rx: 95, ry: 65 },
  },
  "user-voice": {
    id: "user-voice",
    face: { cx: 492, cy: 360, rx: 145, ry: 170 },
    eyes: { cx: 492, cy: 300, rx: 125, ry: 52 },
    mouth: { cx: 492, cy: 440, rx: 85, ry: 55 },
  },
  contrarian: {
    id: "contrarian",
    face: { cx: 500, cy: 345, rx: 150, ry: 190 },
    eyes: { cx: 500, cy: 278, rx: 130, ry: 55 },
    mouth: { cx: 502, cy: 425, rx: 90, ry: 68 },
  },
};

async function makeEllipseMask(
  outPath: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      const idx = (y * W + x) * 4;
      buf[idx] = 0;
      buf[idx + 1] = 0;
      buf[idx + 2] = 0;
      buf[idx + 3] = d2 <= 1.0 ? 0 : 255;
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(outPath);
}

if (import.meta.main) {
  mkdirSync("masks", { recursive: true });
  for (const r of Object.values(ADVISOR_REGIONS)) {
    await makeEllipseMask(
      `masks/${r.id}-face.png`,
      r.face.cx,
      r.face.cy,
      r.face.rx,
      r.face.ry,
    );
    await makeEllipseMask(
      `masks/${r.id}-eyes.png`,
      r.eyes.cx,
      r.eyes.cy,
      r.eyes.rx,
      r.eyes.ry,
    );
    await makeEllipseMask(
      `masks/${r.id}-mouth.png`,
      r.mouth.cx,
      r.mouth.cy,
      r.mouth.rx,
      r.mouth.ry,
    );
  }

  // Build a 3x2 debug sheet with SVG ellipse overlays to verify alignment
  const order = [
    "simplifier",
    "performance",
    "bug-hunter",
    "architect",
    "user-voice",
    "contrarian",
  ];
  const cellSize = 384;
  const composites: { input: Buffer; left: number; top: number }[] = [];

  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const r = ADVISOR_REGIONS[id]!;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const svg = `<svg width="${cellSize}" height="${cellSize}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${r.face.cx}" cy="${r.face.cy}" rx="${r.face.rx}" ry="${r.face.ry}" fill="none" stroke="#ff4444" stroke-width="6" />
      <ellipse cx="${r.eyes.cx}" cy="${r.eyes.cy}" rx="${r.eyes.rx}" ry="${r.eyes.ry}" fill="none" stroke="#00e5ff" stroke-width="6" />
      <ellipse cx="${r.mouth.cx}" cy="${r.mouth.cy}" rx="${r.mouth.rx}" ry="${r.mouth.ry}" fill="none" stroke="#00ff66" stroke-width="6" />
    </svg>`;
    const cellBuf = await sharp(`public/advisors/${id}/base.png`)
      .resize(cellSize, cellSize)
      .composite([{ input: Buffer.from(svg) }])
      .png()
      .toBuffer();
    composites.push({
      input: cellBuf,
      left: col * cellSize,
      top: row * cellSize,
    });
  }

  await sharp({
    create: {
      width: cellSize * 3,
      height: cellSize * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile("masks/debug-regions.png");

  console.log("Generated all advisor masks + masks/debug-regions.png");
}
