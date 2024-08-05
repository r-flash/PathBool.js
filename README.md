# PathBool.js

A low-level library for performing boolean operations on SVG paths.
The project is still in early stages of development;
please, help me test it and provide reduced examples of failure cases.

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

const op = PathBool.PathBooleanOperation.Union;

const result = PathBool.pathBoolean(pathA, fillRuleA, pathB, fillRuleB, op);

console.log(result.map(PathBool.pathToPathData));
console.log(result.map(PathBool.pathToCommands));
```

## License

MIT License

Copyright © 2024 Adam Platkevič
