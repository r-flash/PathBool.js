import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
    FillRule,
    Path,
    PathBoolean,
    PathBooleanOperation as Op,
    pathFromPathData,
} from "../index";
import { originFor, signedArea } from "./support/area";

test("restoring output coordinates preserves thin partition winding", () => {
    const paths: Path[] = JSON.parse(
        readFileSync(
            "src/__fixtures__/regressions/translated-thin-polygons.json",
            "utf8",
        ),
    );
    for (const fillRule of [FillRule.NonZero, FillRule.EvenOdd])
        for (const ordered of [paths, [...paths].reverse()]) {
            const boolean = new PathBoolean(
                ordered.map((path) => ({ path, fillRule })),
            );
            for (const faces of [
                boolean.get(Op.Division),
                boolean.get(Op.Fracture),
                boolean.getFaces(),
            ]) {
                expect(faces.length).toBeGreaterThan(1);
                for (const face of faces)
                    expect(signedArea(face, originFor([face]))).toBeLessThan(0);
            }
        }
});

test.each([1e8, 1e9, 1e10])(
    "long edges retain nearby crossings (height %s)",
    (height) => {
        const paths = [
            `M 0 0 H 2 V ${height} H 0 Z`,
            "M 1 1 H 3 V 2 H 1 Z",
        ].map(pathFromPathData);
        for (const fillRule of [FillRule.NonZero, FillRule.EvenOdd]) {
            for (const ordered of [paths, [...paths].reverse()]) {
                const b = new PathBoolean(
                    ordered.map((path) => ({ path, fillRule })),
                );
                const result = b.get(Op.Intersection);
                const area = result.reduce(
                    (sum, path) =>
                        sum + Math.abs(signedArea(path, originFor([path]))),
                    0,
                );
                expect(area).toBeCloseTo(1, 10);
            }
        }
    },
);

test("the retained mixed-scale fuzz input forms a planar arrangement", () => {
    const strings: string[] = JSON.parse(
        readFileSync(
            "src/__fixtures__/regressions/mixed-scale-arc-and-line.json",
            "utf8",
        ),
    );
    const b = new PathBoolean(
        strings.map((d) => ({
            path: pathFromPathData(d),
            fillRule: d.length % 2 === 0 ? FillRule.EvenOdd : FillRule.NonZero,
        })),
    );
    for (const op of [
        Op.Union,
        Op.Difference,
        Op.Intersection,
        Op.Exclusion,
        Op.Division,
        Op.Fracture,
    ])
        expect(() => b.get(op)).not.toThrow();
    // The corrected-radius arc spans a huge semicircle. Losing its crossings
    // used to leave only the small, central part of the union.
    const union = b.get(Op.Union);
    const area = union.reduce(
        (sum, p) => sum + Math.abs(signedArea(p, originFor([p]))),
        0,
    );
    expect(area).toBeGreaterThan(5e15);
    expect(area).toBeLessThan(5.5e15);
});
