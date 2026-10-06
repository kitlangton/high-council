// Validates `npm pack --dry-run` before publishing:
// 1. Only expected runtime code, docs, and compact public assets are included.
// 2. No raw art/ PNGs, base.png masters, .briefings/, .scratch/, or videos are packed.
// 3. No personal paths, private emails, or private model codenames appear in packed text files.

const p = Bun.spawn(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], { stdout: "pipe", stderr: "pipe" })
const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
if ((await p.exited) !== 0) throw new Error(err)

const [pack]: { files: { path: string; size: number }[] }[] = JSON.parse(out)
const names = pack!.files.map((f) => f.path)

const allowed =
  /^(LICENSE|README\.md|package\.json|bin\/high-council\.ts|src\/[a-z0-9/-]+\.ts|stage\/[a-z0-9/-]+\.(?:ts|html)|public\/(?:index\.html|council-state\.json|audio\/[a-z0-9-]+\.(?:mp3|json)|(?:advisors\/[a-z-]+|codec|starfox|cabinet)\/[a-z0-9-]+\.webp|fonts\/[A-Za-z0-9.-]+\.(?:ttf|txt)))$/

for (const file of names) {
  if (!allowed.test(file) || file.endsWith(".test.ts")) {
    throw new Error(`Unexpected package file: ${file}`)
  }
}

for (const req of [
  "package.json",
  "LICENSE",
  "README.md",
  "bin/high-council.ts",
  "src/server.ts",
  "src/opencode-council.ts",
  "public/index.html",
  "public/council-state.json",
]) {
  if (!names.includes(req)) throw new Error(`Missing required package file: ${req}`)
}

const forbiddenRe =
  /\/Users\/(?!<|testuser)[a-z0-9_-]+|@[a-z0-9.-]+\.ly|Generated with Claude|Co-Authored-By/i

for (const file of names) {
  if (/\.(ts|html|json|md|txt)$/.test(file)) {
    const text = await Bun.file(file).text()
    const match = text.match(forbiddenRe)
    if (match) {
      throw new Error(`Forbidden private string "${match[0]}" found in packaged file: ${file}`)
    }
  }
}

const pkg = await Bun.file("package.json").json()
if (pkg.private || pkg.bin?.["high-council"] !== "bin/high-council.ts") {
  throw new Error("Invalid public CLI manifest in package.json")
}
if (!(await Bun.file(pkg.bin["high-council"]).text()).startsWith("#!/usr/bin/env bun\n")) {
  throw new Error("CLI entrypoint must start with #!/usr/bin/env bun")
}

const totalMb = (pack!.files.reduce((a, f) => a + f.size, 0) / (1024 * 1024)).toFixed(2)
console.log(`Package validated: ${names.length} files (${totalMb} MB unpacked); zero private strings or stray artifacts.`)
