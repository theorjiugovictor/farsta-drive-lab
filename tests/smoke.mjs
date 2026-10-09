// Smoke test: loads the app in headless Chromium (software WebGL), drives every
// scenario in every view for a moment, saves screenshots to tests/output and
// fails on any page error.
//
//   npm install
//   npm test
//
// Set CHROMIUM_PATH to use a specific Chromium build instead of Playwright's own.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests', 'output');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::')) errors.push(m.text()); });

// Serve three.js from node_modules so the test runs offline.
const localThree = path.join(root, 'node_modules', 'three', 'build', 'three.min.js');
if (fs.existsSync(localThree)) {
  await page.route('**/three.min.js', (r) => r.fulfill({ path: localThree, contentType: 'application/javascript' }));
}

await page.goto('file://' + path.join(root, 'index.html'));
await page.waitForTimeout(800);

for (const lvl of ['roundabout', 'highway', 'country']) {
  for (const view of ['driver', 'chase', 'map']) {
    if (await page.locator('#report').isVisible()) await page.click('#closeRep');
    await page.click(`.scard[data-lvl=${lvl}]`);
    await page.click(`#viewSeg [data-view=${view}]`);
    await page.click('#goBtn');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('w');
    await page.waitForTimeout(250);
    await page.locator('.stage').screenshot({ path: path.join(out, `${lvl}-${view}.png`) });
    await page.keyboard.up('w');
  }
}

for (const tab of ['quiz', 'video', 'progress']) {
  await page.click(`nav [data-tab=${tab}]`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `tab-${tab}.png`), fullPage: true });
}

await browser.close();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`OK. Screenshots in ${path.relative(process.cwd(), out)}`);
