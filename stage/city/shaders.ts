// World shaders: every object is an instanced unit cube, optionally collapsed into a gable
// or pyramid. Normals come from screen derivatives, so any deformation shades correctly.

const corners: number[][] = []
const quad = (a: number[], b: number[], c: number[], d: number[]) => corners.push(a, b, c, a, c, d)
quad([0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [0.5, 0, 0.5])
quad([-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], [-0.5, 0, -0.5])
quad([-0.5, 1, -0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5])
quad([-0.5, 0, 0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5])
quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5])
quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5])
const table = `array<vec3f, 36>(${corners.map((c) => `vec3f(${c.map((v) => v.toFixed(1)).join(", ")})`).join(", ")})`

const common = /* wgsl */ `
struct Inst { a: vec4f, b: vec4f, c: vec4f, d: vec4f }
// a: x y z shape · b: sx sy sz rot · c: r g b district · d: seed lit emit material
struct Cam {
  center: vec3f, zoom: f32,
  viewport: vec2f, yaw: f32, pitch: f32,
  sun: vec3f, time: f32,
  lightRight: vec3f, ext: f32,
  lightUp: vec3f, sel: f32,
  lightCenter: vec3f, hover: f32,
  style: vec4f,     // x: pixel-art amount 0..1
}
@group(0) @binding(0) var<storage, read> insts: array<Inst>;
@group(0) @binding(1) var<uniform> cam: Cam;

const DEPTH = 90.0;

fn corner(v: u32) -> vec3f { var t = ${table}; return t[v]; }

// Instance-local position (scaled, unrotated) for one cube corner after shape deformation.
fn local(inst: Inst, v: u32) -> vec3f {
  var c = corner(v);
  let shape = inst.a.w;
  if (c.y > 0.5 && shape == 1.0) { c.x = 0.0; }
  if (c.y > 0.5 && shape == 2.0) { c.x = 0.0; c.z = 0.0; }
  return c * inst.b.xyz;
}
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }
fn world(inst: Inst, lp: vec3f) -> vec3f { return inst.a.xyz + rotY(lp, inst.b.w); }

// Isometric projection: yaw around the vertical axis, then a fixed downward pitch.
fn project(p: vec3f) -> vec4f {
  let d = p - cam.center;
  let c = cos(cam.yaw); let s = sin(cam.yaw);
  let rx = d.x * c - d.z * s;
  let rz = d.x * s + d.z * c;
  let sx = rx * cam.zoom;
  let sy = (rz * sin(cam.pitch) - d.y * cos(cam.pitch)) * cam.zoom;
  let depth = rz * cos(cam.pitch) + d.y * sin(cam.pitch);
  return vec4f(sx / (cam.viewport.x * 0.5), -sy / (cam.viewport.y * 0.5), 0.5 - depth / (2.0 * DEPTH), 1.0);
}
fn lightSpace(p: vec3f) -> vec3f {
  let d = p - cam.lightCenter;
  return vec3f(dot(d, cam.lightRight) / cam.ext, dot(d, cam.lightUp) / cam.ext, 0.5 - dot(d, cam.sun) / (2.0 * DEPTH));
}
`

export const shadowWgsl = /* wgsl */ `
${common}
struct Out { @builtin(position) pos: vec4f, @location(0) z: f32 }
@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let inst = insts[i];
  let ls = lightSpace(world(inst, local(inst, v)));
  var o: Out;
  // Water and emissive points don't cast shadows.
  let skip = inst.d.w == 3.0 || inst.d.w == 5.0 || inst.a.w == 3.0;
  o.pos = select(vec4f(ls.xy, ls.z, 1.0), vec4f(2.0, 2.0, 2.0, 1.0), skip);
  o.z = ls.z;
  return o;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4f { return vec4f(in.z, 0.0, 0.0, 1.0); }
`

export const worldWgsl = /* wgsl */ `
${common}
@group(0) @binding(2) var shadowMap: texture_2d<f32>;
@group(0) @binding(3) var shadowSmp: sampler;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) lp: vec3f,
  @location(2) @interpolate(flat) id: u32,
}
// Puffs are camera-facing discs: the first face becomes a screen quad, the rest collapse.
fn puffCorner(v: u32) -> vec2f {
  var q = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));
  return q[v % 6u];
}

@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let inst = insts[i];
  var o: Out;
  if (inst.a.w == 3.0) {
    let c = puffCorner(v);
    let r = inst.b.x * 0.5;
    var p = project(inst.a.xyz);
    p.x += c.x * r * cam.zoom / (cam.viewport.x * 0.5);
    p.y += c.y * r * cam.zoom / (cam.viewport.y * 0.5);
    o.pos = select(p, vec4f(2.0, 2.0, 2.0, 1.0), v >= 6u);
    o.wp = inst.a.xyz;
    o.lp = vec3f(c, 0.0);
    o.id = i;
    return o;
  }
  let lp = local(inst, v);
  let wp = world(inst, lp);
  o.pos = project(wp);
  o.wp = wp;
  o.lp = lp;
  o.id = i;
  return o;
}

fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1, 0)), u.x), mix(hash(i + vec2f(0, 1)), hash(i + vec2f(1, 1)), u.x), u.y);
}
fn lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
// Pixel style keeps surfaces flat: fine noise turns to mush once art pixels are enlarged.
fn tex(v: f32) -> f32 { return mix(v, 0.5, cam.style.x * 0.85); }

fn shadowAt(p: vec3f, n: vec3f) -> f32 {
  let ls = lightSpace(p + n * 0.04);
  let uv = vec2f(ls.x * 0.5 + 0.5, 0.5 - ls.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowMap));
  var lit = 0.0;
  for (var k = 0; k < 12; k++) {
    let a = f32(k) * 2.39996 + hash(p.xz * 37.0) * 6.28;
    let r = sqrt((f32(k) + 0.5) / 12.0) * 1.8;
    let s = textureSampleLevel(shadowMap, shadowSmp, uv + vec2f(cos(a), sin(a)) * r * texel, 0.0).r;
    lit += select(0.0, 1.0, s >= ls.z - 0.0012);
  }
  return lit / 12.0;
}

// Smoke: a soft volumetric-looking puff. Lit from the sun side, darker and denser in
// the core, with a feathered, noise-eroded edge. Output is premultiplied; the smoke pass
// blends colour only, so the depth stored in alpha stays the surface behind it.
fn puffColor(inst: Inst, q: vec2f, frag: vec2f) -> vec4f {
  let d = length(q);
  let seed = inst.d.x * 31.0;
  let edge = 0.7 + 0.3 * noise(q * 2.2 + seed) + 0.1 * noise(q * 5.0 - seed);
  let body = exp(-pow(d / (edge * 0.62), 2.0) * 2.2);
  if (body <= 0.01) { discard; }
  let nz = sqrt(max(0.0, 1.0 - min(d * d, 1.0)));
  let n3 = normalize(vec3f(q.x, -q.y, nz + 0.35));
  let toSun = normalize(vec3f(-0.55, 0.72, 0.4));
  let lit = 0.55 + 0.45 * max(dot(n3, toSun), 0.0);
  let warm = lin(vec3f(1.0, 0.93, 0.84));
  let cool = lin(vec3f(0.58, 0.62, 0.7));
  let col = lin(inst.c.rgb) * mix(cool, warm, lit) * 1.15;
  let a = body * inst.d.z;
  return vec4f(col * a, a);
}

fn shadeOut(col: vec3f, z: f32) -> vec4f {
  // Alpha carries scene depth (0 = background) for the depth-of-field pass.
  return vec4f(col, clamp(z, 0.002, 1.0));
}

@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let inst = insts[in.id];
  let mat = inst.d.w;
  let size = inst.b.xyz;
  let lp = in.lp;
  let wp = in.wp;
  let fw = fwidth(lp);
  let view = vec3f(cos(cam.pitch) * sin(cam.yaw), sin(cam.pitch), cos(cam.pitch) * cos(cam.yaw));
  var n = normalize(cross(dpdx(wp), dpdy(wp)));
  if (dot(n, view) < 0.0) { n = -n; }
  let nl = rotY(n, -inst.b.w);
  if (inst.a.w == 3.0) { return puffColor(inst, in.lp.xy, in.pos.xy); }
  let top = nl.y > 0.6;
  let wall = abs(nl.y) < 0.3;

  var base = lin(inst.c.rgb);
  var emit = vec3f(0.0);
  var spec = 0.0;

  if (mat == 1.0) { // ground: grass on top, layered earth on the sides
    if (top) {
      base *= 0.86 + 0.28 * tex(noise(wp.xz * 1.7)) + 0.06 * tex(noise(wp.xz * 9.0));
    } else {
      let band = floor(wp.y * 5.0 + noise(wp.xz * 0.6) * 1.5);
      base = lin(mix(vec3f(0.42, 0.3, 0.22), vec3f(0.55, 0.42, 0.3), hash(vec2f(band, 1.0)))) * (0.85 + 0.15 * noise(vec2f(wp.x + wp.z, wp.y) * 6.0));
    }
  } else if (mat == 2.0) { // road with dashed centre line
    base *= 0.92 + 0.12 * tex(noise(wp.xz * 12.0));
    if (top && size.z > 0.85 && abs(lp.z) < 0.035 && fract(lp.x * 1.4) < 0.5) { base = lin(vec3f(0.92, 0.84, 0.55)); }
  } else if (mat == 3.0) { // water: shallow-to-deep tint, sky reflection, shoreline foam, glints
    let t = cam.time;
    // Island half-extent is the water box minus the 4-tile margin on each side, plus the bank.
    let half = size.xz * 0.5 - vec2f(3.5);
    let q = abs(wp.xz - inst.a.xz) - half;
    let shore = max(q.x, q.y);
    // Two octaves of moving ripples give a normal that bends reflections.
    let p1 = wp.xz * 1.6 + vec2f(t * 0.22, t * 0.15);
    let p2 = wp.xz * 4.3 - vec2f(t * 0.31, -t * 0.27);
    let h = noise(p1) * 0.65 + noise(p2) * 0.35;
    let hx = noise(p1 + vec2f(0.15, 0.0)) * 0.65 + noise(p2 + vec2f(0.15, 0.0)) * 0.35 - h;
    let hz = noise(p1 + vec2f(0.0, 0.15)) * 0.65 + noise(p2 + vec2f(0.0, 0.15)) * 0.35 - h;
    let wn = normalize(vec3f(-hx * 1.2, 1.0, -hz * 1.2) * vec3f(1.0 - cam.style.x * 0.7, 1.0, 1.0 - cam.style.x * 0.7));
    let deep = lin(vec3f(0.07, 0.3, 0.42));
    let shallow = lin(mix(vec3f(0.3, 0.72, 0.72), vec3f(0.24, 0.58, 0.66), cam.style.x));
    let depthT = smoothstep(0.0, 3.2, shore);
    var water = mix(shallow, deep, depthT);
    // Fresnel-ish sky reflection, stronger where ripples tilt toward the viewer.
    let fres = pow(1.0 - max(dot(wn, view), 0.0), 3.0);
    let skyc = lin(mix(vec3f(0.78, 0.86, 0.94), vec3f(0.98, 0.95, 0.9), h));
    water = mix(water, skyc, 0.08 + fres * 0.35);
    // Caustic shimmer over the shallows.
    let caus = pow(abs(sin(noise(wp.xz * 3.0 + t * 0.4) * 9.0)), 12.0) * (1.0 - depthT);
    water += lin(vec3f(0.6, 0.95, 0.9)) * caus * 0.05 * (1.0 - smoothstep(0.0, 1.2, shore));
    // Two foam lines lapping at the shore, broken up by noise.
    let lap = sin(shore * 7.0 - t * 1.6) * 0.5 + 0.5;
    let foamN = noise(wp.xz * 6.0 + t * 0.2);
    let near = 1.0 - smoothstep(0.0, 0.5, shore);
    let foam = near * (smoothstep(0.7, 0.95, lap * foamN + 0.3) * 0.7 + (1.0 - smoothstep(0.0, 0.12, shore)));
    water = mix(water, lin(vec3f(0.97, 0.98, 0.97)), clamp(foam, 0.0, 0.9) * (1.0 - cam.style.x * 0.35));
    // Sun glints: rare, tight highlights on ripple crests.
    let hv = normalize(cam.sun + view);
    let glint = pow(max(dot(wn, hv), 0.0), 600.0) * 1.5;
    let sh = shadowAt(wp, vec3f(0.0, 1.0, 0.0));
    let outCol = water * (0.75 + 0.25 * sh) + lin(vec3f(1.0, 0.95, 0.85)) * glint * sh;
    if (cam.sel >= 0.0) {
      let l = dot(outCol, vec3f(0.3, 0.59, 0.11));
      return shadeOut(mix(outCol, vec3f(l), 0.4) * 0.8, in.pos.z);
    }
    return shadeOut(outCol, in.pos.z);
  } else if (mat == 4.0 || mat == 12.0) { // buildings: windows on walls, gravel on top
    if (wall) {
      let u = select(lp.x, lp.z, abs(nl.x) > abs(nl.z));
      let half = select(size.x, size.z, abs(nl.x) > abs(nl.z)) * 0.5;
      let glass = mat == 12.0;
      let cell = vec2f(u / (select(0.17, 0.12, glass) * (1.0 + cam.style.x)), lp.y / (0.2 * (1.0 + cam.style.x * 0.8)));
      let f = fract(cell);
      let id = floor(cell);
      let inWin = select(step(0.3, f.x) * step(f.x, 0.7) * step(0.34, f.y) * step(f.y, 0.78),
                         step(0.06, f.x) * step(f.x, 0.94) * step(0.1, f.y) * step(f.y, 0.92), glass);
      let edge = step(abs(u), half - 0.06) * step(0.08, lp.y) * step(lp.y, size.y - 0.06);
      let win = inWin * edge;
      // Daytime: panes mostly reflect the sky; a few offices have their lights on.
      let on = step(hash(id + vec2f(inst.d.x * 91.0, sign(nl.x + nl.z) * 7.0)), inst.d.y * 0.22 * (1.0 - cam.style.x * 0.5));
      let sky = mix(vec3f(0.42, 0.52, 0.62), vec3f(0.72, 0.8, 0.88), clamp(lp.y / max(size.y, 0.1), 0.0, 1.0));
      let pane = select(lin(vec3f(0.3, 0.36, 0.44)), lin(sky), glass);
      base = mix(base, pane, win * select(0.85, 0.7, glass));
      emit = lin(vec3f(1.0, 0.82, 0.55)) * win * on * 0.35;
      spec = win * select(0.06, 0.18, glass);
    } else if (top) {
      base *= 0.62 + 0.1 * tex(noise(wp.xz * 14.0));
      let rim = min(size.x * 0.5 - abs(lp.x), size.z * 0.5 - abs(lp.z));
      base = mix(base * 1.35, base, smoothstep(0.03, 0.06, rim));
    }
  } else if (mat == 5.0) { // emissive beacons blink
    let blink = step(0.5, fract(cam.time * 0.8 + inst.d.x));
    return shadeOut(lin(inst.c.rgb) * (0.6 + 3.0 * blink), in.pos.z);
  } else if (mat == 6.0) { // plinth: layered stone, like a cut-away diorama base
    let band = floor(wp.y * 3.0);
    base = lin(mix(vec3f(0.5, 0.44, 0.38), vec3f(0.6, 0.53, 0.45), hash(vec2f(band, 2.0)))) * (0.9 + 0.1 * noise(vec2f(wp.x + wp.z, wp.y) * 4.0));
  } else if (mat == 7.0) { // roof tiles
    if (!top) { base *= 0.9 + 0.12 * step(0.5, fract(dot(lp, vec3f(0.0, 9.0, 0.0)))); }
  } else if (mat == 8.0) { // foliage
    base *= 0.85 + 0.3 * tex(noise(wp.xz * 6.0 + wp.y * 4.0));
  } else if (mat == 10.0 || mat == 11.0) { // sidewalk and plaza paving
    if (top) {
      let g = fract(wp.xz * select(3.0, 2.0, mat == 11.0));
      let grout = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
      base *= mix(mix(0.9, 1.0, smoothstep(0.0, 0.05, grout)), 1.0, cam.style.x) * (0.95 + 0.05 * tex(noise(wp.xz * 5.0)));
    }
  }

  // Crisp model edges, like a painted miniature.
  var e = 1.0;
  if (inst.a.w == 0.0 && mat != 3.0 && mat != 1.0) {
    let hs = size.xz * 0.5;
    var d = 1e6;
    if (top) { d = min((hs.x - abs(lp.x)) / fw.x, (hs.y - abs(lp.z)) / fw.z); }
    else if (wall) {
      let hu = select(hs.x, hs.y, abs(nl.x) > abs(nl.z));
      let u = select(lp.x, lp.z, abs(nl.x) > abs(nl.z));
      let fu = select(fw.x, fw.z, abs(nl.x) > abs(nl.z));
      d = min((hu - abs(u)) / fu, (size.y - lp.y) / fw.y);
    }
    e = mix(0.82, 1.0, smoothstep(0.5, 1.6, d));
  }

  let sh = shadowAt(wp, n);
  var diff = max(dot(n, cam.sun), 0.0) * sh;
  // Pixel style: light falls into three flat bands, like hand-shaded sprites.
  let px = cam.style.x;
  diff = mix(diff, floor(diff * 3.0 + 0.35) / 3.0, px);
  let sky = lin(vec3f(0.62, 0.72, 0.9));
  let bounce = lin(vec3f(0.55, 0.48, 0.4));
  var ao = 1.0;
  if (wall) { ao = mix(0.62, 1.0, smoothstep(0.0, 0.45, lp.y)); ao = mix(ao, select(1.0, 0.75, lp.y < 0.12), px); }
  let amb = mix(bounce, sky, n.y * 0.5 + 0.5) * 0.5 * ao;
  let sunc = lin(vec3f(1.0, 0.86, 0.68)) * 1.25;
  var col = base * (amb + sunc * diff) * e + emit + spec * sunc * sh;

  // Focus: other districts fade back so the selected one reads first.
  let did = inst.c.w;
  if (cam.sel >= 0.0 && did != cam.sel) {
    let l = dot(col, vec3f(0.3, 0.59, 0.11));
    col = mix(col, vec3f(l), 0.55) * 0.72;
  }
  if (cam.hover >= 0.0 && did == cam.hover) { col *= 1.12; }
  return shadeOut(col, in.pos.z);
}
`

export const postWgsl = /* wgsl */ `
struct Post { size: vec2f, dpr: f32, time: f32, zoom: f32, aperture: f32, block: f32, pixel: f32, mode: f32, top: vec3f, bottom: vec3f }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> post: Post;
@group(0) @binding(3) var pt: sampler;

const DEPTH = 90.0;
const TAPS = 40;
const MAX_R = 22.0;

fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }

// Circle of confusion in CSS px: distance from the focal plane (the camera target),
// scaled by zoom, so moving in makes the focus shallower like a real macro lens.
fn coc(a: f32) -> f32 {
  if (a < 0.001) { return MAX_R; }
  return min(MAX_R, abs(a - 0.5) * 2.0 * DEPTH * post.zoom * post.aperture);
}

fn bayer(p: vec2f) -> f32 {
  let x = u32(p.x) % 4u; let y = u32(p.y) % 4u;
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[y * 4u + x] + 0.5) / 16.0;
}

fn background(uv: vec2f) -> vec3f {
  let v = uv - vec2f(0.5, 0.42);
  return mix(post.top, post.bottom, uv.y) + vec3f(0.06) * exp(-dot(v, v) * 6.0) * (1.0 - post.pixel);
}

fn grade(c: vec3f) -> vec3f {
  var g = pow(aces(c * 1.05), vec3f(1.0 / 2.2));
  let lum = dot(g, vec3f(0.3, 0.59, 0.11));
  return mix(vec3f(lum), g, 1.1 + post.pixel * 0.25);
}

// Pixel art: point-sample one texel per block (a true low-res render, no smoothing),
// outline silhouettes by depth, then quantize to a 7·8·6-level palette with Bayer dither.
fn pixelArt(uv: vec2f) -> vec3f {
  let b = max(post.block, 1.0 / post.dpr);
  let cell = floor(uv * post.size / b);
  let at = (cell + 0.5) * b / post.size;
  let step2 = vec2f(b) / post.size;
  let s = textureSampleLevel(src, pt, at, 0.0);
  let geo = s.a > 0.001;
  // Colour is a 2x2 average inside the block: fine texture (windows, ripples) resolves
  // to a clean tone instead of aliasing into speckle. Depth stays point-sampled.
  var avg = vec3f(0.0);
  var cnt = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = (vec2f(f32(k % 2), f32(k / 2)) - 0.5) * 0.5 * step2;
    let t = textureSampleLevel(src, pt, at + o, 0.0);
    if (t.a > 0.001) { avg += t.rgb; cnt += 1.0; }
  }
  let rgb = select(s.rgb, avg / max(cnt, 1.0), cnt > 0.0);
  var col = select(background(at), grade(rgb), geo);
  // Ink outline wherever a neighbouring block is clearly nearer (or this block is sky).
  var ink = 0.0;
  for (var k = 0; k < 4; k++) {
    var o = array<vec2f, 4>(vec2f(-1, 0), vec2f(1, 0), vec2f(0, -1), vec2f(0, 1));
    let n = textureSampleLevel(src, pt, at + o[k] * step2, 0.0).a;
    let nearer = n > 0.001 && (!geo || s.a - n > 0.006);
    ink = max(ink, select(0.0, 1.0, nearer));
  }
  col = mix(col, col * vec3f(0.22, 0.2, 0.26), ink * 0.85);
  let levels = vec3f(9.0, 10.0, 8.0);
  let d = (bayer(cell) - 0.5) * select(0.15, 0.6, geo);
  return floor(col * (levels - 1.0) + 0.5 + d) / (levels - 1.0);
}

// ── print styles ─────────────────────────────────────────────────────────────────
// All share one idea: shade from the 3D render, then reduce to a printing process.

fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }

fn bayer8(p: vec2f) -> f32 {
  let x = u32(p.x); let y = u32(p.y);
  var v = 0u;
  for (var i = 0u; i < 3u; i++) {
    let xb = (x >> i) & 1u; let yb = (y >> i) & 1u;
    v = v | ((((xb ^ yb) << 1u) | yb) << (2u * (2u - i)));
  }
  return (f32(v) + 0.5) / 64.0;
}

// Outline strength at uv: silhouettes from depth jumps, creases from tone jumps.
fn edges(uv: vec2f, r: f32) -> vec2f {
  let c = textureSampleLevel(src, pt, uv, 0.0);
  let cl = lum(c.rgb);
  var sil = 0.0;
  var crease = 0.0;
  var o = array<vec2f, 4>(vec2f(1, 0), vec2f(-1, 0), vec2f(0, 1), vec2f(0, -1));
  for (var k = 0; k < 4; k++) {
    let n = textureSampleLevel(src, pt, uv + o[k] * r / post.size, 0.0);
    let hitC = c.a > 0.001; let hitN = n.a > 0.001;
    // Only the nearer side draws the line, so outlines don't double up.
    if (hitN && (!hitC || c.a - n.a > 0.004)) { sil = 1.0; }
    if (hitC && hitN && abs(c.a - n.a) < 0.004) { crease = max(crease, smoothstep(0.08, 0.2, abs(cl - lum(n.rgb)))); }
  }
  return vec2f(sil, crease);
}

fn paperGrain(px: vec2f) -> f32 { return (hash(floor(px)) - 0.5) * 0.035 + (hash(floor(px / 3.0) + 17.0) - 0.5) * 0.02; }

fn shadeAt(uv: vec2f) -> vec4f {
  let s = textureSampleLevel(src, samp, uv, 0.0);
  return vec4f(grade(s.rgb), s.a);
}

// 1-bit dither: ink on warm paper, ordered dither for tone, ink outlines.
fn dither1(uv: vec2f, px: vec2f) -> vec3f {
  let paper = vec3f(0.94, 0.91, 0.84);
  let ink = vec3f(0.11, 0.13, 0.19);
  let c = shadeAt(uv);
  let geo = c.a > 0.001;
  // Print tone curve: lift mids so paper carries most of the image and ink means shadow.
  var l = select(0.97, pow(smoothstep(0.02, 0.62, lum(c.rgb)), 0.7), geo);
  let cell = floor(px);
  var on = select(0.0, 1.0, l < bayer8(cell));
  let e = edges(uv, 1.0);
  on = max(on, max(e.x, e.y * 0.6));
  return mix(paper + paperGrain(px), ink, on);
}

fn halftone(px: vec2f, angle: f32, cell: f32, density: f32) -> f32 {
  let c = cos(angle); let s = sin(angle);
  let q = vec2f(px.x * c - px.y * s, px.x * s + px.y * c) / cell;
  let f = fract(q) - 0.5;
  let r = sqrt(clamp(density, 0.0, 1.0)) * 0.62;
  return 1.0 - smoothstep(r - 0.08, r + 0.08, length(f));
}

// Risograph: two spot inks with rotated halftone screens and a slight misregistration.
fn riso(uv: vec2f, px: vec2f) -> vec3f {
  let paper = vec3f(0.96, 0.94, 0.89);
  let blue = vec3f(0.2, 0.33, 0.66);
  let red = vec3f(0.95, 0.36, 0.3);
  let cb = shadeAt(uv);
  let cr = shadeAt(uv + vec2f(1.4, -0.8) / post.size);
  let geoB = cb.a > 0.001; let geoR = cr.a > 0.001;
  let lB = pow(smoothstep(0.02, 0.62, lum(cb.rgb)), 0.7);
  let dB = select(0.0, pow(1.0 - lB, 1.3) * 0.95 + 0.05, geoB);
  let warm = smoothstep(0.02, 0.18, cr.r - cr.b);
  let dR = select(0.0, warm * 0.75 + (1.0 - lB) * 0.15, geoR);
  let e = edges(uv, 1.0);
  let inkB = max(halftone(px, 0.26, 4.5, dB), e.x * 0.9);
  let inkR = halftone(px + vec2f(1.0, 0.0), 1.31, 4.5, dR);
  var col = paper + paperGrain(px);
  col *= mix(vec3f(1.0), blue, inkB * 0.92);
  col *= mix(vec3f(1.0), red, inkR * 0.85);
  return col;
}

// Ink line: flat posterized colour, a clean ink outline, paper behind.
fn inkLine(uv: vec2f, px: vec2f) -> vec3f {
  let paper = vec3f(0.95, 0.93, 0.88);
  let ink = vec3f(0.12, 0.12, 0.15);
  let c = shadeAt(uv);
  let geo = c.a > 0.001;
  var col = paper + paperGrain(px) * 0.6;
  if (geo) {
    let l = lum(c.rgb);
    let q = (floor(l * 4.0 + 0.5) / 4.0 + 0.06);
    var flat = c.rgb * (q / max(l, 0.02));
    flat = mix(flat, vec3f(lum(flat)), 0.12);
    col = mix(flat, paper, 0.1);
  }
  let e = edges(uv, 1.2);
  col = mix(col, ink, max(e.x, e.y * 0.35));
  return col;
}

// Blueprint: white linework and faint fills on cyanotype blue, with a drafting grid.
fn blueprint(uv: vec2f, px: vec2f) -> vec3f {
  let bg = vec3f(0.1, 0.27, 0.5);
  let line = vec3f(0.9, 0.95, 1.0);
  let c = shadeAt(uv);
  let geo = c.a > 0.001;
  let g = fract(px / 24.0);
  let grid = max(step(g.x, 0.04), step(g.y, 0.04)) * 0.08;
  var col = bg + grid + paperGrain(px) * 0.5;
  if (geo) { col = mix(col, line, 0.06 + lum(c.rgb) * 0.12); }
  let e = edges(uv, 1.0);
  col = mix(col, line, max(e.x, e.y * 0.55) * 0.92);
  return col;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = uv * post.size;
  if (post.pixel > 0.5) { return vec4f(pixelArt(uv), 1.0); }
  let v0 = uv - 0.5;
  let vig = 1.0 - dot(v0, v0) * 0.35;
  if (post.mode == 2.0) { return vec4f(dither1(uv, px), 1.0); }
  if (post.mode == 3.0) { return vec4f(riso(uv, px) * vig, 1.0); }
  if (post.mode == 4.0) { return vec4f(inkLine(uv, px) * vig, 1.0); }
  if (post.mode == 5.0) { return vec4f(blueprint(uv, px) * vig, 1.0); }
  let c0 = textureSampleLevel(src, samp, uv, 0.0);
  let r0 = coc(c0.a);
  // Gather: a tap counts when its own blur disc reaches this pixel, so sharp
  // foreground edges stay crisp and bright points open into bokeh discs.
  var acc = vec3f(0.0);
  var wsum = 0.0;
  var cov = 0.0;
  let spin = hash(px) * 6.2831853;
  let reach = max(r0, 1.0);
  for (var k = 0; k < TAPS; k++) {
    let f = f32(k) + 0.5;
    let a = f * 2.39996323 + spin;
    let d = sqrt(f / f32(TAPS)) * reach;
    let s = textureSampleLevel(src, samp, uv + vec2f(cos(a), sin(a)) * d / post.size, 0.0);
    let present = step(0.001, s.a);
    cov += present;
    let rs = coc(s.a);
    let w = present * clamp(rs - d + 1.0, 0.0, 1.0) / max(rs * rs, 1.0);
    let bright = max(dot(s.rgb, vec3f(0.3, 0.59, 0.11)) - 0.85, 0.0);
    let wb = w * (1.0 + bright * 6.0);
    acc += s.rgb * wb;
    wsum += wb;
  }
  var geo = select(c0.rgb, acc / max(wsum, 1e-5), wsum > 1e-5);
  let coverage = select(cov / f32(TAPS), 1.0, c0.a > 0.001 && r0 < 1.0);
  geo = grade(geo);
  var col = mix(background(uv), geo, coverage);
  // Warm macro grade: lifted blacks, a touch of vignette and grain.
  col = col * 0.96 + vec3f(0.03, 0.025, 0.02);
  col *= 1.0 - dot(uv - 0.5, uv - 0.5) * 0.5;
  col += (hash(px + post.time) - 0.5) * 0.012;
  return vec4f(col, 1.0);
}
`
