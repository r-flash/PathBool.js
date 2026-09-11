<!--
SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>

SPDX-License-Identifier: MIT
-->

# Generated corpus

Machine-generated exemplars that sit between the hand-made golden fixtures in
`../visual-tests/` and the fuzzer in `../../../fuzzing/`.

Every case here exists for a nameable reason — a shape pair crossed with a
relative placement that stresses one specific part of the pipeline — so a
failure reports as `touching/01-tangent-external union` rather than as a hash.
`manifest.json` records the axes for each case.

Category directories and `manifest.json` are generated and ignored by Git. Only
the generator sources, this README and reviewed `expected-failures*.json` lists
are tracked. **Do not edit fixtures by hand**; change `scripts/generate-corpus.mjs`
or `scripts/corpus/malformed.mjs` and run:

```shell
npm run gen-corpus
```

A fresh checkout needs no downloads: `npm test` generates all 424 cases before
building the test workers. Before running Jest directly or benchmarking these
fixtures, run `npm run gen-corpus` yourself. Generation clears category directories
and replaces the generated manifest, preserving the README and expected-failure
lists. The same generator version produces identical bytes; no library boolean
output is used as ground truth.

## Categories

| Category       | What the cases in it are for                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `overlap`      | Generic transversal crossings, one per pair drawn from the shape vocabulary                                                    |
| `touching`     | Contact without crossing: off-axis and clustered tangencies, vertex-on-edge events, and boundaries shared in whole or in part  |
| `nesting`      | Containment with no boundary contact, up to four levels of alternating inside/outside                                          |
| `coincident`   | Boundaries identical up to winding, Bézier subdivision, arc-axis spelling, rotation, signed radii, or tiny offsets             |
| `disjoint`     | No contact at all, including multi-component inputs interleaved with each other                                                |
| `fill-rule`    | Doubled, overlapping, and cancelling subpaths read under both winding rules                                                    |
| `degenerate`   | Zero-area and sub-pixel geometry: points, retraced spikes, bare lines, slivers, and secretly straight curves                   |
| `arcs`         | Arc parametrization corners: flags, radius correction, zero radii, and coincident endpoints                                    |
| `stress`       | Many crossings, tangencies, nested rings, or high-valence vertices challenging graph construction                              |
| `conditioning` | A few of the above placements re-emitted at other positions, scales and angles, since `EPS.point` and `EPS.linear` are lengths |
| `malformed` | 287 finite, valid path inputs with collapsed segments, closing residue, retracing, stationary controls, duplicate contours, arc corners and tiny genuine features |

The malformed cases come from `scripts/corpus/malformed.mjs`, called by the
main generator. Their `case.json` files record the artifact family, placement,
fill rules, conditioning and relationship to clean geometry. Selected cases
also include a generated `clean/original.svg`. These are constructed inputs,
not ground truth copied from the library. `malformed-geometry.test.ts` checks
that proven zero-area residue does not change operation areas or coverage;
partition comparisons allow different subdivisions of the same filled region.

Open fragments are labelled `structuralOnly`: they enter structural tests but
not filled-region oracles, since the low-level API does not establish implicit
SVG fill closure. The generator does not close them to make tests pass.
Tiny positive loops, slivers and islands are deliberate controls against
over-aggressive cleanup. Degeneracy checks reject exactly collapsed output;
closure checks use a separate scale-aware tolerance and floating-point allowance.

To verify reproducibility without overwriting the working fixtures:

```sh
npm run gen-corpus -- --out /tmp/path-bool-regenerated
```

## No ground truth here

These fixtures deliberately ship with only `original.svg` and no committed
`<op>.svg`. Blessing our own output the way
`../visual-tests/establish-ground-truth.sh` does would just freeze whatever
bugs the generator happened to trip. Suites over this corpus have to bring
their own oracle.

Three suites do, each with a different oracle and a different blind spot:

| Suite                                | Oracle                                                    | Sees                                                           | Misses                                                   |
| ------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| `__tests__/corpus-structural.test.ts`     | none — structure only                                     | crashes, hangs, non-finite output, open loops, non-determinism | anything that is well formed but wrong                   |
| `__tests__/corpus-algebraic.test.ts` | exact areas (Green's theorem), identities between results | sub-pixel errors, order dependence                             | output that is internally consistent but uniformly wrong |
| `__tests__/corpus-raster.test.ts`    | resvg coverage masks combined with pixel arithmetic       | wrong regions, non-disjoint partitions                         | features thinner than a pixel                            |

The evaluators live under `__tests__/support/` and are shared with the opt-in
[artwork corpus](../artworks/README.md). Jest builds test-only bundles through
`pretest`; when invoking Jest directly after source changes, run
`npm run pretest` first. Evaluations run in persistent child processes with a
10-second hard timeout; a timed-out child is killed and replaced. Structural checks
use development assertions; algebraic, raster and cleanup-equivalence checks use
an assertion-stripped production bundle. Neither build overwrites `dist/`.

Input masks preserve original command data and do not use the library parser.
Inputs and outputs are rendered near the origin in viewport units, avoiding
resvg float32 precision loss and its treatment of tiny radii as zero. An
independent decoder supplies the reference geometry and applies mandatory SVG
radius correction on both sides. Library inputs remain unchanged.

The complementarity is real rather than theoretical, and each tier has already
caught something the others could not.

The shared-collinear-edge order dependence (fixed in `findVertices`, where
merging a coincident edge used to overwrite the orientation flags of the paths
already on it) was invisible to the raster tier, which only runs the forward
direction — and that direction happened to be the correct one. Only comparing
`A op B` against `B op A` exposed it.

Conversely, when two overlapping circles are wrongly treated as disjoint, Union
and Fracture come out wrong _in the same way_, so every algebraic identity
balances perfectly and only the pixels give it away.

## expected-failures\*.json

Known-bad cases, keyed by `<category>/<name>` then by operation name (structural
and raster) or identity name (algebraic), with a reason. Each suite keeps its
own list because they disagree about what counts as a failure.

A listed case is expected to fail, so the suite stays green while real bugs are
triaged. A listed case that starts passing is _also_ an error, which is what
stops the list from rotting: fix a bug and the suite tells you which entries to
delete.

`expected-failures-equivalence.json` records the cleanup-equivalence tier.
The initial malformed findings include opposite-winding copies sharing an edge
with another operand (open output and order dependence), and a very narrow
sliver whose fracture includes an oppositely oriented face. These are recorded
as library findings; the dataset work does not change geometry algorithms.
