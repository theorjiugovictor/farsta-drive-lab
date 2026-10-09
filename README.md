# Farsta Drive Lab

Practice for the Swedish driving test (körprov B). The app trains the skills the examiner grades: anticipation ("förutse och bedöma"), speed and positioning, attention and interaction with other road users. It scores every drive and writes a report in the same format as Trafikverket's result email.

It runs in any modern browser, and in VR on Meta Quest.

## What is in it

**Drive practice.** Three generic scenarios, each built around a common reason people fail, plus the real streets around the Farsta test centre:

| Scenario | What it trains |
| --- | --- |
| Roundabout | Lane position for your exit, giving way to the left, zebra crossings, signalling out |
| Motorway exit | A slow truck with a tight queue ahead. Overtake or stay, lane changes with checks, braking in the exit lane |
| Country road | Bends, a cyclist with oncoming traffic, a car pulling out of a side road, a bus leaving its stop in a 50 zone |
| Farsta (real roads) | The streets around Trafikverket's test centre at Fryksdalsbacken 20, built from OpenStreetMap. Pick a route and follow the spoken-style directions ("In 200 m, at the roundabout, take the 2nd exit"). Scored on turns, roundabouts, traffic lights, zebra crossings, give-way and högerregeln junctions, buses leaving stops and speed limits, with AI traffic all around |

**Coach** mode shows hints and faults as you drive. **Test** mode stays silent and gives you the report at the end.

**Views:** Driver (from the driver's seat, with mirrors and shoulder checks), Chase (just behind the car) and Map (from above).

**Positioning quiz.** Twelve diagram questions on where to place the car and why.

**Video drills.** Load a dashcam clip, tag the hazards, then drill: tap the moment you spot each one (earlier scores higher) and answer how you would adjust speed and position.

**Progress.** Tracks which fault categories keep coming back and tells you what to focus on next. Stored in the browser's local storage.

## Controls

| Action | Keyboard | Gamepad (standard) | Meta Quest controllers (VR) |
| --- | --- | --- | --- |
| Steer | Left / Right arrows | Left stick | Left thumbstick |
| Gas | Up arrow | Right trigger | Right trigger |
| Brake | Down arrow | Left trigger | Left trigger |
| Signal left / right | Q / E | LB / RB | Left grip / right grip |
| Mirrors | W (hold) | Y | Look at a mirror. B also works |
| Shoulder check | A / D (hold) | X / B | Turn your head |
| Hold speed | C | A | A |
| Start or pause | Space | | X |
| Change view | V | | |
| Recenter seat | | | Y |

## Using it on Meta Quest

1. Open the GitHub Pages address of this repo in the Meta Quest browser.
2. Sit down and press **Drive in VR**.
3. Press Y to recenter your seat if the view is offset.

In VR the app follows your head. Looking into the rear-view or a side mirror counts as a mirror check, and turning your head past about 60 degrees counts as a shoulder check, so you train the real movements.

VR does not start inside the claude.ai artifact preview, because that page runs in a sandboxed frame. Use the GitHub Pages site.

## Run locally

It is a static site with no build step.

```bash
npm start            # serves the folder on http://localhost:8080
```

To test on a Quest over your local network, WebXR needs HTTPS. GitHub Pages provides that. Locally you can use a tunnel such as `npx localtunnel --port 8080`.

## Farsta map data (OpenStreetMap)

The Farsta scenario needs map data, which is not in the repository yet. Build it once:

```bash
npm run osm          # = npm run osm:fetch && npm run osm:build
```

- `tools/fetch-osm.mjs` asks the Overpass API for drivable roads, signals, crossings, give-way and stop nodes, bus stops, sign nodes and buildings in the box set in `tools/farsta.config.json`, and saves the raw answer to `data/farsta.osm.json`.
- `tools/osm-to-level.mjs` turns that into `data/farsta.level.json` and `data/farsta.level.js` (the same data as a script, so the app also works from `file://`). It projects to metres around the test centre, builds the junction graph, simplifies the roads, places signs and traffic lights, and generates three practice routes that start and end at the test centre.

The app never calls Overpass itself. Commit the files in `data/` so GitHub Pages serves them.

**Routes.** The generated routes are loops picked to cover roundabouts, traffic lights, unmarked junctions, zebra crossings and bus stops. They are not the examiners' routes. If your driving school tells you which roads the Farsta examiners use, add them to `routes` in `tools/farsta.config.json` as a name and a list of `[lat, lon]` waypoints, then run `npm run osm:build` again. The app also offers a random route.

**What the data cannot tell.** OpenStreetMap often lacks give-way signs. Where none is mapped, the app assumes that a smaller road gives way to a bigger one, applies högerregeln between equal small streets, and does not score priority between equal bigger roads. Traffic light timings are made up (two phases, about 36 seconds). Turn restrictions and lane arrows are not used yet.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License. The app shows this credit whenever the Farsta scenario is open.

## Tests

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` runs two things:

- `tests/osm.test.mjs`: unit tests for the projection, simplification, conversion, snapping to the road graph, routing and route events, on a small synthetic network in `tests/fixtures/mini.osm.json` (made up for testing, not real map data; regenerate it with `npm run fixture`).
- `tests/smoke.mjs`: drives every scenario in every view in headless Chromium with software WebGL, lets an autopilot drive a whole Farsta route at ten times speed, saves screenshots to `tests/output/` and fails on any page error. Without `data/farsta.level.js` it uses the synthetic network for the Farsta scenario.

## Layout

```
index.html                markup
src/styles.css            styles and theme tokens
src/app.js                everything else: physics, scenarios, scoring, rendering, VR, quiz, video drills
src/osm-lib.js            road graph, routing and route events, shared by the app, the tools and the tests
tools/farsta.config.json  map area, test centre address, custom routes
tools/fetch-osm.mjs       downloads OpenStreetMap data
tools/osm-to-level.mjs    builds the Farsta level from it
data/                     map data for the Farsta scenario (after npm run osm)
tests/                    unit tests, smoke test, synthetic fixture
CLAUDE.md                 architecture notes, for Claude Code
```

## Disclaimer

This is a training aid, not an official Trafikverket tool. The scoring follows the categories in Trafikverket's result reports, but the real examiner's judgement is what counts. Practice in a real car with a teacher as well.
