import sharp from "sharp";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { ADVISOR_REGIONS, type AdvisorRegions } from "./make-masks";

const W = 1024;
const H = 1024;

// 4:3 crop parameters on the 1024x1024 master
const CROP_TOP = 44;
const CROP_W = 1024;
const CROP_H = 768; // 1024x768 = 4:3

// Authentic 1996 CD-ROM 4:3 video resolution (320x240 QVGA)
const LOFI_W = 320;
const LOFI_H = 240;

// 4x4 Bayer matrix normalized to [-0.5, 0.5]
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16 - 0.5));

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

/**
 * Applies authentic 1996 Civ II Cinepak CD-ROM video quantization:
 * - 320x240 (4:3) resolution
 * - Ordered 4x4 Bayer dithering into a crunchy 15-bit/256-color stepped palette
 * - Subtle odd-scanline darkening (interlaced FMV look)
 */
function apply90sFmvFilter(
  buf: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
) {
  const step = 18; // Color quantization step size for 90s 256-color / 15-bit video crunch
  const ditherAmp = 14;
  for (let y = 0; y < height; y++) {
    const scanlineMul = y % 2 === 1 ? 0.91 : 1.0;
    const bayerRow = BAYER_4X4[y & 3]!;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (channels === 4 && buf[idx + 3]! === 0) continue;
      const d = bayerRow[x & 3]! * ditherAmp;
      for (let c = 0; c < 3; c++) {
        const v = buf[idx + c]! * scanlineMul + d;
        const q = Math.round(v / step) * step;
        buf[idx + c] = clampByte(q);
      }
      if (channels === 4) {
        // Hard-quantize alpha to 4 steps so even sprite edges feel 90s
        const a = buf[idx + 3]!;
        buf[idx + 3] = a < 32 ? 0 : a > 210 ? 255 : Math.round(a / 64) * 64;
      }
    }
  }
}

async function saveLoFi4x3(
  fullMasterRgb: Buffer,
  outWebp: string,
  outPng?: string,
) {
  const { data } = await sharp(fullMasterRgb, {
    raw: { width: W, height: H, channels: 3 },
  })
    .extract({ left: 0, top: CROP_TOP, width: CROP_W, height: CROP_H })
    .resize(LOFI_W, LOFI_H, { kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lofiBuf = Buffer.from(data);
  apply90sFmvFilter(lofiBuf, LOFI_W, LOFI_H, 3);

  await sharp(lofiBuf, { raw: { width: LOFI_W, height: LOFI_H, channels: 3 } })
    .webp({ lossless: true })
    .toFile(outWebp);

  if (outPng) {
    await sharp(lofiBuf, {
      raw: { width: LOFI_W, height: LOFI_H, channels: 3 },
    })
      .png({ compressionLevel: 6 })
      .toFile(outPng);
  }
}

async function saveLoFiPatch4x3(
  patchMasterRgba: Buffer,
  outWebp: string,
  outPng?: string,
) {
  const { data } = await sharp(patchMasterRgba, {
    raw: { width: W, height: H, channels: 4 },
  })
    .extract({ left: 0, top: CROP_TOP, width: CROP_W, height: CROP_H })
    .resize(LOFI_W, LOFI_H, { kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lofiBuf = Buffer.from(data);
  apply90sFmvFilter(lofiBuf, LOFI_W, LOFI_H, 4);

  await sharp(lofiBuf, { raw: { width: LOFI_W, height: LOFI_H, channels: 4 } })
    .webp({ lossless: true })
    .toFile(outWebp);

  if (outPng) {
    await sharp(lofiBuf, {
      raw: { width: LOFI_W, height: LOFI_H, channels: 4 },
    })
      .png({ compressionLevel: 6 })
      .toFile(outPng);
  }
}

async function compositeAndSave(
  base: Uint8Array,
  editPath: string,
  ellipse: Ellipse,
  fullOutWebp: string,
  patchOutWebp?: string,
  lofiPngDir?: string,
  frameName?: string,
) {
  const edit = await loadRawRgb(editPath);
  const { dx, dy } = findBestShift(base, edit, ellipse);
  const [offR, offG, offB] = computeColorOffset(base, edit, ellipse, dx, dy);

  const fullBuf = Buffer.alloc(W * H * 3);
  const patchBuf = patchOutWebp ? Buffer.alloc(W * H * 4) : null;

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

  await saveLoFi4x3(
    fullBuf,
    fullOutWebp,
    lofiPngDir && frameName ? `${lofiPngDir}/${frameName}.png` : undefined,
  );

  if (patchBuf && patchOutWebp) {
    await saveLoFiPatch4x3(
      patchBuf,
      patchOutWebp,
      lofiPngDir && frameName
        ? `${lofiPngDir}/patch-${frameName}.png`
        : undefined,
    );
  }
}

export async function processAdvisor(r: AdvisorRegions) {
  const dir = `public/advisors/${r.id}`;
  const rawDir = `.cache/raw/${r.id}`;
  const exportRoot = process.env.HIGH_COUNCIL_EXPORT_DIR;
  const lofiPngDir = exportRoot ? `${exportRoot}/sprites/${r.id}/lofi-4x3` : undefined;
  if (lofiPngDir) mkdirSync(lofiPngDir, { recursive: true });

  const basePath = `${dir}/base.png`;
  if (!existsSync(basePath)) return;

  const base = await loadRawRgb(basePath);
  const baseBuf = Buffer.from(base.buffer, base.byteOffset, base.byteLength);

  await saveLoFi4x3(
    baseBuf,
    `${dir}/neutral.webp`,
    `${lofiPngDir}/neutral.png`,
  );
  await saveLoFi4x3(baseBuf, `${dir}/base-lofi.webp`, `${lofiPngDir}/base.png`);

  await compositeAndSave(
    base,
    basePath,
    r.mouth,
    `${dir}/mouth-closed.webp`,
    `${dir}/patch-mouth-closed.webp`,
    lofiPngDir,
    "mouth-closed",
  );

  const expressions = ["excited", "worried", "smug", "annoyed"] as const;
  for (const expr of expressions) {
    const rawPath = `${rawDir}/raw-${expr}.png`;
    if (existsSync(rawPath)) {
      await compositeAndSave(
        base,
        rawPath,
        r.face,
        `${dir}/${expr}.webp`,
        undefined,
        lofiPngDir,
        expr,
      );
    }
  }

  const blinkRaw = `${rawDir}/raw-blink.png`;
  if (existsSync(blinkRaw)) {
    await compositeAndSave(
      base,
      blinkRaw,
      r.eyes,
      `${dir}/blink.webp`,
      `${dir}/patch-blink.webp`,
      lofiPngDir,
      "blink",
    );
  }

  const visemes = ["open", "wide", "round", "fv"] as const;
  for (const v of visemes) {
    const rawPath = `${rawDir}/raw-mouth-${v}.png`;
    if (existsSync(rawPath)) {
      await compositeAndSave(
        base,
        rawPath,
        r.mouth,
        `${dir}/mouth-${v}.webp`,
        `${dir}/patch-mouth-${v}.webp`,
        lofiPngDir,
        `mouth-${v}`,
      );
    }
  }
  console.log(`Composited 320x240 (4:3) 90s CD-ROM sprites for ${r.id}`);
}

if (import.meta.main) {
  for (const r of Object.values(ADVISOR_REGIONS)) {
    await processAdvisor(r);
  }

  const exportRoot = process.env.HIGH_COUNCIL_EXPORT_DIR;
  const manifestPath = exportRoot ? `${exportRoot}/sprites/manifest.json` : "";
  if (manifestPath && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.lofiFrameSize = { width: LOFI_W, height: LOFI_H, aspect: "4:3" };
    for (const [slug, adv] of Object.entries<any>(manifest.advisors ?? {})) {
      const lofiDir = `${exportRoot}/sprites/${slug}/lofi-4x3`;
      adv.lofi4x3 = {
        frameSize: { width: LOFI_W, height: LOFI_H },
        directory: lofiDir,
        base: `${lofiDir}/base.png`,
        expressions: {
          neutral: `${lofiDir}/neutral.png`,
          excited: `${lofiDir}/excited.png`,
          worried: `${lofiDir}/worried.png`,
          smug: `${lofiDir}/smug.png`,
          annoyed: `${lofiDir}/annoyed.png`,
          blink: `${lofiDir}/blink.png`,
        },
        visemes: {
          closed: `${lofiDir}/mouth-closed.png`,
          open: `${lofiDir}/mouth-open.png`,
          wide: `${lofiDir}/mouth-wide.png`,
          round: `${lofiDir}/mouth-round.png`,
          fv: `${lofiDir}/mouth-fv.png`,
        },
        patches: {
          blink: `${lofiDir}/patch-blink.png`,
          closed: `${lofiDir}/patch-mouth-closed.png`,
          open: `${lofiDir}/patch-mouth-open.png`,
          wide: `${lofiDir}/patch-mouth-wide.png`,
          round: `${lofiDir}/patch-mouth-round.png`,
          fv: `${lofiDir}/patch-mouth-fv.png`,
        },
      };
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}
