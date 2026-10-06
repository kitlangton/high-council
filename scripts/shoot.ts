// bun scripts/shoot.ts <out-prefix> [actions...]  — screenshots the stage in headless Chrome with a real GPU.
import { chromium } from "playwright"
const [out = "shot", ...steps] = process.argv.slice(2)
const browser = await chromium.launch({ args: ["--enable-gpu", "--enable-unsafe-webgpu", "--use-angle=metal", "--autoplay-policy=no-user-gesture-required"] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const seen = new Set<string>()
page.on("console", (m) => { const t = m.text().split("\n")[0]!; if (!seen.has(t)) { seen.add(t); console.log("console:", m.text().slice(0, 600)) } })
page.on("pageerror", (e) => console.log("pageerror:", e.message))
await page.goto(`http://localhost:${process.env.PORT ?? 4321}/codec?${process.env.QUERY ?? "fps"}`)
await page.waitForTimeout(1500)
let n = 0
for (const s of steps) {
  if (s.startsWith("wait:")) await page.waitForTimeout(Number(s.slice(5)))
  else if (s.startsWith("key:")) await page.keyboard.press(s.slice(4))
  else if (s === "shot") await page.screenshot({ path: `${out}-${n++}.png` })
}
await page.screenshot({ path: `${out}-${n}.png` })
await browser.close()
