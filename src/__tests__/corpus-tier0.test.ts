/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Structural corpus checks run in an isolated development bundle.
 The shared oracle checks finite output, closure, exact degeneracy and determinism.
 The process supervisor enforces a hard deadline, including synchronous hangs.
*/
import { afterAll, expect, test } from "@jest/globals";
import * as path from "node:path";

import {
    CORPUS_ROOT,
    OP_NAMES,
    assertOutcome,
    discoverCases,
    loadExpectedFailures,
} from "./support/corpus";
import { isolated, closeWorkers } from "./support/isolated";

const EXPECTED_FAILURES_PATH = path.join(CORPUS_ROOT, "expected-failures.json");

afterAll(closeWorkers);
const expectedFailures = loadExpectedFailures(EXPECTED_FAILURES_PATH);
/* Case discovery */

const corpusCases = discoverCases();

const runs = corpusCases.flatMap((c) =>
    OP_NAMES.map((opName) => ({ ...c, opName })),
);

test("the generated corpus is present", () => {
    // A silently empty glob would make every other test in this file vanish
    // and the suite would still report green.
    expect(corpusCases.length).toBeGreaterThan(0);
});

test.each(runs)(
    "$id $opName",
    async ({ id, dir, opName }) => {
        assertOutcome(
            expectedFailures,
            EXPECTED_FAILURES_PATH,
            id,
            opName,
            await isolated(dir, "tier0", opName),
        );
    },
    20000,
);
