# PathBool.js

A low-level library for performing boolean operations on SVG paths.
The project is still in early stages of development;
please, help me test it and provide reduced examples of failure cases.

## Demos

- [basic](https://r-flash.github.io/PathBool.js/demo.html)
- [animation](https://r-flash.github.io/PathBool.js/demo-animation.html)
- [shape builder](https://r-flash.github.io/PathBool.js/demo-shape-builder.html)

## TODO

- Comment the code thoroughly.
- Support [shape builder](https://media.inkscape.org/media/news/uploads/1-3-shape-builder-ssr_gy8C0ba.webp) use-case.

## Installation

```shell
npm install path-bool
```

## Building

```shell
npm run build
# or with asserts:
npm run build-dev
```

## Benchmarking

```shell
# build first (benchmark imports dist/path-bool.js)
npm run build

# run all benchmark fixtures from bench/fixtures
npm run bench

# run a subset of cases by name
npm run bench -- --cases nesting-03,nesting-04

# run wildcard subset and custom folder
npm run bench -- --root ./my-bench-fixtures --cases "stress-*"
```

Benchmark input format:

- each case contains an SVG file named `original.svg` (override with `--file`)
- that SVG has two path elements with IDs `a` and `b` (override with `--id-a` and `--id-b`)
- benchmark runs all boolean ops: `union`, `difference`, `intersection`, `exclusion`, `division`, `fracture`

## Usage

See the `docs` directory or visit <https://r-flash.github.io/PathBool.js/>.

A snippet of possible usage:

```ts
import * as PathBool from "path-bool";

// initialize path from SVG path data...
const pathA = PathBool.pathFromPathData("M0,0 C...");
// ...or from an array of SVG path commands...
const pathA = PathBool.pathFromCommands([["M", [0, 0]], ["C", [/*...*/], /*...*/]/*...*/]);
// ...or directly from path segments (L, C, Q, or A with the start point prepended)
const pathA = [["C", [0, 0], [/*...*/], /*...*/], /*...*/];

const fillRuleA = PathBool.FillRule.EvenOdd;
const pathB = PathBool.pathFromPathData("M0,0 C...");
const fillRuleB = PathBool.FillRule.NonZero;

// Build the arrangement once from any number of { path, fillRule } inputs...
const pathBoolean = new PathBool.PathBoolean([
    { path: pathA, fillRule: fillRuleA },
    { path: pathB, fillRule: fillRuleB },
]);

// ...then select results for one or more operations (the heavy work is reused).
const result = pathBoolean.get(PathBool.PathBooleanOperation.Union);
const fractured = pathBoolean.get(PathBool.PathBooleanOperation.Fracture);

console.log(result.map(PathBool.pathToPathData));
console.log(result.map(PathBool.pathToCommands));
```

The asymmetric operations generalize to more than two inputs by a left-fold
("first path vs. the rest"): `Difference` is the first path minus the union of
the others, `Exclusion` is the regions covered by an odd number of paths, and
`Division` returns the faces of the first path.

### Shape builder

For interactive "shape builder" tools, the same `PathBoolean` object exposes the
arrangement's atomic regions as an ordered list (the same regions `Fracture`
returns), then merges any chosen subset of them into a single outline:

```ts
const pathBoolean = new PathBool.PathBoolean([
    { path: pathA, fillRule: fillRuleA },
    { path: pathB, fillRule: fillRuleB },
]);

// One Path per atomic region; render these as the selectable pieces.
const faces = pathBoolean.getFaces();

// Merge the regions the user picked (by index into `faces`) into one shape,
// tracing the outline of their union, with holes where appropriate.
const shape = pathBoolean.buildShape([0, 2, 5]);
```

See `docs/demo-shape-builder.html` for a clickable example.

## License

MIT License

Copyright © 2024 Adam Platkevič
