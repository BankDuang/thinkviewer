// Headless smoke test: login, open each app, screenshot, collect console errors.
const { chromium } = require('playwright')

const PW = process.env.TV_PW || '3442913935'
const BASE = 'http://127.0.0.1:19080'
const OUT = '/Users/bank-mini/Desktop/thinkviewer2/screenshots'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

  await page.goto(BASE, { waitUntil: 'networkidle' })

  // Login
  await page.waitForSelector('.login-input', { timeout: 8000 })
  await page.fill('.login-input', PW)
  await page.click('.login-go')
  await page.waitForSelector('.desktop', { timeout: 8000 })
  await page.waitForTimeout(1500) // wallpaper + ws connect
  await page.screenshot({ path: `${OUT}/v_desktop.png` })

  const dock = await page.$$('.dock-item')
  console.log('dock items:', dock.length)

  // APP_ORDER = remote, terminal, files, settings
  const apps = ['remote', 'terminal', 'files', 'settings']
  for (let i = 0; i < apps.length; i++) {
    const items = await page.$$('.dock-item')
    await items[i].click()
    await page.waitForTimeout(1600)
    await page.screenshot({ path: `${OUT}/v_${apps[i]}.png` })
    console.log('opened', apps[i])
  }

  // Final: all windows cascaded
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/v_all.png` })

  console.log('CONSOLE_ERRORS:', errors.length)
  errors.slice(0, 30).forEach((e) => console.log('  ERR:', e))

  await browser.close()
})().catch((e) => {
  console.error('VERIFY_FAILED:', e)
  process.exit(1)
})
