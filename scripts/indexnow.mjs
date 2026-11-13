// Tells IndexNow search engines (Bing, Yandex, Naver, Seznam, ...; not Google) that the sitemap URLs are new or changed.
// Usage: node scripts/indexnow.mjs [url ...]   (no arguments = every <loc> in public/sitemap.xml)
// Run it after a deploy that changed page content. The key file public/<key>.txt must already be live at the site root.
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const HOST = 'reelio.page'
const keyFile = readdirSync(join(root, 'public')).find(f => /^[0-9a-f]{32}\.txt$/.test(f))
if (!keyFile) throw new Error('no IndexNow key file (32 hex characters + .txt) in public/')
const key = keyFile.replace('.txt', '')
const urls = process.argv.length > 2 ? process.argv.slice(2)
  : [...readFileSync(join(root, 'public/sitemap.xml'), 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1])

const live = await fetch(`https://${HOST}/${keyFile}`).then(r => r.text()).catch(() => '')
if (live.trim() !== key) throw new Error(`https://${HOST}/${keyFile} does not serve the key yet: deploy first`)

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList: urls }),
})
console.log(res.status, res.statusText, '-', urls.length, 'URLs') // 200 = accepted, 202 = accepted, key check pending
