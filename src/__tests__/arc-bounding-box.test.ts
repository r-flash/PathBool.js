/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Bounding boxes for arc segments, checked against arcs built directly from a
 centre parametrization rather than through anything in `src/`.

 Two properties matter, and they pull in opposite directions. The box must
 contain the arc, or the intersection finder will prune away a real crossing
 and the boolean result will be wrong. And it must not be much larger than the
 arc, or nothing gets pruned and the finder grinds: a box that was 20x the
 arc's own chord is what made a rotated ellipse take 18 seconds against a
 single corner arc.
*/
import { describe, expect, test } from "@jest/globals";

import { pathSegmentBoundingBox } from "../primitives/PathSegment";
import type { PathArcSegment } from "../primitives/PathSegment";
import type { Vector } from "../primitives/Vector";

type ArcSpec = {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    phiDeg: number;
    theta1: number;
    deltaTheta: number;
};

/* The arc, from its centre form. Independent of the library's recovery of it. */
function pointAt(a: ArcSpec, theta: number): Vector {
    const r = (a.phiDeg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const x = a.rx * Math.cos(theta);
    const y = a.ry * Math.sin(theta);
    return [a.cx + c * x - s * y, a.cy + s * x + c * y];
}

function toSegment(a: ArcSpec): PathArcSegment {
    return [
        "A",
        pointAt(a, a.theta1),
        a.rx,
        a.ry,
        a.phiDeg,
        Math.abs(a.deltaTheta) > Math.PI,
        a.deltaTheta > 0,
        pointAt(a, a.theta1 + a.deltaTheta),
    ];
}

const SAMPLES = 200;

function sampleArc(a: ArcSpec): Vector[] {
    const points: Vector[] = [];
    for (let k = 0; k <= SAMPLES; k++) {
        points.push(pointAt(a, a.theta1 + (a.deltaTheta * k) / SAMPLES));
    }
    return points;
}

function extentOf(points: Vector[]): number {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
    );
}

function boxExtent(seg: PathArcSegment): number {
    const b = pathSegmentBoundingBox(seg);
    return Math.max(b.right - b.left, b.bottom - b.top);
}

describe("arc bounding boxes", () => {
    /*
     With rx === ry every rotation describes the identical circle, so the box
     must not depend on phi at all. It used to: the axis extremes were tested
     at k*pi/2 when the parametrization angle is measured before phi is
     applied, so a small arc sitting where a rotated extreme lands claimed the
     far side of the circle.
    */
    test("a circular arc's box does not depend on how it is rotated", () => {
        const spec: ArcSpec = {
            cx: 0,
            cy: 0,
            rx: 1,
            ry: 1,
            phiDeg: 0,
            theta1: Math.PI / 4,
            deltaTheta: 0.1,
        };
        const trueExtent = extentOf(sampleArc(spec));

        for (const phiDeg of [
            0, 10, 45, 80, 90, 100, 135, 170, 180, -45, -90, -135,
        ]) {
            // Same geometry, re-expressed: shift the parametrization angle so
            // the arc stays put while phi changes.
            const rotated: ArcSpec = {
                ...spec,
                phiDeg,
                theta1: spec.theta1 - (phiDeg * Math.PI) / 180,
            };
            expect(extentOf(sampleArc(rotated))).toBeCloseTo(trueExtent, 12);
            expect(boxExtent(toSegment(rotated))).toBeCloseTo(trueExtent, 6);
        }
    });

    /*
     A deterministic sweep over arcs of every shape, rotation and sweep
     direction, including sweeps past a half turn where the box has to pick up
     axis extremes the endpoints do not reveal.
    */
    const arcs: ArcSpec[] = (() => {
        let seed = 12345;
        const rnd = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        return Array.from({ length: 2000 }, (_, i) => {
            const rx = 0.05 + rnd() * 2;
            return {
                cx: rnd() * 4 - 2,
                cy: rnd() * 4 - 2,
                rx,
                // Half of them circular. `pathSegmentBoundingBox` takes a
                // different branch for rx === ry, and independently random
                // radii would never land on it — the branch holding the bug
                // these tests exist for.
                ry: i % 2 === 0 ? rx : 0.05 + rnd() * 2,
                phiDeg: rnd() * 360 - 180,
                theta1: rnd() * 2 * Math.PI - Math.PI,
                deltaTheta: (rnd() * 2 - 1) * Math.PI * 1.9,
            };
        });
    })();

    test("every box contains its arc", () => {
        let worst = 0;
        let worstSpec: ArcSpec | null = null;

        for (const spec of arcs) {
            const b = pathSegmentBoundingBox(toSegment(spec));
            for (const [x, y] of sampleArc(spec)) {
                const escape = Math.max(
                    b.left - x,
                    x - b.right,
                    b.top - y,
                    y - b.bottom,
                );
                if (escape > worst) {
                    worst = escape;
                    worstSpec = spec;
                }
            }
        }

        // Float noise only; a genuine miss would be orders larger. Reported
        // as a value rather than a bare comparison so the offending arc is in
        // the failure output.
        expect(worst < 1e-9 ? null : { worst, worstSpec }).toBeNull();
    });

    test("no box is meaningfully larger than its arc", () => {
        let worstRatio = 0;
        let total = 0;

        for (const spec of arcs) {
            const trueExtent = extentOf(sampleArc(spec));
            if (trueExtent < 1e-9) continue;
            const ratio = boxExtent(toSegment(spec)) / trueExtent;
            total += ratio;
            worstRatio = Math.max(worstRatio, ratio);
        }

        // Sampling can only under-report the true extent, so ratios sit at or
        // just above 1. The regression this guards produced ratios of 8.8 and
        // 20.2, so even a loose ceiling catches it.
        expect(total / arcs.length).toBeLessThan(1.01);
        expect(worstRatio).toBeLessThan(1.1);
    });
});
