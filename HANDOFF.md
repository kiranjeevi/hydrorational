# HydroRational, handoff brief

Read this first. It is written for whoever picks the project up next,
including a future session with no memory of how it got here.

## What it is

A browser application that performs rational method hydrology to the 2026
County of San Diego Hydrology Manual and exports a plan check report. It is a
single file, `public/index.html`, about 320 KB, with no build step. It runs
from a local file or from any web server.

Scope is San Diego County only. Other jurisdictions were deliberately dropped.

## Ground rules

- **No em dashes anywhere.** Code, comments, UI text, reports, documentation,
  commit messages. Use commas, periods or parentheses. The CI workflow fails
  the build if one appears.
- **Blue accents only.** Navy and sea blue such as `#2E86C1`. No gold or yellow
  for headings or accents in any document or export.
- **Run the tests before and after every change.** `cd tests && npm test`.
  540 checks across 24 suites, all passing. A change that breaks one is wrong
  until proven otherwise.
- **Hydrology never changes to suit a feature.** The manual is the authority.

## Architecture

    public/index.html      the whole application
    src/terrain-core.js    grid model, ingestion, composite, contours, profiles
    src/flow-core.js       depression filling, D8, watersheds, flow paths, pond fill
    functions/index.js     proxy for NOAA and SSURGO, Firebase Cloud Function
    tests/                 21 suites, run with npm test
    samples/               data for every import path
    docs/sample_report.pdf example export

`src/*.js` are inlined into `public/index.html` between BEGIN and END markers
so the app stays one file while the maths stays testable in node. **Suite 12
asserts the two copies are byte identical.** If you edit the maths, edit the
source file and re-inline, never the copy in the page.

## What is built

Hydrology, all validated against the manual:
C from Table 3-1, Ti from Table 3-2, Tt per watercourse type summed along the
route, intensity by log-log interpolation of NOAA Atlas 14, the Section 3.4
junction equation with all three notes, network accumulation node to node, the
Section 6 six hour hydrograph, and Modified Puls detention routing.

Benchmark against SDHydroTools: Tc 10 min, A 20 ac, C 0.6 gives Q 34.3 cfs,
N 36 blocks, peak at 245 min, volume 49.30 ac-in. Suite 02 pins this.

Terrain and delineation:
3DEP fetch, survey and proposed surfaces on top of it, seam reporting, contours,
profiles, one click watershed delineation, traced longest flow path split into
overland and watercourse with slopes off the ground, basin stage-storage read
from a graded surface, and a provenance model so terrain derived values never
overwrite anything you typed.

Data in and out:
NOAA CSV by file, drag or paste. Shapefile with State Plane reprojection,
GeoJSON, KML, KMZ, ASCII grid and x,y,z DEMs. Existing and proposed scenarios
with a pre and post discharge comparison. Report as text or PDF. DXF export.
NLCD impervious sampling. Project save and open at format 3.

Accounts:
anonymous sign in on load, cloud save split into chunks under the Firestore
document limit, autosave fifteen seconds after an edit, and email link upgrade
that keeps the same account. `firestore.rules` restricts each user to their own
projects. Tested against `tests/fake-firebase.js`, which enforces both the size
limit and the rule.

## Things that will bite you

- **3DEP elevations are metres**, whatever horizontal unit you request. A tile
  over Alpine reads 517 to 579 on ground near 1800 ft. Suite 11 asserts that
  reading it as feet is wrong.
- **Zero is a valid input.** `parseInt(v) || fallback` silently discarded land
  use index 0, so Natural open space could never be selected. Do not reintroduce
  that pattern. Use the `fieldNum` helper.
- **jsdom gaps are not app bugs.** JSZip needs `setImmediate`, geotiff touches
  `Worker`, and neither exists in jsdom. The shims live in the test files only.
  Do not add them to the app.
- **Buffers must be allocated in the page realm** in tests, or JSZip rejects
  them. Use `new w.Uint8Array(...)`, not Node's Buffer.
- **A seam between survey and 3DEP steers flow.** The composite reports mean
  and worst vertical difference and warns past half a foot. Take it seriously
  before delineating.
- **`toWorkingXY` returns `[x, y]`, `cellCentre` returns `{x, y}`.** Mixing
  them produces NaN that passes bounds checks, because NaN comparisons are
  false.
- **Auth callbacks can re-enter.** Starting anonymous sign in and then setting
  the user to null let a fast sign in land first and get overwritten. Clear
  state before starting an async call that may call you back.
- **A test that returns `true` unconditionally is not a test.** Three had crept
  in. Suite runs now contain none.
- **HTML nesting is not covered by a syntax check.** Two stray `</div>` tags
  once put the properties panel outside the flex row while 197 tests passed.
  Suite 01 now asserts the DOM tree.

## Open items

1. **Deploy.** Not pushed to GitHub or Firebase yet. Accounts need Anonymous
   and Email link sign-in enabled in the console, see SETUP.md. `SETUP.md` has the three
   commands. Hosting runs on the free plan. The proxy function needs Blaze
   because it calls hosts outside Google.
2. **Name.** Undecided. Studio names are out, Hydrology Studio and Stormwater
   Studio are existing competitors. StormQ with `Q = CIA` as the tagline was the
   suggestion.
3. **Verify the report format** against a run you trust. The node and station
   listing follows the block layout San Diego reviewers expect, not a published
   specification.
4. **Note 3 in Section 3.4** is printed in the manual as `I = sum(CA)/Q`. Since
   `Q = sum(CA) I` that inverts to `I = Q/sum(CA)`, which is what the app uses.
   Worth confirming before a submittal leans on it.
5. Not built: FEMA base flood elevation lines, LAS and DXF terrain import,
   terrain editing inside the app.

## How to verify a change

    cd tests && npm test

Suites are numbered by area. When fixing a bug, add the test that would have
caught it before fixing the code. Several bugs here were found only because a
test asserted something arithmetic rather than plausible: a plane must route
exactly east, a box basin must store area times depth, a cone must fill as the
cube of depth.

When a test fails, check whether the test or the code is wrong. On this project
roughly half the failures were bad test fixtures, and finding that out was
worth more than the passing count.
