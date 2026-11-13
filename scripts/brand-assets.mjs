// Regenerates the share images and app icons from public/favicon.svg and scripts/og.html using headless Chrome.
// Usage: node scripts/brand-assets.mjs   (set CHROME to the browser path if it is not in the default location)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'reelio-brand-'))
const shot = (url, out, w, h, transparent = false) => execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmp, 'p')}`, '--allow-file-access-from-files',
  ...(transparent ? ['--default-background-color=00000000'] : []),
  `--window-size=${w},${h}`, `--screenshot=${out}`, '--virtual-time-budget=4000', url,
], { stdio: 'ignore' })

for (const v of ['home', 'gta']) shot(`${pathToFileURL(join(root, 'scripts/og.html')).href}?v=${v}`, join(root, `public/og-${v}.png`), 1200, 630)

const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')
const maskable = svg.replace('rx="112"', 'rx="0"') // full-bleed background for maskable / apple-touch icons
const page = (s, size) => {
  const f = join(tmp, `i${size}-${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(f, `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${s}`)
  return pathToFileURL(f).href
}
const icons = [['icon-192.png', svg, 192], ['icon-512.png', svg, 512], ['icon-maskable-512.png', maskable, 512], ['apple-touch-icon.png', maskable, 180], ['favicon-32.png', svg, 32], ['favicon-16.png', svg, 16], ['favicon-48.png', svg, 48]]
for (const [name, s, size] of icons) shot(page(s, size), join(root, 'public', name), size, size, true)

// favicon.ico: PNG-compressed 16/32/48 entries
const sizes = [16, 32, 48]
const png = sizes.map(n => readFileSync(join(root, `public/favicon-${n}.png`)))
const head = Buffer.alloc(6 + 16 * png.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(png.length, 4)
let off = head.length
png.forEach((b, i) => { const o = 6 + i * 16; head[o] = sizes[i]; head[o + 1] = sizes[i]; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12); off += b.length })
writeFileSync(join(root, 'public/favicon.ico'), Buffer.concat([head, ...png]))
for (const n of sizes) rmSync(join(root, `public/favicon-${n}.png`))
rmSync(tmp, { recursive: true, force: true })
