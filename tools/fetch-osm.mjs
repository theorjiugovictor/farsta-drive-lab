// Downloads the roads, junction nodes, signs and buildings for the areas in tools/farsta.config.json
// (Farsta and the places the examiners' routes go) from the Overpass API and saves the raw response to data/farsta.osm.json. Run it once, then run
// tools/osm-to-level.mjs. The app never calls Overpass itself.
//
//   node tools/fetch-osm.mjs            (or: npm run osm:fetch)
//
// Data © OpenStreetMap contributors, available under the Open Database License (ODbL).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'farsta.config.json'), 'utf8'));
const DRIVE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const MAIN = 'motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const bb = (b) => `(${b.join(',')})`;
const parts = [];
for (const a of cfg.areas) {
  parts.push(`  way["highway"~"^(${a.roads === 'main' ? MAIN : DRIVE})$"]${bb(a.bbox)};`);
  if (a.roads !== 'main') {
    parts.push(`  node["highway"~"^(crossing|traffic_signals|give_way|stop|bus_stop)$"]${bb(a.bbox)};`);
    parts.push(`  node["crossing"]${bb(a.bbox)};`);
    parts.push(`  node["traffic_sign"]${bb(a.bbox)};`);
  } else {
    parts.push(`  node["highway"~"^(traffic_signals|give_way|stop)$"]${bb(a.bbox)};`);
  }
  if (a.buildings) parts.push(`  way["building"]${bb(a.bbox)};`);
}
parts.push(`  nwr["addr:street"="${cfg.centre.street}"]["addr:housenumber"="${cfg.centre.housenumber}"]${bb(cfg.areas[0].bbox)};`);

export const query = `[out:json][timeout:300];
(
${parts.join('\n')}
);
out body;
>;
out skel qt;`;

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function main() {
  let lastErr;
  for (const url of MIRRORS) {
    try {
      console.log(`Querying ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'farsta-drive-lab (driving test practice app)' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.elements || !json.elements.length) throw new Error('empty response');
      fs.mkdirSync(path.join(root, 'data'), { recursive: true });
      const out = path.join(root, 'data', 'farsta.osm.json');
      fs.writeFileSync(out, JSON.stringify(json));
      const ways = json.elements.filter((x) => x.type === 'way').length;
      console.log(`Saved ${json.elements.length} elements (${ways} ways) to ${path.relative(process.cwd(), out)}, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`  failed: ${err.message}`);
    }
  }
  console.error('All Overpass mirrors failed. Last error: ' + (lastErr && lastErr.message));
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
