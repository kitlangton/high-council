import { clamp, Spring } from "../core/motion"
import type { Scenario } from "../city/scenario"
import { renderOverworldHud, type HudHitBox } from "./hud"
import { buildLandmarks, findPathWaypoints, WORLD_H, WORLD_W } from "./landmarks"
import type { OverworldRenderer } from "./renderer"
import { renderOverworldFrame, renderStaticTerrain } from "./sprites"

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

export function overworldSkin(r: OverworldRenderer, scenario: Scenario) {
  const landmarks = buildLandmarks(scenario)
  const staticTerrain = renderStaticTerrain()

  const worldCanvas = new OffscreenCanvas(WORLD_W, WORLD_H)
  const worldCtx = worldCanvas.getContext("2d")!

  let hudCanvas = new OffscreenCanvas(1, 1)
  let hudCtx = hudCanvas.getContext("2d")!

  // Camera springs in world coordinates (512x320)
  const camX = new Spring(WORLD_W / 2, 8, 1)
  const camY = new Spring(WORLD_H / 2 + 2, 8, 1)
  const logZoom = new Spring(Math.log(2.5), 8, 1)
  const cardOpen = new Spring(0, 12, 1)
  const crtMix = new Spring(0, 12, 1)

  let focus = -1
  let hover = -1
  let crtOn = false
  let W = 1440
  let H = 900
  let sized = false
  let lastSize = ""

  // Hero Traveler state (starts at Landmark 0: Grand Keep)
  let heroNode = 0
  let heroX = landmarks[0]!.x + landmarks[0]!.heroOffset[0]
  let heroY = landmarks[0]!.y + landmarks[0]!.heroOffset[1]
  let heroFacingLeft = false
  let route: [number, number][] = []
  let routeIdx = 0

  let hits: HudHitBox[] = []

  function baseScale() {
    return Math.min(W / 476, (H - 104) / 256)
  }

  function overview(snap = false) {
    focus = -1
    cardOpen.set(0)
    const s = baseScale()
    const tx = WORLD_W / 2
    const ty = WORLD_H / 2 + 2
    if (snap || reduced) {
      camX.snap(tx)
      camY.snap(ty)
      logZoom.snap(Math.log(s))
      cardOpen.snap(0)
    } else {
      camX.set(tx)
      camY.set(ty)
      logZoom.set(Math.log(s))
    }
  }

  function select(idx: number, snap = false) {
    if (idx < 0 || idx >= landmarks.length) return
    focus = idx
    cardOpen.set(1)

    // Send the Hero Traveler walking along the overworld path to the chosen landmark!
    if (idx !== heroNode || route.length > 0) {
      const pts = findPathWaypoints(heroNode, idx)
      route = [[heroX, heroY], ...pts]
      routeIdx = 0
      heroNode = idx
    }

    const lm = landmarks[idx]!
    const fScale = baseScale() * 1.9
    // Offset camera right so the focused landmark centers in the open map area left of the Quest Scroll
    const panelOffsetWorld = 205 / fScale
    const tx = lm.x + panelOffsetWorld
    const ty = lm.y + 2

    if (snap || reduced) {
      camX.snap(tx)
      camY.snap(ty)
      logZoom.snap(Math.log(fScale))
      cardOpen.snap(1)
    } else {
      camX.set(tx)
      camY.set(ty)
      logZoom.set(Math.log(fScale))
    }
  }

  function back() {
    overview(false)
  }

  function toggleCrt() {
    crtOn = !crtOn
    reduced ? crtMix.snap(crtOn ? 1 : 0) : crtMix.set(crtOn ? 1 : 0)
  }

  function worldToScreen(wx: number, wy: number): [number, number] {
    const s = Math.exp(logZoom.x)
    return [(wx - camX.x) * s + W / 2, (wy - camY.x) * s + H / 2]
  }

  function screenToWorld(sx: number, sy: number): [number, number] {
    const s = Math.exp(logZoom.x)
    return [(sx - W / 2) / s + camX.x, (sy - H / 2) / s + camY.x]
  }

  function stepHero(dt: number) {
    if (routeIdx >= route.length) return
    let rem = dt * 260 // brisk SNES overworld run speed
    while (rem > 0 && routeIdx < route.length) {
      const [tx, ty] = route[routeIdx]!
      const dx = tx - heroX
      const dy = ty - heroY
      const dist = Math.hypot(dx, dy)
      if (Math.abs(dx) > 0.2) heroFacingLeft = dx < 0
      if (dist <= rem) {
        heroX = tx
        heroY = ty
        rem -= dist
        routeIdx++
      } else {
        heroX += (dx / dist) * rem
        heroY += (dy / dist) * rem
        rem = 0
      }
    }
    if (routeIdx >= route.length) {
      route = []
      routeIdx = 0
    }
  }

  function pickLandmark(sx: number, sy: number): number {
    const [wx, wy] = screenToWorld(sx, sy)
    let best = -1
    let bestDist = 30
    for (const lm of landmarks) {
      const d = Math.hypot(wx - lm.x, wy - lm.y)
      if (d < bestDist) {
        bestDist = d
        best = lm.index
      }
    }
    return best
  }

  const input = {
    tap(sx: number, sy: number) {
      for (let i = hits.length - 1; i >= 0; i--) {
        const b = hits[i]!
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
          b.run()
          return
        }
      }
      const lmIdx = pickLandmark(sx, sy)
      if (lmIdx >= 0) {
        select(lmIdx)
      } else if (focus >= 0) {
        back()
      }
    },
    hover(sx: number, sy: number) {
      for (let i = hits.length - 1; i >= 0; i--) {
        const b = hits[i]!
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
          hover = -1
          return
        }
      }
      hover = pickLandmark(sx, sy)
    },
    pan(dx: number, dy: number) {
      const s = Math.exp(logZoom.x)
      camX.snap(clamp(camX.x - dx / s, 60, WORLD_W - 60))
      camY.snap(clamp(camY.x - dy / s, 45, WORLD_H - 45))
    },
    zoom(factor: number, sx: number, sy: number) {
      const [wx, wy] = screenToWorld(sx, sy)
      const minS = baseScale() * 0.85
      const maxS = baseScale() * 3.5
      const nextS = clamp(Math.exp(logZoom.x) * factor, minS, maxS)
      logZoom.snap(Math.log(nextS))
      camX.snap(clamp(wx - (sx - W / 2) / nextS, 60, WORLD_W - 60))
      camY.snap(clamp(wy - (sy - H / 2) / nextS, 45, WORLD_H - 45))
    },
    key(e: KeyboardEvent) {
      if (e.key === "Escape") back()
      else if (e.key === "p" || e.key === "P") toggleCrt()
      else if (e.key >= "1" && e.key <= "7") select(Number(e.key) - 1)
      else if (e.key === "ArrowRight" || e.key === "l") select(focus < 0 ? 0 : (focus + 1) % landmarks.length)
      else if (e.key === "ArrowLeft" || e.key === "h")
        select(focus < 0 ? landmarks.length - 1 : (focus - 1 + landmarks.length) % landmarks.length)
      else if (e.key === "=" || e.key === "+")
        logZoom.set(clamp(logZoom.target + 0.25, Math.log(baseScale() * 0.85), Math.log(baseScale() * 3.5)))
      else if (e.key === "-")
        logZoom.set(clamp(logZoom.target - 0.25, Math.log(baseScale() * 0.85), Math.log(baseScale() * 3.5)))
    },
  }

  function frame(dt: number, time: number) {
    ;[W, H] = r.size
    const dpr = r.dpr
    const sizeKey = `${W}x${H}x${dpr}`
    if (!sized) {
      sized = true
      overview(true)
    } else if (sizeKey !== lastSize) {
      focus >= 0 ? select(focus, true) : overview(true)
    }
    lastSize = sizeKey

    camX.step(dt)
    camY.step(dt)
    logZoom.step(dt)
    cardOpen.step(dt)
    crtMix.step(dt)
    stepHero(dt)

    // Render 512x320 16-bit pixel art world frame
    renderOverworldFrame(
      worldCtx,
      staticTerrain,
      landmarks,
      {
        x: heroX,
        y: heroY,
        walking: routeIdx < route.length,
        facingLeft: heroFacingLeft,
      },
      focus,
      time,
    )

    // Render crisp SNES HUD at device pixel resolution
    const pw = Math.max(1, Math.round(W * dpr))
    const ph = Math.max(1, Math.round(H * dpr))
    if (hudCanvas.width !== pw || hudCanvas.height !== ph) {
      hudCanvas = new OffscreenCanvas(pw, ph)
      hudCtx = hudCanvas.getContext("2d")!
    }
    hudCtx.save()
    hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    hits = renderOverworldHud(
      hudCtx,
      W,
      H,
      landmarks,
      focus,
      hover,
      heroNode,
      routeIdx < route.length,
      crtOn,
      cardOpen.x,
      time,
      worldToScreen,
      { select, back, toggleCrt },
    )
    hudCtx.restore()

    const scale = Math.exp(logZoom.x)
    r.render(worldCanvas, hudCanvas, [camX.x, camY.x], scale, time, crtMix.x)
  }

  return { frame, input, select, back, toggleCrt }
}
