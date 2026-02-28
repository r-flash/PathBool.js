/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from "@jest/globals";

import * as PathBool from "../index";
import { Path } from "../primitives/Path";
import { reversePathSegment } from "../primitives/PathSegment";

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

describe("robustness properties", () => {
    test("determinism under near-tangent geometry", () => {
        const pathA = PathBool.pathFromPathData("M0 0 C 10 0 10 1e-12 20 0");
        const pathB = PathBool.pathFromPathData("M10 -1 L10 1");
        const aFillRule = PathBool.FillRule.NonZero;
        const bFillRule = PathBool.FillRule.NonZero;

        const expected = serializePaths(
            PathBool.pathBoolean(
                pathA,
                aFillRule,
                pathB,
                bFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );

        for (let i = 0; i < 20; i++) {
            const next = serializePaths(
                PathBool.pathBoolean(
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
            PathBool.pathBoolean(
                pathA,
                aFillRule,
                pathB,
                bFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );
        const unionBA = serializePaths(
            PathBool.pathBoolean(
                pathB,
                bFillRule,
                pathA,
                aFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );
        expect(unionAB).toBe(unionBA);

        const interAB = serializePaths(
            PathBool.pathBoolean(
                pathA,
                aFillRule,
                pathB,
                bFillRule,
                PathBool.PathBooleanOperation.Intersection,
            ),
        );
        const interBA = serializePaths(
            PathBool.pathBoolean(
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
            PathBool.pathBoolean(
                pathA,
                aFillRule,
                empty,
                aFillRule,
                PathBool.PathBooleanOperation.Union,
            ),
        );
        expect(union).toBe(serializePaths([pathA]));

        const intersection = PathBool.pathBoolean(
            pathA,
            aFillRule,
            empty,
            aFillRule,
            PathBool.PathBooleanOperation.Intersection,
        );
        expect(serializePaths(intersection)).toBe("");

        const difference = serializePaths(
            PathBool.pathBoolean(
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
