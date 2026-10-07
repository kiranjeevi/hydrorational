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
  726 checks across 31 suites, all passing. Run `npm install` in tests first;
  the runner now fails any suite that crashes or reports nothing. A change that breaks one is wrong
  until proven otherwise.
- **Hydrology never changes to suit a feature.** The manual is the authority.

## Architecture

    public/index.html      the whole application
    src/terrain-core.js    grid model, ingestion, composite, contours, profiles
    src/flow-core.js       depression filling, D8, watersheds, flow paths, pond fill
    functions/index.js     proxy for NOAA and SSURGO, Firebase Cloud Function
    tools/inline-core.js   copies src/*.js into the page: node tools/inline-core.js
    tests/                 31 suites, run with npm test; fixtures builders in tests/lib
    samples/               data for every import path
    docs/sample_report.pdf example export

`src/*.js` are inlined into `public/index.html` between BEGIN and END markers
so the app stays one file while the maths stays testable in node. **Suite 12
asserts the two copies are byte identical.** If you edit the maths, edit the
source file and re-inline with `node tools/inline-core.js`, never the copy in
the page.

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

Terrain sources and edits:
DXF (ASCII) with a layer chooser, utility layers unticked by default and flat
2D linework skipped. LAS 1.0 to 1.4, ground class 2 only, CRS and vertical
unit read from GeoKeys or WKT, binned and gridded through a trimmed TIN. LAZ
is refused with the fix. UTM 11N and NAD83(2011) zone 6 are known. Grading
edits: a pad or basin at an elevation that daylights at H:1, or a footprint
raised or lowered, each as its own layer above the stack with cut and fill.

Existing and proposed workflow:
The toolbar switch reads Existing | Proposed. Once a project has a name,
address or drawn elements, the right panel shows the project and the pre and
post discharge table instead of the getting started cards. Reports cover
existing, proposed or both (asked once, remembered); the comparison prints
once at the end. Boundary editing touches subarea polygons only and ends with
the button, Done, Enter, double click or right click; Cancel or Esc reverts.

Reference layers (none feed a calculation):
FEMA flood zones, BFE lines and cross sections with WSEL, NHD flowlines
(layer 3) and waterbodies, NWI wetlands, SSURGO soil groups through the
proxy, NLCD 2021 land cover.

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
- **Layers in other CRSs.** The composite used to union bounds and cells in
  each layer's own units, so a UTM or zone 5 layer vanished. Bounds and cell
  are now projected into the working CRS first. Suite 27 pins it.
- **Grading edits never write to the layers under them.** Removing the edit
  layer is the undo. Edit layers are excluded from the seam check.
- **Never run plain `git status` from the Linux shell** on this folder. It
  leaves a `.git/index.lock` it cannot remove, which blocks commits on
  Windows. Use `git --no-optional-locks status`.
- **Ids after opening a project.** `nextId` was not advanced past the saved
  layer ids, so a new layer could overwrite one from the file. Fixed, suite 29.
- **HTML nesting is not covered by a syntax check.** Two stray `</div>` tags
  once put the properties panel outside the flex row while 197 tests passed.
  Suite 01 now asserts the DOM tree.

## Open items

1. **Deploy.** Live at https://hydrorational.web.app, project `hydrorational`,
   on the Blaze plan since 2026-09-21. The proxy at /api/proxy is deployed and
   was checked on 2026-10-01 against NOAA Atlas 14 and NRCS Soil Data Access.
   Deploy with the Firebase CLI from this folder (SETUP.md); pushing to GitHub
   does not deploy. Work since the last deploy is uncommitted locally.
2. **Name.** Undecided. Studio names are out, Hydrology Studio and Stormwater
   Studio are existing competitors. StormQ with `Q = CIA` as the tagline was the
   suggestion.
3. **Verify the report format** against a run you trust. The node and station
   listing follows the block layout San Diego reviewers expect, not a published
   specification.
4. **Note 3 in Section 3.4** is printed in the manual as `I = sum(CA)/Q`. Since
   `Q = sum(CA) I` that inverts to `I = Q/sum(CA)`, which is what the app uses.
   Worth confirming before a submittal leans on it.
5. Built since the last brief: BFE lines, DXF and LAS import, grading edits,
   and the reference layers that were placeholder toggles. Next candidates:
   LAZ decompression in the browser, sloped pads, and reading Civil 3D
   LandXML surfaces.

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
