// Downloads the roads, junction nodes, signs and buildings around the Farsta test centre from the
// Overpass API and saves the raw response to data/farsta.osm.json. Run it once, then run
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
const [s, w, n, e] = cfg.bbox;
const bb = `(${s},${w},${n},${e})`;
const DRIVE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

export const query = `[out:json][timeout:180];
(
  way["highway"~"^(${DRIVE})$"]${bb};
  node["highway"~"^(crossing|traffic_signals|give_way|stop|bus_stop)$"]${bb};
  node["crossing"]${bb};
  node["traffic_sign"]${bb};
  way["building"]${bb};
  nwr["addr:street"="${cfg.centre.street}"]["addr:housenumber"="${cfg.centre.housenumber}"]${bb};
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
