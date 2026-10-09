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
| Parking and reversing | Parallel parking (fickparkering), reversing into a bay, reversing around a corner (backa runt hörn). Scored on looking around before and while reversing, kerb contact, speed, the final position (straight, centred, close to the kerb) and the number of corrections |
| Farsta (real roads) | The streets around Trafikverket's test centre at Fryksdalsbacken 20, built from OpenStreetMap. Pick a route and follow the spoken-style directions ("In 200 m, at the roundabout, take the 2nd exit"). Scored on turns, roundabouts, traffic lights, zebra crossings, give-way and högerregeln junctions, buses leaving stops and speed limits, with AI traffic all around |

**Coach** mode shows hints and faults as you drive. **Test** mode stays silent and gives you the report at the end.

**Views:** Driver (from the driver's seat, with mirrors and shoulder checks), Chase (just behind the car) and Map (from above).

**Positioning quiz.** Twelve diagram questions on where to place the car and why.

**Video drills.** Load a dashcam clip, tag the hazards, then drill: tap the moment you spot each one (earlier scores higher) and answer how you would adjust speed and position.

**Progress.** Tracks which fault categories keep coming back and tells you what to focus on next. Stored in the browser's local storage.

## Controls

| Action | Keyboard | Gamepad (standard) | Meta Quest controllers (VR) |
| --- | --- | --- | --- |
| Steer | Left / Right arrows | Left stick (a USB steering wheel works too) | Hold the steering wheel with the grips and turn it, or use the left thumbstick |
| Gas | Up arrow | Right trigger | Right trigger |
| Brake | Down arrow | Left trigger | Left trigger |
| Signal left / right | Q / E | LB / RB | Left thumbstick down / up (the stalk), or a grip away from the wheel |
| Mirrors | W (hold) | Y | Look at a mirror. B also works |
| Shoulder check | A / D (hold) | X / B | Turn your head |
| Look back through the rear window | S (hold) | Right stick click | Turn your head right round |
| Gear D / R (when stopped) | R | Back / Select | Right stick: forward D, back R |
| Hold speed | C | A | A |
| Start or pause | Space | | X |
| Change view | V | | |
| Recenter seat | | | Y |

## Using it on Meta Quest

1. Open the GitHub Pages address of this repo in the Meta Quest browser.
2. Sit down and press **Drive in VR**.
3. Press Y to recenter your seat if the view is offset.

In VR the app follows your head. Looking into the rear-view or a side mirror counts as a mirror check, turning your head past about 60 degrees counts as a shoulder check, and turning it right round counts as looking back through the rear window, so you train the real movements.

**Steering wheel.** Put a hand on the rim of the wheel in the cockpit and hold the grip button: the controller buzzes and your hand appears on the rim, turning with the wheel. Turn it to steer. With both hands on, the wheel follows the line between your hands, like a real one. You can let go with one hand and take a new grip (hand over hand). While you hold it you feel a light rumble that grows with speed and steering, and a knock at full lock. Let go with both hands and the wheel straightens itself, faster at speed. Push the left thumbstick and the app goes back to stick steering.

How far the wheel turns is a setting under Meta Quest on the page: like a real car (about one and a quarter turns each way), quicker (about three quarters of a turn) or fast (about half a turn). Without the resistance of a real wheel, a quicker setting can feel more natural in VR.

VR does not start inside the claude.ai artifact preview, because that page runs in a sandboxed frame. Use the GitHub Pages site.

## Run locally

It is a static site with no build step.

```bash
npm start            # serves the folder on http://localhost:8080
```

To test on a Quest over your local network, WebXR needs HTTPS. GitHub Pages provides that. Locally you can use a tunnel such as `npx localtunnel --port 8080`.

## Farsta map data (OpenStreetMap)

The Farsta scenario uses map data in `data/`, built from OpenStreetMap. To refresh it (for example after changing the areas or routes), run:

```bash
npm run osm          # = npm run osm:fetch && npm run osm:build
```

- `tools/fetch-osm.mjs` asks the Overpass API for drivable roads, signals, crossings, give-way and stop nodes, bus stops, sign nodes and buildings in the areas set in `tools/farsta.config.json`, and saves the raw answer to `data/farsta.osm.json`. The areas are Farsta with Larsboda, Fagersjö, Hökarängen and Skarpnäck, old Enskede, Länna and Lissmavägen in Huddinge, Vega and Norrby in Haninge (all streets), and the main roads along Nynäsvägen (road 73) from Stockholm to Haninge.
- `tools/osm-to-level.mjs` turns that into `data/farsta.level.json` and `data/farsta.level.js` (the same data as a script, so the app also works from `file://`). It projects to metres around the test centre, builds the junction graph, simplifies the roads, places signs and traffic lights, and generates three practice routes that start and end at the test centre.

The app never calls Overpass itself. Commit the files in `data/` so GitHub Pages serves them.

**Routes.** Four exam-style routes come from what students report about Farsta tests (Trafikverket does not publish routes, and they change):

- Nynäsvägen south, exit towards Huddinge at Länna, out on Lissmavägen (country road), back on road 73
- Nynäsvägen to Vega (roundabouts, the 40 road past Bauhaus)
- Nynäsvägen to Norrby
- Nynäsvägen towards Stockholm, back through Hökarängen

Waypoints in `tools/farsta.config.json` name a road (`"road": "73"`, `"Lissmavägen"`), a driving direction for the right carriageway, or the nearest roundabout or junction to an approximate point, so they do not depend on exact coordinates. The build warns about any waypoint it cannot match. Check each route on the Map view after the first build and adjust the waypoints if one goes the wrong way. Three more routes are generated automatically to cover roundabouts, lights, unmarked junctions, zebra crossings and bus stops near the test centre, and the app also offers a random route.

On Nynäsvägen the app scores joining (signal left, shoulder check, speed), lane changes (signal, mirrors, shoulder check, blind spot) and exits (signal and mirrors), and gives directions such as "In 400 m, take the exit towards Huddinge" from the exit's destination sign.

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
