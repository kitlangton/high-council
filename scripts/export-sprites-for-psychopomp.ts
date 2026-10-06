import sharp from "sharp";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { ADVISOR_REGIONS, type AdvisorRegions } from "./make-masks";

const W = 1024;
const H = 1024;
const OUT_ROOT = process.env.HIGH_COUNCIL_EXPORT_DIR ?? ".scratch/sprites";

mkdirSync(OUT_ROOT, { recursive: true });

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

async function loadRawRgb(path: string): Promise<Uint8Array> {
  const { data } = await sharp(path)
    .resize(W, H)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function findBestShift(
  base: Uint8Array,
  edit: Uint8Array,
  ellipse: Ellipse,
): { dx: number; dy: number } {
  const minX = Math.max(16, Math.floor(ellipse.cx - ellipse.rx * 1.35));
  const maxX = Math.min(W - 17, Math.ceil(ellipse.cx + ellipse.rx * 1.35));
  const minY = Math.max(16, Math.floor(ellipse.cy - ellipse.ry * 1.35));
  const maxY = Math.min(H - 17, Math.ceil(ellipse.cy + ellipse.ry * 1.35));

  const samples: number[] = [];
  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const nx = (x - ellipse.cx) / ellipse.rx;
      const ny = (y - ellipse.cy) / ellipse.ry;
      const d = Math.hypot(nx, ny);
      if (d >= 0.95 && d <= 1.35) {
        samples.push(y * W + x);
      }
    }
  }

  let bestDx = 0;
  let bestDy = 0;
  let bestErr = Number.POSITIVE_INFINITY;

  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      let err = 0;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i]!;
        const sp = p + dy * W + dx;
        const bIdx = p * 3;
        const eIdx = sp * 3;
        err +=
          Math.abs(base[bIdx]! - edit[eIdx]!) +
          Math.abs(base[bIdx + 1]! - edit[eIdx + 1]!) +
          Math.abs(base[bIdx + 2]! - edit[eIdx + 2]!);
      }
      if (err < bestErr) {
        bestErr = err;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

function computeColorOffset(
  base: Uint8Array,
  edit: Uint8Array,
  ellipse: Ellipse,
  dx: number,
  dy: number,
): [number, number, number] {
  const minX = Math.max(16, Math.floor(ellipse.cx - ellipse.rx * 1.15));
  const maxX = Math.min(W - 17, Math.ceil(ellipse.cx + ellipse.rx * 1.15));
  const minY = Math.max(16, Math.floor(ellipse.cy - ellipse.ry * 1.15));
  const maxY = Math.min(H - 17, Math.ceil(ellipse.cy + ellipse.ry * 1.15));

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const nx = (x - ellipse.cx) / ellipse.rx;
      const ny = (y - ellipse.cy) / ellipse.ry;
      const d = Math.hypot(nx, ny);
      if (d >= 0.82 && d <= 1.1) {
        const bIdx = (y * W + x) * 3;
        const eIdx = ((y + dy) * W + (x + dx)) * 3;
        sumR += base[bIdx]! - edit[eIdx]!;
        sumG += base[bIdx + 1]! - edit[eIdx + 1]!;
        sumB += base[bIdx + 2]! - edit[eIdx + 2]!;
        count++;
      }
    }
  }
  if (count === 0) return [0, 0, 0];
  return [sumR / count, sumG / count, sumB / count];
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function featherWeight(d: number, inner = 0.68, outer = 1.02): number {
  if (d <= inner) return 1.0;
  if (d >= outer) return 0.0;
  const t = (d - inner) / (outer - inner);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

async function compositePng(
  base: Uint8Array,
  editPath: string,
  ellipse: Ellipse,
  fullOutPng: string,
  patchOutPng?: string,
) {
  const edit = await loadRawRgb(editPath);
  const { dx, dy } = findBestShift(base, edit, ellipse);
  const [offR, offG, offB] = computeColorOffset(base, edit, ellipse, dx, dy);

  const fullBuf = Buffer.alloc(W * H * 3);
  const patchBuf = patchOutPng ? Buffer.alloc(W * H * 4) : null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - ellipse.cx) / ellipse.rx;
      const ny = (y - ellipse.cy) / ellipse.ry;
      const d = Math.hypot(nx, ny);
      const w = featherWeight(d);
      const bIdx = (y * W + x) * 3;

      const br = base[bIdx]!;
      const bg = base[bIdx + 1]!;
      const bb = base[bIdx + 2]!;

      if (w <= 0) {
        fullBuf[bIdx] = br;
        fullBuf[bIdx + 1] = bg;
        fullBuf[bIdx + 2] = bb;
      } else {
        const sx = Math.min(W - 1, Math.max(0, x + dx));
        const sy = Math.min(H - 1, Math.max(0, y + dy));
        const eIdx = (sy * W + sx) * 3;
        const er = clampByte(edit[eIdx]! + offR);
        const eg = clampByte(edit[eIdx + 1]! + offG);
        const eb = clampByte(edit[eIdx + 2]! + offB);

        fullBuf[bIdx] = clampByte(br * (1 - w) + er * w);
        fullBuf[bIdx + 1] = clampByte(bg * (1 - w) + eg * w);
        fullBuf[bIdx + 2] = clampByte(bb * (1 - w) + eb * w);

        if (patchBuf) {
          const pIdx = (y * W + x) * 4;
          patchBuf[pIdx] = er;
          patchBuf[pIdx + 1] = eg;
          patchBuf[pIdx + 2] = eb;
          patchBuf[pIdx + 3] = clampByte(w * 255);
        }
      }
    }
  }

  await sharp(fullBuf, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toFile(fullOutPng);

  if (patchBuf && patchOutPng) {
    await sharp(patchBuf, { raw: { width: W, height: H, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toFile(patchOutPng);
  }
}

const ADVISOR_META: Record<
  string,
  { name: string; icon: string; priority: boolean; voiceId: string }
> = {
  "bug-hunter": {
    name: "Bug Hunter",
    icon: "🐛",
    priority: true,
    voiceId: "N2lVS1w4EtoT3dr4eOWO",
  },
  performance: {
    name: "Performance",
    icon: "⚡",
    priority: true,
    voiceId: "pqHfZKP75CvOlQylNhV4",
  },
  architect: {
    name: "Architect",
    icon: "🏛",
    priority: true,
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
  },
  simplifier: {
    name: "Simplifier",
    icon: "🧹",
    priority: false,
    voiceId: "pFZP5JQG7iQjIQuC4Bku",
  },
  "user-voice": {
    name: "User Voice",
    icon: "🗣",
    priority: false,
    voiceId: "EXAVITQu4vr4xnSDxMaL",
  },
  contrarian: {
    name: "Contrarian",
    icon: "😈",
    priority: false,
    voiceId: "onwK4e9ZLuTAKqWW03F9",
  },
};

const manifestAdvisors: Record<string, unknown> = {};

// Process priority advisors first (bug-hunter, performance, architect), then the rest
const orderedSlugs = [
  "bug-hunter",
  "performance",
  "architect",
  "simplifier",
  "user-voice",
  "contrarian",
];

for (const slug of orderedSlugs) {
  const r: AdvisorRegions = ADVISOR_REGIONS[slug]!;
  const meta = ADVISOR_META[slug]!;
  const outDir = `${OUT_ROOT}/${slug}`;
  mkdirSync(outDir, { recursive: true });

  const baseSrc = `public/advisors/${slug}/base.png`;
  const rawDir = `.cache/raw/${slug}`;
  const baseRgb = await loadRawRgb(baseSrc);

  // 1. base.png and neutral.png
  await sharp(baseSrc).resize(W, H).png().toFile(`${outDir}/base.png`);
  await sharp(baseSrc).resize(W, H).png().toFile(`${outDir}/neutral.png`);

  // 2. Expressions: excited, worried, smug, annoyed
  const expressions = ["excited", "worried", "smug", "annoyed"] as const;
  for (const expr of expressions) {
    const rawPath = `${rawDir}/raw-${expr}.png`;
    if (existsSync(rawPath)) {
      await compositePng(baseRgb, rawPath, r.face, `${outDir}/${expr}.png`);
    }
  }

  // 3. Blink full frame + transparent eye patch
  const blinkRaw = `${rawDir}/raw-blink.png`;
  if (existsSync(blinkRaw)) {
    await compositePng(
      baseRgb,
      blinkRaw,
      r.eyes,
      `${outDir}/blink.png`,
      `${outDir}/patch-blink.png`,
    );
  }

  // 4. Mouth visemes: closed, mbp, open, wide, round, fv (both full 1024x1024 PNGs and transparent 1024x1024 RGBA patches)
  await compositePng(
    baseRgb,
    baseSrc,
    r.mouth,
    `${outDir}/mouth-closed.png`,
    `${outDir}/patch-mouth-closed.png`,
  );
  await compositePng(
    baseRgb,
    baseSrc,
    r.mouth,
    `${outDir}/mouth-mbp.png`,
    `${outDir}/patch-mouth-mbp.png`,
  );

  const visemes = ["open", "wide", "round", "fv"] as const;
  for (const v of visemes) {
    const rawPath = `${rawDir}/raw-mouth-${v}.png`;
    if (existsSync(rawPath)) {
      await compositePng(
        baseRgb,
        rawPath,
        r.mouth,
        `${outDir}/mouth-${v}.png`,
        `${outDir}/patch-mouth-${v}.png`,
      );
    }
  }

  manifestAdvisors[slug] = {
    slug,
    name: meta.name,
    icon: meta.icon,
    priority: meta.priority,
    voiceId: meta.voiceId,
    frameSize: { width: W, height: H },
    regions: {
      face: r.face,
      eyes: r.eyes,
      mouth: r.mouth,
    },
    directory: outDir,
    frames: {
      base: `${outDir}/base.png`,
      expressions: {
        neutral: `${outDir}/neutral.png`,
        excited: `${outDir}/excited.png`,
        worried: `${outDir}/worried.png`,
        smug: `${outDir}/smug.png`,
        annoyed: `${outDir}/annoyed.png`,
        blink: `${outDir}/blink.png`,
      },
      visemes: {
        closed: `${outDir}/mouth-closed.png`,
        mbp: `${outDir}/mouth-mbp.png`,
        open: `${outDir}/mouth-open.png`,
        wide: `${outDir}/mouth-wide.png`,
        round: `${outDir}/mouth-round.png`,
        fv: `${outDir}/mouth-fv.png`,
      },
      patches: {
        blink: `${outDir}/patch-blink.png`,
        closed: `${outDir}/patch-mouth-closed.png`,
        mbp: `${outDir}/patch-mouth-mbp.png`,
        open: `${outDir}/patch-mouth-open.png`,
        wide: `${outDir}/patch-mouth-wide.png`,
        round: `${outDir}/patch-mouth-round.png`,
        fv: `${outDir}/patch-mouth-fv.png`,
      },
    },
  };
  console.log(`Exported 1024x1024 PNG sprite set for ${slug}`);
}

const manifest = {
  version: 1,
  style: "1996-civ2-fmv",
  frameSize: { width: W, height: H },
  alignmentGuarantee:
    "All frames are 1024x1024 RGBA/RGB PNGs sub-pixel aligned and cosine-feathered onto base.png. Background, shoulders, hair silhouette, and props are bit-for-bit identical across all frames. `visemes` are full 1024x1024 frames with the mouth shape applied to the neutral face; `patches` are 1024x1024 transparent RGBA overlays that can be composited at (0,0) on top of any expression frame.",
  priorityAdvisors: ["bug-hunter", "performance", "architect"],
  allAdvisors: orderedSlugs,
  advisors: manifestAdvisors,
  sampleAudioManifest: "public/audio/manifest.json",
};

writeFileSync(`${OUT_ROOT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${OUT_ROOT}/manifest.json`);
