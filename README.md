# HydroRational

**Version 0.9.0 beta.** The hydrology is validated and the test suite is
extensive, but the report format has not been checked against a run from
another program, and it has not been used on a live submittal. Treat results
as the responsibility of the engineer of record, as the report itself states.

Rational method hydrology on a map canvas, built to the 2026 County of
San Diego Hydrology Manual.

New to the project? Read [HANDOFF.md](HANDOFF.md) first.

Open `public/index.html` in a browser. No install and no build step. It
runs from a local file or from any web server. To host it, see
[SETUP.md](SETUP.md).

## What it does

Draw subcatchments, place nodes, connect them with flow paths, and the
peak flows fall out. Then export the plan check report.

- **Runoff coefficient** from Table 3-1, `C = 0.90 (% impervious) + Cp (1 - % impervious)`
- **Initial time Ti** from Table 3-2, interpolated on slope
- **Travel time Tt** per flow path, summed along the route, Section 3.1.4.2
- **Intensity** by log-log interpolation of NOAA Atlas 14, Section 3.1.3
- **Junction analysis** by the Section 3.4 equation, including all three notes
- **Hydrograph** by the Section 6 six hour nested storm
- **Detention routing** by Modified Puls storage indication
- **Report** as a node and station listing, text or PDF

Validated against SDHydroTools: Tc 10 min, A 20 ac, C 0.6 gives
Q 34.3 cfs, N 36 blocks, peak at 245 min, volume 49.30 ac-in.

## Rainfall

NOAA blocks browser requests, so the app does not fetch it directly.
Click **Open NOAA PFDS for this site**, download the CSV, then use
**Load NOAA CSV**. You can also drag the CSV onto the depth boxes or
paste the table into any of them. The design frequency dropdown decides
which ARI column is read, so one file covers every return period.

Deploy the function in `functions/` and this stops being manual. The page
probes its own origin on load, finds the proxy, and switches the automatic
buttons on by itself. **Auto-fetch NOAA Atlas 14** then pulls the rainfall for
the site coordinates, or for the centre of the map if none are set. See
[SETUP.md](SETUP.md).

## Terrain

Fetch USGS 3DEP for the current view, then load your own survey or proposed
grading on top of it. Higher priority surfaces win inside their footprint and
3DEP fills the rest of the tributary area.

Two things a file cannot tell us, so the panel asks: the horizontal CRS and
the vertical unit. 3DEP is a standing trap here, since it returns the raster
in whatever CRS you request but its elevations are always metres. Taken at
face value the ground reads 3.28 times too low.

Where a survey meets the base terrain there is a seam. A vertical mismatch
there creates a false ridge or sink that will push flow the wrong way once
delineation runs over it, so the panel reports the mean and worst difference
and warns past half a foot. Seam check draws the boundary cells.

Contours, terrain profiles with grade, and node elevations all read from the
composited surface.

## Delineation

With terrain loaded, **Delineate a watershed** turns a click at an outlet into
a subarea. The click snaps to the nearest channel, the boundary and area come
from the routed surface, and the hydraulically longest flow path is split into
an initial overland reach and the watercourse below it, each with its own
length and slope. Those land straight on the Table 3-2 and Section 3.1.4.2
inputs. The traced route is drawn in two colours so the numbers can be checked
against something visible.

Anything you then type is yours. Each field records whether it came from the
terrain, was edited, or was entered by hand, and **Re-run delineation** applies
fresh terrain values only to the fields you have not touched. An edited
boundary is never overwritten. The panel states the provenance, and it is
saved with the project.

**Channels** draws the flow network above whatever contributing area you set,
which is a quick way to check that the surface is routing sensibly before
trusting a delineation.

## Existing and proposed

A study needs two states. The toolbar carries a scenario selector, and
**+ Proposed** copies existing conditions so only the changes have to be drawn.
Each scenario keeps its own subareas, nodes, flow paths and terrain stack, with
the rasters held once and shared rather than duplicated.

Load the graded surface into the proposed scenario, re-run delineation, and the
**Pre / Post** tab gives peak discharge at every point of discharge with the
change and percentage. A point that exists in only one condition is flagged
rather than dropped. The same table goes into the report, which also states
which condition the listing describes.

## Basin storage from the ground

A graded basin is a depression in the proposed surface, so the stage-storage
table does not need typing. **Read storage from the terrain** floods the
depression at the basin node from its low point and returns storage against
elevation, the floor, and the spill elevation, which is where the emergency
weir belongs. One button sets the weir crest to it.

It stops at the real rim. If the pond crosses a saddle into lower ground that
saddle is the spill, not whatever lies beyond it. If the depression runs off
the edge of the loaded terrain, or the depth limit is reached first, it says so
rather than reporting a rim that is not there.

The table feeds the Modified Puls routing already in the app, and anything you
then edit is kept.

## Percent impervious, and the drawing

**Sample percent impervious from NLCD** takes about thirty points across the
subarea and averages them, then C follows. MRLC serves the impervious layer
with open CORS but not as a coverage, so this is a sample rather than an exact
area weighting, and it is reported that way: the point count and the spread
come back with the mean. Anything you type afterwards is kept.

**Export the drawing as DXF** writes the subareas, flow paths, nodes, pond
outlines, contours and labels as AutoCAD R12 on separate layers, in the working
coordinate system, so it lands on the survey rather than needing to be placed.

## Accounts

On the hosted version every visitor is signed in anonymously the moment the page
opens, and their work saves to the cloud a few seconds after each change. There
is no signup to get started.

To keep projects across browsers, enter an email in the Account panel and open
the link it sends. That links the address to the same account, so the guest
projects are simply still there. If the address already has an account from
another computer, the projects from this browser are copied into it.

Each person can read and write only their own projects, enforced by
`firestore.rules`. Projects are stored as a small header plus the project split
across chunk documents, because Firestore caps a single document at 1 MiB and a
survey surface can be larger than that.

Opened as a local file, accounts stay off and saving is by download, as before.

## Files you can bring

- Shapefile as a `.zip` holding the shp, dbf and prj. State Plane is
  reprojected to WGS84 automatically.
- GeoJSON, KML, KMZ
- Terrain as a GeoTIFF, an ESRI ASCII grid, or x,y,z survey points
- A saved `.json` project

Survey and proposed surfaces are saved inside the project file, quantised to a
hundredth of a foot, because they are the one thing you cannot get back. 3DEP
is stored as a footprint only and re-fetched on demand, which keeps the file
small.

Any of them can be dropped straight onto the map.

## Samples

| File | Use |
|---|---|
| `samples/PF_Depth_English_PDS.csv` | NOAA depths, load in the Rainfall tab |
| `samples/basins_sp6.zip` | shapefile in California State Plane zone 6 |
| `samples/subs.geojson` | two subcatchment polygons |
| `samples/site.kml` | study area and an outfall |
| `samples/site_dem.asc` | ASCII grid DEM for node elevations |
| `samples/alpine_3dep.tif` | real 3DEP tile in State Plane, used by the tests |
| `docs/sample_report.pdf` | example of the exported report |
| `samples/unconnected_project.json` | a project with subareas not yet joined to nodes |

## Keyboard

`S` select, `P` subcatchment, `J` junction or node, `B` basin,
`O` outfall, `L` link or flow path, `Delete` remove the selection,
`Enter` run the analysis, `Esc` back to select.

## Tests

540 checks across twenty four suites, run against `public/index.html` in a real
DOM with Leaflet loaded.

    cd tests && npm install && npm test

They cover the layout markup, the chart, saving and reopening, layer
order, the node and station report, detention routing, the junction equation and the
network accumulation, and GIS import including a State Plane shapefile.
Needs jsdom 30 or newer, which the package file pins.

## Layout

    public/index.html    the whole application
    src/terrain-core.js  terrain maths, inlined into the page and tested as a module
    src/flow-core.js     depression filling, D8 routing, watersheds, flow paths
    tests/               540 checks, run with npm test
    functions/           optional proxy for NOAA and SSURGO
    firestore.rules      each user reads and writes only their own projects
    samples/             example data for every import path
    docs/                example exported report
    firebase.json        hosting and function routing
    SETUP.md             GitHub and Firebase instructions
    HANDOFF.md           context for picking the project up

## Scope

This build covers the County of San Diego only.

## Known limits

- NOAA rainfall and SSURGO soils need the proxy function, see SETUP.md
- The node and station listing follows the block layout San Diego plan
  checkers are used to, not a published specification. Check
  `docs/sample_report.pdf` against a run you trust before relying on it.
- The manual prints Note 3 as `I = sum(CA)/Q`. Since `Q = sum(CA) I`,
  that inverts to `I = Q/sum(CA)`, which is the form the app uses.
- Results remain the responsibility of the engineer of record.

## Licence

Copyright (c) 2026 Kiran Pallachulla. All rights reserved.
