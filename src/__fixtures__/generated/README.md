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

Everything under the category directories is generated. **Do not edit by
hand**; change `scripts/generate-corpus.mjs` and run:

```shell
npm run gen-corpus
```

Regenerating clears the category directories but leaves the files at this
level (`README.md`, `expected-failures.json`) alone.

## Categories

| Category       | What the cases in it are for                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `overlap`      | Generic transversal crossings, one per pair drawn from the shape vocabulary                                                       |
| `touching`     | Contact without crossing: tangency, vertex on vertex, vertex on edge, and edges — straight or curved — shared in whole or in part |
| `nesting`      | Containment with no boundary contact, up to four levels of alternating inside/outside                                             |
| `coincident`   | Boundaries that are identical, identical up to representation, or a few nanometres apart                                          |
| `disjoint`     | No contact at all, including multi-component inputs interleaved with each other                                                   |
| `fill-rule`    | The same geometry read under each winding rule, once per way of reaching a winding number the two rules disagree about            |
| `degenerate`   | Zero-area and sub-pixel geometry: spikes, bare lines, slivers, and curve segments that are secretly straight                      |
| `arcs`         | The corners of the SVG arc parametrization: `largeArc`, opposing sweeps, the F.6.6 radius correction, a zero radius               |
| `stress`       | Many intersections at once, where the quad tree, the angular sort and the face trace all have to work at scale                    |
| `conditioning` | A few of the above placements re-emitted at other positions, scales and angles, since `EPS.point` and `EPS.linear` are lengths    |

## No ground truth here

These fixtures deliberately ship with only `original.svg` and no committed
`<op>.svg`. Blessing our own output the way
`../visual-tests/establish-ground-truth.sh` does would just freeze whatever
bugs the generator happened to trip. Suites over this corpus have to bring
their own oracle.

Three suites do, each with a different oracle and a different blind spot:

| Suite                                | Oracle                                                    | Sees                                                           | Misses                                                   |
| ------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| `__tests__/corpus-tier0.test.ts`     | none — structure only                                     | crashes, hangs, non-finite output, open loops, non-determinism | anything that is well formed but wrong                   |
| `__tests__/corpus-algebraic.test.ts` | exact areas (Green's theorem), identities between results | sub-pixel errors, order dependence                             | output that is internally consistent but uniformly wrong |
| `__tests__/corpus-raster.test.ts`    | resvg coverage masks combined with pixel arithmetic       | wrong regions, non-disjoint partitions                         | features thinner than a pixel                            |

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

Known-bad cases, keyed by `<category>/<name>` then by operation name (tier 0
and raster) or identity name (algebraic), with a reason. Each suite keeps its
own list because they disagree about what counts as a failure.

A listed case is expected to fail, so the suite stays green while real bugs are
triaged. A listed case that starts passing is _also_ an error, which is what
stops the list from rotting: fix a bug and the suite tells you which entries to
delete.
