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

// Compares paths up to rotation of segments and reversal of orientation.
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

function makePathBoolean(
    a: string,
    b: string,
    aFillRule = PathBool.FillRule.NonZero,
    bFillRule = PathBool.FillRule.NonZero,
): PathBool.PathBoolean {
    return new PathBool.PathBoolean([
        { path: PathBool.pathFromPathData(a), fillRule: aFillRule },
        { path: PathBool.pathFromPathData(b), fillRule: bFillRule },
    ]);
}

// Two overlapping shapes that produce several atomic regions.
const OVERLAP_A = "M0 0 L20 0 L20 20 L0 20 Z";
const OVERLAP_B = "M10 10 L30 10 L30 30 L10 30 Z";

// A small square fully inside a larger one (disjoint, nested boundaries).
const OUTER = "M0 0 L30 0 L30 30 L0 30 Z";
const INNER = "M10 10 L20 10 L20 20 L10 20 Z";

describe("shape builder API", () => {
    test("getFaces matches the Fracture operation", () => {
        const pb = makePathBoolean(OVERLAP_A, OVERLAP_B);
        const faces = pb.getFaces();
        const fractured = pb.get(PathBool.PathBooleanOperation.Fracture);

        expect(faces.length).toBe(fractured.length);
        expect(faces.length).toBeGreaterThan(1);
        for (let i = 0; i < faces.length; i++) {
            expect(canonicalizePath(faces[i])).toBe(
                canonicalizePath(fractured[i]),
            );
        }
    });

    test("selecting all regions equals the union", () => {
        const pb = makePathBoolean(OVERLAP_A, OVERLAP_B);
        const faces = pb.getFaces();
        const allIndices = faces.map((_, i) => i);

        const shape = pb.buildShape(allIndices);
        const union = pb.get(PathBool.PathBooleanOperation.Union)[0];

        expect(canonicalizePath(shape)).toBe(canonicalizePath(union));
    });

    test("a single selected region round-trips to its face", () => {
        const pb = makePathBoolean(OVERLAP_A, OVERLAP_B);
        const faces = pb.getFaces();

        for (let i = 0; i < faces.length; i++) {
            expect(canonicalizePath(pb.buildShape([i]))).toBe(
                canonicalizePath(faces[i]),
            );
        }
    });

    test("disjoint nested region keeps its hole", () => {
        const pb = makePathBoolean(OUTER, INNER);
        const faces = pb.getFaces();
        expect(faces.length).toBe(2);

        // The ring (outer minus inner) is the face with two boundary loops.
        const ringIndex = faces.findIndex((p) => p.length > 4);
        const diskIndex = 1 - ringIndex;
        expect(ringIndex).toBeGreaterThanOrEqual(0);

        // Selecting only the ring yields outer-minus-inner (a hole), i.e. the
        // Difference of the two paths.
        const difference = pb.get(PathBool.PathBooleanOperation.Difference)[0];
        expect(canonicalizePath(pb.buildShape([ringIndex]))).toBe(
            canonicalizePath(difference),
        );

        // Selecting only the disk yields just the inner square.
        expect(canonicalizePath(pb.buildShape([diskIndex]))).toBe(
            canonicalizePath(PathBool.pathFromPathData(INNER)),
        );

        // Selecting both fills the hole back in: the plain outer square.
        expect(canonicalizePath(pb.buildShape([ringIndex, diskIndex]))).toBe(
            canonicalizePath(PathBool.pathFromPathData(OUTER)),
        );
    });

    test("empty and out-of-range selections", () => {
        const pb = makePathBoolean(OVERLAP_A, OVERLAP_B);

        expect(pb.buildShape([])).toEqual([]);

        // Out-of-range indices are ignored.
        expect(pb.buildShape([999])).toEqual([]);
        expect(canonicalizePath(pb.buildShape([0, 999]))).toBe(
            canonicalizePath(pb.buildShape([0])),
        );
    });
});
