/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Bounding boxes for cubic segments, checked against Bernstein evaluation rather
 than against anything in `src/`.

 A box that fails to contain its curve is a correctness bug, not a cosmetic
 one: the intersection finder prunes candidate pairs by box overlap, so a curve
 poking outside its own box has its crossings silently discarded and the
 boolean result comes out wrong with nothing raised.
*/
import { describe, expect, test } from "@jest/globals";

import { pathSegmentBoundingBox } from "../primitives/PathSegment";
import type { PathCubicSegment } from "../primitives/PathSegment";

type Cubic = [number, number][];

function evalAt(P: Cubic, t: number): [number, number] {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [0, 1].map((d) => w.reduce((s, wi, i) => s + wi * P[i][d], 0)) as [
        number,
        number,
    ];
}

const toSegment = (P: Cubic): PathCubicSegment => ["C", P[0], P[1], P[2], P[3]];

const SAMPLES = 500;

function escapeOf(P: Cubic): number {
    const b = pathSegmentBoundingBox(toSegment(P));
    let worst = 0;
    for (let k = 0; k <= SAMPLES; k++) {
        const [x, y] = evalAt(P, k / SAMPLES);
        worst = Math.max(
            worst,
            b.left - x,
            x - b.right,
            b.top - y,
            y - b.bottom,
        );
    }
    return worst;
}

function looseness(P: Cubic): number {
    const b = pathSegmentBoundingBox(toSegment(P));
    let lo: [number, number] = [Infinity, Infinity];
    let hi: [number, number] = [-Infinity, -Infinity];
    for (let k = 0; k <= SAMPLES; k++) {
        const [x, y] = evalAt(P, k / SAMPLES);
        lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
        hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
    }
    const trueExtent = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
    const boxExtent = Math.max(b.right - b.left, b.bottom - b.top);
    return trueExtent < 1e-9 ? 1 : boxExtent / trueExtent;
}

function generate(count: number, symmetric: boolean): Cubic[] {
    let seed = 20260803;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    return Array.from({ length: count }, () => {
        const coord = () => rnd() * 4 - 2;
        if (!symmetric) {
            return [
                [coord(), coord()],
                [coord(), coord()],
                [coord(), coord()],
                [coord(), coord()],
            ] as Cubic;
        }
        // p0y === p3y and p1y === p2y makes the derivative's leading
        // coefficient vanish analytically in y.
        const y0 = coord();
        const y1 = coord();
        return [
            [coord(), y0],
            [coord(), y1],
            [coord(), y1],
            [coord(), y0],
        ] as Cubic;
    });
}

describe("cubic bounding boxes", () => {
    /*
     The shape that first exposed this: an ordinary symmetric arch. Its box
     used to report a height of zero while the curve rose to 1.5, because the
     derivative's leading coefficient is analytically zero and the quadratic
     solve divided by the rounding noise left in its place.
    */
    test("a symmetric arch's box covers its apex", () => {
        const arch: Cubic = [
            [-1, 0],
            [0, 2],
            [0, 2],
            [1, 0],
        ];
        const b = pathSegmentBoundingBox(toSegment(arch));
        expect(evalAt(arch, 0.5)[1]).toBeCloseTo(1.5, 12);
        expect(b.bottom).toBeGreaterThanOrEqual(1.5 - 1e-9);
        expect(b.top).toBeCloseTo(0, 9);
    });

    for (const symmetric of [false, true]) {
        const label = symmetric ? "symmetric in y" : "arbitrary";
        const cubics = generate(2000, symmetric);

        test(`every box contains its curve (${label})`, () => {
            let worst = 0;
            let worstCubic: Cubic | null = null;
            for (const P of cubics) {
                const escape = escapeOf(P);
                if (escape > worst) {
                    worst = escape;
                    worstCubic = P;
                }
            }
            expect(worst < 1e-9 ? null : { worst, worstCubic }).toBeNull();
        });

        test(`no box is meaningfully larger than its curve (${label})`, () => {
            const ratios = cubics.map(looseness);
            expect(Math.max(...ratios)).toBeLessThan(1.05);
        });
    }
});
