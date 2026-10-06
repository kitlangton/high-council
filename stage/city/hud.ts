import { Kind, type QuadLayer } from "../core/gpu"
import type { City, Placed } from "./generate"

// 90s city-builder chrome drawn with hard-edged quads and a pixel font, rasterized 1:1 and
// snapped to device pixels so every edge stays crisp.

export const PIXEL_FONT = "PixelifySans"
const FONT = (w: number) => `${w} {px} ${PIXEL_FONT}, monospace`

type C = [number, number, number, number]
const FACE: C = [0.75, 0.75, 0.72, 1]
const LIGHT: C = [1, 1, 1, 1]
const SHADE: C = [0.47, 0.47, 0.45, 1]
const DARK: C = [0.12, 0.12, 0.14, 1]
const TITLE: C = [0.08, 0.16, 0.45, 1]
const INK: C = [0.06, 0.06, 0.08, 1]
const WHITE: C = [1, 1, 1, 1]
const AMBER: C = [0.98, 0.6, 0.1, 1]
const WARN: C = [0.72, 0.16, 0.08, 1]

export interface HudButton { x: number; y: number; w: number; h: number; run: () => void }

export function createHud(q: QuadLayer, dprOf: () => number) {
  const snap = (v: number) => Math.round(v * dprOf()) / dprOf()
  const rect = (x: number, y: number, w: number, h: number, color: C, alpha = 1) =>
    q.push({ x: snap(x), y: snap(y), w: snap(w), h: snap(h), color, alpha })
  const text = (str: string, x: number, y: number, px: number, color: C, weight = 500, align: "left" | "center" | "right" = "left", alpha = 1) => {
    const e = q.text(str, px, FONT(weight), 0, dprOf())
    const ox = align === "center" ? -e.w / 2 : align === "right" ? -e.w : 0
    q.push({ kind: Kind.text, x: snap(x + ox), y: snap(y - e.h / 2), w: e.w, h: e.h, uv: e.uv, color, alpha })
    return e.w
  }
  const width = (str: string, px: number, weight = 500) => q.text(str, px, FONT(weight), 0, dprOf()).w

  // Raised or sunken Win95-style bevel.
  function bevel(x: number, y: number, w: number, h: number, sunken = false, face: C = FACE) {
    rect(x, y, w, h, face)
    rect(x, y, w, 2, sunken ? SHADE : LIGHT); rect(x, y, 2, h, sunken ? SHADE : LIGHT)
    rect(x, y + h - 2, w, 2, sunken ? LIGHT : SHADE); rect(x + w - 2, y, 2, h, sunken ? LIGHT : SHADE)
    rect(x - 1, y - 1, w + 2, 1, DARK); rect(x - 1, y + h, w + 2, 1, DARK)
    rect(x - 1, y, 1, h, DARK); rect(x + w, y, 1, h, DARK)
  }
  function window(x: number, y: number, w: number, h: number, title: string) {
    bevel(x, y, w, h)
    rect(x + 4, y + 4, w - 8, 22, TITLE)
    text(title, x + 10, y + 15, 15, WHITE, 700)
    bevel(x + w - 24, y + 7, 16, 15)
    text("x", x + w - 16, y + 14, 13, INK, 700, "center")
  }

  // A map tag: white box, ink border, district swatch, name, amber count.
  function tag(label: string, color: number[], count: number, x: number, y: number, alpha: number, big: boolean) {
    const px = big ? 17 : 14
    const tw = width(label, px, 600)
    const cw = count ? width(String(count), px - 1, 700) + 10 : 0
    const w = 10 + 12 + 6 + tw + (count ? cw + 6 : 0) + 8, h = px + 12
    const x0 = x - w / 2, y0 = y - h - 8
    rect(x0 + 3, y0 + 3, w, h, [0, 0, 0, 0.35], alpha)
    rect(x0 - 1, y0 - 1, w + 2, h + 2, INK, alpha)
    rect(x0, y0, w, h, WHITE, alpha)
    rect(x0 + 8, y0 + h / 2 - 6, 12, 12, INK, alpha)
    rect(x0 + 9, y0 + h / 2 - 5, 10, 10, [color[0]!, color[1]!, color[2]!, 1], alpha)
    text(label, x0 + 26, y0 + h / 2, px, INK, 600, "left", alpha)
    if (count) {
      const bx = x0 + 26 + tw + 6
      rect(bx, y0 + 4, cw, h - 8, AMBER, alpha)
      text(String(count), bx + cw / 2, y0 + h / 2, px - 1, INK, 700, "center", alpha)
    }
    // Pin down to the district.
    rect(x - 1, y0 + h + 1, 2, 7, INK, alpha)
    rect(x - 3, y - 2, 6, 3, INK, alpha)
    return { x: x0, y: y0, w, h }
  }

  function frame(W: number, H: number, city: City, focus: number, buttons: HudButton[], actions: {
    select: (i: number) => void; back: () => void; rotate: (d: number) => void; zoom: (f: number) => void; style: () => void
  }) {
    // Title bar.
    bevel(0, 0, W, 32)
    rect(8, 8, 16, 16, DARK); rect(10, 14, 4, 8, [0.95, 0.85, 0.3, 1]); rect(15, 10, 4, 12, [0.6, 0.8, 0.95, 1]); rect(20, 16, 3, 6, [0.9, 0.5, 0.4, 1])
    text("SIMCOUNCIL", 32, 16, 17, INK, 700)
    const open = city.districts.reduce((a, d) => a + d.district.items.length, 0)
    const due = city.districts.reduce((a, d) => a + d.district.urgent, 0)
    const stats: [string, string][] = [["Oct 2026", ""], ["Projects", String(city.districts.length)], ["Open", String(open)], ["Due soon", String(due)]]
    let sx = 170
    for (const [k, v] of stats) {
      rect(sx - 10, 7, 2, 18, SHADE); rect(sx - 8, 7, 1, 18, LIGHT)
      sx += text(k, sx, 16, 15, INK, 500) + 8
      if (v) sx += text(v, sx, 16, 15, k === "Due soon" ? WARN : INK, 700) + 18
      else sx += 10
    }
    for (const [k, glyph] of [[2, "?"], [1, "_"], [0, "x"]] as const) {
      const bx = W - 30 - k * 24
      bevel(bx, 7, 20, 18)
      text(glyph, bx + 10, 15, 14, INK, 700, "center")
    }

    // Toolbar: one swatch button per district, then view controls.
    const tx = 0, ty = 33, tw = 44
    bevel(tx, ty, tw, H - ty - 26)
    city.districts.forEach((d, i) => {
      const by = ty + 8 + i * 38
      const on = focus === i
      bevel(tx + 6, by, 32, 32, on)
      rect(tx + 12 + (on ? 1 : 0), by + 6 + (on ? 1 : 0), 20, 20, INK)
      rect(tx + 13 + (on ? 1 : 0), by + 7 + (on ? 1 : 0), 18, 18, [d.color[0], d.color[1], d.color[2], 1])
      text(String(i + 1), tx + 22 + (on ? 1 : 0), by + 16 + (on ? 1 : 0), 13, WHITE, 700, "center")
      buttons.push({ x: tx + 6, y: by, w: 32, h: 32, run: () => (focus === i ? actions.back() : actions.select(i)) })
    })
    const tools: [string, () => void][] = [["+", () => actions.zoom(1.4)], ["-", () => actions.zoom(1 / 1.4)], ["<", () => actions.rotate(-1)], [">", () => actions.rotate(1)], ["P", actions.style]]
    tools.forEach(([g, run], k) => {
      const by = H - 26 - 8 - (tools.length - k) * 34
      bevel(tx + 6, by, 32, 28)
      text(g, tx + 22, by + 14, 17, INK, 700, "center")
      buttons.push({ x: tx + 6, y: by, w: 32, h: 28, run })
    })

    // Minimap: top-down districts, the focused one outlined.
    const mw = 196, mh = 156, mx = W - mw - 12, my = 44
    window(mx, my, mw, mh, "Map")
    const ix = mx + 8, iy = my + 32, iw = mw - 16, ih = mh - 40
    rect(ix, iy, iw, ih, [0.12, 0.34, 0.55, 1])
    const scale = Math.min((iw - 12) / city.width, (ih - 12) / city.depth)
    const ox = ix + (iw - city.width * scale) / 2, oz = iy + (ih - city.depth * scale) / 2
    rect(ox, oz, city.width * scale, city.depth * scale, [0.32, 0.52, 0.26, 1])
    city.districts.forEach((d, i) => {
      const x = ox + d.x0 * scale, z = oz + d.z0 * scale, w = (d.x1 - d.x0) * scale, h = (d.z1 - d.z0) * scale
      if (focus === i) rect(x - 2, z - 2, w + 4, h + 4, WHITE)
      rect(x, z, w, h, [d.color[0] * 0.85, d.color[1] * 0.85, d.color[2] * 0.85, 1])
      buttons.push({ x, y: z, w, h, run: () => actions.select(i) })
    })

    // Status bar.
    bevel(0, H - 26, W, 26)
    const d = focus >= 0 ? city.districts[focus]! : null
    const msg = d ? `Zone: ${d.district.name}   ${d.district.items.length} open   ${d.district.urgent} due soon` : "Click a zone, or press 1-7.  Q/E rotate.  P switches style."
    bevel(6, H - 22, W - 12, 18, true)
    text(msg, 14, H - 13, 14, INK, 500)
  }

  function card(d: Placed, W: number, alpha: number) {
    if (alpha < 0.02) return
    const w = 360, x0 = W - w - 12, y0 = 212
    const rows = d.district.items.slice(0, 7)
    const h = 34 + 12 + rows.length * 28 + 12
    window(x0, y0, w, h, d.district.name)
    bevel(x0 + 8, y0 + 32, w - 16, h - 40, true, [0.98, 0.98, 0.96, 1])
    rows.forEach((it, k) => {
      const y = y0 + 32 + 18 + k * 28
      rect(x0 + 18, y - 4, 8, 8, it.urgent ? WARN : SHADE)
      const title = it.title.length > 36 ? it.title.slice(0, 35) + "…" : it.title
      text(title, x0 + 34, y, 15, INK, 500)
      if (it.when) text(it.when, x0 + w - 18, y, 14, it.urgent ? WARN : SHADE, 700, "right")
    })
  }

  return { frame, tag, card }
}
