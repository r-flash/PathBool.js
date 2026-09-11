# Testing

Use Node.js and run commands from the repository root unless stated otherwise.
Install the development dependencies first:

```shell
npm ci
```

Commands containing `<...>` are templates; replace those placeholders before
running them.

Tests are run manually; the repository has no continuous-integration setup that
runs them automatically after a push.

## Running the automated tests

```shell
npm test
```

This runs tests of individual functions, regressions for reported bugs,
comparisons with saved SVG results, and checks over generated input paths.
Jest is the test runner; ts-jest lets it run tests written in TypeScript.
A test suite is a collection of tests, usually one file under `src/__tests__/`.

Before starting Jest, npm automatically runs the `pretest` script. It generates
the synthetic input paths and compiles copies of the library for tests that run
in separate processes. You do not need to generate those inputs or build the
library yourself when using `npm test`. This preparation also happens when
running only part of the tests. It requires no artwork downloads.

```shell
npm test -- src/__tests__/robustness-tests.ts # run one test file
npm test -- -t "symmetry"                     # run tests with matching names
npm test -- --runInBand                       # run test files one at a time
npm test -- --coverage                        # report which source code the tests execute
```

If you invoke Jest directly instead of using `npm test`, run `npm run pretest`
after source changes to refresh the generated inputs and compiled test code.

The following commands are separate from `npm test`. Their inputs and usage are
explained in their respective sections below.

| Command | What it does |
| --- | --- |
| `npm run test:artwork-corpus` | Checks boolean results for path pairs taken from downloaded SVG artwork |
| `npm run test:corpus-tools` | Tests the programs that generate inputs, collect artwork and run tests in separate processes |
| `npm run fuzz` | Changes path strings automatically, searching for crashes, hangs and excessive memory use |
| `npm run bench` | Measures the speed of boolean operations |

## Tests of individual functions and reported bugs

These tests use small, selected examples. Some check a geometry function
in isolation; others run a complete boolean operation to reproduce a previous
bug. They run directly against the TypeScript source.

The library represents path connectivity using graphs. It includes assertions:
checks that throw an error when an internal assumption is violated, such as an
edge missing its reverse edge. Some tests deliberately break those structures
to verify that the assertions detect them.

The following files are under [`src/__tests__/`](src/__tests__/):

| Test file | What it checks |
| --- | --- |
| `robustness-tests.ts` | Repeating an operation gives the same result; swapping inputs preserves union/intersection; empty inputs and retraced segments behave correctly. Path comparisons allow reversed direction and a different starting segment. |
| `shape-builder.test.ts` | `getFaces()` enumerates regions and `buildShape()` merges selected regions correctly, including holes, empty selections and invalid indices. |
| `invariants.test.ts`, `assertion-error.test.ts` | Assertions detect broken graph links and reverse-edge pairs, and produce the expected error type and message. |
| `arc-bounding-box.test.ts`, `cubic-bounding-box.test.ts` | Bounding boxes contain sampled curve points without being unnecessarily large. |
| `intersection-grouping.test.ts` | Duplicate reports of one crossing are merged; nearby distinct crossings stay separate. |
| `arc-and-winding-normalization.test.ts` | Equivalent arc parameters describe the same geometry; omitted arcs and opposite traversals cancel correctly. |
| `closed-loop-cubic.test.ts` | Curves that enclose a region survive sampling, splitting and boolean operations; curves that merely retrace a line disappear. |
| `scale-invariance.test.ts` | Scaling inputs across a range of sizes preserves operation areas after dividing by the scale squared. |
| `malformed-geometry.test.ts` | Collapsed geometry is distinguished from genuine tiny curves; checks of output paths detect degenerate segments and open loops. |

Inputs copied from reported issues are kept under
[`src/__fixtures__/reported-issues/`](src/__fixtures__/reported-issues/).
Some known-broken regression tests use Jest's `test.failing`. The test still
executes, but a failure is expected. If it starts passing, Jest fails the suite
to prompt removal of `.failing` when the bug is fixed.

## Comparing results with saved SVGs

The visual tests compare the library's result with a saved expected result.
Each test case has a directory, called a fixture, containing `original.svg`
and one expected SVG per operation: for example, `union.svg` for union.
The expected SVGs are committed to Git.

The collections are under `src/__fixtures__/`:

| Collection | Paths read from `original.svg` | Operations checked |
| --- | --- | --- |
| `visual-tests/` | Two paths with IDs `a` and `b` | union, difference, intersection, exclusion, division, fracture |
| `visual-tests-variadic/` | All path elements, passed to the library together | union, intersection, exclusion, fracture |

The second collection checks operations on more than two inputs. Each path's
CSS `fill-rule` determines how overlapping subpaths are filled: nonzero or
evenodd. The default is nonzero.

Both collections run through `src/__tests__/visual-tests.ts`:

```shell
npm test -- src/__tests__/visual-tests.ts
npm test -- src/__tests__/visual-tests.ts -t "variadic" # only the multi-input cases
```

The test uses resvg, an SVG-to-image renderer, to turn the computed and expected
results into pixels. At each pixel, the red, green, blue and alpha channel values
must agree within `TOLERANCE`, defined in `visual-tests.ts`. The number of
returned paths must also match the expected SVG. Computed SVGs and PNG renders
are written to the case's `test-results/` directory for inspection.

Successful two-input cases also save their input path strings in `fuzzing/corpus/`.
Those files are starting examples for the automatic input mutation described
in the fuzzing section.

### Adding or correcting a visual fixture

Create a case directory with `original.svg` and its expected operation SVGs.
Inkscape can generate missing expected SVGs. From either
`src/__fixtures__/visual-tests/` or `src/__fixtures__/visual-tests-variadic/`, run:

```shell
bash generate-ground-truth.sh
```

This invokes Inkscape's path operations and writes only missing references.
Inspect the results, especially for degenerate or nearly coincident geometry.

A second script replaces expected results with the library's last test output:

```shell
bash establish-ground-truth.sh
```

Run it from the same collection directory only after reviewing the renders and
confirming that the computed results are correct. It replaces references for
**every case** in that collection. Do not loosen tolerances or skip tests to
hide a mismatch.

## Checking collections of inputs without saved results

A *corpus* is a collection of test inputs. This repository uses paths created
by a deterministic generator and path pairs extracted from SVG artwork.
Neither collection has a saved expected SVG for each boolean operation.

Instead, tests check properties that a correct result must satisfy. Some inspect
output paths, some compare areas, and some compare rendered images. These checks
catch different kinds of errors; passing any one of them does not prove that a
result is correct in every respect.

The following subsections explain those checks. In examples, A is the first
input path and B is the second. The sections after them explain how to run the
checks on generated inputs and artwork.

### Structural checks: is the output a valid path?

The structural tests run a boolean operation and inspect the returned paths.
Coordinates must be finite, loops must close, and no segment may collapse
entirely to one point. The operation is repeated and must return identical data.

An empty result is valid. An empty path alongside nonempty paths is rejected,
because it indicates a selected region with no boundary. Exceptions and excessive
execution time are failures too.

These checks detect malformed output, but cannot detect a valid path outlining
the wrong region. They are implemented in `support/structural-oracle.ts` and
used by `corpus-structural.test.ts`, both under `src/__tests__/`.

### Algebraic checks: do the output areas agree?

The algebraic tests compute several operations on the same inputs, measure the
areas of their results, and compare mathematical relationships between them.
For example, the area of exclusion must equal the area of union minus the area
of intersection. Swapping A and B must preserve the areas of union,
intersection and exclusion.

Division and fracture return separate regions rather than one merged outline.
Together, division's regions should cover A; fracture's should cover the union.
The tests compare sums of region areas with the corresponding combined results.
They also compare the sorted areas of fracture regions after swapping inputs,
check that regions have consistent boundary directions, and require component
areas not to exceed the union's area.

Area is calculated by separate test code using Green's theorem, which integrates
along each segment. It does not ask the boolean implementation to measure its
own output. The relative tolerance is defined by `AREA_TOL_REL` in
`src/__tests__/support/algebraic-oracle.ts`. `corpus-algebraic.test.ts` checks this
area calculation against shapes with known areas and a deliberately wrong area
before using it to judge results.

These tests compare outputs with other outputs, not with saved ground truth.
An error shared by all operations may satisfy the relationships. Boundary
direction is inferred from the sign of signed area; rounding makes that sign
unreliable for nearly zero-area regions.

### Raster checks: does the result cover the right pixels?

The raster tests render the original A and B into images called masks. Each
pixel's alpha value represents how much of the pixel the path covers. Combining
the two masks supplies an expected image for an operation:
union covers pixels from either input, intersection covers their overlap, and
so on. The library's result is rendered separately and compared with that image.

For division and fracture, each returned region is rendered separately. The
regions must cover A or the union, respectively, without overlapping each other.

Images are rendered at a fixed maximum dimension and compared with an alpha
tolerance. Pixels within a narrow band around the input boundaries are excluded
because edge antialiasing can differ between equivalent paths. The image size,
alpha tolerance and band width are defined in
`src/__tests__/support/raster-oracle.ts`.
If an expected nonempty region lies entirely inside that band, the test reports
that it cannot judge the result and counts this as a failure. Tiny features
outside the image's resolution are not verified.

Reference images are produced without the library's SVG parser. Separate test
code decodes paths and applies SVG arc-radius correction; rendering moves
coordinates near the origin to reduce errors from large coordinate values.
`corpus-raster.test.ts` also checks that the image comparison rejects a known
wrong result.

Coverage mismatches write `<op>-mismatch.txt`, `<op>-ours.svg` and
`<op>-ours.png` under the case's `test-results/`, where `<op>` is the operation
name, such as `union`.

### Cleanup equivalence: does redundant geometry change the answer?

Some generated cases contain geometry that should have no effect, such as a
line traversed forward and backward. For these cases, the generator creates both
`original.svg` and `clean/original.svg`. The latter is a constructed version
without that redundant geometry; it is not output from a library cleanup step.

`malformed-geometry.test.ts` runs the same operation on both versions and compares
result areas and rendered coverage. Division and fracture may divide a region
into different pieces, provided the covered region and total area agree.

Both versions are processed by the library. The test can therefore detect a
change caused by redundant geometry, but a wrong answer shared by both versions
can pass.

### Test code, separate processes and time limits

The code for these check types lives in `src/__tests__/support/`. Each helper
runs a case and reports success or a failure description; the repository calls
these helpers *evaluators*. Their files use the name `*-oracle.ts`, where an
*oracle* is the rule used to judge a result.

The corpus tests send work to a separate Node process, called a worker. This
lets the test runner kill a worker stuck in a synchronous geometry loop without
hanging the entire run. Each worker handles one job at a time. A process deadline
kills and replaces a stuck worker; its default is defined in
`scripts/corpus/process.cjs`. Structural, algebraic and raster checks also report
a failure if boolean computation finishes but exceeds the time budget defined
in their respective test helpers. Cleanup equivalence has only the process
deadline.

Ordinary unit and visual tests run inside Jest instead. Jest's timeout cannot
interrupt a synchronous loop in those tests.

Corpus workers use development and production copies of the library, stored under
`.cache/path-bool/build/`:

- The **development** copy keeps internal assertions and enables graph consistency
  checks, so tests can detect invalid intermediate structures.
- The **production** copy removes all `assert*` calls and disables graph checks,
  so tests also exercise behavior when those checks are absent.

Generated structural tests use development. Algebraic, raster and cleanup tests
use production. Artwork structural tests run in both. Building these test copies
does not overwrite the release files in `dist/`.

### Running checks on generated inputs

The generator writes cases under `src/__fixtures__/generated/`. Cases are
grouped by the geometry they exercise: overlap, touching, nesting, coincident
boundaries, disjoint paths, fill rules, degenerate geometry, arcs, stress cases,
and sensitivity to position, scale or rotation. The malformed group includes
collapsed segments, retracing, residue from closing paths,
stationary control points, duplicate contours, arc corners and genuine tiny
features.

Each case has an ID of the form `<category>/<name>`. Its test names append the
operation or area relationship being checked. This lets Jest select a category,
case or individual check by name:

```shell
npm test -- src/__tests__/corpus-structural.test.ts
npm test -- src/__tests__/corpus-algebraic.test.ts
npm test -- src/__tests__/corpus-raster.test.ts
npm test -- src/__tests__/malformed-geometry.test.ts
npm test -- src/__tests__/corpus-structural.test.ts -t "touching/"
```

Some cases deliberately contain open path fragments. They are marked
`structuralOnly` and run only structural checks because their inputs do not
define the closed filled regions required by area and image comparisons.

`npm test` generates the inputs automatically. To generate them separately,
or write a second copy for inspection:

```shell
npm run gen-corpus
npm run gen-corpus -- --out /tmp/path-bool-regenerated
```

Change `scripts/generate-corpus.mjs` or `scripts/corpus/malformed.mjs` to add or
modify cases. Never hand-edit their generated output. Case directories and
`manifest.json`, the generated list of cases and their properties, are ignored
by Git and replaced on regeneration. The README and known-failure lists are
preserved. Do not copy library results into this corpus as expected output.
See [categories and fixture format](src/__fixtures__/generated/README.md).

By default, Jest reads these cases from `src/__fixtures__/generated/`.
`PATH_BOOL_CORPUS_ROOT` changes that lookup location, including the known-failure
lists. It does not change the generator's output directory; use `--out` for that.

### Recording known failures in the generated corpus

A known-failure entry records a case that currently produces a wrong result,
throws or exceeds a limit, together with a reason. The test still runs. If it
fails as expected, it does not make the suite fail. An unlisted failure or a
listed case that now passes does fail the suite. Remove entries with their fixes.

The files are in `src/__fixtures__/generated/`:

| Check type | Known-failure file |
| --- | --- |
| Structural | `expected-failures.json` |
| Algebraic | `expected-failures-algebraic.json` |
| Raster | `expected-failures-raster.json` |
| Cleanup equivalence | `expected-failures-equivalence.json` |

Each file is keyed by case ID, then operation name or algebraic identity name.
The case ID identifies an input pair; a key such as `union` identifies the
operation on that pair. Entries require a reason, not saved output.

### Preparing artwork inputs

Artwork tests use paths already present in CC0/public-domain Wikimedia Commons
SVGs. `src/__fixtures__/artworks/manifest.json` is the saved source list: URLs,
content hashes and instructions for selecting and extracting each path pair.
Downloaded SVGs, extracted fixtures and test reports are stored under
`.cache/path-bool/artworks/`.

To restore the inputs in that saved list:

```shell
npm run scrape-paths -- --replay
```

Replay downloads missing sources, verifies that cached bytes match their hashes,
and reconstructs the path-pair fixtures. Extraction preserves compound paths
and inherited fill rules while applying SVG transforms to their coordinates.
It does not trace images, convert strokes into filled outlines or remove
degenerate geometry.

To search for additional sources instead:

```text
npm run scrape-paths -- --count <total-source-count>
```

`--count` is the desired total number of accepted source SVGs. It is not a number
to add on each run. A smaller value does not delete sources already collected.

### Running artwork tests and reading their results

After restoring or collecting the cached fixtures:

```shell
npm run test:artwork-corpus
```

To limit a run or choose a specific pair:

```text
npm run test:artwork-corpus -- --limit <pair-limit> --timeout <milliseconds>
npm run test:artwork-corpus -- --cases <source-id>/<pair-id>
```

This command rebuilds the development and production test copies of the library,
checks source hashes and extraction instructions, and runs the same structural,
algebraic and raster checks described above. Per input pair, it runs:

- structural operation checks in development;
- structural operation checks in production;
- algebraic checks in production;
- raster operation checks in production.

An evaluation is one recorded check of an operation or algebraic identity on a
particular input pair and library build.

`--cases` takes comma-separated exact IDs of the form `<source>/<pair>`.
`--limit` bounds the number of pairs. `--timeout` sets the worker deadline for
one evaluation, in milliseconds. Both `scrape-paths` and `test:artwork-corpus`
accept `--manifest` and `--cache` to override the source-list and cache locations.

The cache's `test-report.json` records results, excluded checks, elapsed times
and commands for reproducing them. Each run overwrites it, including a run of
only one case. Preserve a full report before investigating a subset.

Artwork known failures are recorded in `expected-failures.json` beside the
manifest. As with generated cases, both unexpected failures and unexpected
passes fail the run and produce a nonzero exit status. Entries use the case ID,
then `<build>/<check-type>/<operation-or-identity>`, for example
`development/structural/union`. There is no command to automatically accept all
failures. See [collection and replay details](src/__fixtures__/artworks/README.md).

## Testing the programs that prepare and run corpus tests

The generator, artwork collector and worker-management code have their own
tests under `scripts/corpus/*.test.mjs`. These check the testing tools rather
than boolean-operation results. They use Node's built-in test runner:

```shell
npm run test:corpus-tools
```

Coverage includes identical output on repeated generation, protection against
clearing unrelated directories, manifest replay, source hashes, duplicate-source
rejection and licence filters. HTTP tests check caching, retries, delays between
retries and sequential requests; requests are mocked rather than sent to artwork
servers. Geometry tests cover SVG extraction, coordinate transforms and arc
handling. Process tests verify that a hung worker is killed and the next job
runs in a replacement worker.

## Fuzzing: searching for crashing or expensive inputs

Fuzzing automatically modifies inputs and tries them against the library. The
jsfuzz program starts with saved examples called seeds, changes their SVG path
strings, and retains inputs that execute previously unvisited code. It searches
for crashes, hangs and excessive memory use; it does not check whether returned
shapes are correct.

```shell
npm run fuzz
```

To set time and memory limits:

```text
npm run fuzz -- --timeout <seconds> --rss-limit-mb <megabytes>
```

The command compiles current source to `fuzzing/build/path-bool.cjs`, keeping
assertions, then starts jsfuzz. Seeds are read from and saved to `fuzzing/corpus/`.
Successful two-input visual tests populate this directory. Seeds can also be
written by hand.

`fuzzing/target.cjs` contains the function that jsfuzz calls for each input. It
rejects inputs larger than the `MAX_INPUT_BYTES` constant in that file. Accepted
inputs contain exactly two SVG path strings separated by one newline, with no
trailing newline. Parse errors are ignored. Each string's length selects its
fill rule: even length uses evenodd, odd length uses nonzero.
For valid inputs, the function constructs a `PathBoolean` object and requests
all supported operations. Exceptions from construction or operation selection
are reported to jsfuzz.

jsfuzz generates ASCII inputs and periodically checks elapsed time and worker
memory against its limits. `npm run fuzz -- --help` lists the installed defaults.
Crashes, timeouts and memory failures save the triggering input as a `crash-*`
file in the working directory.
`--exact-artifact-path` overrides that filename. `--fuzzTime` stops after the
specified number of seconds without new code coverage; 0 means unlimited.

### Replaying fuzz inputs

The installed jsfuzz version accepts `--regression`, but its execution loop does
not use that setting to stop mutation. It is not a working replay-only mode.
Use the direct calls below to reproduce a particular saved input.

For a direct call on one saved crash, rebuild the fuzz library and pass the file
to the target function. Replace `crash-example` with the actual filename:

```shell
npm run build-fuzz
node -e 'require("./fuzzing/target.cjs").fuzz(require("node:fs").readFileSync("crash-example"))'
```

Alternatively, if the working directory contains exactly one `crash-*` file:

```shell
node fuzzing/reproduce.cjs
```

These direct calls do not start jsfuzz and have no separate process enforcing a
timeout. The library's internal subdivision and intersection limits do not
guarantee that every input terminates.

## Benchmarks: measuring operation speed

Benchmarks import the compiled library from `dist/path-bool.js`. Rebuild it after
source changes; otherwise measurements use the previous build:

```shell
npm run build
npm run bench
npm run bench -- --cases "nesting-*" --ops union,intersection
npm run bench -- --json-file /tmp/path-bool-bench.json
```

To use a different fixture directory and set the run counts:

```text
npm run bench -- --root <fixture-directory> --cases "stress-*" --iterations <timed-runs> --warmup <warmup-runs>
```

The default inputs are `original.svg` files anywhere under `bench/fixtures/`,
each containing paths with IDs `a` and `b`. All supported operations are measured
unless restricted with `--ops`. For each case and operation, initial runs warm up
execution and are discarded; subsequent runs are timed. `--warmup` and
`--iterations` select those counts. Each run constructs a `PathBoolean` object and
calls `get()` for one operation. Input parsing is outside the timing; nothing
is rendered.

Results show average, minimum and maximum time, plus operations per second.
Benchmarks do not compare shapes with expected results and do not enforce a
performance threshold.

`--file`, `--id-a` and `--id-b` override the SVG filename and path IDs.
`--cases` and positional case names accept wildcards; `--grep` filters names
with a regular expression. `--json` prints the result data; `--json-file` saves
it. `npm run bench -- --help` lists all options and their defaults.

## Manual browser checks

Serve `docs/` through a local HTTP server and open the basic, animation or
shape-builder demo. Rebuild their library with `npm run build` after source
changes, or use `npm run watch` to rebuild automatically. The automated visual
tests use resvg to render SVGs; they do not run these browser interfaces.

## Reference: assertions and release builds

An assertion checks an internal assumption and throws an error if it is false.
The library has individual `assert*` calls and larger checks of its graph
structures. Runtime settings and build-time removal disable checks differently.

**Runtime setting:** before loading the library, set `PATH_BOOL_DEV_ASSERTS=1`
to enable graph consistency checks or `0` to disable them. Without an explicit
setting, graph checks are enabled in Node unless `NODE_ENV=production`.
This also applies to the fuzz build. The flag does not disable individual
`assert*` functions. Unit tests retain source assertions; visual tests set the
flag to `0` but still retain individual assertion calls.

**Build-time removal:** a production build removes `assert*` calls from the
compiled code entirely. Corpus tests use their own development copy with checks
enabled and production copy with checks removed, as described above.
Assertions must not be necessary for correct output because production removes
them.

Release builds under `dist/` are separate from corpus test builds. They include
full and core versions: the full library includes SVG path-string conversion;
the core library omits it. Each comes as a JavaScript module (ESM) and a UMD
bundle for browser/CommonJS use. The docs have their own full-library copy.

| Build command | Full ESM/UMD files in `dist/` | Core files and `docs/js/path-bool.js` |
| --- | --- | --- |
| `npm run build` | Assertions removed; UMD minified | Assertions removed; core UMD minified |
| `npm run build-dev` | Assertions retained | Assertions removed; core UMD minified |
