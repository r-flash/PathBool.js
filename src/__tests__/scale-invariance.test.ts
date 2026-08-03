/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 The same drawing, drawn smaller, must give the same answer scaled down.

 That failed to hold because the length-valued tolerances were fixed
 constants: at a scene a few thousandths of a unit across, subdivision stopped
 while a chord still spanned much of its arc, intersection points landed
 further apart than the vertex-merging tolerance, and output loops were left
 open by most of the width of the scene.

 Scaling by powers of two so the coordinates themselves are exact and only the
 algorithm's behaviour is under test.
*/
import { describe, expect, test } from "@jest/globals";

import * as PathBool from "../index";
import type { Path } from "../index";
import { originFor, signedArea } from "./support/area";

const OPS = [
    ["union", PathBool.PathBooleanOperation.Union],
    ["difference", PathBool.PathBooleanOperation.Difference],
    ["intersection", PathBool.PathBooleanOperation.Intersection],
    ["exclusion", PathBool.PathBooleanOperation.Exclusion],
] as const;

const circle = (cx: number, cy: number, r: number) =>
    `M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r} ` +
    `A ${r} ${r} 0 0 1 ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy - r} ` +
    `A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;

const CASES: [string, string, string][] = [
    ["overlapping circles", circle(0, 0, 1), circle(1.1, 0.55, 1)],
    [
        "square and circle",
        "M -1 -1 L 1 -1 L 1 1 L -1 1 L -1 -1 Z",
        circle(1, 0.5, 1),
    ],
    [
        "self-intersecting cubic and circle",
        "M -1 -0.6 C 2.2 1.4 -2.2 1.4 1 -0.6 L -1 -0.6 Z",
        circle(1.1, 0.55, 1),
    ],
    [
        "shape with a hole",
        circle(0, 0, 2) + " " + circle(0, 0, 1).replace(/0 0 1/g, "0 0 0"),
        circle(1.5, 0, 1),
    ],
];

function scalePath(d: string, k: number): Path {
    const path = PathBool.pathFromPathData(d);
    return path.map((seg) => {
        const at = (v: readonly number[]) =>
            [v[0] * k, v[1] * k] as [number, number];
        switch (seg[0]) {
            case "L":
                return ["L", at(seg[1]), at(seg[2])];
            case "Q":
                return ["Q", at(seg[1]), at(seg[2]), at(seg[3])];
            case "C":
                return ["C", at(seg[1]), at(seg[2]), at(seg[3]), at(seg[4])];
            case "A":
                return [
                    "A",
                    at(seg[1]),
                    seg[2] * k,
                    seg[3] * k,
                    seg[4],
                    seg[5],
                    seg[6],
                    at(seg[7]),
                ];
        }
    }) as Path;
}

function measure(aData: string, bData: string, k: number) {
    const a = scalePath(aData, k);
    const b = scalePath(bData, k);
    const origin = originFor([a, b] as never);
    const boolean = new PathBool.PathBoolean([
        { path: a, fillRule: PathBool.FillRule.NonZero },
        { path: b, fillRule: PathBool.FillRule.NonZero },
    ]);
    return Object.fromEntries(
        OPS.map(([name, op]) => [
            name,
            // Areas scale by k^2, so divide it back out.
            Math.abs(
                boolean
                    .get(op)
                    .reduce((s, p) => s + signedArea(p as never, origin), 0),
            ) /
                (k * k),
        ]),
    );
}

describe("results do not depend on how large the drawing is", () => {
    /*
     Up to 2^5, past the point where the tolerances stop scaling and hold at
     their nominal values, and down to 2^-10, where the whole scene is a few
     thousandths of a unit across. Over that range the results are not merely
     close but identical to every digit.

     2^-11 is where it stops, and the reason is the next fixed length down:
     NEARLY_LINEAR_EPS, at 1e-10, is what the subdivision uses to decide a
     curve is straight enough to intersect as a line. Once `point` falls below
     it, intersection points are located less accurately than the distance at
     which two of them count as the same vertex, which is the same bind that
     made these tolerances need scaling in the first place. Scaling that one
     too means threading it through the segment primitives, whose public
     signatures take it as a default argument.
    */
    const FACTORS = [32, 4, 1, 1 / 16, 1 / 256, 1 / 1024];

    for (const [label, aData, bData] of CASES) {
        test(label, () => {
            const reference = measure(aData, bData, 1);
            // Guard against a vacuous comparison of four zeroes.
            expect(reference.union).toBeGreaterThan(0.5);
            expect(reference.intersection).toBeGreaterThan(0.01);

            for (const k of FACTORS) {
                const got = measure(aData, bData, k);
                for (const [name] of OPS) {
                    expect([k, name, got[name] / reference[name]]).toEqual([
                        k,
                        name,
                        expect.closeTo(1, 6),
                    ]);
                }
            }
        });
    }
});
