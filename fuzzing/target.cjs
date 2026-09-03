const PathBool = require("./build/path-bool.cjs");

const MAX_INPUT_BYTES = 100000;

const ops = {
    union: PathBool.PathBooleanOperation.Union,
    difference: PathBool.PathBooleanOperation.Difference,
    intersection: PathBool.PathBooleanOperation.Intersection,
    exclusion: PathBool.PathBooleanOperation.Exclusion,
    division: PathBool.PathBooleanOperation.Division,
    fracture: PathBool.PathBooleanOperation.Fracture,
};

function fuzz(buf) {
    if (buf.length > MAX_INPUT_BYTES) return;
    const str = buf.toString();
    const arr = str.split("\n");

    if (arr.length !== 2) return;

    let pathA = null;
    let pathB = null;

    try {
        pathA = PathBool.pathFromPathData(arr[0]);
        pathB = PathBool.pathFromPathData(arr[1]);
    } catch (e) {
        return;
    }

    const aFillRule =
        arr[0].length % 2 === 0
            ? PathBool.FillRule.EvenOdd
            : PathBool.FillRule.NonZero;
    const bFillRule =
        arr[1].length % 2 === 0
            ? PathBool.FillRule.EvenOdd
            : PathBool.FillRule.NonZero;

    const pathBoolean = new PathBool.PathBoolean([
        { path: pathA, fillRule: aFillRule },
        { path: pathB, fillRule: bFillRule },
    ]);

    for (const op of Object.values(ops)) {
        pathBoolean.get(op);
    }
}

module.exports = {
    fuzz,
};
