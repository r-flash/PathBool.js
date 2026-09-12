# PathBool.js

A low-level library for performing boolean operations on SVG paths.

## Demos

- [basic](https://r-flash.github.io/PathBool.js/demo.html)
- [animation](https://r-flash.github.io/PathBool.js/demo-animation.html)
- [shape builder](https://r-flash.github.io/PathBool.js/demo-shape-builder.html)

## Behavior choices

- **Open paths are not implicitly closed.** Boolean operations use the regions
  enclosed by the supplied segments; dangling portions are discarded. To close
  an open subpath, add `Z` after its last SVG command (before the next `M`, if
  any). With raw segment arrays, add a line from its end back to its start:
  `["L", end, start]` (see Usage below for details on segment arrays).
- **An explicit error is preferable to an invalid result.** The library favors
  throwing when computation cannot proceed reliably over silently discarding
  geometry or returning a partial result. This does not guarantee that every
  incorrect result is detected; development builds include additional
  consistency checks that are omitted from production builds.

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

## Testing

Testing accounts for the majority of the codebase and therefore deserves its
own document. Extracting the testing framework into a separate repository is
a possible future task. (Let me know if you want to test your own SVG or
vector-processing project, and I'll prioritize it.)

See [TESTING.md](TESTING.md) for test suites, corpora, fuzzing and benchmarks.

## License

MIT License

Copyright © 2024 Adam Platkevič
