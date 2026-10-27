import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const OUT = 'C:/CRYPTO MONEY MAKER/tmp/wdkfin/media'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCALAPPDATA + '/ms-playwright/chromium-1247/chrome-win64/chrome.exe' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:7799/')
await page.waitForFunction('window.__done === true', null, { timeout: 120000 }).catch(() => console.log('TIMEOUT waiting for done'))
await page.waitForTimeout(2500)
const video = page.video()
await ctx.close()
await browser.close()
console.log('VIDEO', await video.path())
