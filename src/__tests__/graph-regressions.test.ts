import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
    FillRule,
    Path,
    PathBoolean,
    PathBooleanOperation as Op,
} from "../index";
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
const cases = [
    { name: "near-endpoint crossing", curves },
    { name: "equal curvature after subdivision", curves: departures[0] },
    { name: "third-order endpoint contact", curves: departures[1] },
];
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
