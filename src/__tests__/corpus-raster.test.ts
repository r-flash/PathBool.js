/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Independent resvg input masks are combined using boolean pixel arithmetic.
 The shared evaluator checks output coverage and partition disjointness in an
 isolated, assertion-stripped production bundle. No library-generated goldens.
*/
import { afterAll, expect, test } from "@jest/globals";
import * as path from "node:path";

import {
    CORPUS_ROOT,
    OP_NAMES,
    assertOutcome,
    discoverCases,
    loadExpectedFailures,
    readFixture,
    readCaseMetadata,
} from "./support/corpus";
import { isolated, closeWorkers } from "./support/isolated";
import { createOracle } from "./support/raster-oracle";

type PathBoolModule = typeof import("../index");
let PathBool: PathBoolModule;

process.env.PATH_BOOL_DEV_ASSERTS = "0";
PathBool = require("../index") as PathBoolModule;

const EXPECTED_FAILURES_PATH = path.join(
    CORPUS_ROOT,
    "expected-failures-raster.json",
);

afterAll(closeWorkers);
const { inputsFor, combine, compare } = createOracle(PathBool);
const expectedFailures = loadExpectedFailures(EXPECTED_FAILURES_PATH);
/* Wiring */

const corpusCases = discoverCases().filter(
    (c) => !readCaseMetadata(c.dir).structuralOnly,
);

const runs = corpusCases.flatMap((c) =>
    OP_NAMES.map((opName) => ({ ...c, opName })),
);

test("the generated corpus is present", () => {
    expect(corpusCases.length).toBeGreaterThan(0);
});

/*
 Keeps the oracle honest. An oracle that agrees with us on every case is only
 reassuring if it would have disagreed had we been wrong, so feed it a
 deliberately wrong answer — A on its own, offered as the union of A and B —
 and require it to notice. Without this, a band that swallowed the image or a
 comparison that never ran would look exactly like a clean pass.
*/
test("the oracle rejects a known-wrong result", () => {
    const overlapping = corpusCases.find(
        (c) => c.id === "overlap/01-circle-arc-x-circle-arc",
    )!;
    const { code } = readFixture(overlapping.dir);
    const { a, b, band } = inputsFor(overlapping.dir, code);

    const union = combine("union", a.alpha, b.alpha)!;
    const wrong = compare(union, a.alpha, band, a.width);
    expect(wrong.considered).toBeGreaterThan(0);
    expect(wrong.count).toBeGreaterThan(0);

    // ...and still agrees when handed the right one.
    const right = compare(union, union, band, a.width);
    expect(right.count).toBe(0);
});

test.each(runs)(
    "$id $opName",
    async ({ id, dir, opName }) => {
        assertOutcome(
            expectedFailures,
            EXPECTED_FAILURES_PATH,
            id,
            opName,
            await isolated(dir, "raster", opName),
        );
    },
    30000,
);
