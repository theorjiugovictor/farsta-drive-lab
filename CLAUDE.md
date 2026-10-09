# Farsta Drive Lab: notes for Claude Code

A static web app (no build step) that trains people for the Swedish driving test, körprov B. Read `README.md` for what it does from the user's side. This file covers how the code works and what to build next.

## Conventions

- No em dashes in any user-facing copy, docs or commit messages.
- Commit messages describe the change. Do not add AI attribution or `Co-authored-by` lines.
- Keep it a static site that works from GitHub Pages and from `file://`. No bundler. Libraries come from cdnjs with an exact version (three.js is pinned to r128 because the code uses its `WebGLRenderer.xr` API from that release).
- UI copy is plain English. Swedish terms appear where they match what the user sees in Trafikverket's reports or on signs (Godkänd, Underkänd, Cirkulationsplats, Landsväg).
- Run `npm test` after changes. It must pass with no page errors, and look at the screenshots in `tests/output/` when you touch rendering.

## Architecture (`src/app.js`)

Everything lives in one IIFE. Main parts, in file order:

1. **Persistence**: `store` wraps localStorage (always in try/catch). `P` holds progress: `drives`, `quiz`, `video`.
2. **Fault categories**: `CATS` mirrors the headings in Trafikverket's result email (predict, speed, place, attention, interact, maneuver, rules).
3. **Path utilities**: `buildPath` (Catmull-Rom through control points), `polyline`, `reversePath`, `at(path, s)` gives position, tangent and curvature at arc length `s`, and `project(path, x, y)` returns `{s, lat}`. Coordinates are metres. World x is east/right, world y is down/south (canvas convention). Heading `h` is 0 when facing negative y and increases clockwise. Forward vector: `(sin h, -cos h)`.
4. **State `S`**: the player car `S.car`, AI vehicles `S.ai`, pedestrians `S.peds`, faults, timers, view, mode.
5. **`fault(cat, text, sev, key, tip)`**: records a fault. `sev` is `minor`, `serious` or `intervention`. `key` dedupes repeated faults. An intervention makes the examiner brake and ends the drive.
6. **Physics**: `stepCar` is a kinematic bicycle model about the rear axle (1.35 m behind the car's centre, wheelbase 2.7 m) with speed-dependent steering limits. `c.v` is signed: negative when reversing. `c.gear` is `D` or `R`, changed with `setGear` only when stopped (`c.gearChanges` counts changes, for corrections). Steering input is either a fraction of full lock (`st`, keys and sticks) or a road-wheel angle (`S.gp.wheel`, from the VR wheel); `STEER_RATIO` is 15. `act()` handles signals, mirror, shoulder and look-back checks, gear and hold speed. `mirrorAgo`, `lookLAgo`, `lookRAgo` and `lookBAgo` are the seconds since the last check, and scoring reads them.
7. **AI**: `mkVeh` creates a vehicle that follows a path at arc length `s` with lateral offset `lat`. `updateAI` does car following, optional `hold` (stop at a point while a condition is true) and an optional per-vehicle `script`.
8. **Generic checks**: `genericChecks` covers speed limits and harsh braking. `laneChangeCheck` covers signal, mirrors, shoulder check and blind-spot occupancy.
9. **Levels**: `RB` (roundabout), `HW` (motorway exit), `CR` (country road), `PK` (parking and reversing), `OSM` (Farsta, real roads, see below), registered in `LEVELS`. `PK` has three exercises (`parallel`, `bay`, `corner`), each with an `onRoad(x, y)` surface test used for kerb contact (`wheelsOf` gives the tyre points), a `target` pose and an `evaluate()` for the final position. Parked cars are `parkedCar()` AI vehicles: always visible, and touching one is an intervention. The level interface:
   - `init(opts)`: build paths, spawn the player and AI, set `signs`, `hints`, `S.instr`
   - `step(dt)`: scenario-specific scoring, calls `finish()` at the end
   - `draw(g)`: draws the ground (roads, markings) in world metres on a 2D canvas. The 3D view reuses this as the ground texture, so anything drawn here shows up in every view.
   - `checkLimit()`, `hudLimit()`, `zone()`: the speed limit used for scoring, the one shown, and a zone id used to dedupe speeding faults
   - `ground` (colour), `title`, `signs: [{x, y, type, val}]` with types `limit | warn | giveway | mw | town | rb | bus | zebra`
   - `hints: [{when: () => bool, t: 'text'}]` for coach mode
   - optional: `subtitle()` (shown in the report, e.g. the route name), `trees` (3D trees), `build3D(group)` (extra 3D scenery), `sync3D()` (per-frame 3D updates), `drawDyn(g)` (per-frame 2D overlay that must not go into the cached ground texture)
10. **2D renderer** (Map view): `render`, `drawVeh`, `drawSign` and `drawSignFace`.
11. **3D renderer** (Driver and Chase views, three.js): `init3D`, `build3D` (per-level scenery: trees as InstancedMesh, houses, signs as sprites), `vehMesh`, `syncDyn` (keeps meshes in step with `S.ai` and `S.peds`), `updateGroundTex` (redraws `level.draw` into a 2048 px texture covering 280 m around a point ahead of the car), `render3D` (desktop mirrors use scissor viewports and a horizontally flipped projection, which is why scene materials are DoubleSide).
12. **VR**: `buildCockpit` (dashboard, pillars, steering wheel, mirror planes using render targets, dashboard display panel), `pollXR` (Quest controller mapping: grips hold the wheel when on the rim and signal otherwise, left stick steers and is the indicator stalk, right stick selects D and R), `wheelStep` (pure: hands in the wheel's frame to a wheel angle, hand over hand, self-centring), controller grips with gloves added to the rig in `init3D`, `renderXR` (rig follows the car, mirror render targets every other frame, head-gaze detection for mirror and shoulder checks), `enterVR`, `recenterXR`. The frame loop runs through `renderer.setAnimationLoop(frame)`.
13. **Report**: `finish()` builds the Trafikverket-style report and saves the drive to progress.
14. **Quiz** (`QUIZ` array with inline SVG diagrams), **video drills** (`V`), **progress** (`renderProgress`).
15. **Test hook**: with `?test` in the address, `window.FDL_TEST` exposes `auto(on, timeScale, traffic)` (an autopilot that follows the Farsta route, gives way, stops at red and signals; `traffic` false clears AI traffic), `drive(gp)` (analogue input, `null` to stop), `act(a)`, `solve()` (puts the car on a parking exercise's target), `wheel()` (runs `wheelStep` with simulated hands), `state()` and `near()` (vehicles around the player, for debugging). The smoke test uses it.

## Farsta level (OpenStreetMap)

Pipeline: `tools/fetch-osm.mjs` (Overpass query for the `areas` in `tools/farsta.config.json`: all streets in some, main roads only in the road 73 corridor, buildings only around Farsta) → `data/farsta.osm.json` → `tools/osm-to-level.mjs` → `data/farsta.level.json` and `data/farsta.level.js` (`window.FDL_FARSTA=...`, loaded by a script tag so `file://` works). If the data file is missing, the Farsta card is disabled.

`src/osm-lib.js` is a plain script (works as a classic script and as an ES module import) that sets `globalThis.FDL_OSM`. It holds everything shared by the app, the preprocessor and the unit tests:
- `projector(lat0, lon0)`: `x = (lon - lon0) * cos(lat0) * 111320`, `y = -(lat - lat0) * 110540`. The origin is the test centre, found in the OSM data by its address.
- `simplify` (Douglas-Peucker), `tier(hw)` (road class), `defaultLimit(hw)`, `laneOffset(way)` (rightmost lane centre).
- `Net(level)`: the junction graph. Directed edge id `de` = `2 * edge` for a→b, `2 * edge + 1` for b→a (one-way ways are stored in their legal direction). Spatial grid for `nearest`, `nearestDe` (respects heading and one-way), `snapNode`. Routing: `route` (edge-based Dijkstra with turn costs, no U-turns except at dead ends), `routeVia`, `routeWaypoints`, `randomWalk` (AI), `generateRoute` / `generateFrom` (scored loops from the test centre). `pathPoints` builds a lane-centre polyline with rounded corners. `events` lists what happens along a route: `node` (turn, roundabout, motorway `exit` named from the slip road's `destination` tag, or `merge`, with `ctrl` = signals | stop | give_way | yield | right | major | unknown), `rbx` (roundabout exits passed), `rbout`, `light`, `zebra`, `bus`. `control` decides priority: tagged signs first, then a smaller road gives way to a bigger one, högerregeln between equal small streets, and `unknown` (not scored) between equal bigger roads. Traffic lights: `buildLights` finds each cluster's approaches, stop lines and two phase groups by direction; `lightState(cluster, group, t)`.

Custom routes in the config: waypoints are resolved by `resolveWaypoint` in `tools/osm-to-level.mjs` (road name or ref, heading for the carriageway, nearest roundabout or junction). Slip roads rank as tier 2 so the end of an off-ramp gives way.

`OSM` in `src/app.js`: `setRoute` turns a route into `this.path` (with `lim` and zone per point) and `this.ev` (events with path `s`); `checks` scores each event (signal and mirrors before turns, lane position, stop signs, give-way and högerregeln via `conflictAt`, roundabout entry yield via `ringConflict`, early and missing exit signals, red and amber, zebras with spawned pedestrians, the bus pulling out). Leaving the route reroutes (`reroute`) without a fault: it rejoins the planned route further on, or goes back to the test centre if it cannot. Lane changes on one-way roads with several lanes go through `laneChangeCheck`, except within 25 m of a junction. AI: `spawnAI` and `mkAI` put cars on random walks within 280 m; `aiDrive` handles curves, lights, roundabout entry, junction reservation (`reserve`, one car per unsignalled junction at a time), yielding to the player and pedestrians. Scripted conflicts: `spawnRing` (car already in the roundabout) and `spawnRight` (car from the right at an unmarked junction, `assert: true` so it keeps its priority). 3D: merged building mesh, traffic light heads with shared lamp materials, trees along the route corridor.

## Farsta roads: status and next steps

Done: the pipeline, the `OSM` level, the Farsta card with a route picker, attribution, unit tests and the smoke test (see above). The real map data is in `data/` (the user ran `npm run osm`; the cloud build environment cannot reach Overpass). The test centre is found by its address. After `npm run osm:build`, all seven routes build: the four exam-style ones (Huddinge exit and Lissmavägen, Vega, Norrby, towards Stockholm, 12 to 17 km) and three generated loops of 5 to 6 km. The test autopilot drives them on the real data (see `FDL_TEST.auto`), which is the quickest way to find geometry problems: run it without traffic and look for "Left the road" or serious faults.

Lessons from the real data: slip roads join the motorway centreline in OSM, so `pathPoints` moves into the right lane over 80 m after joining and back over 80 m before an exit; off-road checks use `Net.onRoad` (any road surface under the car), not only the nearest edge; högerregeln (`ctrl` right) only applies when a road actually joins from the right.

Next:
1. Drive the routes yourself in all views and check the directions against the real signs. The waypoint positions for the exam routes were placed from the real data, but the route between them is the shortest one.
2. Ask the user about more routes, for example Fagersjö's level crossing, Skarpnäck and old Enskede, which students also mention.
3. Turn restrictions (`restriction` relations) in routing, and `turn:lanes` for lane choice and lane-position scoring on multi-lane roads (currently not scored there).
4. Multi-lane roundabouts: lane choice by exit.
5. Left turns at lights: give way to oncoming traffic.
6. Keep the size in check: buildings are most of `data/farsta.level.json`. Drop or simplify them further if it grows past a few MB.

Things to get right for Swedish rules:
- Priority to the right (högerregeln) applies at junctions without signs.
- In roundabouts, traffic inside has priority (give-way at entry). Signal right before leaving.
- Buses leaving a stop must be let out where the limit is 50 km/h or lower.
- Pedestrians on or about to step onto a zebra crossing must be let across.
- Give cyclists a safe side margin when overtaking. The app uses 1.5 m, which is the usual guidance. Check current Trafikverket guidance before hard-coding a legal rule.

## Other ideas

- Make the hint and fault text available in Swedish as well.
- VR wheel: feel resistance with stronger haptics at speed, and show hand models instead of gloves.
- Parking: pedestrians walking in the car park, and reversing out of a bay.
- Night and rain variants, since visibility is part of "adjust speed to the circumstances".
- Import YouTube dashcam clips in video drills when hosted outside the claude.ai sandbox (the IFrame Player API works on GitHub Pages).
