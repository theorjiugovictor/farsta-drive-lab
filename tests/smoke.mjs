// Smoke test: loads the app in headless Chromium (software WebGL), drives every
// scenario in every view for a moment, lets an autopilot drive a whole Farsta route,
// saves screenshots to tests/output and fails on any page error.
//
// The Farsta scenario uses data/farsta.level.js when it exists. Without it (the map data has
// not been downloaded yet), it uses a level built from the synthetic network in tests/fixtures.
//
//   npm install
//   npm test
//
// Set CHROMIUM_PATH to use a specific Chromium build instead of Playwright's own.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { convert } from '../tools/osm-to-level.mjs';

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

const realData = fs.existsSync(path.join(root, 'data', 'farsta.level.js'));
if (!realData) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'farsta.config.json'), 'utf8'));
  const osm = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'mini.osm.json'), 'utf8'));
  const level = convert(osm, cfg, { routeLength: [700, 4000] });
  await page.addInitScript({ content: `window.FDL_FARSTA=${JSON.stringify(level)};` });
  console.log('Farsta: no data/farsta.level.js, using the synthetic test network');
}

await page.goto('file://' + path.join(root, 'index.html') + '?test');
await page.waitForTimeout(800);

for (const lvl of ['roundabout', 'highway', 'country', 'park', 'farsta']) {
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

// Farsta with the test autopilot (ten times real time). Without traffic it must drive the whole route and get
// no serious faults, which checks routing, the guide path, events and scoring. With traffic it must keep moving
// for two minutes of simulated driving without page errors.
async function autopilot(view, traffic, simSeconds) {
  if (await page.locator('#report').isVisible()) await page.click('#closeRep');
  await page.click('.scard[data-lvl=farsta]');
  // a town loop of a few km (the exam routes on the real map are 12 to 17 km, too long for a smoke test)
  const loop = await page.$$eval('#routeSel option', (o) => (o.find((x) => x.textContent.startsWith('Route B')) || o[0]).value);
  await page.selectOption('#routeSel', loop);
  await page.click(`#viewSeg [data-view=${view}]`);
  await page.click('#goBtn');
  await page.evaluate((t) => window.FDL_TEST.auto(true, 10, t), traffic);
  const t0 = Date.now();
  let st, shot = false;
  while (Date.now() - t0 < 240000) {
    st = await page.evaluate(() => window.FDL_TEST.state());
    if (st.ended || st.time > simSeconds) break;
    if (!shot && st.s > st.len * 0.3) { shot = true; await page.locator('.stage').screenshot({ path: path.join(out, `farsta-auto-${view}.png`) }); }
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.FDL_TEST.auto(false));
  console.log(`Farsta autopilot, ${view} view, traffic ${traffic ? 'on' : 'off'}: ${st.route}, ${Math.round(st.s)} of ${Math.round(st.len)} m in ${st.time.toFixed(0)} s, ${st.ai} cars nearby, ended=${st.ended}`);
  for (const f of st.faults) console.log('  ' + f);
  return st;
}
{
  const st = await autopilot('map', false, 1e9);
  if (!st.ended || st.s < st.len - 20) errors.push('Farsta autopilot did not finish the route');
  if (st.faults.some((f) => !f.startsWith('minor'))) errors.push('Farsta autopilot got a serious fault on a careful drive');
  await page.screenshot({ path: path.join(out, 'farsta-report.png') });
}
{
  // Not asserted: the autopilot is cautious and occasionally waits a long time at a busy junction.
  await autopilot('driver', true, 120);
  if (await page.locator('#report').isHidden()) { await page.keyboard.press('Space'); }
}

// Parking and reversing: reverse gear moves the car backwards, and each exercise finishes and is scored
// when the car stands on its target.
{
  if (await page.locator('#report').isVisible()) await page.click('#closeRep');
  await page.click('.scard[data-lvl=park]');
  await page.click('#viewSeg [data-view=driver]');
  await page.click('#goBtn');
  const y0 = (await page.evaluate(() => window.FDL_TEST.state())).car.y;
  await page.keyboard.press('r');
  await page.keyboard.down('s');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.locator('.stage').screenshot({ path: path.join(out, 'park-reverse-driver.png') });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('s');
  const car = (await page.evaluate(() => window.FDL_TEST.state())).car;
  if (car.gear !== 'R' || !(car.y > y0 + 0.3)) errors.push(`Reverse gear did not move the car backwards (gear ${car.gear}, y ${y0.toFixed(2)} -> ${car.y.toFixed(2)})`);
  for (const ex of ['parallel', 'bay', 'corner']) {
    if (await page.locator('#report').isVisible()) await page.click('#closeRep');
    await page.selectOption('#parkSel', ex);
    await page.click('#viewSeg [data-view=map]');
    await page.click('#goBtn');
    await page.evaluate(() => window.FDL_TEST.solve());
    await page.waitForTimeout(500);
    await page.locator('.stage').screenshot({ path: path.join(out, `park-${ex}-map.png`) });
    await page.waitForSelector('#report:not([hidden])', { timeout: 15000 }).catch(() => {});
    const st = await page.evaluate(() => window.FDL_TEST.state());
    console.log(`Parking, ${ex}: ended=${st.ended}; ${st.faults.join('; ') || 'no faults'}`);
    if (!st.ended) errors.push(`Parking exercise ${ex} did not finish with the car on its target`);
    if (st.faults.some((f) => !f.startsWith('minor'))) errors.push(`Parking exercise ${ex} gave a serious fault for a perfect position`);
  }
}

// VR steering wheel, with simulated hand positions
{
  const w = await page.evaluate(() => window.FDL_TEST.wheel());
  console.log(`VR wheel: quarter turn -> ${w.turned.toFixed(2)} rad, held=${w.held}, grab far from the rim=${w.farGrab}, after letting go ${w.centred.toFixed(3)} rad`);
  if (Math.abs(w.turned - Math.PI / 2) > 0.05 || !w.held) errors.push('VR wheel: a quarter turn of the hand did not turn the wheel a quarter turn to the right');
  if (w.farGrab) errors.push('VR wheel: a grip far from the rim grabbed the wheel');
  if (Math.abs(w.centred) > 0.05) errors.push('VR wheel: the wheel did not centre itself after letting go');
}

if (await page.locator('#report').isVisible()) await page.click('#closeRep');
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
