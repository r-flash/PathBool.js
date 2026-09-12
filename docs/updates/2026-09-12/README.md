# Geometry correctness without work caps

Work on `fix/geometry-correctness`, based on `testing-revamp` at `780ecef`.
Validated code and bundles: `6e24ce4`. The branch has not been merged or released.

## Approach

Preserve the failing inputs and baseline artwork report, establish memory
containment, then repair termination, primitive geometry, intersections and
face construction in that order. Validate without deadlines before interpreting
normal test-mode timing failures. Keep the existing runtime dependency set.

The removed subdivision, intersection-pair, split-count and tangent-sampling
caps could silently discard geometry. Their replacements stop on geometric
criteria or representable parameter progress. Exhausting memory remains a
failure; it is not a reason to return a partial arrangement.

## Repairs

- Smooth SVG commands use a reflected control point only after a command from
  the matching curve family.
- Cubic self-intersections are solved once per original segment. Rechecking
  their children had repeatedly rediscovered a rounded endpoint and grown the
  edge array without bound. Subdivision uses a depth-first work list.
- Positive arc radii retain SVG radius correction, however small their specified
  value. Sampling and splitting no longer flatten genuine tiny curves. Arc
  bounding-box padding follows arithmetic scale instead of a fixed distance.
- Distant geometry is translated toward the origin during construction.
  Canonical shared endpoints close the output exactly. Broad-phase bounds cover
  the endpoint neighborhood accepted by the intersection solver.
- Collinearity checks include displacement, not just parallel direction.
  Line/Bézier roots are isolated between derivative extrema. Circular arc
  intersections preserve the second crossing beside a shared endpoint.
  Polynomial contact refinement solves both curve parameters and distinguishes
  nearby roots using their numerical conditioning. Parameter tolerances also
  follow a bound on segment speed: a fixed parameter cutoff had discarded a
  crossing a full unit from the endpoint of a long line in a retained fuzz seed.
- Polynomial leaf pairs use derivative ranges to certify when they can cross
  at most once. Ambiguous pairs subdivide further to the point resolution.
  Artwork `commons-8667810/00` had a second crossing hidden beside a shared
  endpoint by the old chord approximation; the missing cut corrupted its faces.
- Minor-graph chains preserve traversal direction and per-input winding. A
  degree-two vertex is collapsed only when those windings agree across it.
  This also repairs the regressions retained from issue #3.
- Face orientation uses analytic area about a local origin, with compensated
  sums and a stable short-arc formula. Component containment checks bounds.
- Angular ordering places its branch cut away from outgoing tangents and uses
  analytic curvature and curvature derivatives to distinguish cubic contacts.
  Shared leading control points also provide an exact departure comparison.
  Development builds check Euler's planar-graph identity: one positive-area
  face alone did not prove that the traced arrangement was planar.
- Resolved short edges constrain endpoint merging: each endpoint's merge radius
  is below half its incident edge lengths. The radii are shared by coordinate,
  including separately allocated copies of an input endpoint. Splitting retains
  cuts down to arithmetic precision, so one curve cannot discard a crossing
  retained by the other. Polynomial coincidence checks use their evaluation
  error scale; subdivision resolution remains separate. Approximate arc contacts
  retain their own cut and merge tolerance. This repairs the dense
  near-endpoint intersections in `commons-48353204/05`.
- Exact shared polynomial endpoints are included as roots. The line/Bézier
  distance calculation also preserves exact endpoint incidence instead of
  introducing a residual through normalization.
- Nesting uses a boundary vertex of each component. Distinct connected
  components do not intersect, so this identifies the containing face without
  searching for an interior sample in a tiny, sampled polygon. Arc subdivision
  preserves the supplied endpoints and shares the midpoint exactly; rebuilding
  those points through trigonometry had moved them across containment rays.
- Output restoration preserves signed winding when adding the coordinate
  offset rounds a thin region enough to reverse its area. The retained polygon
  reduction from `commons-8667810/00` changes from a negative face in local
  coordinates to a positive triangle after restoration. Reversing traversal
  retains the rounded boundary and relative winding of contours and holes;
  no face is discarded and no filled-region tolerance changes.

## Independent checks and references

The test area calculation remains separate from production area code. For short
arcs it uses quadrature instead of the production Taylor recurrence. Raster
checks retry thin, otherwise unjudgeable regions at higher resolution without
changing their boundary band or alpha tolerance. Cases still unjudgeable within
the renderer allocation budget remain failures.

Partition visual checks paint fills before strokes on both sides. Otherwise,
reordering the same regions changed pixels by painting over a shared boundary.
A separate regression verifies order independence and detection of a missing
internal boundary. No tolerance was loosened.

The `simple-08` division and fracture references omitted a real closing region.
An independent decimal intersection solve confirms it; the fixture README
records the parameters. The corrected references retain that region. The
`real-02` geometry references were not changed.

The new short-edge regression retains the existing area precision. The cubic
regression from issue #3 checks the same command structure and bounds coordinate
differences by floating-point arithmetic scale. The previous serialized-string
comparison rejected a control-point change of about five trillionths caused by
splitting and rejoining; it did not describe a changed filled region.

The circle/cubic contact-count test previously required fewer than twenty
segment-pair reports. Four shared vertices each belong to two arcs and two
cubics, contributing sixteen reports; four quadrant-midpoint contacts bring
the exact total to twenty. The test now requires that total as well as the
original eight distinct contact positions. Preserving arc endpoints exposed
the incorrect bound by restoring the missing endpoint incidences.

Untimed runs snapshot their workers and shared geometry helper, record each job
before starting it, and reject stale resume results. A systemd service contains
JavaScript and native renderer allocations together without containing the IDE.
A deliberate allocation exhaustion test killed only that service.

Large partition rendering then exposed a real resource failure under that
limit. Releasing inactive builds and completed oracle caches reduced retained
geometry. Native renderer wrappers additionally needed collection and an event
loop turn between batches so N-API finalizers could release their canvases.
Both large cap-affected artworks completed every check after that repair under
the same memory limit, including in the final corpus sweep.

Partition rendering also reuses the SVG frame after removing the original paths.
Reparsing a large source drawing for every face had repeated the same work
thousands of times. A CPU profile then showed most sampled time in garbage
collection. Partition checks now serialize the output and release
the graph and segment arrays before rendering; a later operation rebuilds the
arrangement if needed. Each face is still rendered and checked at the same size.
Dense-artwork partition checks still took roughly ten to thirteen minutes each
in the final sweep. No performance bound follows from these repairs.

## Validation record

All results below use the final output-restoration repair. Corpus validation
ran without deadlines in services capped at 2 GiB with swap disabled. The final
runs completed without resource exhaustion. Coverage verification also checked
that the recorded workers and shared geometry helper match the final build.

- Complete Jest run: 21 suites, 10,138 tests passed.
- Final-build untimed generated corpus: 424 cases, no failures; 12,384 checks
  passed and 256 existing open-path checks were excluded by fixture metadata.
  All generated expected-failure entries were removed only after corresponding
  passing results.
- Complete pinned artwork corpus: 1,857 pairs, 51,996 checks; 45,788 passed,
  6,208 existing open-path checks excluded by fixture metadata, no failures or
  missing jobs. These exclusions preserve inputs whose filled-region contract
  is not established; they are not new exceptions for repaired cases.
- Corpus tooling: 18 tests passed, including snapshot loading, unfinished-job
  replay, stale resume rejection and synchronous timeout recovery.
- TypeScript and formatting checks passed. The TypeScript project now excludes
  generated build declarations, which previously broke type checking after a
  fuzz build.
- Previously failing representative artworks, including the cow and bee, pass
  the independent structural, area and raster checks.
- The mammal-tree structural and orientation failures and the previously
  unjudgeable thin intersection now pass. The artwork expected-failure list is
  empty; entries were removed from observed final-build results.
- The large cap-affected artworks `commons-141391608/00` and
  `commons-19544924/01` passed every untimed check.
- All 80 existing fuzz seeds passed after repairing the mixed-scale crossing.
- Full and core ESM/UMD bundles and the docs bundle were rebuilt and passed
  public-API checks for mixed-scale intersections and partitioning; the full
  bundles also passed a smooth-command parsing check.

Detailed job logs remain in `.cache/path-bool/`: `restored-generated.jsonl`,
`artwork-restored-0.jsonl`, `artwork-restored-1.jsonl`, `restored-artwork.jsonl`
and `restored-fuzz.jsonl`. `restored-validation.log` contains the Jest, tooling,
type and bundle checks; `restored-artwork-final-summary.json` records complete
artwork coverage. Downloaded artwork and the original report are not committed.
Normal tests still retain their timing budgets. A passing correctness check
does not establish a performance bound.
See [untimed correctness checks](../../../TESTING.md#untimed-correctness-checks)
for commands, containment requirements and result interpretation.
