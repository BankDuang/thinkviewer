const { chromium } = require('playwright')
const PW = process.env.TV_PW || '3442913935zZ*'
const OUT = '/Users/bank-mini/Desktop/thinkviewer2/screenshots'

;(async () => {
  const b = await chromium.launch({ headless: true })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))

  await page.goto('http://127.0.0.1:19080', { waitUntil: 'networkidle' })
  await page.waitForSelector('.login-input')
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/readme-login.png` })

  await page.fill('.login-input', PW)
  await page.click('.login-go')
  await page.waitForSelector('.desktop')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/readme-desktop.png` })

  const apps = ['remote', 'terminal', 'files', 'settings', 'servers']
  for (let i = 0; i < apps.length; i++) {
    const items = await page.$$('.dock-item')
    await items[i].click()
    await page.waitForTimeout(1700)
    await page.screenshot({ path: `${OUT}/readme-${apps[i]}.png` })
  }
  console.log('CONSOLE_ERRORS:', errs.length)
  errs.slice(0, 10).forEach((e) => console.log('  ', e))
  await b.close()
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
