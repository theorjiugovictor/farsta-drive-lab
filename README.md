# Farsta Drive Lab

Practice for the Swedish driving test (körprov B). The app trains the skills the examiner grades: anticipation ("förutse och bedöma"), speed and positioning, attention and interaction with other road users. It scores every drive and writes a report in the same format as Trafikverket's result email.

It runs in any modern browser, and in VR on Meta Quest.

## What is in it

**Drive practice.** Three scenarios, each built around a common reason people fail:

| Scenario | What it trains |
| --- | --- |
| Roundabout | Lane position for your exit, giving way to the left, zebra crossings, signalling out |
| Motorway exit | A slow truck with a tight queue ahead. Overtake or stay, lane changes with checks, braking in the exit lane |
| Country road | Bends, a cyclist with oncoming traffic, a car pulling out of a side road, a bus leaving its stop in a 50 zone |

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

## Tests

```bash
npm install
npx playwright install chromium
npm test
```

The smoke test drives every scenario in every view in headless Chromium with software WebGL, saves screenshots to `tests/output/` and fails on any page error.

## Layout

```
index.html        markup
src/styles.css    styles and theme tokens
src/app.js        everything else: physics, scenarios, scoring, rendering, VR, quiz, video drills
tests/smoke.mjs   headless smoke test
CLAUDE.md         architecture notes and the OpenStreetMap roadmap, for Claude Code
```

## Roadmap

The scenarios are generic Swedish road types, not Farsta's real streets. The next step is to build them from OpenStreetMap data around the Farsta test centre. See `CLAUDE.md` for the plan.

## Disclaimer

This is a training aid, not an official Trafikverket tool. The scoring follows the categories in Trafikverket's result reports, but the real examiner's judgement is what counts. Practice in a real car with a teacher as well.
