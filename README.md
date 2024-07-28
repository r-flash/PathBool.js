# PathBool.js

A low-level library for performing boolean operations on SVG paths.
The project is still in early stages of development;
please, help me test it and provide reduced examples of failure cases.

## TODO

- Publish on NPM.
- Expand documentation.
- Comment the code thoroughly.

## Building

```shell
npm run build
# or with asserts:
npm run build-dev
```

## Usage

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

const op = PathBool.PathBooleanOperation.Union;

const result = PathBool.pathBoolean(pathA, fillRuleA, pathB, fillRuleB, op);

console.log(result.map(PathBool.pathToPathData));
console.log(result.map(PathBool.pathToCommands));
```

`pathBoolean` returns an array of `Path`s (arrays of `PathSegment`s).
The array is empty if the input paths are empty.
It contains exactly one `Path` when the operation is `Union`, `Difference`, `Intersection`, or `Exclusion`.
Potentially multiple `Path`s are output for operations `Division` and `Fracture`.

## API

For exported public functions and enums see the example above.

```ts
type Vector = [number, number];
```

### Commands

```ts
type AbsolutePathCommand =
    | ["M", Vector]
    | ["L", Vector]
    | ["C", Vector, Vector, Vector]
    | ["S", Vector, Vector]
    | ["Q", Vector, Vector]
    | ["T", Vector]
    | ["A", number, number, number, boolean, boolean, Vector]
    | ["Z"]
    | ["z"];

type RelativePathCommand =
    | ["H", number]
    | ["V", number]
    | ["m", number, number]
    | ["l", number, number]
    | ["h", number]
    | ["v", number]
    | ["c", number, number, number, number, number, number]
    | ["s", number, number, number, number]
    | ["q", number, number, number, number]
    | ["t", number, number]
    | ["a", number, number, number, boolean, boolean, number, number];

type PathCommand = AbsolutePathCommand | RelativePathCommand;
```

### Segments

```ts
type PathLineSegment = ["L", Vector, Vector];

type PathCubicSegment = ["C", Vector, Vector, Vector, Vector];

type PathQuadraticSegment = ["Q", Vector, Vector, Vector];

type PathArcSegment = [
    "A",
    Vector,
    number, // rx
    number, // ry
    number, // rotation
    boolean, // large-arc-flag
    boolean, // sweep-flag
    Vector,
];

type PathSegment =
    | PathLineSegment
    | PathCubicSegment
    | PathQuadraticSegment
    | PathArcSegment;
```

## License

MIT License

Copyright © 2024 Adam Platkevič
