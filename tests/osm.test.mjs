// Unit tests for the OpenStreetMap pipeline: projection, simplification, conversion, snapping,
// routing and route events. Uses the synthetic network in tests/fixtures/mini.osm.json.
//
//   node --test tests/osm.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/osm-lib.js';
import { convert, parseSpeed } from '../tools/osm-to-level.mjs';

const OSM = globalThis.FDL_OSM;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'farsta.config.json'), 'utf8'));
const osm = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'mini.osm.json'), 'utf8'));
const L = convert(osm, cfg, { routeLength: [700, 4000], date: '2000-01-01' });
const net = new OSM.Net(L);
// The test centre building (centre at 25 m west, 80 m south in the fixture's east/north grid) is the
// origin. F(east, north) gives app coordinates for a fixture position.
const F = (e, n) => [e + 25, -(n + 80)];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('projection: origin, axes and round trip', () => {
  const pj = OSM.projector(59.24, 18.09);
  assert.deepEqual(pj.fwd(59.24, 18.09).map((v) => Math.abs(v)), [0, 0]);
  const [x, y] = pj.fwd(59.241, 18.091);
  near(y, -110.54, 0.01, 'north is negative y');
  near(x, 111320 * Math.cos(59.24 * Math.PI / 180) * 0.001, 0.01, 'east is positive x');
  const [la, lo] = pj.inv(x, y);
  near(la, 59.241, 1e-9); near(lo, 18.091, 1e-9);
});

test('Douglas-Peucker keeps corners and drops collinear points', () => {
  const line = [[0, 0], [1, 0.1], [2, -0.1], [3, 0.05], [10, 0]];
  assert.deepEqual(OSM.simplify(line, 0.5), [[0, 0], [10, 0]]);
  const corner = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
  assert.deepEqual(OSM.simplify(corner, 0.5), [[0, 0], [10, 0], [10, 10]]);
});

test('speed parsing', () => {
  assert.equal(parseSpeed('50'), 50);
  assert.equal(parseSpeed('30 km/h'), 30);
  assert.equal(parseSpeed('SE:urban'), 50);
  assert.equal(parseSpeed('walk'), 7);
  assert.equal(parseSpeed('none'), null);
});

test('conversion: graph, features, signs, buildings', () => {
  assert.equal(L.centre.found, true, 'test centre found by address');
  assert.equal(L.attribution, '© OpenStreetMap contributors');
  // the parking aisle and the footway are not part of the network
  assert.ok(!L.ways.some((w) => w.hw === 'footway'));
  assert.ok(!L.ways.some((w) => w.hw === 'service'));
  const rb = L.ways.find((w) => w.rb);
  assert.ok(rb && rb.ow === 1, 'roundabout is one-way');
  const t = (k) => L.feats.filter((f) => f.t === k).length;
  assert.equal(t('sig'), 4); assert.equal(t('zebra'), 2); assert.equal(t('give_way'), 1); assert.equal(t('bus'), 1);
  assert.equal(L.lights.length, 1, 'four signal nodes form one cluster');
  const bus = L.feats.find((f) => f.t === 'bus');
  assert.equal(bus.side, 1, 'bus stop south of an eastbound edge is on its right');
  const gw = L.feats.find((f) => f.t === 'give_way');
  const gwEdge = net.E[gw.e];
  assert.equal(net.deg[gw.d === 1 ? gwEdge.b : gwEdge.a] >= 3, true, 'give-way faces the junction');
  assert.ok(L.signs.some((s) => s.type === 'limit' && s.val === 40));
  assert.ok(L.signs.some((s) => s.type === 'rb'));
  assert.equal(L.bld.length, 11);
  assert.ok(L.routes.length >= 1);
});

test('snapping to the network', () => {
  const nr = net.nearest(...F(-200, -3), 20);
  assert.ok(nr, 'found a road');
  assert.equal(nr.way.n, 'Storvägen');
  near(nr.d, 3, 0.2, 'distance to centreline');
  // heading east (pi/2) picks the eastbound direction of the two-way road, west picks westbound
  const east = net.nearestDe(...F(-200, -2), Math.PI / 2, 20), west = net.nearestDe(...F(-200, 2), -Math.PI / 2, 20);
  assert.equal(east.de >> 1, west.de >> 1);
  assert.notEqual(east.de, west.de);
  assert.ok(net.pointAt(east.de, east.s + 10).x > net.pointAt(east.de, east.s).x, 'eastbound moves east');
  // a one-way street cannot be snapped against its direction
  const ow = L.ways.findIndex((w) => w.n === 'Enkelgatan');
  const owEdge = net.E.find((e) => e.wi === ow);
  const mid = net.pointAt(2 * owEdge.i, owEdge.len / 2);
  const against = net.nearestDe(mid.x, mid.y, Math.atan2(-mid.tx, mid.ty), 10);
  assert.ok(!against || (against.de >> 1) !== owEdge.i, 'no snap against the one-way direction');
  // waypoints snap to nodes and route through them
  const n = net.snapNode(...F(-146, 3), 30), [jx, jy] = F(-150, 0);
  assert.ok(Math.hypot(net.nodes[n].x - jx, net.nodes[n].y - jy) < 1, 'snapped to the crossroads node');
});

test('routing respects one-way streets and connects edges', () => {
  for (const r of L.routes) {
    for (let i = 1; i < r.de.length; i++) assert.equal(net.from(r.de[i]), net.to(r.de[i - 1]), 'consecutive edges share a node');
    for (const d of r.de) if (net.way(d).ow) assert.equal(d & 1, 0, 'one-way edges only in their direction');
    assert.equal(net.to(r.de[r.de.length - 1]), net.from(r.de[0]), 'route ends back at the test centre');
    r.de.forEach((d, i) => { if (i) assert.notEqual(d >> 1, r.de[i - 1] >> 1, 'no U-turns'); });
  }
  const rt = net.routeWaypoints([F(-60, -100), F(235, 0), F(250, 230)], 60);
  assert.ok(rt, 'waypoint route found');
  assert.ok(rt.de.some((d) => net.rb(d)), 'goes through the roundabout');
});

test('route events: roundabout exit count, lights, priority', () => {
  // from the test centre to the roundabout's north arm: enter from the west, leave north = 3rd exit, left
  const rt = net.routeWaypoints([F(-60, -100), F(-60, 0), F(235, 0), F(250, 240)], 60);
  const ev = net.events(rt.de, rt.s0);
  const rb = ev.find((e) => e.t === 'node' && e.m === 'rb');
  assert.ok(rb, 'roundabout event');
  assert.equal(rb.n, 3); assert.equal(rb.dir, 'left'); assert.equal(rb.name, 'Norra vägen');
  assert.equal(ev.filter((e) => e.t === 'rbx').length, 2, 'passes two exits first');
  const out = ev.find((e) => e.t === 'node' && e.m === 'turn');
  assert.equal(out.ctrl, 'yield', 'residential onto secondary: give way');
  assert.equal(out.dir, 'right');
  // westwards through the crossroads: lights, stop line before the signal node
  const rt2 = net.routeWaypoints([F(100, 2), F(-300, 0)], 60);
  const ev2 = net.events(rt2.de, rt2.s0);
  const li = ev2.find((e) => e.t === 'light');
  assert.ok(li, 'light event');
  near(li.x, F(-150 + 13, 0)[0], 1.5, 'stop line just before the eastern signal');
  // Övre gatan / Bigatan: unmarked junction between residential streets
  const rt3 = net.routeWaypoints([F(-150, 240), F(250, 250)], 60);
  const ev3 = net.events(rt3.de, rt3.s0);
  assert.ok(ev3.some((e) => e.t === 'node' && e.ctrl === 'right'), 'högerregeln junction');
});

test('path points follow the right-hand lane', () => {
  const st = net.nearestDe(...F(-400, 0), Math.PI / 2, 20);
  const pp = net.pathPoints([st.de], st.s);
  const mid = pp.pts[Math.floor(pp.pts.length / 2)];
  near(mid.y, F(0, -1.75)[1], 0.2, 'eastbound lane centre is south (right) of the centreline');
});

test('traffic light phases alternate between crossing directions', () => {
  const C = net.lights[0];
  assert.equal(C.ngrp, 2);
  let both = 0;
  for (let t = 0; t < 36; t += 0.5) {
    const a = net.lightState(0, 0, t).st, b = net.lightState(0, 1, t).st;
    if (a !== 'R' && b !== 'R') both++;
  }
  assert.equal(both, 0, 'never green or amber in both directions at once');
});
