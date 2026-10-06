import { effect, frame, sampler, surface, texture } from "vgpu"
import { initGpu } from "../core/gpu"
import { WORLD_H, WORLD_W } from "./landmarks"

const overworldWgsl = /* wgsl */ `
struct Params {
  viewSize: vec2f,
  camCenter: vec2f,
  camScale: f32,
  dpr: f32,
  time: f32,
  crt: f32,
}

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var hudTex: texture_2d<f32>;
@group(0) @binding(2) var nearestSmp: sampler;
@group(0) @binding(3) var<uniform> params: Params;

fn barrel(uv: vec2f, amt: f32) -> vec2f {
  let c = uv - 0.5;
  let r2 = dot(c, c);
  return uv + c * (r2 * 0.12 * amt);
}

// Seamless 16-bit SNES ocean tile outside the 512x320 world canvas bounds
fn oceanFallback(wp: vec2f, time: f32) -> vec3f {
  let ip = floor(wp);
  let dither = ((i32(ip.x) + i32(ip.y)) & 1) == 0;
  let wave = sin(ip.x * 0.09 + ip.y * 0.14 + floor(time * 3.5) * 0.6) > 0.45;
  var col = select(vec3f(0.078, 0.204, 0.392), vec3f(0.102, 0.259, 0.502), wave && dither);
  // Occasional white wave crest
  let cellX = ((i32(ip.x) % 48) + 48) % 48;
  let cellY = ((i32(ip.y) % 32) + 32) % 32;
  let shift = i32(floor(time * 3.5)) % 4;
  if (cellY == 16 && cellX >= 10 + shift && cellX <= 14 + shift) {
    col = vec3f(0.49, 0.827, 0.988);
  }
  return col;
}

@fragment fn fs_main(@location(0) rawUv: vec2f) -> @location(0) vec4f {
  let crt = params.crt;
  let uv = barrel(rawUv, crt);

  // CRT bezel edge mask when curved
  if (crt > 0.01 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) {
    return vec4f(0.02, 0.04, 0.09, 1.0);
  }

  let screenPx = uv * params.viewSize;
  let worldPos = (screenPx - params.viewSize * 0.5) / params.camScale + params.camCenter;
  let worldDims = vec2f(${WORLD_W}.0, ${WORLD_H}.0);

  // Snap to integer world texel centers for razor-sharp 16-bit pixel art at any zoom
  let snappedWorld = (floor(worldPos) + vec2f(0.5)) / worldDims;

  var worldCol: vec3f;
  if (worldPos.x < 0.0 || worldPos.x >= worldDims.x || worldPos.y < 0.0 || worldPos.y >= worldDims.y) {
    worldCol = oceanFallback(worldPos, params.time);
  } else {
    worldCol = textureSampleLevel(worldTex, nearestSmp, snappedWorld, 0.0).rgb;
  }

  // Sample crisp HUD layer
  let hudSample = textureSampleLevel(hudTex, nearestSmp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  var col = mix(worldCol, hudSample.rgb, hudSample.a);

  // Optional 16-bit SNES CRT Trinitron scanlines + aperture grille + warm glow
  if (crt > 0.01) {
    let devPx = uv * params.viewSize * params.dpr;
    let scanline = 0.5 + 0.5 * cos(devPx.y * 3.14159265 / 1.5);
    col *= mix(1.0, 0.82 + 0.22 * scanline, crt * 0.75);

    // Subtle RGB phosphor triad modulation
    let triad = i32(floor(devPx.x)) % 3;
    let mask = select(
      select(vec3f(0.96, 0.96, 1.06), vec3f(0.96, 1.05, 0.96), triad == 1),
      vec3f(1.06, 0.96, 0.96),
      triad == 0
    );
    col *= mix(vec3f(1.0), mask, crt * 0.35);

    // Gentle CRT corner vignette
    let v = uv - 0.5;
    col *= 1.0 - dot(v, v) * 0.45 * crt;
  }

  return vec4f(col, 1.0);
}
`

export type OverworldRenderer = Awaited<ReturnType<typeof createOverworldRenderer>>

export async function createOverworldRenderer(canvas: HTMLCanvasElement) {
  const gpu = await initGpu()
  const screen = surface(gpu, canvas, { dpr: [1, 2], clearColor: [0.078, 0.204, 0.392, 1] })
  const dev = gpu.gpu

  const worldTex = texture(gpu, {
    kind: "2d",
    size: [WORLD_W, WORLD_H],
    format: "rgba8unorm",
    usage: ["texture_binding", "copy_dst", "render_attachment"],
  })

  let hudW = Math.max(1, screen.size[0])
  let hudH = Math.max(1, screen.size[1])
  let hudTex = texture(gpu, {
    kind: "2d",
    size: [hudW, hudH],
    format: "rgba8unorm",
    usage: ["texture_binding", "copy_dst", "render_attachment"],
  })

  const nearestSmp = sampler(gpu, { magFilter: "nearest", minFilter: "nearest" })
  const fx = effect(gpu, overworldWgsl)
  fx.set({
    worldTex,
    hudTex,
    nearestSmp,
    params: {
      viewSize: [1, 1],
      camCenter: [WORLD_W / 2, WORLD_H / 2],
      camScale: 1,
      dpr: 1,
      time: 0,
      crt: 0,
    },
  })

  function render(
    worldCanvas: OffscreenCanvas,
    hudCanvas: OffscreenCanvas,
    camCenter: [number, number],
    camScale: number,
    time: number,
    crt: number,
  ) {
    const dpr = screen.dpr
    const sw = Math.max(1, screen.size[0])
    const sh = Math.max(1, screen.size[1])
    const W = sw / dpr
    const H = sh / dpr

    if (hudW !== sw || hudH !== sh) {
      hudW = sw
      hudH = sh
      hudTex = texture(gpu, {
        kind: "2d",
        size: [hudW, hudH],
        format: "rgba8unorm",
        usage: ["texture_binding", "copy_dst", "render_attachment"],
      })
      fx.set({ hudTex })
    }

    dev.queue.copyExternalImageToTexture(
      { source: worldCanvas },
      { texture: worldTex.gpu },
      [WORLD_W, WORLD_H],
    )
    dev.queue.copyExternalImageToTexture(
      { source: hudCanvas },
      { texture: hudTex.gpu },
      [hudW, hudH],
    )

    fx.set({
      params: {
        viewSize: [W, H],
        camCenter,
        camScale,
        dpr,
        time,
        crt,
      },
    })

    frame(gpu, (f) => {
      f.pass(screen, fx)
    })
  }

  return {
    gpu,
    render,
    get size() {
      return [screen.size[0] / screen.dpr, screen.size[1] / screen.dpr] as const
    },
    get dpr() {
      return screen.dpr
    },
  }
}
