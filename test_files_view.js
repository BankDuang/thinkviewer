const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    // Step 1: Navigate to the application
    console.log('=== Step 1: Navigate to http://localhost:19080/ ===');
    await page.goto('http://localhost:19080/', { waitUntil: 'networkidle' });
    console.log('  Page title:', await page.title());
    console.log('  URL:', page.url());

    // Step 2: Login with password
    console.log('\n=== Step 2: Login with password ===');
    await page.fill('#password-input', '3442913935');
    await page.click('#login-btn');
    console.log('  Password entered and Connect clicked');
    await page.waitForTimeout(2000);

    // Verify login succeeded
    const loginHidden = await page.evaluate(() => {
      const el = document.getElementById('login-view');
      if (!el) return 'no login-view element';
      return getComputedStyle(el).display;
    });
    console.log('  Login view display:', loginHidden);

    // Step 3: Click on "Files" in the sidebar
    console.log('\n=== Step 3: Click on "Files" in sidebar ===');

    // First, enumerate sidebar items
    const sidebarItems = await page.evaluate(() => {
      const items = document.querySelectorAll('.sidebar *');
      const results = [];
      items.forEach(el => {
        const text = el.textContent.trim();
        if (text && text.length < 30 && el.children.length === 0) {
          results.push({
            tag: el.tagName,
            text: text,
            id: el.id,
            className: el.className,
            dataset: JSON.stringify(el.dataset)
          });
        }
      });
      return results;
    });
    console.log('  Sidebar leaf items:', JSON.stringify(sidebarItems, null, 2));

    // Try clicking Files
    let filesClicked = false;
    for (const selector of [
      '[data-view="files"]',
      '.nav-item:has-text("Files")',
      'button:has-text("Files")',
      'a:has-text("Files")',
      'text=Files',
      '.sidebar >> text=Files'
    ]) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          filesClicked = true;
          console.log('  Clicked Files using selector:', selector);
          break;
        }
      } catch (e) { /* try next */ }
    }

    if (!filesClicked) {
      console.log('  WARNING: Could not click Files nav item');
    }

    await page.waitForTimeout(1500);

    // Step 4: Take screenshot and analyze the layout
    console.log('\n=== Step 4: Analyze Files view layout ===');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'files_view_01.png'), fullPage: false });
    console.log('  Screenshot saved: files_view_01.png');

    // Analyze the file manager layout in detail
    const layoutAnalysis = await page.evaluate(() => {
      const results = {};

      // Check for the files view
      const filesView = document.querySelector('#files-view, .files-view');
      results.filesViewFound = !!filesView;
      if (filesView) {
        results.filesViewDisplay = getComputedStyle(filesView).display;
        results.filesViewClasses = filesView.className;
      }

      // Check for split-pane layout
      const panels = document.querySelectorAll('.file-panel, .panel, .pane, [class*="panel"], [class*="pane"]');
      results.panelCount = panels.length;
      results.panels = Array.from(panels).map(p => ({
        className: p.className,
        id: p.id,
        textPreview: p.textContent.trim().substring(0, 100).replace(/\s+/g, ' ')
      }));

      // Check for "Client" panel
      const allText = document.body.innerHTML;
      results.hasClientText = allText.includes('Client');
      results.hasDeviceText = allText.includes('Device');
      results.hasRemoteText = allText.includes('Remote');
      results.hasBrowserText = allText.includes('Browser');
      results.hasTransferText = allText.includes('Transfer');
      results.hasAddFilesText = allText.includes('Add Files');
      results.hasDropZoneText = allText.includes('drop') || allText.includes('Drop');

      // Check for transfer buttons
      const transferBtns = document.querySelectorAll('button');
      const transferButtons = Array.from(transferBtns).filter(b =>
        b.textContent.includes('>>') || b.textContent.includes('<<') ||
        b.textContent.includes('→') || b.textContent.includes('←') ||
        b.innerHTML.includes('arrow') || b.innerHTML.includes('transfer')
      );
      results.transferButtonCount = transferButtons.length;
      results.transferButtons = transferButtons.map(b => ({
        text: b.textContent.trim().substring(0, 50),
        className: b.className,
        id: b.id
      }));

      // Get full text content of files view area
      if (filesView) {
        results.fullTextContent = filesView.textContent.trim().substring(0, 1000).replace(/\s+/g, ' ');
      }

      // Check for file listing / table
      const tables = document.querySelectorAll('table, .file-list, .file-listing, [class*="file-list"]');
      results.tableCount = tables.length;

      // Check for path bar
      const pathBar = document.querySelectorAll('[class*="path"], [class*="breadcrumb"], .path-bar');
      results.pathBarCount = pathBar.length;
      results.pathBars = Array.from(pathBar).map(p => ({
        className: p.className,
        text: p.textContent.trim().substring(0, 100)
      }));

      // Check for transfer log
      const logAreas = document.querySelectorAll('[class*="log"], [class*="transfer-log"], .log-area');
      results.logAreaCount = logAreas.length;
      results.logAreas = Array.from(logAreas).map(l => ({
        className: l.className,
        id: l.id,
        text: l.textContent.trim().substring(0, 100)
      }));

      return results;
    });

    console.log('\n  --- Layout Analysis ---');
    console.log('  Files view found:', layoutAnalysis.filesViewFound);
    console.log('  Files view display:', layoutAnalysis.filesViewDisplay);
    console.log('  Files view classes:', layoutAnalysis.filesViewClasses);
    console.log('  Panel count:', layoutAnalysis.panelCount);
    console.log('  Panels:', JSON.stringify(layoutAnalysis.panels, null, 4));
    console.log('  Has "Client" text:', layoutAnalysis.hasClientText);
    console.log('  Has "Device" text:', layoutAnalysis.hasDeviceText);
    console.log('  Has "Remote" text:', layoutAnalysis.hasRemoteText);
    console.log('  Has "Browser" text:', layoutAnalysis.hasBrowserText);
    console.log('  Has "Transfer" text:', layoutAnalysis.hasTransferText);
    console.log('  Has "Add Files" text:', layoutAnalysis.hasAddFilesText);
    console.log('  Has "drop/Drop" text:', layoutAnalysis.hasDropZoneText);
    console.log('  Transfer buttons:', layoutAnalysis.transferButtonCount);
    console.log('  Transfer buttons detail:', JSON.stringify(layoutAnalysis.transferButtons, null, 4));
    console.log('  Table/file-list count:', layoutAnalysis.tableCount);
    console.log('  Path bar count:', layoutAnalysis.pathBarCount);
    console.log('  Path bars:', JSON.stringify(layoutAnalysis.pathBars, null, 4));
    console.log('  Log area count:', layoutAnalysis.logAreaCount);
    console.log('  Log areas:', JSON.stringify(layoutAnalysis.logAreas, null, 4));
    console.log('  Full text content:', layoutAnalysis.fullTextContent);

    // Step 5: Take a full page screenshot for visual verification
    console.log('\n=== Step 5: Full page screenshot for visual verification ===');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'files_view_02_full.png'), fullPage: true });
    console.log('  Screenshot saved: files_view_02_full.png');

    // Get detailed CSS layout info
    const cssLayout = await page.evaluate(() => {
      const filesView = document.querySelector('#files-view, .files-view');
      if (!filesView) return 'No files view';

      // Get all direct children with their computed styles
      const children = Array.from(filesView.children);
      return children.map(child => {
        const style = getComputedStyle(child);
        return {
          tag: child.tagName,
          className: child.className,
          id: child.id,
          display: style.display,
          flexDirection: style.flexDirection,
          width: style.width,
          height: style.height,
          textPreview: child.textContent.trim().substring(0, 150).replace(/\s+/g, ' ')
        };
      });
    });
    console.log('\n  --- CSS Layout of Files View Children ---');
    console.log(JSON.stringify(cssLayout, null, 2));

    // Get deeper layout analysis - check for the specific FileZilla-style components
    const deepAnalysis = await page.evaluate(() => {
      const results = {};

      // Look for specific heading text
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, .panel-header, .panel-title, [class*="header"], [class*="title"]');
      results.headings = Array.from(headings).map(h => ({
        tag: h.tagName,
        className: h.className,
        text: h.textContent.trim().substring(0, 80)
      })).filter(h => h.text.length > 0 && h.text.length < 80);

      // Look for drop zone
      const dropZones = document.querySelectorAll('[class*="drop"], [ondrop], [ondragover], .drop-zone, .dropzone');
      results.dropZones = Array.from(dropZones).map(d => ({
        className: d.className,
        id: d.id,
        text: d.textContent.trim().substring(0, 80)
      }));

      // Look for file input
      const fileInputs = document.querySelectorAll('input[type="file"]');
      results.fileInputCount = fileInputs.length;

      // Look for >> and << buttons more broadly
      const allButtons = document.querySelectorAll('button');
      results.allButtons = Array.from(allButtons).map(b => ({
        text: b.textContent.trim().substring(0, 40),
        className: b.className,
        id: b.id,
        title: b.title || '',
        innerHTML: b.innerHTML.substring(0, 80)
      }));

      return results;
    });
    console.log('\n  --- Deep Analysis ---');
    console.log('  Headings:', JSON.stringify(deepAnalysis.headings, null, 2));
    console.log('  Drop zones:', JSON.stringify(deepAnalysis.dropZones, null, 2));
    console.log('  File input count:', deepAnalysis.fileInputCount);
    console.log('  All buttons:', JSON.stringify(deepAnalysis.allButtons, null, 2));

    console.log('\n=== TEST COMPLETE ===');
    console.log('All screenshots saved to:', SCREENSHOTS_DIR);

  } catch (error) {
    console.error('Error during test:', error.message);
    console.error('Stack:', error.stack);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'files_error.png'), fullPage: true });
    console.log('Error screenshot saved');
  } finally {
    await browser.close();
  }
})();
