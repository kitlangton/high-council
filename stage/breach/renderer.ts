import { effect, frame, sampler, surface, target, texture } from "vgpu"
import { createQuadLayer, initGpu } from "../core/gpu"
import { Spring } from "../core/motion"
import type { BreachBoard } from "./board"
import { renderTacticalHud, type HudHitRegion } from "./hud"
import {
  isoToTile,
  PixelSurface,
  renderPixelBoard,
  tileToIso,
  type PaletteMode,
} from "./sprites"

export const WORLD_W = 480
export const WORLD_H = 270
export const ORIGIN_X = 240
export const ORIGIN_Y = 52

const worldCompositeWgsl = /* wgsl */ `
struct WorldView {
  screenSize: vec2f,
  worldSize: vec2f,
  arenaCenter: vec2f,
  camArtPos: vec2f,
  camScale: f32,
  time: f32,
  nightMode: f32,
  _pad: f32,
}

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var nearestSamp: sampler;
@group(0) @binding(2) var<uniform> view: WorldView;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let screenPx = uv * view.screenSize;
  // Map screen CSS pixel to virtual art pixel in worldTex
  let artPx = (screenPx - view.arenaCenter) / view.camScale + view.camArtPos;
  let ipx = floor(artPx);
  let texUv = (ipx + vec2f(0.5)) / view.worldSize;

  // Seamless pixel-art chasm abyss background across the entire viewport
  let t = clamp(uv.y, 0.0, 1.0);
  var bg = mix(
    select(vec3f(0.043, 0.071, 0.106), vec3f(0.024, 0.039, 0.071), view.nightMode > 0.5),
    select(vec3f(0.090, 0.145, 0.215), vec3f(0.055, 0.090, 0.155), view.nightMode > 0.5),
    floor(t * 16.0) / 16.0
  );

  // Subtle pixel tactical grid in the abyss (locked to virtual art pixels)
  let gx = abs(ipx.x - floor(ipx.x / 24.0) * 24.0);
  let gy = abs(ipx.y - floor(ipx.y / 24.0) * 24.0);
  let onDot = (gx < 1.0 && floor(ipx.y) % 2.0 == 0.0) || (gy < 1.0 && floor(ipx.x) % 2.0 == 0.0);
  if (onDot) {
    bg += vec3f(0.016, 0.028, 0.045);
  }

  var col = bg;
  if (texUv.x >= 0.0 && texUv.x <= 1.0 && texUv.y >= 0.0 && texUv.y <= 1.0) {
    let samp = textureSampleLevel(worldTex, nearestSamp, texUv, 0.0);
    col = mix(bg, samp.rgb, samp.a);
  }

  // Subtle pixel grid bevel when zoomed in (Into the Breach crisp tactical LCD feel)
  let cellSub = fract(artPx);
  let subGrid = step(0.94, max(cellSub.x, cellSub.y)) * step(2.2, view.camScale) * 0.05;
  col *= 1.0 - subGrid;

  // Soft atmospheric vignette around screen perimeter
  let v = uv - vec2f(0.45, 0.48);
  col *= 1.0 - dot(v, v) * 0.35;

  return vec4f(col, 1.0);
}
`

export async function createBreachRenderer(canvas: HTMLCanvasElement, board: BreachBoard) {
  const gpu = await initGpu()
  gpu.onError((e) => console.error("VGPU_ERR:", e.code, e.message, e.fix ?? ""))
  const bg: [number, number, number, number] = [0.04, 0.07, 0.11, 1]
  const screen = surface(gpu, canvas, { dpr: [1, 2], clearColor: bg })
  const quads = createQuadLayer(gpu, [])
  await quads.ready

  const pixelSurf = new PixelSurface(WORLD_W, WORLD_H)
  const worldTex = texture(gpu, {
    kind: "2d",
    size: [WORLD_W, WORLD_H],
    format: "rgba8unorm",
    usage: ["texture_binding", "copy_dst"],
  })
  const nearestSamp = sampler(gpu, { magFilter: "nearest", minFilter: "nearest" })
  const sceneTarget = target(gpu, {
    size: [screen.size[0], screen.size[1]],
    format: screen.format,
    clearColor: bg,
  })
  const worldFx = effect(gpu, worldCompositeWgsl)
  worldFx.set({
    worldTex,
    nearestSamp,
    view: {
      screenSize: [1280, 720],
      worldSize: [WORLD_W, WORLD_H],
      arenaCenter: [550, 340],
      camArtPos: [ORIGIN_X, ORIGIN_Y + 95],
      camScale: 2,
      time: 0,
      nightMode: 0,
      _pad: 0,
    },
  })

  // Interactive Tactical State
  let selectedSector: number | null = null
  let selectedTile: { gx: number; gy: number } | null = null
  let hoveredTile: { gx: number; gy: number } | null = null
  let paletteMode: PaletteMode = "day"
  let turn = 3
  const maxTurns = 4
  let hitRegions: HudHitRegion[] = []

  // Sprung camera in virtual art pixels
  const defaultArtX = ORIGIN_X
  const defaultArtY = ORIGIN_Y + 94
  const camX = new Spring(defaultArtX, 14, 1)
  const camY = new Spring(defaultArtY, 14, 1)
  const camScale = new Spring(2.0, 14, 1)

  const getArenaCenter = (W: number, H: number): [number, number] => {
    const leftEdge = 204
    const rightEdge = W - 372
    const topEdge = 80
    const bottomEdge = H - 80
    return [Math.round((leftEdge + rightEdge) * 0.5), Math.round((topEdge + bottomEdge) * 0.5)]
  }

  const selectSector = (idx: number | null) => {
    selectedSector = idx
    if (idx === null) {
      selectedTile = null
      camX.set(defaultArtX)
      camY.set(defaultArtY)
      camScale.set(2.0)
    } else {
      const sec = board.sectors[idx]
      if (!sec) return
      const firstTile = sec.tiles[0]
      if (firstTile) selectedTile = { gx: firstTile.gx, gy: firstTile.gy }
      const [tx, ty] = tileToIso(sec.centerGx, sec.centerGy, 0, ORIGIN_X, ORIGIN_Y)
      camX.set(tx)
      camY.set(ty - 6)
      camScale.set(3.0)
    }
  }

  const selectTile = (gx: number, gy: number) => {
    selectedTile = { gx, gy }
    const tile = board.grid[gx]?.[gy]
    if (tile && tile.districtIndex !== null) {
      selectedSector = tile.districtIndex
      const [tx, ty] = tileToIso(gx, gy, tile.elevation, ORIGIN_X, ORIGIN_Y)
      camX.set(tx)
      camY.set(ty - 8)
      camScale.set(3.0)
    }
  }

  const screenToArt = (sx: number, sy: number, W: number, H: number): [number, number] => {
    const [acx, acy] = getArenaCenter(W, H)
    const scale = camScale.x
    return [(sx - acx) / scale + camX.x, (sy - acy) / scale + camY.x]
  }

  function stepFrame(dt: number, time: number) {
    const dpr = screen.dpr
    const W = screen.size[0] / dpr
    const H = screen.size[1] / dpr

    camX.step(dt)
    camY.step(dt)
    camScale.step(dt)

    // 1. Render pure 2D pixel art board into pixelSurf & upload to worldTex
    renderPixelBoard(pixelSurf, {
      board,
      selectedSector,
      hoveredTile,
      selectedTile,
      time,
      paletteMode,
      originX: ORIGIN_X,
      originY: ORIGIN_Y,
    })

    gpu.gpu.queue.writeTexture(
      { texture: worldTex.gpu },
      pixelSurf.u8 as unknown as BufferSource,
      { bytesPerRow: WORLD_W * 4, rowsPerImage: WORLD_H },
      [WORLD_W, WORLD_H],
    )

    // 2. Build Tactical HUD Quads
    quads.reset()
    hitRegions = renderTacticalHud(quads, W, H, dpr, {
      board,
      selectedSector,
      selectedTile,
      hoveredTile,
      turn,
      maxTurns,
      paletteMode,
      time,
      onSelectSector: selectSector,
      onSelectTile: selectTile,
      onEndTurn: () => {
        turn = turn >= maxTurns ? 1 : turn + 1
      },
      onTogglePalette: () => {
        paletteMode = paletteMode === "day" ? "night" : "day"
      },
    })
    quads.prepare(W, H, dpr, time)

    if (sceneTarget.size[0] !== screen.size[0] || sceneTarget.size[1] !== screen.size[1]) {
      sceneTarget.resize([screen.size[0], screen.size[1]])
    }

    const [acx, acy] = getArenaCenter(W, H)
    // Snap scale when resting so static/resting frames are 100% integer pixel scale
    const activeScale = camScale.resting ? Math.round(camScale.x) : camScale.x
    const activeCamX = camX.resting ? Math.round(camX.x) : camX.x
    const activeCamY = camY.resting ? Math.round(camY.x) : camY.x

    worldFx.set({
      view: {
        screenSize: [W, H],
        worldSize: [WORLD_W, WORLD_H],
        arenaCenter: [acx, acy],
        camArtPos: [activeCamX, activeCamY],
        camScale: activeScale,
        time,
        nightMode: paletteMode === "night" ? 1 : 0,
        _pad: 0,
      },
    })

    frame(gpu, (f) => {
      f.pass(screen, (p) => {
        p.draw(worldFx)
        quads.draw(p)
      })
    })
  }

  return {
    gpu,
    frame: stepFrame,
    selectSector,
    selectTile,
    input: {
      pan(dx: number, dy: number) {
        const s = camScale.x
        camX.snap(Math.max(80, Math.min(WORLD_W - 80, camX.x - dx / s)))
        camY.snap(Math.max(40, Math.min(WORLD_H - 40, camY.x - dy / s)))
      },
      zoom(factor: number, _x: number, _y: number) {
        const next = Math.max(1.5, Math.min(4.0, camScale.target * factor))
        camScale.set(next)
      },
      hover(x: number, y: number) {
        const dpr = screen.dpr
        const W = screen.size[0] / dpr
        const H = screen.size[1] / dpr
        // Ignore hover if over a HUD panel
        for (const h of hitRegions) {
          if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
            hoveredTile = null
            return
          }
        }
        const [artX, artY] = screenToArt(x, y, W, H)
        hoveredTile = isoToTile(artX, artY, ORIGIN_X, ORIGIN_Y, board)
      },
      tap(x: number, y: number) {
        for (const h of hitRegions) {
          if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
            h.onClick()
            return
          }
        }
        const dpr = screen.dpr
        const W = screen.size[0] / dpr
        const H = screen.size[1] / dpr
        const [artX, artY] = screenToArt(x, y, W, H)
        const hit = isoToTile(artX, artY, ORIGIN_X, ORIGIN_Y, board)
        if (hit) {
          const tile = board.grid[hit.gx]![hit.gy]!
          selectedTile = hit
          if (tile.districtIndex !== null) {
            selectSector(tile.districtIndex)
          }
        } else {
          selectSector(null)
        }
      },
      key(e: KeyboardEvent) {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key >= "1" && e.key <= "7") {
          const idx = Number(e.key) - 1
          if (idx < board.sectors.length) {
            selectSector(selectedSector === idx ? null : idx)
          }
        } else if (e.key === "Escape" || e.key === "0") {
          selectSector(null)
        } else if (e.key === "p" || e.key === "P" || e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") {
          paletteMode = paletteMode === "day" ? "night" : "day"
        } else if (e.key === " " || e.key === "Enter") {
          turn = turn >= maxTurns ? 1 : turn + 1
        }
      },
    },
  }
}
