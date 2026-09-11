# Artwork pilot — 2026-09-11

Collected **300 public-domain SVGs**, containing **79,049 extracted paths**. The manifest selects **1,857 unchanged path pairs/control cases** for opt-in testing. All 300 source files and their extraction recipes replayed from cache without network access.

The collection spans ten topic queries; selection additionally balances geometry features and caps each author at five artworks. Counts below are artworks containing a feature, so columns overlap. “Selected” measures the operands chosen for tests, rather than every path in the source.

| Feature | Sources | Selected |
| --- | ---: | ---: |
| `command:L` | 295 | 295 |
| `command:Q` | 22 | 12 |
| `command:C` | 255 | 250 |
| `command:A` | 50 | 43 |
| `fill:nonzero` | 261 | 258 |
| `fill:evenodd` | 88 | 77 |
| `compound` | 227 | 211 |
| `open` | 136 | 88 |
| `collapsed` | 226 | 226 |
| `closed-cubic` | 23 | 11 |

## Validation and findings

- 287 deterministic malformed-geometry cases supplement the existing 137 generated cases.
- 10,077 configured Jest checks verified across the full run and affected-suite reruns; 12 offline tooling tests passed.
- 15 distinct artwork cases were evaluated in development and production, including arc and quadratic inputs. Of 420 evaluations, 396 passed, 16 were explicitly inapplicable to original open subpaths, and eight matched reviewed expected failures.
- Seven expected evaluations concern the same mammal-diagram pair: six development operations hit the multiple-outer-faces invariant, and the production algebraic oracle finds an oppositely oriented fracture face.
- The remaining expected evaluation is a raster resolution limit: a two-pixel intersection is swallowed by the boundary band. This is not recorded as a library defect.

Synthetic findings include cancelling opposite-winding contours leaving an open boundary, an oppositely oriented sliver face, and positive arc radii being flattened before SVG radius correction. Expected-failure lists retain these findings and fail on unexpected passes.

This is a smoke sample, not a completed run over all 1,857 artwork pairs. Run `npm run test:artwork-corpus` for the full corpus. The raw test report is cached at `.cache/path-bool/artworks/pilot-test-report.json`; committed [summary metadata](pilot-summary.json) preserves the sample selection and counts.

Reproduce the sample:

```sh
npm run scrape-paths -- --replay
npm run test:artwork-corpus -- --cases commons-115096348/00,commons-12051116/00,commons-151720042/00,commons-153223976/00,commons-162080539/00,commons-16969381/00,commons-170866480/00,commons-17101964/00,commons-17101966/00,commons-177042118/03,commons-2645947/00,commons-3502725/00,commons-66522532/00,commons-7333866/00,commons-76377877/00
```

See [README.md](README.md) for collection, replay, extraction boundaries, source rights and report formats.

## Reproduction and subsequent tooling changes

The 424 synthetic fixtures and their generated manifest are now ignored by Git;
`npm test` recreates them offline before testing. Generator sources and reviewed
expected failures remain tracked. Artwork source provenance stays in the tracked
manifest, with downloaded and extracted artwork in the ignored cache.

The collector now spaces serial requests by two seconds, caches discovery and
candidate downloads, honors full server-requested retry delays, and stops network
activity after repeated transient failures. See
[request behavior](README.md#request-behavior). These changes do not alter the
pilot's source selection or historical validation counts above.
