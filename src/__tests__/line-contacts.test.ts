import { expect, test } from "@jest/globals";

import { EPS } from "../config";
import { pathSegmentIntersection } from "../intersections/path-segment";
import { PathSegment, samplePathSegmentAt } from "../primitives/PathSegment";

test("parallel diagonals on different lines do not overlap", () => {
    expect(
        pathSegmentIntersection(
            ["L", [0, 0], [10, 10]],
            ["L", [0, 1], [10, 11]],
            EPS,
        ),
    ).toEqual([]);
});

test("rounded diagonal directions still identify a shared boundary", () => {
    const hits = pathSegmentIntersection(
        ["L", [0, 0], [66.667, 66.667]],
        ["L", [66.667 + 1e-13, 66.667], [0, 0]],
        EPS,
    );
    expect(hits).toHaveLength(2);
});

test("an endpoint and a nearby crossing are distinct even in a shallow excursion", () => {
    // Reduced from commons-89980899/02: a rounded corner overshoots a
    // vertical edge, then returns to its endpoint on that edge.
    const line: PathSegment = ["L", [1, -1], [1, 2]];
    const curve: PathSegment = ["C", [0, 1], [0, 1], [1 + 1e-6, 1], [1, 0]];
    const hits = pathSegmentIntersection(line, curve, EPS);
    expect(hits).toHaveLength(2);
    expect(hits[0][1]).toBeLessThan(1 - 1e-8);
    expect(hits[1][1]).toBe(1);
    for (const [s, t] of hits) {
        const a = samplePathSegmentAt(line, s),
            b = samplePathSegmentAt(curve, t);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-12);
    }
});

test("a stationary quadratic contact is retained", () => {
    const hits = pathSegmentIntersection(
        ["L", [-1, 0], [2, 0]],
        ["Q", [0, 1 / 9], [0.5, -2 / 9], [1, 4 / 9]],
        EPS,
    );
    expect(hits.some(([, t]) => Math.abs(t - 1 / 3) < 1e-12)).toBe(true);
});

test("almost tangent circular arcs retain the crossing next to a shared endpoint", () => {
    const a: PathSegment = ["A", [1, 0], 1, 1, 0, false, true, [0, 1 + 1e-7]];
    const b: PathSegment = ["A", [1, 0], 1, 1, 0, false, false, [2, 1 + 1e-7]];
    const hits = pathSegmentIntersection(a, b, EPS);
    expect(hits).toHaveLength(2);
    expect(hits.some(([s, t]) => s === 0 && t === 0)).toBe(true);
    expect(hits.some(([s, t]) => s > EPS.param && t > EPS.param)).toBe(true);
});
