// Writes tests/fixtures/mini.osm.json: a SYNTHETIC road network in Overpass JSON format.
// It is not Farsta. It is a small made-up town placed at the config's fallback point, used by the unit
// and smoke tests so the OSM pipeline and the Farsta level can be tested without network access.
//
//   node tests/fixtures/make-mini-osm.mjs
//
// Layout (metres, x east, N north):
//   Storvägen (secondary, 40 then 50) runs west-east along N=0 through a signalled crossroads with
//   Tvärgatan (x=-150), a zebra (x=0), a T junction with Fryksdalsbacken (x=-60, south) where the
//   test centre is, a T with Bigatan (x=80, north, give-way) and a one-lane roundabout at x=250.
//   Övre gatan (N=250) links Tvärgatan, Bigatan and the roundabout's north arm: unmarked junctions.
//   A one-way street links the roundabout's south arm back to Fryksdalsbacken.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'tools', 'farsta.config.json'), 'utf8'));
const [lat0, lon0] = cfg.centre.fallback;
const kx = Math.cos(lat0 * Math.PI / 180) * 111320;
const ll = (x, n) => [+(lat0 + n / 110540).toFixed(7), +(lon0 + x / kx).toFixed(7)];

const els = [];
let nid = 1000, wid = 1;
const N = {};
function node(name, x, n, tags) { const [lat, lon] = ll(x, n); const id = nid++; N[name] = id; els.push({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) }); return id; }
function way(names, tags) { els.push({ type: 'way', id: wid++, nodes: names.map((k) => N[k]), tags }); }

// Storvägen
node('A', -500, 0); node('S1', -300, 0); node('BUSN', -250, 0);
node('SIG_W', -162, 0, { highway: 'traffic_signals' }); node('J1', -150, 0); node('SIG_E', -138, 0, { highway: 'traffic_signals' });
node('J3', -60, 0); node('Z1', 0, 0, { highway: 'crossing', crossing: 'uncontrolled', 'crossing:markings': 'zebra' }); node('J2', 80, 0);
node('Z2', 200, 0, { highway: 'crossing', crossing: 'zebra' });
// roundabout, centre (250,0), r 15, counterclockwise seen from above
const ring = [];
for (let i = 0; i < 12; i++) { const a = Math.PI + i * Math.PI / 6; const nm = 'R' + i; node(nm, 250 + 15 * Math.cos(a), 15 * Math.sin(a)); ring.push(nm); }
// R0 = west (180 deg), R3 = south (270), R6 = east (0), R9 = north (90)
node('E1', 500, 0);
way(['A', 'S1'], { highway: 'secondary', name: 'Storvägen', maxspeed: '40' });
way(['S1', 'BUSN', 'SIG_W', 'J1', 'SIG_E', 'J3', 'Z1', 'J2', 'Z2', 'R0'], { highway: 'secondary', name: 'Storvägen', maxspeed: '50' });
way([...ring.slice(0), 'R0'], { highway: 'secondary', junction: 'roundabout', name: 'Storvägen' });
way(['R6', 'E1'], { highway: 'secondary', name: 'Storvägen', maxspeed: '50' });
// Tvärgatan with signals on the side approaches
node('T_S', -150, -300); node('SIG_S', -150, -12, { highway: 'traffic_signals' }); node('SIG_N', -150, 12, { highway: 'traffic_signals' });
node('T_O', -150, 250); node('T_N', -150, 400);
way(['T_S', 'SIG_S', 'J1', 'SIG_N', 'T_O', 'T_N'], { highway: 'tertiary', name: 'Tvärgatan', maxspeed: '50' });
// Fryksdalsbacken, the test centre street
node('F_S', -48, -162); node('F_M', -60, -70); node('F_1', -60, -150); node('F_2', -58.4, -158); node('F_3', -54, -162);
way(['J3', 'F_M', 'F_1', 'F_2', 'F_3', 'F_S'], { highway: 'residential', name: 'Fryksdalsbacken' });
// Bigatan with a give-way at the main road
node('B_GW', 80, 8, { highway: 'give_way' }); node('B_O', 80, 250);
way(['J2', 'B_GW', 'B_O'], { highway: 'residential', name: 'Bigatan' });
// north and south arms of the roundabout, with rounded corners like real mapped bends
node('RN', 238, 250); node('RN1', 250, 236); node('RN2', 248.4, 244); node('RN3', 244, 248.4);
node('RS', 238, -200); node('RS1', 250, -186); node('RS2', 248.4, -194); node('RS3', 244, -198.4);
way(['R9', 'RN1', 'RN2', 'RN3', 'RN'], { highway: 'residential', name: 'Norra vägen' });
way(['R3', 'RS1', 'RS2', 'RS3', 'RS'], { highway: 'residential', name: 'Södra vägen' });
// Övre gatan: unmarked junctions
way(['T_O', 'B_O', 'RN'], { highway: 'residential', name: 'Övre gatan' });
// one-way street back west
way(['RS', 'F_S'], { highway: 'residential', name: 'Enkelgatan', oneway: 'yes' });
// a car park road that must be ignored and a footway that must be ignored
node('P1', -60, -100); node('P2', -20, -100);
way(['F_M', 'P1', 'P2'], { highway: 'service', service: 'parking_aisle' });
node('FW1', 0, -5); node('FW2', 0, -60);
way(['FW1', 'FW2'], { highway: 'footway' });
// bus stop beside Storvägen, south side, serves eastbound traffic
node('BUS', -250, -6, { highway: 'bus_stop', name: 'Storvägen' });
// a speed sign node
node('SGN', -296, 6, { traffic_sign: 'SE:C31-50' });
// buildings, the test centre with its address
function bld(cx, cn, w, d, tags) { const ks = []; [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], i) => { const k = `b${wid}_${i}`; node(k, cx + a * w / 2, cn + b * d / 2); ks.push(k); }); way([...ks, ks[0]], tags); }
bld(-25, -80, 30, 20, { building: 'office', 'building:levels': '2', 'addr:street': cfg.centre.street, 'addr:housenumber': cfg.centre.housenumber, name: 'Test centre (synthetic)' });
for (let i = 0; i < 6; i++) bld(-430 + i * 70, 30, 24, 14, { building: 'apartments', 'building:levels': String(3 + (i % 3)) });
for (let i = 0; i < 4; i++) bld(120 + i * 30, 200, 12, 10, { building: 'house' });

const out = path.join(here, 'mini.osm.json');
fs.writeFileSync(out, JSON.stringify({ version: 0.6, generator: 'tests/fixtures/make-mini-osm.mjs (synthetic, not real map data)', elements: els }, null, 0));
console.log(`Wrote ${out}: ${els.length} elements`);
