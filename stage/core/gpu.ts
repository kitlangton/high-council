import { draw, effect, frame, initFromDevice, sampler, storage, surface, target, texture, type Gpu } from "vgpu"

// One instanced draw renders every quad (sprites, text, panels, glows) from a single
// storage buffer, then one post pass applies the skin's screen treatment.
// The pattern is ported from gpu-gallery; skins only ever push quads and set post params.

export const FLOATS = 28
const MAX = 16384
const SPRITE = 512
const TEXT = 4096

export const Kind = { sprite: 0, text: 1, rect: 2, glow: 3 } as const

export interface Quad {
  x: number; y: number; w: number; h: number
  kind?: number
  uv?: ArrayLike<number>
  layer?: number; layer2?: number; mix?: number
  radius?: number; alpha?: number; stroke?: number; noise?: number
  color?: ArrayLike<number>
  blur?: [number, number]; bright?: number; glow?: number
  glitch?: number; split?: number; roll?: number; seed?: number
}

const quadsWgsl = /* wgsl */ `
struct Quad {
  rect: vec4f,    // x y w h, CSS px
  uv: vec4f,      // u0 v0 u1 v1
  src: vec4f,     // layer, kind (0 sprite 1 text 2 rect 3 glow), layer2, mix
  look: vec4f,    // radius, alpha, stroke px (rect) | glow px (glow), static noise (sprite)
  color: vec4f,
  motion: vec4f,  // blur x y (screen px), brightness, _
  fx: vec4f,      // sprite: glitch (row tears), rgb split (uv), rolling bar phase, seed
}
struct View { size: vec2f, dpr: f32, time: f32 }

@group(0) @binding(0) var<storage, read> quads: array<Quad>;
@group(0) @binding(1) var<uniform> view: View;
@group(0) @binding(2) var sprites: texture_2d_array<f32>;
@group(0) @binding(3) var glyphs: texture_2d<f32>;
@group(0) @binding(4) var smp: sampler;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) id: u32,
}

@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let q = quads[i];
  var corners = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let pad = select(vec2f(1.0), vec2f(q.look.z * 3.0 + 1.0), q.src.y == 3.0) + abs(q.motion.xy) * 0.5;
  let local = -pad + corners[v] * (q.rect.zw + pad * 2.0);
  let p = q.rect.xy + local;
  var o: Out;
  o.pos = vec4f(p / view.size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  o.local = local;
  o.id = i;
  return o;
}

fn box(p: vec2f, size: vec2f, r: f32) -> f32 {
  let q = abs(p - size * 0.5) - size * 0.5 + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

// Sharp bilinear: when magnifying, keep texels crisp and antialias only their edges,
// so pixel art stays pixel art at any zoom. Minification falls back to plain filtering.
fn crisp(uv: vec2f, span: vec2f, size: vec2f, gx: vec2f) -> vec2f {
  let dims = vec2f(textureDimensions(sprites));
  let texelsPerPx = length(gx / size * span * dims);
  let scale = 1.0 / max(texelsPerPx, 1e-4);
  if (scale <= 1.0) { return uv; }
  let t = uv * dims;
  let i = floor(t);
  let f = clamp((fract(t) - 0.5) * scale + 0.5, vec2f(0.0), vec2f(1.0));
  return (i + f) / dims;
}

fn layers(q: Quad, uv: vec2f, span: vec2f, size: vec2f, gx: vec2f, gy: vec2f) -> vec3f {
  let u = crisp(uv, span, size, gx);
  var rgb = textureSampleGrad(sprites, smp, u, i32(q.src.x), gx / size * span, gy / size * span).rgb;
  if (q.src.z >= 0.0 && q.src.w > 0.0) {
    rgb = mix(rgb, textureSampleGrad(sprites, smp, u, i32(q.src.z), gx / size * span, gy / size * span).rgb, q.src.w);
  }
  return rgb;
}

fn sprite(q: Quad, local: vec2f, gx: vec2f, gy: vec2f) -> vec3f {
  let size = max(q.rect.zw, vec2f(1.0));
  var uvIn = clamp(local / size, vec2f(0.0), vec2f(1.0));
  let n = q.look.w;
  let g = q.fx.x;
  let tick = floor(view.time * 24.0) + q.fx.w * 13.0;
  // Fine interference: every scan row slips a little while the channel is noisy.
  let row = floor(uvIn.y * 90.0);
  uvIn.x += (hash(vec2f(row, tick)) - 0.5) * n * n * 0.12;
  // Speech tears: a few thick bands jump sideways together, like a codec losing sync.
  let band = floor(uvIn.y * 14.0 + hash(vec2f(tick, 3.0)) * 4.0);
  let tear = step(1.0 - g * 0.55, hash(vec2f(band, tick)));
  uvIn.x += tear * (hash(vec2f(band + 7.0, tick)) - 0.5) * g * 0.16;
  let span = q.uv.zw - q.uv.xy;
  let uv = q.uv.xy + span * uvIn;
  // Channel split widens inside torn bands.
  let sp = vec2f(q.fx.y * (1.0 + tear * 2.0), 0.0);
  var rgb = layers(q, uv, span, size, gx, gy);
  if (q.fx.y > 0.0) {
    rgb.r = layers(q, uv + sp, span, size, gx, gy).r;
    rgb.b = layers(q, uv - sp, span, size, gx, gy).b;
  }
  rgb *= 1.0 + tear * 0.35;
  // Rolling hold bar drifting down the picture.
  if (q.fx.z >= 0.0) {
    let d = fract(uvIn.y - q.fx.z);
    rgb *= 1.0 + 0.22 * exp(-d * 18.0) - 0.08 * smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.08, 0.2, d));
  }
  let snow = hash(floor(local * view.dpr / 2.0) + vec2f(view.time * 61.0, view.time * 17.0));
  rgb = mix(rgb, vec3f(snow) * vec3f(0.55, 1.0, 0.6), n * 0.8);
  return rgb * q.motion.z;
}

@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let q = quads[in.id];
  let gx = dpdx(in.local);
  let gy = dpdy(in.local);
  let size = max(q.rect.zw, vec2f(1.0));
  let r = min(q.look.x, min(size.x, size.y) * 0.5);
  let d = box(in.local, q.rect.zw, r);
  let cov = clamp(0.5 - d * view.dpr, 0.0, 1.0);
  let alpha = q.look.y;
  let kind = q.src.y;

  if (kind == 1.0) {
    let uv = mix(q.uv.xy, q.uv.zw, clamp(in.local / size, vec2f(0.0), vec2f(1.0)));
    return q.color * textureSampleLevel(glyphs, smp, uv, 0.0).a * alpha;
  }
  if (kind == 2.0) {
    var c = cov;
    if (q.look.z > 0.0) { c = clamp(0.5 - (abs(d + q.look.z * 0.5) - q.look.z * 0.5) * view.dpr, 0.0, 1.0); }
    return vec4f(q.color.rgb, 1.0) * q.color.a * c * alpha;
  }
  if (kind == 3.0) {
    let g = exp(-max(d, 0.0) / max(q.look.z, 0.5)) * select(1.0, 0.0, d < -q.look.z * 2.0);
    return vec4f(q.color.rgb, 1.0) * q.color.a * g * alpha;
  }
  let len = length(q.motion.xy);
  var rgb = vec3f(0.0);
  if (len < 0.75) {
    rgb = sprite(q, in.local, gx, gy);
  } else {
    let n = clamp(i32(len / 2.0) + 2, 3, 16);
    for (var k = 0; k < n; k++) {
      let f = (f32(k) + 0.5) / f32(n) - 0.5;
      rgb += sprite(q, in.local - q.motion.xy * f, gx, gy);
    }
    rgb /= f32(n);
  }
  return vec4f(rgb, 1.0) * cov * alpha;
}
`

export interface Post {
  burst: number   // full-screen static, 0..1
  scan: number    // scanline strength
  grain: number
  bloom: number
  tint: [number, number, number]
}

const postWgsl = /* wgsl */ `
struct Post { size: vec2f, dpr: f32, time: f32, burst: f32, scan: f32, grain: f32, bloom: f32, tint: vec3f }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> post: Post;

fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = uv * post.size;
  let b = post.burst;
  let row = floor(px.y / 3.0);
  let tick = floor(post.time * 30.0);
  let tear = (hash(vec2f(row, tick)) - 0.5) * b * 0.09 * step(0.55, hash(vec2f(row * 0.37, tick)));
  let u = uv + vec2f(tear, 0.0);
  let ca = (0.0007 + b * 0.006);
  var col = vec3f(
    textureSampleLevel(src, samp, u + vec2f(ca, 0.0), 0.0).r,
    textureSampleLevel(src, samp, u, 0.0).g,
    textureSampleLevel(src, samp, u - vec2f(ca, 0.0), 0.0).b);
  // Phosphor bloom: two rings of taps, weighted toward bright greens.
  var acc = vec3f(0.0);
  let spin = hash(px) * 6.2831853;
  for (var k = 1; k < 17; k++) {
    let f = f32(k);
    let a = f * 2.39996323 + spin;
    let rad = sqrt(f / 16.0) * 9.0 / post.size;
    acc += textureSampleLevel(src, samp, u + vec2f(cos(a), sin(a)) * rad, 0.0).rgb;
  }
  col += max(acc / 16.0 - 0.12, vec3f(0.0)) * post.bloom;
  let line = 0.5 + 0.5 * cos(px.y * 6.2831853 / 3.0);
  col *= mix(1.0, 0.7 + 0.3 * line, post.scan);
  col += (hash(px + post.time * 91.0) - 0.5) * post.grain;
  let snow = hash(floor(px / 2.0) + vec2f(post.time * 60.0, 0.0));
  col = mix(col, vec3f(snow) * post.tint, clamp(b * 0.9, 0.0, 0.92));
  let v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.9;
  return vec4f(col, 1.0);
}
`

export async function initGpu() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })
  if (!adapter) throw new Error("No WebGPU adapter")
  const device = await adapter.requestDevice()
  // Own the adapter and device so they stay referenced between frames.
  ;(globalThis as any).__gpuKeepAlive = { adapter, device }
  return initFromDevice(device)
}

export type QuadLayer = ReturnType<typeof createQuadLayer>

// The shared 2D layer: sprites, text, panels and glows in one instanced draw. Skins use it
// for HUDs and labels whether the scene underneath is flat or 3D.
export function createQuadLayer(gpu: Gpu, spriteUrls: string[], opts: { depth?: boolean } = {}) {
  const dev = gpu.gpu
  const sprites = texture(gpu, {
    kind: "2d-array", size: [SPRITE, SPRITE], layers: Math.max(2, spriteUrls.length), format: "rgba8unorm",
    usage: ["texture_binding", "copy_dst", "render_attachment"],
  })
  const glyphs = texture(gpu, { kind: "2d", size: [TEXT, TEXT], format: "rgba8unorm", usage: ["texture_binding", "copy_dst", "render_attachment"] })
  const buf = storage(gpu, MAX * FLOATS * 4)
  const data = new Float32Array(MAX * FLOATS)
  const pass = draw(gpu, { shader: quadsWgsl, vertices: 6, blend: "premultiplied", ...(opts.depth ? { depth: false as const } : {}) })
  const smp = sampler(gpu, { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 4 })
  pass.set({ quads: buf, sprites, glyphs, smp, view: { size: [1, 1], dpr: 1, time: 0 } })

  const ready = Promise.all(spriteUrls.map(async (url, layer) => {
    const bmp = await createImageBitmap(await (await fetch(url)).blob())
    dev.queue.copyExternalImageToTexture({ source: bmp }, { texture: sprites.gpu, origin: [0, 0, layer] }, [Math.min(bmp.width, SPRITE), Math.min(bmp.height, SPRITE)])
    bmp.close()
  }))

  // Text: each string is rasterized once into a shelf-packed atlas and addressed by uv.
  const textCanvas = new OffscreenCanvas(TEXT, TEXT)
  const tctx = textCanvas.getContext("2d")!
  const textMap = new Map<string, { uv: [number, number, number, number]; w: number; h: number }>()
  let tx = 0, ty = 0, rowH = 0, textDirty = false
  // Raster scale shrinks for large type so a page of display text can't exhaust the atlas.
  // Pass `scale` (usually the device pixel ratio) to rasterize 1:1 for pixel fonts.
  function text(str: string, px: number, font = "600 {px} ui-monospace, 'SF Mono', Menlo, monospace", spacing = 0, scale?: number) {
    const key = `${str}|${px}|${font}|${spacing}|${scale ?? ""}`
    const hit = textMap.get(key)
    if (hit) return hit
    const SCALE = scale ?? Math.min(3, Math.max(1.2, 72 / px))
    tctx.font = font.replace("{px}", `${px * SCALE}px`)
    ;(tctx as any).letterSpacing = `${spacing * SCALE}px`
    const w = Math.ceil(tctx.measureText(str).width + spacing * SCALE) + 6
    const h = Math.ceil(px * SCALE * 1.3)
    if (tx + w > TEXT) { tx = 0; ty += rowH + 4; rowH = 0 }
    if (ty + h > TEXT) { tctx.clearRect(0, 0, TEXT, TEXT); textMap.clear(); tx = 0; ty = 0; rowH = 0 }
    tctx.fillStyle = "#fff"
    tctx.textBaseline = "middle"
    tctx.fillText(str, tx + 3, Math.round(ty + h / 2))
    const entry = { uv: [tx / TEXT, ty / TEXT, (tx + w) / TEXT, (ty + h) / TEXT] as [number, number, number, number], w: w / SCALE, h: h / SCALE }
    tx += w + 4
    rowH = Math.max(rowH, h)
    textMap.set(key, entry)
    textDirty = true
    return entry
  }

  let count = 0
  function push(o: Quad) {
    if (count >= MAX) return
    const b = count++ * FLOATS
    data[b] = o.x; data[b + 1] = o.y; data[b + 2] = o.w; data[b + 3] = o.h
    const u = o.uv ?? [0, 0, 1, 1]; data[b + 4] = u[0]!; data[b + 5] = u[1]!; data[b + 6] = u[2]!; data[b + 7] = u[3]!
    data[b + 8] = o.layer ?? 0; data[b + 9] = o.kind ?? Kind.rect; data[b + 10] = o.layer2 ?? -1; data[b + 11] = o.mix ?? 0
    data[b + 12] = o.radius ?? 0; data[b + 13] = o.alpha ?? 1; data[b + 14] = o.stroke ?? o.glow ?? 0; data[b + 15] = o.noise ?? 0
    const c = o.color ?? [1, 1, 1, 1]; data[b + 16] = c[0]!; data[b + 17] = c[1]!; data[b + 18] = c[2]!; data[b + 19] = c[3]!
    data[b + 20] = o.blur?.[0] ?? 0; data[b + 21] = o.blur?.[1] ?? 0; data[b + 22] = o.bright ?? 1; data[b + 23] = 0
    data[b + 24] = o.glitch ?? 0; data[b + 25] = o.split ?? 0; data[b + 26] = o.roll ?? -1; data[b + 27] = o.seed ?? 0
  }

  return {
    ready, text, push,
    reset() { count = 0 },
    get count() { return count },
    // Uploads this frame's quads and text; call once before drawing.
    prepare(W: number, H: number, dpr: number, time: number) {
      if (textDirty) {
        dev.queue.copyExternalImageToTexture({ source: textCanvas }, { texture: glyphs.gpu }, [TEXT, TEXT])
        textDirty = false
      }
      buf.write(data.subarray(0, count * FLOATS))
      pass.set({ view: { size: [W, H], dpr, time } })
    },
    draw(p: { draw: (d: typeof pass, o: { instances: number }) => void }) { if (count) p.draw(pass, { instances: count }) },
  }
}

export type Renderer = Awaited<ReturnType<typeof createRenderer>>

export async function createRenderer(canvas: HTMLCanvasElement, spriteUrls: string[]) {
  const gpu = await initGpu()
  const bg: [number, number, number, number] = [0.004, 0.012, 0.008, 1]
  const screen = surface(gpu, canvas, { dpr: [1, 2], clearColor: bg })
  const quads = createQuadLayer(gpu, spriteUrls)

  const scene = target(gpu, { size: [screen.size[0], screen.size[1]], format: screen.format, clearColor: bg })
  const fx = effect(gpu, postWgsl)
  const post: Post = { burst: 0, scan: 0.6, grain: 0.03, bloom: 0.9, tint: [0.45, 1, 0.6] }
  fx.set({ src: scene, samp: sampler(gpu, { magFilter: "linear", minFilter: "linear" }), post: { size: [1, 1], dpr: 1, time: 0, burst: 0, scan: 0, grain: 0, bloom: 0, tint: [0, 0, 0] } })

  function render(time: number) {
    const dpr = screen.dpr
    const W = screen.size[0] / dpr, H = screen.size[1] / dpr
    quads.prepare(W, H, dpr, time)
    if (scene.size[0] !== screen.size[0] || scene.size[1] !== screen.size[1]) scene.resize([screen.size[0], screen.size[1]])
    fx.set({ post: { size: [W, H], dpr, time, burst: post.burst, scan: post.scan, grain: post.grain, bloom: post.bloom, tint: post.tint } })
    frame(gpu, (f) => {
      f.pass(scene, (p) => quads.draw(p))
      f.pass(screen, fx)
    })
  }

  return {
    gpu, ready: quads.ready, post, text: quads.text, push: quads.push, render,
    reset: quads.reset,
    get count() { return quads.count },
  }
}
