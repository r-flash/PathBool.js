import { afterAll, describe, expect, test } from "@jest/globals";
import * as path from "node:path";

import * as PathBool from "../index";
import { lineariseDegenerateSegment } from "../primitives/PathSegment";
import type { PathSegment } from "../primitives/PathSegment";
import {
    CORPUS_ROOT,
    OP_NAMES,
    discoverCases,
    readCaseMetadata,
    loadExpectedFailures,
    assertOutcome,
} from "./support/corpus";
import { closeWorkers, isolated } from "./support/isolated";
import { createOracle } from "./support/structural-oracle";

afterAll(closeWorkers);
const structural = createOracle(PathBool);

describe("sanitization distinguishes collapsed geometry from real curves", () => {
    test.each<PathSegment>([
        ["Q", [0, 0], [0, 0], [0, 0]],
        ["C", [0, 0], [0, 0], [0, 0], [0, 0]],
        ["Q", [0, 0], [20, 0], [0, 0]],
        ["C", [0, 0], [-20, 0], [20, 0], [0, 0]],
    ])("collapses retraced or point-only %s", (...parts) => {
        expect(lineariseDegenerateSegment(parts as PathSegment, 1e-6)).toEqual([
            "L",
            [0, 0],
            [0, 0],
        ]);
    });
    test.each<PathSegment>([
        ["C", [0, 0], [40, 0], [0, 40], [0, 0]],
        ["C", [0, 0], [40, 0], [0, 40], [1e-9, 0]],
        ["C", [0, 0], [-20, 0], [60, 0], [40, 0]],
        ["Q", [0, 0], [20, 1e-4], [40, 0]],
    ])("preserves meaningful %s", (...parts) => {
        expect(lineariseDegenerateSegment(parts as PathSegment, 1e-6)).toEqual(
            parts,
        );
    });
    test("zero radii become lines while undersized positive radii remain arcs", () => {
        expect(
            lineariseDegenerateSegment(
                ["A", [0, 0], 0, 20, 0, false, true, [40, 0]],
                1e-6,
            )[0],
        ).toBe("L");
        expect(
            lineariseDegenerateSegment(
                ["A", [0, 0], 1e-8, 1e-8, 0, false, true, [40, 0]],
                1e-6,
            )[0],
        ).toBe("A");
    });
    test("structural oracle accepts a tiny loop and rejects collapsed segments and open output", () => {
        expect(
            structural.checkNoDegenerateSegments([
                [["C", [0, 0], [1e-12, 0], [0, 1e-12], [0, 0]]],
            ]),
        ).toBeNull();
        expect(
            structural.checkNoDegenerateSegments([[["L", [0, 0], [0, 0]]]]),
        ).not.toBeNull();
        expect(
            structural.checkNoDegenerateSegments([
                [["A", [0, 0], 0, 1, 0, false, true, [1, 0]]],
            ]),
        ).not.toBeNull();
        const tolerance = structural.toleranceFor(1e-6);
        expect(tolerance).toBeLessThan(1e-12);
        expect(
            structural.checkLoopsClose([[["L", [0, 0], [1e-6, 0]]]], tolerance),
        ).not.toBeNull();
    });
});

const expectedFile = path.join(
    CORPUS_ROOT,
    "expected-failures-equivalence.json",
);
const expected = loadExpectedFailures(expectedFile);
const cases = discoverCases().filter(
    (c) => readCaseMetadata(c.dir).cleanA !== undefined,
);
test("the cleanup-equivalence corpus is present", () =>
    expect(cases.length).toBeGreaterThan(0));
test.each(cases.flatMap((c) => OP_NAMES.map((op) => ({ ...c, op }))))(
    "$id preserves $op",
    async ({ id, dir, op }) => {
        assertOutcome(
            expected,
            expectedFile,
            id,
            op,
            await isolated(dir, "equivalence", op),
        );
    },
    20000,
);
