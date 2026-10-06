import { draw, effect, frame, sampler, storage, surface, target } from "vgpu"
import { createQuadLayer, initGpu } from "../core/gpu"

// Two-pass HDR phosphor vector renderer:
// 1. Background tactical projection shader (graticule, bathymetry, radar sweeps with phosphor decay,
//    orbital ground-track sine waves) + instanced anti-aliased SDF vector segments (coastlines,
//    airspace polygons, ballistic arcs, reticles, silos).
// 2. QuadLayer for crisp tactical telemetry labels and HUD panels.
// 3. CRT Phosphor Bloom & curvature post-process pass.

export const MAX_SEGMENTS = 16384
export const SEG_FLOATS = 12

export interface PhosphorTheme {
  name: string
  bg: [number, number, number]
  grid: [number, number, number]
  coast: [number, number, number]
  inner: [number, number, number]
  friendly: [number, number, number]
  track: [number, number, number]
  alert: [number, number, number]
  text: [number, number, number]
  dim: [number, number, number]
}

export const THEMES: PhosphorTheme[] = [
  {
    name: "DEFCON ICE // CRIMSON",
    bg: [0.006, 0.022, 0.042],
    grid: [0.05, 0.24, 0.42],
    coast: [0.16, 0.78, 1.0],
    inner: [0.07, 0.38, 0.58],
    friendly: [0.25, 0.95, 0.75],
    track: [1.0, 0.72, 0.18],
    alert: [1.0, 0.2, 0.18],
    text: [0.72, 0.94, 1.0],
    dim: [0.25, 0.52, 0.68],
  },
  {
    name: "HIGHFLEET // AMBER",
    bg: [0.024, 0.016, 0.008],
    grid: [0.34, 0.22, 0.07],
    coast: [1.0, 0.68, 0.18],
    inner: [0.52, 0.33, 0.09],
    friendly: [0.95, 0.85, 0.38],
    track: [1.0, 0.55, 0.14],
    alert: [1.0, 0.22, 0.08],
    text: [1.0, 0.86, 0.58],
    dim: [0.62, 0.44, 0.2],
  },
  {
    name: "WOPR // P1 GREEN",
    bg: [0.005, 0.024, 0.01],
    grid: [0.06, 0.28, 0.12],
    coast: [0.22, 0.96, 0.42],
    inner: [0.09, 0.44, 0.18],
    friendly: [0.55, 1.0, 0.65],
    track: [0.88, 0.96, 0.28],
    alert: [1.0, 0.32, 0.16],
    text: [0.74, 1.0, 0.8],
    dim: [0.26, 0.58, 0.34],
  },
]

const bgWgsl = /* wgsl */ `
struct BgUniforms {
  size: vec2f,
  camCenter: vec2f,
  camZoom: f32,
  time: f32,
  focusIdx: f32,
  themeIdx: f32,
  bgCol: vec4f,
  gridCol: vec4f,
  coastCol: vec4f,
  alertCol: vec4f,
  // 7 sectors packed: xy = world pos, z = radius, w = radar angle (negative if urgent)
  sec0: vec4f,
  sec1: vec4f,
  sec2: vec4f,
  sec3: vec4f,
  sec4: vec4f,
  sec5: vec4f,
  sec6: vec4f,
}

@group(0) @binding(0) var<uniform> u: BgUniforms;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn radarContrib(wp: vec2f, sec: vec4f, idx: f32) -> vec3f {
  let dVec = wp - sec.xy;
  let r = length(dVec);
  let maxR = sec.z * 1.12;
  if (r > maxR || r < 2.0) { return vec3f(0.0); }
  let urgent = sec.w < 0.0;
  let beamAng = abs(sec.w) - 10.0;
  let ptAng = atan2(dVec.y, dVec.x);
  // Angular distance behind the sweep clockwise
  let diff = fract((beamAng - ptAng) / 6.2831853);
  let trail = exp(-diff * 7.5) * smoothstep(maxR, maxR * 0.72, r);
  let leadEdge = smoothstep(0.012, 0.0, diff) * smoothstep(maxR, maxR * 0.1, r);
  let ring1 = smoothstep(1.6 / u.camZoom, 0.0, abs(r - maxR * 0.5)) * 0.22;
  let ring2 = smoothstep(1.6 / u.camZoom, 0.0, abs(r - maxR * 0.85)) * 0.28;
  let focusBoost = select(1.0, 1.55, abs(u.focusIdx - idx) < 0.1);
  let baseCol = select(u.coastCol.rgb, mix(u.coastCol.rgb, u.alertCol.rgb, 0.55), urgent);
  return baseCol * ((trail * 0.18 + leadEdge * 0.55 + ring1 + ring2) * focusBoost);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let sp = uv * u.size;
  let wp = (sp - u.size * 0.5) / u.camZoom + u.camCenter;

  var col = u.bgCol.rgb;

  // Deep ocean tactical radial glow in the center of the board
  let normW = (wp - vec2f(800.0, 450.0)) / vec2f(900.0, 520.0);
  col += u.gridCol.rgb * (0.28 * exp(-dot(normW, normW) * 1.4));

  // World bounds soft frame (0..1600 x 0..900)
  let inMap = step(0.0, wp.x) * step(wp.x, 1600.0) * step(0.0, wp.y) * step(wp.y, 900.0);

  // Primary Lat/Lon Graticule (every 100 world units) + fine sub-grid (every 25 units)
  let pxW = 1.0 / u.camZoom;
  let gx100 = min(abs(fract(wp.x / 100.0 + 0.5) - 0.5) * 100.0, abs(fract(wp.y / 100.0 + 0.5) - 0.5) * 100.0);
  let gx25 = min(abs(fract(wp.x / 25.0 + 0.5) - 0.5) * 25.0, abs(fract(wp.y / 25.0 + 0.5) - 0.5) * 25.0);
  let line100 = smoothstep(pxW * 1.4, 0.0, gx100);
  let line25 = smoothstep(pxW * 1.1, 0.0, gx25);
  col += u.gridCol.rgb * (line100 * 0.55 + line25 * 0.16) * inMap;

  // Equator & Prime Meridian dashed emphasis
  let eq = smoothstep(pxW * 1.8, 0.0, abs(wp.y - 450.0));
  let pm = smoothstep(pxW * 1.8, 0.0, abs(wp.x - 800.0));
  let dash = step(0.35, fract((wp.x + wp.y) / 18.0));
  col += u.coastCol.rgb * (max(eq, pm) * dash * 0.25) * inMap;

  // Three sinusoidal orbital reconnaissance ground-tracks across the world
  for (var k = 0; k < 3; k++) {
    let fk = f32(k);
    let phase = fk * 2.1 + u.time * 0.04;
    let orbY = 450.0 + sin(wp.x * 0.0052 + phase) * (250.0 - fk * 35.0);
    let dOrb = abs(wp.y - orbY);
    let orbDash = step(0.45, fract(wp.x / 14.0 - u.time * 0.8 + fk * 0.3));
    let orbLine = smoothstep(pxW * 1.6, 0.0, dOrb) * orbDash;
    col += u.gridCol.rgb * orbLine * 0.45 * inMap;
  }

  // Radar sweeps for all 7 command sectors
  col += radarContrib(wp, u.sec0, 0.0);
  col += radarContrib(wp, u.sec1, 1.0);
  col += radarContrib(wp, u.sec2, 2.0);
  col += radarContrib(wp, u.sec3, 3.0);
  col += radarContrib(wp, u.sec4, 4.0);
  col += radarContrib(wp, u.sec5, 5.0);
  col += radarContrib(wp, u.sec6, 6.0);

  return vec4f(col, 1.0);
}
`

const segWgsl = /* wgsl */ `
struct Seg {
  p0: vec2f,
  p1: vec2f,
  color: vec4f,
  // x = widthPx, y = glowPx, z = dashPeriod (0 = solid), w = dashOffset
  style: vec4f,
}

struct View {
  size: vec2f,
  camCenter: vec2f,
  camZoom: f32,
  dpr: f32,
  time: f32,
  _pad: f32,
}

@group(0) @binding(0) var<storage, read> segs: array<Seg>;
@group(0) @binding(1) var<uniform> view: View;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) lenPx: f32,
  @location(2) @interpolate(flat) id: u32,
}

@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let s = segs[i];
  let s0 = (s.p0 - view.camCenter) * view.camZoom + view.size * 0.5;
  let s1 = (s.p1 - view.camCenter) * view.camZoom + view.size * 0.5;
  let delta = s1 - s0;
  let len = max(length(delta), 0.001);
  let dir = delta / len;
  let nrm = vec2f(-dir.y, dir.x);
  let pad = s.style.x * 0.5 + s.style.y * 2.5 + 2.0;

  var corners = array<vec2f, 6>(
    vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),  vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[v];
  let along = -pad + c.x * (len + pad * 2.0);
  let perp = c.y * pad;
  let pt = s0 + dir * along + nrm * perp;

  var o: Out;
  o.pos = vec4f(pt / view.size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  o.local = vec2f(along, perp);
  o.lenPx = len;
  o.id = i;
  return o;
}

@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let s = segs[in.id];
  let clampedX = clamp(in.local.x, 0.0, in.lenPx);
  let d = length(vec2f(in.local.x - clampedX, in.local.y));

  let halfW = s.style.x * 0.5;
  let core = clamp(0.5 - (d - halfW) * view.dpr, 0.0, 1.0);
  let glow = exp(-max(d - halfW, 0.0) / max(s.style.y, 0.5)) * 0.55;

  var mask = 1.0;
  if (s.style.z > 0.0) {
    let phase = fract((clampedX + s.style.w) / s.style.z);
    mask = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.52, 0.6, phase));
  }

  let a = (core + glow) * mask * s.color.a;
  return vec4f(s.color.rgb * a, a);
}
`

const postWgsl = /* wgsl */ `
struct Post {
  size: vec2f,
  dpr: f32,
  time: f32,
  bloom: f32,
  scan: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> post: Post;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Subtle CRT glass barrel warp
  let centered = uv - 0.5;
  let r2 = dot(centered, centered);
  let u = clamp(uv + centered * r2 * 0.035, vec2f(0.001), vec2f(0.999));
  let px = u * post.size * post.dpr;

  // Slight RGB phosphor fringe near edges
  let ca = 0.00045 + r2 * 0.0012;
  var col = vec3f(
    textureSampleLevel(src, samp, u + vec2f(ca, 0.0), 0.0).r,
    textureSampleLevel(src, samp, u, 0.0).g,
    textureSampleLevel(src, samp, u - vec2f(ca, 0.0), 0.0).b
  );

  // Multi-tap golden-angle phosphor bloom
  var bloomAcc = vec3f(0.0);
  let spin = hash(px) * 6.2831853;
  for (var k = 1; k < 15; k++) {
    let fk = f32(k);
    let ang = fk * 2.39996323 + spin;
    let rad = sqrt(fk / 14.0) * 11.0 / post.size;
    let tap = textureSampleLevel(src, samp, u + vec2f(cos(ang), sin(ang)) * rad, 0.0).rgb;
    bloomAcc += max(tap - vec3f(0.14), vec3f(0.0));
  }
  col += (bloomAcc / 14.0) * post.bloom;

  // Fine CRT scanlines + faint grain
  let scanline = 0.9 + 0.1 * cos(px.y * 2.094);
  col *= mix(1.0, scanline, post.scan);
  col += (hash(px + post.time * 43.0) - 0.5) * 0.015;

  // Glass bezel vignette
  col *= 1.0 - r2 * 0.55;

  return vec4f(col, 1.0);
}
`

export interface Segment {
  x0: number
  y0: number
  x1: number
  y1: number
  color: [number, number, number, number]
  width?: number
  glow?: number
  dashPeriod?: number
  dashOffset?: number
}

export type DefconRenderer = Awaited<ReturnType<typeof createDefconRenderer>>

export async function createDefconRenderer(canvas: HTMLCanvasElement) {
  const gpu = await initGpu()
  const screen = surface(gpu, canvas, { dpr: [1, 2], clearColor: [0.006, 0.022, 0.042, 1] })
  const scene = target(gpu, {
    size: [screen.size[0], screen.size[1]],
    format: "rgba16float",
    clearColor: [0.006, 0.022, 0.042, 1],
  })

  const bgFx = effect(gpu, bgWgsl)
  const segBuf = storage(gpu, MAX_SEGMENTS * SEG_FLOATS * 4)
  const segData = new Float32Array(MAX_SEGMENTS * SEG_FLOATS)
  const segDraw = draw(gpu, { shader: segWgsl, vertices: 6, blend: "additive" })
  segDraw.set({ segs: segBuf, view: { size: [1, 1], camCenter: [800, 450], camZoom: 1, dpr: 1, time: 0, _pad: 0 } })

  const quads = createQuadLayer(gpu, [])
  const postFx = effect(gpu, postWgsl)
  postFx.set({
    src: scene,
    samp: sampler(gpu, { magFilter: "linear", minFilter: "linear" }),
    post: { size: [1, 1], dpr: 1, time: 0, bloom: 1.25, scan: 0.75, _pad0: 0, _pad1: 0 },
  })

  let segCount = 0
  function resetSegments() {
    segCount = 0
  }

  function pushSegment(s: Segment) {
    if (segCount >= MAX_SEGMENTS) return
    const b = segCount++ * SEG_FLOATS
    segData[b] = s.x0
    segData[b + 1] = s.y0
    segData[b + 2] = s.x1
    segData[b + 3] = s.y1
    segData[b + 4] = s.color[0]
    segData[b + 5] = s.color[1]
    segData[b + 6] = s.color[2]
    segData[b + 7] = s.color[3]
    segData[b + 8] = s.width ?? 1.5
    segData[b + 9] = s.glow ?? 2.5
    segData[b + 10] = s.dashPeriod ?? 0
    segData[b + 11] = s.dashOffset ?? 0
  }

  function render(
    camCenter: [number, number],
    camZoom: number,
    time: number,
    focusIdx: number,
    themeIdx: number,
    theme: PhosphorTheme,
    sectorSweepUniforms: [number, number, number, number][],
  ) {
    const dpr = screen.dpr
    const W = screen.size[0] / dpr
    const H = screen.size[1] / dpr
    if (scene.size[0] !== screen.size[0] || scene.size[1] !== screen.size[1]) {
      scene.resize([screen.size[0], screen.size[1]])
    }

    bgFx.set({
      u: {
        size: [W, H],
        camCenter,
        camZoom,
        time,
        focusIdx,
        themeIdx,
        bgCol: [...theme.bg, 1],
        gridCol: [...theme.grid, 1],
        coastCol: [...theme.coast, 1],
        alertCol: [...theme.alert, 1],
        sec0: sectorSweepUniforms[0] ?? [0, 0, 0, 0],
        sec1: sectorSweepUniforms[1] ?? [0, 0, 0, 0],
        sec2: sectorSweepUniforms[2] ?? [0, 0, 0, 0],
        sec3: sectorSweepUniforms[3] ?? [0, 0, 0, 0],
        sec4: sectorSweepUniforms[4] ?? [0, 0, 0, 0],
        sec5: sectorSweepUniforms[5] ?? [0, 0, 0, 0],
        sec6: sectorSweepUniforms[6] ?? [0, 0, 0, 0],
      },
    })

    if (segCount > 0) {
      segBuf.write(segData.subarray(0, segCount * SEG_FLOATS) as Float32Array<ArrayBuffer>)
    }
    segDraw.set({
      view: { size: [W, H], camCenter, camZoom, dpr, time, _pad: 0 },
    })

    quads.prepare(W, H, dpr, time)
    postFx.set({
      post: { size: [W, H], dpr, time, bloom: 1.25, scan: 0.75, _pad0: 0, _pad1: 0 },
    })

    frame(gpu, (f) => {
      f.pass(scene, bgFx)
      f.pass({ target: scene, clear: false }, (p) => {
        if (segCount > 0) p.draw(segDraw, { instances: segCount })
        quads.draw(p)
      })
      f.pass(screen, postFx)
    })
  }

  return {
    gpu,
    quads,
    resetSegments,
    pushSegment,
    render,
    get size() {
      return [screen.size[0] / screen.dpr, screen.size[1] / screen.dpr] as const
    },
    get dpr() {
      return screen.dpr
    },
  }
}
