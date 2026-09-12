/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from "@jest/globals";

import {
    issue3CubicAndRetracedLine,
    issue3RetracedTriangle,
} from "../__fixtures__/reported-issues/issue-3";
import * as PathBool from "../index";
import { Path } from "../primitives/Path";
import { reversePathSegment } from "../primitives/PathSegment";
import { createOracle } from "./support/structural-oracle";

// Local two-path convenience wrapper around the variadic PathBoolean class.
function pathBoolean(
    a: Path,
    aFillRule: PathBool.FillRule,
    b: Path,
    bFillRule: PathBool.FillRule,
    op: PathBool.PathBooleanOperation,
): Path[] {
    return new PathBool.PathBoolean([
        { path: a, fillRule: aFillRule },
        { path: b, fillRule: bFillRule },
    ]).get(op);
}

function reversePath(path: Path): Path {
    return [...path].reverse().map((seg) => reversePathSegment(seg));
}

function rotatePath(path: Path, startIndex: number): Path {
    if (path.length === 0) return path;
    return path.slice(startIndex).concat(path.slice(0, startIndex));
}

function canonicalizePath(path: Path): string {
    if (path.length === 0) return "";
    const variants: string[] = [];
    for (let i = 0; i < path.length; i++) {
        variants.push(PathBool.pathToPathData(rotatePath(path, i), 1e-6));
        variants.push(
            PathBool.pathToPathData(reversePath(rotatePath(path, i)), 1e-6),
        );
    }
    variants.sort();
    return variants[0];
}

function serializePaths(paths: Path[]): string {
    return paths.map(canonicalizePath).sort().join("|");
}

describe("issue #3 exclusion regressions", () => {
    const structural = createOracle(PathBool);
    const variants = [
        PathBool.FillRule.NonZero,
        PathBool.FillRule.EvenOdd,
    ].flatMap((fillRule) =>
        [false, true].map((swapped) => ({ fillRule, swapped })),
    );

    function exclude(
        a: Path,
        b: Path,
        fillRule: PathBool.FillRule,
        swapped: boolean,
    ) {
        return pathBoolean(
            swapped ? b : a,
            fillRule,
            swapped ? a : b,
            fillRule,
            PathBool.PathBooleanOperation.Exclusion,
        );
    }

    // A cycle may contain forward and backward half-edges. Preserve each
    // segment's direction when collapsing it (artwork-corpus.html#minor).
    test.each(variants)(
        "retraced triangle stays closed (fill rule $fillRule, swapped $swapped)",
        ({ fillRule, swapped }) => {
            const { a, b } = issue3RetracedTriangle;
            const result = exclude(a, b, fillRule, swapped);
            expect(structural.checkLoopsClose(result, 1e-6)).toBeNull();
            // The first two edges cancel; the remaining four bound a triangle.
            // B retraces a separate line and contributes no filled region.
            expect(serializePaths(result)).toBe(serializePaths([a.slice(2)]));
        },
    );

    test.each(variants)(
        "cubic path survives exclusion of a retraced line (fill rule $fillRule, swapped $swapped)",
        ({ fillRule, swapped }) => {
            const { a, b } = issue3CubicAndRetracedLine;
            const result = exclude(a, b, fillRule, swapped);
            expect(structural.checkLoopsClose(result, 1e-6)).toBeNull();
            // Splitting and rejoining can round cubic controls even when the
            // filled region is unchanged. Require the same command structure
            // and bound coordinate differences by the arithmetic scale.
            const tokens = (paths: Path[]) =>
                serializePaths(paths).match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)!;
            const actual = tokens(result),
                expected = tokens([a]);
            expect(actual).toHaveLength(expected.length);
            for (let i = 0; i < expected.length; i++) {
                const x = Number(actual[i]),
                    y = Number(expected[i]);
                if (Number.isNaN(y)) expect(actual[i]).toBe(expected[i]);
                else
                    expect(Math.abs(x - y)).toBeLessThanOrEqual(
                        64 *
                            Number.EPSILON *
                            Math.max(Math.abs(x), Math.abs(y)),
                    );
            }
        },
    );
});

describe("robustness properties", () => {
    test.each([PathBool.FillRule.NonZero, PathBool.FillRule.EvenOdd])(
        "a retraced closed Bezier has no effect on exclusion (fill rule %s)",
        (fillRule) => {
            const a = PathBool.pathFromPathData(
                "M717.91,881.01 " +
                    "c0.84,-6.47 17.65,-12.82 15.22,-7.23 " +
                    "c-3.18,2.73 -6.11,5.69 -8.79,8.88 " +
                    "c-0.48,0.26 -0.88,0.18 -1.21,-0.25 " +
                    "c-0.8,-4.44 -4.09,2.62 -5.22,-1.4 Z",
            );
            const b = PathBool.pathFromPathData(
                "M723.21,879.97 c0.53,-0.68 0.53,-0.68 0,0 Z",
            );
            for (const [first, second] of [
                [a, b],
                [b, a],
            ]) {
                const boolean = new PathBool.PathBoolean([
                    { path: first, fillRule },
                    { path: second, fillRule },
                ]);
                // The four cubics already close; Z adds a redundant line.
                expect(
                    serializePaths(
                        boolean.get(PathBool.PathBooleanOperation.Exclusion),
                    ),
                ).toBe(serializePaths([a.slice(0, 4)]));
                expect(
                    serializePaths(
                        boolean.get(PathBool.PathBooleanOperation.Intersection),
                    ),
                ).toBe("");
            }
        },
    );

    test("determinism under near-tangent geometry", () => {
        const pathA = PathBool.pathFromPathData("M0 0 C 10 0 10 1e-12 20 0");
        const pathB = PathBool.pathFromPathData("M10 -1 L10 1");
        const aFillRule = PathBool.FillRule.NonZero;
        const bFillRule = PathBool.FillRule.NonZero;

        const expected = serializePaths(
            pathBoolean(
                pathA,
                aFillRule,
                pathB,
                bFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );

        for (let i = 0; i < 20; i++) {
            const next = serializePaths(
                pathBoolean(
                    pathA,
                    aFillRule,
                    pathB,
                    bFillRule,
                    PathBool.PathBooleanOperation.Union,
                ),
            );
            expect(next).toBe(expected);
        }
    });

    test("symmetry for union and intersection", () => {
        const pathA = PathBool.pathFromPathData("M0 0 L10 0 L10 10 L0 10 Z");
        const pathB = PathBool.pathFromPathData("M5 -5 L15 5 L5 15 Z");
        const aFillRule = PathBool.FillRule.NonZero;
        const bFillRule = PathBool.FillRule.EvenOdd;

        const unionAB = serializePaths(
            pathBoolean(
                pathA,
                aFillRule,
                pathB,
                bFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );
        const unionBA = serializePaths(
            pathBoolean(
                pathB,
                bFillRule,
                pathA,
                aFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );
        expect(unionAB).toBe(unionBA);

        const interAB = serializePaths(
            pathBoolean(
                pathA,
                aFillRule,
                pathB,
                bFillRule,
                PathBool.PathBooleanOperation.Intersection,
            ),
        );
        const interBA = serializePaths(
            pathBoolean(
                pathB,
                bFillRule,
                pathA,
                aFillRule,
                PathBool.PathBooleanOperation.Intersection,
            ),
        );
        expect(interAB).toBe(interBA);
    });

    test("basic identities with empty path", () => {
        const pathA = PathBool.pathFromPathData("M0 0 L10 0 L10 10 L0 10 Z");
        const empty: Path = [];
        const aFillRule = PathBool.FillRule.NonZero;

        const union = serializePaths(
            pathBoolean(
                pathA,
                aFillRule,
                empty,
                aFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );
        expect(union).toBe(serializePaths([pathA]));

        const intersection = pathBoolean(
            pathA,
            aFillRule,
            empty,
            aFillRule,
            PathBool.PathBooleanOperation.Intersection,
        );
        expect(serializePaths(intersection)).toBe("");

        const difference = serializePaths(
            pathBoolean(
                pathA,
                aFillRule,
                empty,
                aFillRule,
                PathBool.PathBooleanOperation.Difference,
            ),
        );
        expect(difference).toBe(serializePaths([pathA]));
    });
});
