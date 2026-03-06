const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    // Step 1: Navigate to the application
    console.log('Step 1: Navigating to http://localhost:19080/');
    await page.goto('http://localhost:19080/', { waitUntil: 'networkidle' });
    console.log('  Page title:', await page.title());

    // Step 2: Screenshot the login page
    console.log('Step 2: Taking screenshot of login page');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_login_page.png'), fullPage: true });
    console.log('  Screenshot saved: 01_login_page.png');

    // Describe login page
    const loginLogoText = await page.textContent('.login-logo');
    console.log('  Login page text:', loginLogoText.trim().replace(/\s+/g, ' '));
    const hasPasswordInput = await page.isVisible('#password-input');
    console.log('  Password input visible:', hasPasswordInput);
    const loginBtnText = await page.textContent('#login-btn');
    console.log('  Login button text:', loginBtnText.trim());

    // Step 3: Type the password
    console.log('Step 3: Typing password into input field');
    await page.fill('#password-input', '46jdDp');
    console.log('  Password entered');

    // Step 4: Click Connect button
    console.log('Step 4: Clicking Connect button');
    await page.click('#login-btn');
    console.log('  Connect button clicked');

    // Wait for login to complete
    await page.waitForTimeout(2000);

    // Step 5: Screenshot the main desktop view
    console.log('Step 5: Taking screenshot of main desktop view');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02_desktop_view.png'), fullPage: true });
    console.log('  Screenshot saved: 02_desktop_view.png');

    // Describe main view
    const loginViewHidden = await page.evaluate(() => {
      const el = document.getElementById('login-view');
      return el ? (el.classList.contains('hidden') || !el.classList.contains('active')) : true;
    });
    console.log('  Login view hidden:', loginViewHidden);

    const desktopVisible = await page.evaluate(() => {
      const el = document.getElementById('desktop-view');
      return el ? (el.classList.contains('active') || getComputedStyle(el).display !== 'none') : false;
    });
    console.log('  Desktop view visible:', desktopVisible);

    // Check sidebar navigation items
    const sidebarItems = await page.evaluate(() => {
      const items = document.querySelectorAll('.sidebar .nav-item, .sidebar a, .sidebar button, .sidebar [class*="nav"]');
      return Array.from(items).map(el => ({
        text: el.textContent.trim().replace(/\s+/g, ' '),
        className: el.className
      }));
    });
    console.log('  Sidebar items:', JSON.stringify(sidebarItems, null, 2));

    // Step 6: Click on Terminal in sidebar
    console.log('Step 6: Clicking Terminal in sidebar');
    // Try multiple selectors for terminal nav item
    let terminalClicked = false;
    for (const selector of [
      'text=Terminal',
      '[data-view="terminal"]',
      '.nav-item:has-text("Terminal")',
      'button:has-text("Terminal")',
      'a:has-text("Terminal")',
      '[onclick*="terminal"]'
    ]) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          terminalClicked = true;
          console.log('  Clicked terminal using selector:', selector);
          break;
        }
      } catch (e) { /* try next */ }
    }
    if (!terminalClicked) {
      console.log('  Could not find Terminal nav item, trying broader search...');
      const allClickables = await page.evaluate(() => {
        const els = document.querySelectorAll('button, a, [role="button"], [class*="nav"], [class*="sidebar"] *');
        return Array.from(els).filter(el => el.textContent.includes('Terminal')).map(el => ({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 50),
          id: el.id,
          className: el.className
        }));
      });
      console.log('  Elements containing "Terminal":', JSON.stringify(allClickables));
    }

    await page.waitForTimeout(1000);

    // Step 7: Screenshot terminal view
    console.log('Step 7: Taking screenshot of terminal view');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03_terminal_view.png'), fullPage: true });
    console.log('  Screenshot saved: 03_terminal_view.png');

    // Step 8: Type command in terminal
    console.log('Step 8: Typing command in terminal');
    // Find terminal input
    let terminalInput = null;
    for (const selector of [
      '#terminal-input',
      '.terminal-input input',
      '.terminal input[type="text"]',
      'input[placeholder*="command"]',
      'input[placeholder*="type"]',
      '.cmd-input',
      '.terminal-prompt input',
      '#cmd-input'
    ]) {
      const el = await page.$(selector);
      if (el) {
        terminalInput = el;
        console.log('  Found terminal input with selector:', selector);
        break;
      }
    }

    if (terminalInput) {
      await terminalInput.click();
      await terminalInput.fill('echo Hello ThinkViewer');
      await page.keyboard.press('Enter');
      console.log('  Command typed and Enter pressed');
    } else {
      console.log('  Could not find terminal input, looking for alternatives...');
      const inputs = await page.evaluate(() => {
        const allInputs = document.querySelectorAll('input, textarea');
        return Array.from(allInputs).map(el => ({
          tag: el.tagName,
          type: el.type,
          id: el.id,
          className: el.className,
          placeholder: el.placeholder,
          visible: getComputedStyle(el).display !== 'none'
        }));
      });
      console.log('  All inputs:', JSON.stringify(inputs, null, 2));
    }

    await page.waitForTimeout(2000);

    // Step 9: Screenshot terminal output
    console.log('Step 9: Taking screenshot of terminal output');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04_terminal_output.png'), fullPage: true });
    console.log('  Screenshot saved: 04_terminal_output.png');

    // Check terminal output
    const terminalOutput = await page.evaluate(() => {
      const outputEl = document.querySelector('.terminal-output, .terminal-body, #terminal-output, .output');
      return outputEl ? outputEl.textContent.trim().substring(0, 500) : 'No terminal output element found';
    });
    console.log('  Terminal output:', terminalOutput);

    // Step 10: Click on Files in sidebar
    console.log('Step 10: Clicking Files in sidebar');
    for (const selector of [
      'text=Files',
      '[data-view="files"]',
      '.nav-item:has-text("Files")',
      'button:has-text("Files")',
      'a:has-text("Files")'
    ]) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          console.log('  Clicked Files using selector:', selector);
          break;
        }
      } catch (e) { /* try next */ }
    }

    await page.waitForTimeout(1000);

    // Step 11: Screenshot file manager
    console.log('Step 11: Taking screenshot of file manager');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05_file_manager.png'), fullPage: true });
    console.log('  Screenshot saved: 05_file_manager.png');

    // Check files view content
    const filesContent = await page.evaluate(() => {
      const filesView = document.querySelector('#files-view, .files-view, [data-view="files"]');
      if (filesView) return filesView.textContent.trim().substring(0, 300).replace(/\s+/g, ' ');
      return 'No files view element found';
    });
    console.log('  Files view content:', filesContent);

    // Step 12: Click on Settings in sidebar
    console.log('Step 12: Clicking Settings in sidebar');
    for (const selector of [
      'text=Settings',
      '[data-view="settings"]',
      '.nav-item:has-text("Settings")',
      'button:has-text("Settings")',
      'a:has-text("Settings")'
    ]) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          console.log('  Clicked Settings using selector:', selector);
          break;
        }
      } catch (e) { /* try next */ }
    }

    await page.waitForTimeout(1000);

    // Step 13: Screenshot settings page
    console.log('Step 13: Taking screenshot of settings page');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06_settings_page.png'), fullPage: true });
    console.log('  Screenshot saved: 06_settings_page.png');

    // Check settings view content
    const settingsContent = await page.evaluate(() => {
      const settingsView = document.querySelector('#settings-view, .settings-view, [data-view="settings"]');
      if (settingsView) return settingsView.textContent.trim().substring(0, 500).replace(/\s+/g, ' ');
      return 'No settings view element found';
    });
    console.log('  Settings view content:', settingsContent);

    console.log('\n=== TEST COMPLETE ===');
    console.log('All screenshots saved to:', SCREENSHOTS_DIR);

  } catch (error) {
    console.error('Error during test:', error.message);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error_screenshot.png'), fullPage: true });
    console.log('Error screenshot saved');
  } finally {
    await browser.close();
  }
})();
