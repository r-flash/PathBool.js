import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { EPS } from "../config";
import {
    FillRule,
    Path,
    PathBoolean,
    PathBooleanOperation as Op,
} from "../index";
import { pathSegmentIntersection } from "../intersections/path-segment";
import { originFor, signedArea } from "./support/area";

// Reduced from commons-12175526/00. The cubics cross again just before their
// common endpoint; merging that crossing with the endpoint reverses a face.
const curves: Path[] = JSON.parse(
    readFileSync(
        "src/__fixtures__/regressions/near-coincident-cubics.json",
        "utf8",
    ),
);
const departures: Path[][] = JSON.parse(
    readFileSync("src/__fixtures__/regressions/cubic-departures.json", "utf8"),
);
const merged: Path[] = JSON.parse(
    readFileSync(
        "src/__fixtures__/regressions/merged-intersections.json",
        "utf8",
    ),
);
const cases: { name: string; curves: Path[] }[] = [
    {
        name: "merged nearby intersections",
        curves: merged,
    },
    {
        name: "crossing inside a chord approximation",
        curves: JSON.parse(
            readFileSync(
                "src/__fixtures__/regressions/near-endpoint-cubics.json",
                "utf8",
            ),
        ) as Path[],
    },
    { name: "near-endpoint crossing", curves },
    { name: "equal curvature after subdivision", curves: departures[0] },
    { name: "third-order endpoint contact", curves: departures[1] },
];

test("a shared endpoint does not hide a crossing within the linearization distance", () => {
    // x=t on both quadratics; their y difference is t*(1e-5 - t/2).
    // The crossings are therefore exactly t=0 and t=2e-5.
    const hits = pathSegmentIntersection(
        ["Q", [0, 0], [0.5, 0], [1, 1]],
        ["Q", [0, 0], [0.5, 5e-6], [1, 0.50001]],
        EPS,
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual([0, 0]);
    expect(hits[1][0]).toBeCloseTo(2e-5, 8);
    expect(hits[1][1]).toBeCloseTo(2e-5, 8);
});
test.each(
    cases.flatMap(({ curves, name }) =>
        [FillRule.NonZero, FillRule.EvenOdd].flatMap((fillRule) =>
            [false, true].map((swapped) => ({
                curves,
                name,
                fillRule,
                swapped,
            })),
        ),
    ),
)(
    "$name preserves faces ($fillRule, swapped $swapped)",
    ({ curves, fillRule, swapped }) => {
        const paths = swapped ? [...curves].reverse() : curves;
        const boolean = new PathBoolean(
            paths.map((path) => ({ path, fillRule })),
        );
        const measure = (paths: Path[]) =>
            paths.reduce(
                (sum, p) => sum + Math.abs(signedArea(p, originFor([p]))),
                0,
            );
        const union = measure(boolean.get(Op.Union)),
            intersection = measure(boolean.get(Op.Intersection));
        expect(union + intersection).toBeCloseTo(measure(paths), 9);
        expect(measure(boolean.get(Op.Fracture))).toBeCloseTo(union, 9);
        for (const face of boolean.get(Op.Fracture))
            expect(signedArea(face, originFor([face]))).toBeLessThan(0);
    },
);
