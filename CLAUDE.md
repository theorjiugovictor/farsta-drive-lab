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
6. **Physics**: `stepCar` is a kinematic bicycle model with speed-dependent steering limits. `act()` handles signals, mirror and shoulder checks, and hold speed. `mirrorAgo`, `lookLAgo` and `lookRAgo` are the seconds since the last check, and scoring reads them.
7. **AI**: `mkVeh` creates a vehicle that follows a path at arc length `s` with lateral offset `lat`. `updateAI` does car following, optional `hold` (stop at a point while a condition is true) and an optional per-vehicle `script`.
8. **Generic checks**: `genericChecks` covers speed limits and harsh braking. `laneChangeCheck` covers signal, mirrors, shoulder check and blind-spot occupancy.
9. **Levels**: `RB` (roundabout), `HW` (motorway exit), `CR` (country road), registered in `LEVELS`. The level interface:
   - `init(opts)`: build paths, spawn the player and AI, set `signs`, `hints`, `S.instr`
   - `step(dt)`: scenario-specific scoring, calls `finish()` at the end
   - `draw(g)`: draws the ground (roads, markings) in world metres on a 2D canvas. The 3D view reuses this as the ground texture, so anything drawn here shows up in every view.
   - `checkLimit()`, `hudLimit()`, `zone()`: the speed limit used for scoring, the one shown, and a zone id used to dedupe speeding faults
   - `ground` (colour), `title`, `signs: [{x, y, type, val}]` with types `limit | warn | giveway | mw | town | rb | bus | zebra`
   - `hints: [{when: () => bool, t: 'text'}]` for coach mode
10. **2D renderer** (Map view): `render`, `drawVeh`, `drawSign` and `drawSignFace`.
11. **3D renderer** (Driver and Chase views, three.js): `init3D`, `build3D` (per-level scenery: trees as InstancedMesh, houses, signs as sprites), `vehMesh`, `syncDyn` (keeps meshes in step with `S.ai` and `S.peds`), `updateGroundTex` (redraws `level.draw` into a 2048 px texture covering 280 m around a point ahead of the car), `render3D` (desktop mirrors use scissor viewports and a horizontally flipped projection, which is why scene materials are DoubleSide).
12. **VR**: `buildCockpit` (dashboard, pillars, steering wheel, mirror planes using render targets, dashboard display panel), `pollXR` (Quest controller mapping), `renderXR` (rig follows the car, mirror render targets every other frame, head-gaze detection for mirror and shoulder checks), `enterVR`, `recenterXR`. The frame loop runs through `renderer.setAnimationLoop(frame)`.
13. **Report**: `finish()` builds the Trafikverket-style report and saves the drive to progress.
14. **Quiz** (`QUIZ` array with inline SVG diagrams), **video drills** (`V`), **progress** (`renderProgress`).

## Next: real Farsta roads from OpenStreetMap

Goal: replace or complement the generic scenarios with drives on the real roads around the Trafikverket test centre in Farsta (look up the current address on trafikverket.se), so the user can rehearse the actual test area. Use OpenStreetMap data (ODbL, credit "© OpenStreetMap contributors" in the UI). Do not use Google Maps geometry: its terms do not allow extracting road data.

Suggested plan:

1. **Fetch data** with the Overpass API for a bounding box around Farsta (roughly Farsta centrum, Farsta strand, Larsboda and Nynäsvägen, road 73, as far as typical test routes go; ask the user which routes the examiners use). Query `way[highway]` with the tags `lanes`, `maxspeed`, `oneway`, `junction`, `turn:lanes`, and nodes with `highway=crossing|traffic_signals|give_way|stop|bus_stop`. Save the raw response to `data/farsta.osm.json` so the app does not hit Overpass at runtime.
2. **Preprocess** with a Node script (`tools/osm-to-level.mjs`) into `data/farsta.level.json`:
   - Project lat/lon to local metres around an origin: `x = (lon - lon0) * cos(lat0) * 111320`, `y = -(lat - lat0) * 110540` (y points south, to match the app).
   - For each way: centreline polyline, width from `lanes` (about 3.5 m per lane), speed limit, oneway, roundabout flag.
   - Junction graph: nodes shared by ways, with give-way and signal info.
   - Keep it under a few MB. Simplify polylines (Douglas-Peucker, about 0.5 m).
3. **Add an `OSM` level** that implements the level interface:
   - `draw(g)`: road surfaces as stroked polylines at road width, lane markings (dashed centre lines, edge lines), zebra crossings at crossing nodes, stop and give-way lines.
   - Routes: a route is a list of way and node ids, or simply a list of waypoints. Build the player's guidance path by snapping waypoints to the graph, and give spoken-style instructions ("Take the 2nd exit", "Turn left at the lights") at the right distances.
   - Scoring: reuse `genericChecks` and `laneChangeCheck`. Generalise the roundabout logic from `RB.step` to any `junction=roundabout` (entry yield, lane position for exit, exit signal), the junction logic from `CR.step` (anticipation near side roads), and add traffic-light compliance and priority to the right at unmarked junctions.
   - Traffic: spawn AI along random graph paths, with a simple junction reservation so cars do not drive through each other.
4. **Signs** from OSM tags (`maxspeed` changes, `traffic_sign` nodes where they exist).
5. **UI**: add a "Farsta" scenario card with a route picker, and show the OSM attribution.
6. **Tests**: extend `tests/smoke.mjs` to drive the OSM level, and add a unit test for the projection and path snapping.

Things to get right for Swedish rules:
- Priority to the right (högerregeln) applies at junctions without signs.
- In roundabouts, traffic inside has priority (give-way at entry). Signal right before leaving.
- Buses leaving a stop must be let out where the limit is 50 km/h or lower.
- Pedestrians on or about to step onto a zebra crossing must be let across.
- Give cyclists a safe side margin when overtaking. The app uses 1.5 m, which is the usual guidance. Check current Trafikverket guidance before hard-coding a legal rule.

## Other ideas

- Make the hint and fault text available in Swedish as well.
- Hands-on-wheel steering in VR (grab the 3D wheel with both controllers).
- Night and rain variants, since visibility is part of "adjust speed to the circumstances".
- Import YouTube dashcam clips in video drills when hosted outside the claude.ai sandbox (the IFrame Player API works on GitHub Pages).
