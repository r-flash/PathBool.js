/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Two curves meeting at a shallow angle make the subdivision report one crossing
 many times over, because it cannot separate the crossing from its
 surroundings. Those reports are collapsed back to one — but only where the
 curves really are in the same place, since merging two genuine crossings is
 the worse failure of the two: it silently removes a face.
*/
import { describe, expect, test } from "@jest/globals";

import { epsilonsForExtent } from "../config";
import * as PathBool from "../index";
import { samplePathSegmentAt } from "../primitives/PathSegment";
import type { PathSegment } from "../primitives/PathSegment";

const KAPPA = 0.5522847498307936;

/* The unit circle, as four arcs and as the four cubics that approximate it. */
const ARC_CIRCLE = PathBool.pathFromPathData(
    "M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 0 1 -1 0 A 1 1 0 0 1 0 -1 A 1 1 0 0 1 1 0 Z",
);
const CUBIC_CIRCLE = PathBool.pathFromPathData(
    `M 1 0 C 1 ${KAPPA} ${KAPPA} 1 0 1 C ${-KAPPA} 1 -1 ${KAPPA} -1 0 ` +
        `C -1 ${-KAPPA} ${-KAPPA} -1 0 -1 C ${KAPPA} -1 1 ${-KAPPA} 1 0 Z`,
);

// Rounded, with -0.0000 folded onto 0.0000 so a coordinate a hair below zero
// does not read as a separate point.
function round(v: number) {
    const r = v.toFixed(4);
    return r === "-0.0000" ? "0.0000" : r;
}

function contactPoints(a: PathSegment[], b: PathSegment[], extent: number) {
    const eps = epsilonsForExtent(extent);
    const seen = new Set<string>();
    let reported = 0;
    for (const s of a) {
        for (const t of b) {
            for (const [t0] of PathBool.pathSegmentIntersection(s, t, eps)) {
                reported++;
                const p = samplePathSegmentAt(s, t0);
                seen.add(`${round(p[0])},${round(p[1])}`);
            }
        }
    }
    return { reported, distinct: [...seen].sort() };
}

describe("intersection reports are collapsed per crossing", () => {
    /*
     A kappa cubic touches the circle it approximates at both ends of each
     quadrant and again at the quadrant's midpoint, bulging about 3e-4 outside
     in between: eight contacts in all, every one of them tangential. Before
     grouping this reported 146 points, which became 103 faces each claiming
     to be the outer one.
    */
    test("a circle against its own cubic approximation gives eight", () => {
        const { reported, distinct } = contactPoints(
            ARC_CIRCLE,
            CUBIC_CIRCLE,
            2,
        );
        expect(distinct).toEqual([
            "-0.7071,-0.7071",
            "-0.7071,0.7071",
            "-1.0000,0.0000",
            "0.0000,-1.0000",
            "0.0000,1.0000",
            "0.7071,-0.7071",
            "0.7071,0.7071",
            "1.0000,0.0000",
        ]);
        // Some contacts sit on a shared endpoint and so are found by two
        // segment pairs; what matters is that the count is of that order and
        // not of the order of a hundred.
        expect(reported).toBeLessThan(20);
    });

    /*
     The other direction, which is the one that bites. Two crossings only a few
     leaf-widths apart must still be reported separately, or a face disappears.
     An earlier attempt grouped by leaf size — treating a report as accurate
     only to the width of the leaf that produced it — and merged crossings this
     close, losing five faces in visual-tests/real-02.
    */
    test("two nearby crossings are kept apart", () => {
        const eps = epsilonsForExtent(2);
        const line = PathBool.pathFromPathData("M -1 0 L 1 0");
        // Crosses the line, dips 4e-6 below it and crosses back, over a span
        // of 2e-5. A few leaf-widths across, so the subdivision does resolve
        // it, and a hundred times eps.point deep, so the curves are plainly in
        // different places in between.
        const dip = PathBool.pathFromPathData(
            "M -0.00001 0.000002 Q 0 -0.00001 0.00001 0.000002",
        );
        expect(2e-5 / eps.linear).toBeGreaterThan(2);
        expect(4e-6 / eps.point).toBeGreaterThan(50);

        const hits = PathBool.pathSegmentIntersection(line[0], dip[0], eps);
        expect(hits.length).toBe(2);
        const xs = hits
            .map(([t0]) => samplePathSegmentAt(line[0], t0)[0])
            .sort((p, q) => p - q);
        expect(xs[1] - xs[0]).toBeGreaterThan(5e-6);
    });

    test("a plain transversal crossing is still reported once", () => {
        const eps = epsilonsForExtent(2);
        const a = PathBool.pathFromPathData("M -1 0 L 1 0");
        const b = PathBool.pathFromPathData("M 0 -1 L 0 1");
        expect(PathBool.pathSegmentIntersection(a[0], b[0], eps).length).toBe(
            1,
        );
    });
});
