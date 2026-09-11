/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 A cubic whose endpoints coincide is a loop, not a degenerate segment.
 Splitting a self-intersecting cubic at its crossing produces exactly that, so
 the pipeline meets one whenever an input path crosses itself.
*/
import { describe, expect, test } from "@jest/globals";

import * as PathBool from "../index";
import { pathCubicSegmentSelfIntersection } from "../intersections/path-cubic-segment-self-intersection";
import {
    isNearlyLinearSegment,
    lineariseDegenerateSegment,
    pathSegmentBoundingBox,
    samplePathSegmentAt,
    splitSegmentAt,
} from "../primitives/PathSegment";
import type { PathCubicSegment } from "../primitives/PathSegment";
import { originFor, signedArea } from "./support/area";

/* The loop of the corpus fixture, taken at its self-intersection. */
const LOOP: PathCubicSegment = [
    "C",
    [0, 0.18947368421052557],
    [0.8259082916941265, 1.1368421052631576],
    [-0.8259082916941265, 1.1368421052631576],
    [0, 0.18947368421052557],
];

// Bernstein evaluation, independent of anything in src/.
function evalAt(seg: PathCubicSegment, t: number): [number, number] {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [0, 1].map((d) =>
        w.reduce((s, wi, i) => s + wi * (seg[i + 1] as number[])[d], 0),
    ) as [number, number];
}

describe("a cubic that closes on itself", () => {
    test("rounded endpoint contacts do not recursively create new loops", () => {
        // commons-193646307/00, reduced from the artwork report. The old
        // absolute-coordinate solve classified its closure as an interior
        // crossing, then recursively split the resulting closed child to OOM.
        const curve: PathCubicSegment = [
            "C",
            [56.472512000000016, 25.17099999999999],
            [56.472012000000014, 25.17109999999999],
            [56.472512000000016, 25.171699999999987],
            [56.472512000000016, 25.17099999999999],
        ];
        const crossing = pathCubicSegmentSelfIntersection(curve);
        expect(
            crossing === null ||
                crossing.every((t) => t <= 1e-8 || t >= 1 - 1e-8),
        ).toBe(true);
        const result = new PathBool.PathBoolean([
            { path: [curve], fillRule: PathBool.FillRule.NonZero },
        ]).get(PathBool.PathBooleanOperation.Union);
        expect(result.flat()).toHaveLength(1);
        expect(Math.abs(signedArea(result[0] as never, curve[1]))).toBeCloseTo(
            Math.abs(signedArea([curve] as never, curve[1])),
            16,
        );
    });
    test("is not linear", () => {
        expect(isNearlyLinearSegment(LOOP)).toBe(false);
        expect(lineariseDegenerateSegment(LOOP, 1e-6)).toBe(LOOP);
    });

    test("has a bounding box covering the loop, not a point", () => {
        const b = pathSegmentBoundingBox(LOOP);
        let lo: [number, number] = [Infinity, Infinity];
        let hi: [number, number] = [-Infinity, -Infinity];
        for (let k = 0; k <= 1000; k++) {
            const [x, y] = evalAt(LOOP, k / 1000);
            lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
            hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
        }
        // The loop really does enclose area: roughly x +-0.24, y 0.19..0.90.
        expect(hi[0] - lo[0]).toBeGreaterThan(0.4);
        expect(hi[1] - lo[1]).toBeGreaterThan(0.7);

        expect(b.left).toBeLessThanOrEqual(lo[0] + 1e-9);
        expect(b.top).toBeLessThanOrEqual(lo[1] + 1e-9);
        expect(b.right).toBeGreaterThanOrEqual(hi[0] - 1e-9);
        expect(b.bottom).toBeGreaterThanOrEqual(hi[1] - 1e-9);
    });

    test("samples trace the curve rather than standing still", () => {
        const mid = samplePathSegmentAt(LOOP, 0.5);
        expect(mid[1]).toBeCloseTo(evalAt(LOOP, 0.5)[1], 9);
        expect(Math.abs(mid[1] - LOOP[1][1])).toBeGreaterThan(0.5);
    });

    test("splits into two curves, not two zero-length lines", () => {
        const [first, second] = splitSegmentAt(LOOP, 0.5);
        expect(first[0]).toBe("C");
        expect(second[0]).toBe("C");
    });
});

describe("closed Beziers that retrace a line", () => {
    test.each([
        "M0 0 Q4 8 0 0 Z",
        "M0 0 C4 8 4 8 0 0 Z",
        "M0 0 C2 4 4 8 0 0 Z",
        "M0 0 C-2 -4 4 8 0 0 Z",
        "M0 0 C0 0 4 8 0 0 Z",
        "M0 0 C4 8 0 0 0 0 Z",
        "M0 0 C0 0 0 0 0 0 Z",
    ])("has no filled faces: %s", (data) => {
        const path = PathBool.pathFromPathData(data);
        const boolean = new PathBool.PathBoolean([
            { path, fillRule: PathBool.FillRule.NonZero },
        ]);
        expect(boolean.getFaces()).toEqual([]);
        expect(boolean.get(PathBool.PathBooleanOperation.Union)).toEqual([[]]);
    });
});

/*
 End to end, on the fixture that exposed this. The loop is the only part of the
 self-intersecting path that reaches into the circle -- the head and tail
 sections stay outside it entirely -- so while the loop was invisible the two
 shapes came out disjoint.
*/
describe("boolean operations across a self-intersection", () => {
    const a = PathBool.pathFromPathData(
        "M -1 -0.6 C 2.2 1.4 -2.2 1.4 1 -0.6 L -1 -0.6 Z",
    );
    const b = PathBool.pathFromPathData(
        "M 2.1 0.55 A 1 1 0 0 1 1.1 1.55 A 1 1 0 0 1 0.1 0.55 " +
            "A 1 1 0 0 1 1.1 -0.45 A 1 1 0 0 1 2.1 0.55 Z",
    );
    const origin = originFor([a, b] as never);
    const boolean = new PathBool.PathBoolean([
        { path: a, fillRule: PathBool.FillRule.NonZero },
        { path: b, fillRule: PathBool.FillRule.NonZero },
    ]);
    const areaOf = (op: PathBool.PathBooleanOperation) =>
        Math.abs(
            boolean
                .get(op)
                .reduce((s, p) => s + signedArea(p as never, origin), 0),
        );

    test("the circle overlapping the loop is not treated as disjoint", () => {
        // A thin sliver where the circle's left edge cuts into the loop: the
        // loop only reaches x = 0.24 and the circle starts at x = 0.1. Small,
        // but emphatically not the zero that was reported before.
        const intersection = areaOf(PathBool.PathBooleanOperation.Intersection);
        expect(intersection).toBeGreaterThan(0.005);
        expect(intersection).toBeLessThan(0.05);
    });

    test("union is smaller than the sum of the parts", () => {
        // |A| = 0.94946, measured against a far-away second path; |B| = pi.
        const union = areaOf(PathBool.PathBooleanOperation.Union);
        const intersection = areaOf(PathBool.PathBooleanOperation.Intersection);
        expect(union).toBeLessThan(0.94946 + Math.PI - 0.005);
        expect(union).toBeCloseTo(0.94946 + Math.PI - intersection, 4);
    });

    test("Fracture tiles the union", () => {
        const faces = boolean
            .get(PathBool.PathBooleanOperation.Fracture)
            .filter((p) => p.length);
        const total = faces.reduce(
            (s, f) => s + Math.abs(signedArea(f as never, origin)),
            0,
        );
        expect(total).toBeCloseTo(
            areaOf(PathBool.PathBooleanOperation.Union),
            6,
        );
    });
});
