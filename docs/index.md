# PathBool.js documentation

## Demos

- [basic](./demo.html)

## Installation

You can use npm or any compatible package manager:

```shell
npm install path-bool
```

Alternatively, you can just `import`
from [dist/path-bool.js](https://github.com/r-flash/PathBool.js/blob/master/dist/path-bool.js),
`require()` [dist/path-bool.umd.js](https://github.com/r-flash/PathBool.js/blob/master/dist/path-bool.umd.js)
or load the UMD build using a `<script src="...">`,
in which case the library will be exposed under the global variable `PathBool`.

There are also "core" builds available
which don't include the string path data parser.

## A quick look at the API

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

## Usage

The main function has the following interface:

```ts
function pathBoolean(
    a: Path,
    aFillRule: FillRule,
    b: Path,
    bFillRule: FillRule,
    op: PathBooleanOperation,
): Path[];
```

The output array is empty if the input paths are empty.
It contains exactly one `Path` when the operation is `Union`, `Difference`, `Intersection`, or `Exclusion`.
Potentially multiple `Path`s are output for operations `Division` and `Fracture`.

Here, `FillRule` is an enum
(see [fill-rule documentation on MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/fill-rule) for
details):

```ts
enum FillRule {
    NonZero,
    EvenOdd,
}
```

`PathBooleanOperation` is an enum:

```ts
enum PathBooleanOperation {
    Union,        // logical OR
    Difference,   // A and not B
    Intersection, // logical AND
    Exclusion,    // logical XOR
    Division,     // use B to slice A into partitions
    Fracture,     // output all partitions
}
```

`Path` is an array of `PathSegment`s, which in turn are defined as:

```ts
type Vector = [number, number];

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

They correspond to the `L`, `C`, `Q`, and `A`
[SVG path commands](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#path_commands)
with the start point (the previous point, if you will)
as the second element after the letter.
This is the minimal representation of SVG path data,
but it's not very useful if your inputs and outputs are SVG paths.

Therefore, there are two other representations that you can convert to and from `Path`s.

The middle ground are arrays of `PathCommand`s.
This is a representation that you should be able to obtain from any other representation
without substantial pain.
`PathCommand`s are defined as:

```ts
type PathCommand =
    | ["M", Vector]
    | ["L", Vector]
    | ["C", Vector, Vector, Vector]
    | ["S", Vector, Vector]
    | ["Q", Vector, Vector]
    | ["T", Vector]
    | ["A", number, number, number, boolean, boolean, Vector]
    | ["Z"]
    | ["z"]
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
```

The command letters and order of parameters match with what you would write in the `d` attribute of a `<path>`.
Absolute coordinates are encoded as `Vector`s,
i.e., `[number, number]` arrays.

There is the following pair of functions to convert `Path`s to and from this representation:

```ts
const path = PathBool.pathFromCommands(commands);
const commands = PathBool.pathToCommands(path);
```

Another option is working with `d` attributes directly:

```ts
const path = PathBool.pathFromPathData("M 0,0 h 10 v 10 z");
const pathData = PathBool.pathToPathData(path);
```

Please bear in mind that the parser behind `pathFromPathData` is not fully standards-compliant.
For one, it throws when encountering bad or weird data,
rather than outputting the good part of the parse.
