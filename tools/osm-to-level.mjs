// Turns the raw Overpass response (data/farsta.osm.json) into the compact level the app loads:
// data/farsta.level.json, plus data/farsta.level.js, which wraps the same data in a script tag so
// the app also works from file:// (browsers block fetch() there).
//
//   node tools/osm-to-level.mjs [input.osm.json] [output-basename]     (or: npm run osm:build)
//
// What it does: projects lat/lon to metres around the test centre, keeps drivable roads, splits them
// into a junction graph, simplifies polylines (Douglas-Peucker, 0.5 m), attaches signals, crossings,
// give-way and stop nodes and bus stops to edges, places signs, clusters traffic lights, keeps building
// footprints for the 3D view and generates practice routes that start and end at the test centre.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/osm-lib.js';

const OSM = globalThis.FDL_OSM;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const LOW_BUILDINGS = new Set(['garage', 'garages', 'shed', 'roof', 'carport', 'hut', 'kiosk']);
const HOUSES = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'villa', 'cabin']);
const r1 = (v) => Math.round(v * 10) / 10;

export function parseSpeed(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return +s;
  const m = s.match(/^(\d+)\s*km\/h$/); if (m) return +m[1];
  if (s === 'SE:urban') return 50;
  if (s === 'SE:rural') return 70;
  if (s === 'SE:motorway') return 110;
  if (s === 'walk' || s === 'SE:living_street') return 7;
  return null;
}
function defaultLanes(hw, ow) {
  const b = hw.replace('_link', '');
  if (b === 'motorway' || b === 'trunk') return ow ? 2 : 4;
  if (b === 'service' || b === 'living_street') return 1;
  if (hw.endsWith('_link')) return 1;
  return ow ? 1 : 2;
}
function laneWidth(hw) { const t = OSM.tier(hw); return t >= 2 ? 3.5 : 3.0; }
function zebraTags(t) {
  const c = t.crossing, m = t['crossing:markings'];
  if (c === 'traffic_signals' || c === 'unmarked' || c === 'no') return false;
  if (t.crossing_ref === 'zebra' || c === 'zebra' || c === 'marked' || c === 'uncontrolled') return true;
  return !!(m && m !== 'no');
}

/** Convert an Overpass JSON response to level data. cfg is tools/farsta.config.json. */
export function convert(osm, cfg, opts = {}) {
  const log = opts.log || (() => {});
  const nodes = new Map(), ways = new Map();
  for (const e of osm.elements) {
    if (e.type === 'node') {
      const o = nodes.get(e.id);
      if (!o) nodes.set(e.id, { lat: e.lat, lon: e.lon, tags: e.tags || null });
      else if (e.tags && !o.tags) o.tags = e.tags;
    } else if (e.type === 'way') {
      const o = ways.get(e.id);
      if (!o || (e.tags && !o.tags)) ways.set(e.id, e);
    }
  }

  // test centre: the address from the config, else the fallback point
  const C = cfg.centre;
  let centre = null;
  for (const e of osm.elements) {
    const t = e.tags; if (!t || t['addr:street'] !== C.street || t['addr:housenumber'] !== C.housenumber) continue;
    if (e.type === 'node') centre = { lat: e.lat, lon: e.lon };
    else if (e.type === 'way') {
      const ids = e.nodes || [], ns = (ids.length > 1 && ids[0] === ids[ids.length - 1] ? ids.slice(1) : ids).map((id) => nodes.get(id)).filter(Boolean);
      if (ns.length) centre = { lat: ns.reduce((a, n) => a + n.lat, 0) / ns.length, lon: ns.reduce((a, n) => a + n.lon, 0) / ns.length };
    } else if (e.type === 'relation' && e.center) centre = { lat: e.center.lat, lon: e.center.lon };
    if (centre) break;
  }
  const found = !!centre;
  if (!centre) { centre = { lat: C.fallback[0], lon: C.fallback[1] }; log(`Warning: ${C.street} ${C.housenumber} not found in the data, using the fallback point.`); }
  const pj = OSM.projector(centre.lat, centre.lon);
  const P = (id) => { const n = nodes.get(id); return pj.fwd(n.lat, n.lon); };

  // drivable ways
  const W = [];
  for (const w of ways.values()) {
    const t = w.tags || {}, hw = t.highway;
    if (!DRIVE.has(hw) || t.area === 'yes') continue;
    if (['no', 'private'].includes(t.access) || ['no', 'private'].includes(t.motor_vehicle) || t.motorcar === 'no') continue;
    if (hw === 'service' && SKIP_SERVICE.has(t.service)) continue;
    let nds = (w.nodes || []).filter((id) => nodes.has(id));
    if (nds.length < 2) continue;
    const rb = t.junction === 'roundabout' || t.junction === 'circular';
    const o = t.oneway; let ow = 0;
    if (o === 'yes' || o === '1' || o === 'true') ow = 1;
    else if (o === '-1' || o === 'reverse') { ow = 1; nds = nds.slice().reverse(); }
    else if (o !== 'no' && (rb || hw === 'motorway' || hw === 'motorway_link')) ow = 1;
    const reversed = o === '-1' || o === 'reverse';
    let ln = parseInt(t.lanes, 10); if (!(ln > 0)) ln = rb ? 1 : defaultLanes(hw, ow);
    let width = parseFloat(t.width); if (!(width > 2)) width = rb ? Math.max(5.5, ln * 4.5) : Math.max(ow ? 3.5 : 5, ln * laneWidth(hw));
    W.push({ id: w.id, nds, reversed, way: { n: t.name || '', ref: t.ref || '', hw, ln, w: r1(width), ms: parseSpeed(t.maxspeed), ow, rb: rb ? 1 : 0 } });
  }

  // graph nodes: way ends and nodes shared by several ways (or used twice by one)
  const use = new Map();
  for (const w of W) {
    const closed = w.nds[0] === w.nds[w.nds.length - 1];
    w.nds.forEach((id, i) => { if (closed && i === w.nds.length - 1) return; use.set(id, (use.get(id) || 0) + 1); });
  }
  const isG = (w, i) => i === 0 || i === w.nds.length - 1 || use.get(w.nds[i]) > 1;

  let edges = [];
  for (let wi = 0; wi < W.length; wi++) {
    const w = W[wi]; let start = 0;
    for (let i = 1; i < w.nds.length; i++) {
      if (!isG(w, i)) continue;
      const ids = w.nds.slice(start, i + 1);
      if (ids.length >= 2 && !(ids.length === 2 && ids[0] === ids[1])) edges.push({ wi, ids });
      start = i;
    }
  }

  // keep the largest connected part of the network
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const e of edges) for (const id of [e.ids[0], e.ids[e.ids.length - 1]]) if (!parent.has(id)) parent.set(id, id);
  for (const e of edges) { const a = find(e.ids[0]), b = find(e.ids[e.ids.length - 1]); if (a !== b) parent.set(a, b); }
  const compLen = new Map();
  const elen = (e) => { let L = 0; for (let i = 1; i < e.ids.length; i++) { const a = P(e.ids[i - 1]), b = P(e.ids[i]); L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };
  for (const e of edges) { const r = find(e.ids[0]); compLen.set(r, (compLen.get(r) || 0) + elen(e)); }
  let bestComp = null; for (const [r, L] of compLen) if (bestComp == null || L > compLen.get(bestComp)) bestComp = r;
  const before = edges.length;
  edges = edges.filter((e) => find(e.ids[0]) === bestComp);
  log(`Edges: ${edges.length} kept, ${before - edges.length} dropped (not connected to the main network)`);

  // compact ways, nodes and edges
  const wayIdx = new Map(), outWays = [], nodeIdx = new Map(), outNodes = [], onEdge = new Map();
  const wIdx = (wi) => { if (!wayIdx.has(wi)) { wayIdx.set(wi, outWays.length); outWays.push(W[wi].way); } return wayIdx.get(wi); };
  const nIdx = (id) => { if (!nodeIdx.has(id)) { nodeIdx.set(id, outNodes.length); const p = P(id); outNodes.push([r1(p[0]), r1(p[1])]); } return nodeIdx.get(id); };
  const outEdges = edges.map((e, ei) => {
    const pts = OSM.simplify(e.ids.map(P), 0.5);
    e.ids.slice(1, -1).forEach((id) => onEdge.set(id, ei));
    const flat = []; for (const p of pts) flat.push(r1(p[0]), r1(p[1]));
    return [nIdx(e.ids[0]), nIdx(e.ids[e.ids.length - 1]), wIdx(e.wi), flat];
  });
  const edgeWay = edges.map((e) => W[e.wi]);
  const L = { ways: outWays, nodes: outNodes, edges: outEdges, feats: [], lights: [] };
  const net = new OSM.Net(L);

  // features
  const sigs = [];
  const projOnEdge = (ei, x, y) => {
    const E = net.E[ei]; let best = null;
    for (let k = 0; k < E.pts.length - 1; k++) {
      const [ax, ay] = E.pts[k], [bx, by] = E.pts[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (!best || d < best.d) best = { d, s: E.cum[k] + t * Math.sqrt(L2), h: OSM.hdg(dx, dy), x: ax + dx * t, y: ay + dy * t };
    }
    return best;
  };
  const attach = (id, x, y, maxD) => {
    if (onEdge.has(id)) { const ei = onEdge.get(id); return { e: ei, ...projOnEdge(ei, x, y) }; }
    if (nodeIdx.has(id)) {
      const ni = nodeIdx.get(id), de = net.out[ni][0] ?? net.inc[ni][0];
      if (de == null) return null;
      const ei = de >> 1, E = net.E[ei]; return { e: ei, d: 0, s: E.a === ni ? 0 : E.len, x, y, atNode: ni };
    }
    const nr = net.nearest(x, y, maxD); return nr ? { e: nr.e.i, d: nr.d, s: nr.s, h: nr.h, x: nr.x, y: nr.y, near: true } : null;
  };
  const dirFor = (f, tags, ei) => {
    const E = net.E[ei];
    if (E.way.ow) return 1;
    const dt = tags.direction || tags['traffic_signals:direction'];
    if (dt === 'forward' || dt === 'backward') { let d = dt === 'forward' ? 1 : -1; if (edgeWay[ei].reversed) d = -d; return d; }
    if (f.atNode != null) return E.b === f.atNode ? 1 : -1;
    // no tag: the sign faces traffic heading for the nearest real junction
    const jA = net.deg[E.a] >= 3, jB = net.deg[E.b] >= 3;
    if (jA && !jB) return -1; if (jB && !jA) return 1;
    return f.s > E.len / 2 ? 1 : -1;
  };
  for (const [id, n] of nodes) {
    const t = n.tags; if (!t) continue;
    const hw = t.highway, [x, y] = P(id);
    let type = null;
    if (hw === 'traffic_signals') type = 'sig';
    else if (hw === 'give_way' || hw === 'stop') type = hw;
    else if (hw === 'bus_stop') type = 'bus';
    else if ((hw === 'crossing' || t.crossing) && zebraTags(t)) type = 'zebra';
    if (!type) continue;
    const a = attach(id, x, y, type === 'bus' ? 25 : 3);
    if (!a || (!onEdge.has(id) && !nodeIdx.has(id) && type !== 'bus')) continue;
    const f = { t: type, x: r1(a.x), y: r1(a.y), e: a.e, s: r1(a.s) };
    if (type === 'give_way' || type === 'stop') f.d = dirFor(a, t, a.e);
    if (type === 'bus') { const q = net.pointAt(2 * a.e, a.s); f.side = a.d < 1.5 ? 0 : Math.sign((x - q.x) * -q.ty + (y - q.y) * q.tx); f.x = r1(x); f.y = r1(y); }
    if (type === 'sig') sigs.push(f);
    L.feats.push(f);
  }

  // traffic light clusters (greedy, 30 m)
  for (const f of sigs) {
    let c = L.lights.find((c) => Math.hypot(c.x - f.x, c.y - f.y) < 30);
    if (!c) { c = { x: f.x, y: f.y, n: 0, sx: 0, sy: 0 }; L.lights.push(c); }
    c.n++; c.sx += f.x; c.sy += f.y; c.x = c.sx / c.n; c.y = c.sy / c.n;
  }
  L.lights = L.lights.map((c) => ({ x: r1(c.x), y: r1(c.y) }));

  // signs
  const net2 = new OSM.Net(L);
  const signs = [];
  const addSign = (x, y, type, val) => { if (signs.some((s) => s.type === type && s.val === val && Math.hypot(s.x - x, s.y - y) < 8)) return; signs.push({ x: r1(x), y: r1(y), type, ...(val != null ? { val } : {}) }); };
  const sideOf = (de, s, extra) => { const p = net2.pointAt(de, s), off = net2.eOf(de).half + (extra || 1.4); return [p.x - p.ty * off, p.y + p.tx * off]; };
  // speed limit changes along a road
  for (let n = 0; n < net2.N; n++) {
    for (const din of net2.inc[n]) for (const dout of net2.out[n]) {
      if ((din >> 1) === (dout >> 1)) continue;
      const a = net2.way(din), b = net2.way(dout);
      if (!b.ms || a.ms === b.ms || a.rb || b.rb) continue;
      if (net2.deg[n] > 2 && !(a.n && a.n === b.n)) continue;
      if (Math.abs(OSM.angDiff(net2.hOut(dout), net2.hIn(din))) > 0.6) continue;
      const [x, y] = sideOf(dout, Math.min(6, net2.len(dout) / 2)); addSign(x, y, 'limit', b.ms);
    }
  }
  // limit signs where a road with an explicit limit starts at a junction
  for (let n = 0; n < net2.N; n++) {
    if (net2.deg[n] < 3) continue;
    for (const dout of net2.out[n]) {
      const b = net2.way(dout); if (!b.ms || b.rb || net2.len(dout) < 30) continue;
      if (net2.inc[n].some((d) => (d >> 1) !== (dout >> 1) && net2.way(d).ms === b.ms && net2.way(d).n === b.n)) continue;
      const [x, y] = sideOf(dout, 10); addSign(x, y, 'limit', b.ms);
    }
  }
  // signs mapped as nodes (Swedish codes)
  for (const [id, n] of nodes) {
    const ts = n.tags && n.tags.traffic_sign; if (!ts) continue;
    const [x, y] = P(id);
    for (const part of String(ts).split(/[;,]/)) {
      const m = part.match(/SE:C31[-[]?(\d+)/);
      if (m) addSign(x, y, 'limit', +m[1]);
      else if (/SE:C31/.test(part) && parseSpeed(n.tags.maxspeed)) addSign(x, y, 'limit', parseSpeed(n.tags.maxspeed));
      else if (/SE:B1\b/.test(part)) addSign(x, y, 'giveway');
      else if (/SE:B2\b/.test(part)) addSign(x, y, 'stop');
    }
  }
  for (const f of L.feats) {
    const E = net2.E[f.e];
    if (f.t === 'give_way' || f.t === 'stop') { const de = f.d === 1 ? 2 * f.e : 2 * f.e + 1, s = f.d === 1 ? f.s : E.len - f.s; const [x, y] = sideOf(de, s); addSign(x, y, f.t === 'stop' ? 'stop' : 'giveway'); }
    if (f.t === 'zebra') { for (const de of E.way.ow ? [2 * f.e] : [2 * f.e, 2 * f.e + 1]) { const s = de & 1 ? E.len - f.s : f.s; const [x, y] = sideOf(de, Math.max(0, s - 1)); addSign(x, y, 'zebra'); } }
  }
  // roundabout entries: give-way and roundabout signs
  for (let n = 0; n < net2.N; n++) {
    if (!net2.out[n].some((d) => net2.rb(d))) continue;
    for (const din of net2.inc[n]) {
      if (net2.rb(din)) continue;
      const L2 = net2.len(din); let [x, y] = sideOf(din, Math.max(0, L2 - 4)); addSign(x, y, 'giveway');
      if (L2 > 30) { [x, y] = sideOf(din, L2 - 25); addSign(x, y, 'rb'); }
    }
  }
  L.signs = signs;

  // buildings
  const bld = [];
  for (const w of ways.values()) {
    const t = w.tags || {}; if (!t.building || t.building === 'no') continue;
    const ids = (w.nodes || []).filter((id) => nodes.has(id)); if (ids.length < 4 || ids[0] !== ids[ids.length - 1]) continue;
    let pts = OSM.simplify(ids.map(P), 0.3); pts.pop(); if (pts.length < 3) continue;
    let lv = parseInt(t['building:levels'], 10);
    if (!(lv > 0)) lv = LOW_BUILDINGS.has(t.building) ? 1 : HOUSES.has(t.building) ? 2 : 4;
    const flat = [Math.min(lv, 30)]; for (const p of pts) flat.push(r1(p[0]), r1(p[1]));
    bld.push(flat);
  }
  L.bld = bld;

  // routes
  const net3 = new OSM.Net(L);
  const routes = [];
  if (net3.startOptions(0, 0).length) {
    const rnd = OSM.rng(opts.seed || 20240501);
    const [minLen, maxLen] = opts.routeLength || cfg.routeLength || [2500, 6000];
    const fmt = (s) => [s.rb && `${s.rb} roundabout${s.rb > 1 ? 's' : ''}`, s.sig && `${s.sig} set${s.sig > 1 ? 's' : ''} of lights`, s.right && `${s.right} unmarked junction${s.right > 1 ? 's' : ''}`, s.zebra && `${s.zebra} zebra crossing${s.zebra > 1 ? 's' : ''}`, s.bus && `${s.bus} bus stop${s.bus > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    for (const r of cfg.routes || []) {
      const wps = r.via.map(([la, lo]) => pj.fwd(la, lo));
      const rt = net3.routeWaypoints(wps, 60);
      if (!rt) { log(`Warning: route "${r.name}" could not be snapped to the network, skipped.`); continue; }
      const s = net3.stats(rt.de, rt.s0);
      routes.push({ id: 'c' + routes.length, name: r.name, desc: [`${(s.len / 1000).toFixed(1)} km`, fmt(s)].filter(Boolean).join(', '), len: Math.round(s.len), de: rt.de, s0: r1(rt.s0) });
    }
    const themes = [
      { name: 'Route A: mixed town driving', w: { rb: 3, sig: 3, right: 3, yield: 2, zebra: 1, bus: 1, turn: 1 } },
      { name: 'Route B: roundabouts', w: { rb: 8, sig: 1, right: 1, yield: 1, zebra: 1, bus: 1, turn: 0.5 } },
      { name: 'Route C: lights and junctions', w: { rb: 1, sig: 6, right: 4, yield: 2, zebra: 1, bus: 0.5, turn: 1 } },
    ];
    const used = new Set();
    for (const th of themes) {
      const best = net3.generateFrom(0, 0, th.w, rnd, { minLen, maxLen, tries: opts.tries || 80, avoid: used });
      if (!best) { log(`Warning: no route found for "${th.name}".`); continue; }
      if (routes.some((r) => r.de.join() === best.de.join())) { log(`"${th.name}" is the same as an earlier route, skipped.`); continue; }
      best.de.forEach((d) => used.add(d >> 1));
      routes.push({ id: 'g' + routes.length, name: th.name, desc: [`${(best.stats.len / 1000).toFixed(1)} km`, fmt(best.stats)].filter(Boolean).join(', '), len: Math.round(best.stats.len), de: best.de, s0: r1(best.s0) });
    }
  } else log('Warning: no road near the test centre, no routes generated.');
  L.routes = routes;

  const xs = outNodes.map((p) => p[0]), ys = outNodes.map((p) => p[1]);
  return {
    v: 1,
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL 1.0, https://www.openstreetmap.org/copyright',
    generated: opts.date || new Date().toISOString().slice(0, 10),
    origin: [centre.lat, centre.lon],
    centre: { name: C.name, x: 0, y: 0, found },
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round),
    ...L,
  };
}

function main() {
  const inp = process.argv[2] || path.join(root, 'data', 'farsta.osm.json');
  const outBase = process.argv[3] || path.join(root, 'data', 'farsta.level');
  if (!fs.existsSync(inp)) { console.error(`${inp} not found. Run: npm run osm:fetch`); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'farsta.config.json'), 'utf8'));
  const level = convert(JSON.parse(fs.readFileSync(inp, 'utf8')), cfg, { log: (m) => console.log(m) });
  const json = JSON.stringify(level);
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  fs.writeFileSync(outBase + '.json', json);
  fs.writeFileSync(outBase + '.js', '/* Generated by tools/osm-to-level.mjs. Map data © OpenStreetMap contributors, ODbL. */\nwindow.FDL_FARSTA=' + json + ';\n');
  console.log(`Wrote ${outBase}.json and .js: ${level.edges.length} road edges, ${level.feats.length} features, ${level.lights.length} light clusters, ${level.signs.length} signs, ${level.bld.length} buildings, ${level.routes.length} routes, ${(json.length / 1e6).toFixed(2)} MB`);
  for (const r of level.routes) console.log(`  ${r.name}: ${r.desc}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
