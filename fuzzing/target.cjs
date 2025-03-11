const PathBool = require("./build/path-bool.cjs");

const ops = {
    union: PathBool.PathBooleanOperation.Union,
    difference: PathBool.PathBooleanOperation.Difference,
    intersection: PathBool.PathBooleanOperation.Intersection,
    exclusion: PathBool.PathBooleanOperation.Exclusion,
    division: PathBool.PathBooleanOperation.Division,
    fracture: PathBool.PathBooleanOperation.Fracture,
};

function fuzz(buf) {
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

    for (const op of Object.values(ops)) {
        PathBool.pathBoolean(pathA, aFillRule, pathB, bFillRule, op);
    }
}

module.exports = {
    fuzz,
};
