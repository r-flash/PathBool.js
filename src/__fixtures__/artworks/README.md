# Artwork path corpus

This opt-in corpus contains **paths already present in public-domain artwork**.
It does not generate edits, simplify paths, trace bitmaps, convert strokes/text,
or discard degenerate geometry. The committed manifest contains provenance and
extraction recipes, not artwork bytes. Downloads, derived SVG pairs and reports
live under the ignored `.cache/path-bool/artworks/` directory.

## Collect, replay and test

```sh
npm run scrape-paths -- --count 300
npm run scrape-paths -- --replay
npm run test:artwork-corpus
# A bounded investigation, with a hard per-evaluation timeout in milliseconds:
npm run test:artwork-corpus -- --limit 12 --timeout 10000
npm run test:artwork-corpus -- --cases commons-123/00
npm run test:corpus-tools
```

`--count` is the desired **total number of accepted, distinct source SVGs**.
Increasing it extends the existing manifest; decreasing it never removes entries.
`--manifest` and `--cache` select alternate locations on both commands. Collection
checkpoints the manifest after each accepted source. A failed or interrupted run
can be resumed. A shortfall or replay failure exits nonzero and is detailed in
`collection-report.json` (or `replay-report.json` for replay); an empty dataset is
not a successful collection.

Replay fetches the recorded URL only if the content-addressed cache is missing,
checks SHA-256 before extraction, and verifies the recorded recipes. Changed or
unavailable upstream files are reported, never replaced. Cached corrupt files
also fail verification. The manifest makes reconstruction verifiable, but cannot
guarantee upstream availability. Keep a local cache if long-term availability
matters. Versioned extraction changes require an explicit manifest migration;
replay does not silently reinterpret old recipes.

The test command builds development and assertion-stripped production bundles
from current source into `.cache/path-bool/build/`, leaving release bundles alone.
Structural checks run against both builds; algebraic and raster checks run against
production. A child process timeout kills synchronous hangs and later evaluations
continue in a fresh worker. `test-report.json` records every evaluation, exclusions,
timings, build mode and reproduction command. Raster failures additionally write
SVG/PNG diagnostics alongside the derived fixture. Findings exit nonzero.

Known failures can be recorded in `expected-failures.json`, keyed by
`<source-id>/<pair-number>` and then `<build>/<tier>/<operation-or-identity>`.
Values must explain a reviewed finding. An unexpected pass fails too. There is no
automatic blessing command. Preserve an untriaged report before starting another
run, since the report describes the latest run.

The [pilot report](PILOT.md) records the initial 300-source collection, coverage,
smoke-test selection and reviewed findings. Tooling was verified with Node 24.

## Sources and selection

The implemented collector uses the Wikimedia Commons Action API. It requests
original SVG URLs, upload timestamps and hashes, and extended rights metadata.
Only explicit CC0 or public-domain metadata with a PD identifier is accepted;
ambiguous records and non-SVG files are excluded. Original rights evidence and
author information are retained in the manifest. Discovery queries span flowers,
ornaments, animals, lettering, maps, diagrams, symbols, botanical drawings,
borders, illustrations and patterns.

Within bounded candidate windows, selection favors underrepresented command
types, fill rules, complexity levels, scales, compound paths and observed
artifacts. Each author contributes at most five SVGs; byte-identical downloads
are deduplicated. This is feature-guided sampling, not a claim of statistical
representativeness. `collection-report.json` records coverage and exclusions, with separate selected-operand
coverage and explicit gaps.
Rare or absent features remain visible as gaps, rather than being synthesized.

References:

- [Commons Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo)
- [Machine-readable rights metadata](https://commons.wikimedia.org/wiki/Commons:Machine-readable_data)
- [API request etiquette](https://www.mediawiki.org/wiki/API:Etiquette)

Do not infer rights from a search label or treat every freely licensed Commons
image as public domain.

## Extraction boundaries

Each complete `<path>` remains an operand, including all its subpaths and original
command data. Element indices, IDs, original path hashes, fill rules, transforms,
feature measurements and context labels are recorded for selected operands.
The source path count and aggregate feature coverage include all extracted paths;
the manifest does not duplicate metadata for thousands of unselected paths. Inherited presentation
attributes and ordinary static CSS rules are resolved. Unsupported dynamic CSS,
layout-dependent values, animation and active content are explicit exclusions.

Existing transforms are applied only to express objects in a common coordinate
system. Lines and Béziers transform directly; elliptical arcs retain arcs via
affine ellipse reparameterization, including reflected sweep. Singular transforms
are retained as labelled local-coordinate cases, excluded from placed pairs.
Original `d` strings and transforms supply independent raster masks. Rendering
normalizes coordinates to viewport units and applies mandatory SVG arc-radius
correction on both inputs and outputs, avoiding resvg precision limits. The
inputs supplied to the boolean library retain their original geometry.

Pairs preferentially come from overlapping bounds of existing painted objects,
with a disjoint sample and empty/self counterpart checks. At most eight pairs are
selected per artwork. Paths from definitions, clipping/masking geometry, hidden
objects and stroke-only objects are retained as labelled isolated geometry.
Their tests concern their filled path geometry, not the final artwork appearance.
`<use>` references, text and non-path shapes are reported rather than expanded.
Large operands remain intact and may produce timeout findings.

Open subpaths are retained unchanged for structural tests. Their algebraic/raster
evaluations are reported as excluded because the low-level API does not establish
SVG's implicit fill closure. No closing segment is silently inserted. The raster
oracle cannot resolve arbitrarily thin features; algebraic comparisons complement
it, and coverage reports distinguish excluded evaluations from passes.

## Request behavior

Run one collector process at a time. Its HTTP client serializes requests and body
reads, with at least **two seconds between request starts**, including retries.
Commons searches batch metadata for 50 results, use `maxlag=5`, and identify the
project in the User-Agent. This follows the [MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)
guidance on serial requests, batching, caching and server load.

Search responses are cached for 24 hours under `discovery/`; candidate downloads
are cached under `downloads/`, keyed by URL and recorded upload revision/hash.
Extending a collection reuses these snapshots, including unselected candidates.
Accepted sources use the SHA-256 raw cache for offline replay. Cached bytes are
verified before reuse. To explicitly refresh search results, remove only
`.cache/path-bool/artworks/discovery/`; keep the raw and download caches.

HTTP 429/5xx, interrupted downloads, and Commons `maxlag`/`ratelimited` JSON errors
(including HTTP 200) get at most four attempts. Valid `Retry-After` seconds or HTTP
dates are honored in full, without a 60-second cap. Otherwise retries use
exponential backoff starting at five seconds, plus jitter. Exhausting retries
stops further network requests for that run; resume later after checking the
report. HTTP 401/403 also stop further network requests immediately. Other HTTP
4xx responses are not retried. Each attempt has a 30-second
transport timeout and an 8 MiB download limit. Tests use mocked transport and
clocks; routine validation does not scrape the APIs.
