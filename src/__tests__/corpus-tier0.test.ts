/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Tier 0 of the generated-corpus suite: every case, every operation, no
 rendering.

 This is the cheap pass. It does not know what the right answer is — that is
 the raster oracle's job — it only asserts that the pipeline produced *an*
 answer that is structurally well formed: it terminated, it did not trip an
 internal invariant, every coordinate is finite, every subpath closes, and a
 second run produces the identical result.

 Unlike `visual-tests.ts`, this file runs with `PATH_BOOL_DEV_ASSERTS` ON, so
 the dev-only invariant checks inside `path-boolean.ts` are load-bearing here.
 That is the point: this is the only suite that exercises them across a wide
 input corpus.

 Regenerate the corpus with `npm run gen-corpus`.
*/
import { expect, test } from "@jest/globals";
import * as path from "node:path";

import type { Path } from "../index";
import type { PathSegment } from "../primitives/PathSegment";
import { getEndPoint, getStartPoint } from "../primitives/PathSegment";
import {
    CORPUS_ROOT,
    OP_NAMES,
    assertOutcome,
    discoverCases,
    loadExpectedFailures,
    readFixture,
} from "./support/corpus";
import type { OpName } from "./support/corpus";

type PathBoolModule = typeof import("../index");
let PathBool: PathBoolModule;

process.env.PATH_BOOL_DEV_ASSERTS = "1";
PathBool = require("../index") as PathBoolModule;

const EXPECTED_FAILURES_PATH = path.join(CORPUS_ROOT, "expected-failures.json");

const ops: Record<OpName, number> = {
    union: PathBool.PathBooleanOperation.Union,
    difference: PathBool.PathBooleanOperation.Difference,
    intersection: PathBool.PathBooleanOperation.Intersection,
    exclusion: PathBool.PathBooleanOperation.Exclusion,
    division: PathBool.PathBooleanOperation.Division,
    fracture: PathBool.PathBooleanOperation.Fracture,
};

const fillRules = {
    nonzero: PathBool.FillRule.NonZero,
    evenodd: PathBool.FillRule.EvenOdd,
};

const expectedFailures = loadExpectedFailures(EXPECTED_FAILURES_PATH);

/*
 Every well-behaved case in the corpus finishes in single-digit milliseconds,
 so this is a ~1000x margin. It exists because "it terminated" is one of the
 things this tier promises, and a case that takes tens of seconds is a finding
 rather than a slow machine.
*/
const DURATION_BUDGET_MS = 5000;

/* Structural checks */

// The library's own point-merge tolerance is absolute, so a scene translated
// to 1e6 has far less headroom than one at the origin. Scale with the
// magnitude of the output so the conditioning cases are judged fairly.
function toleranceFor(magnitude: number): number {
    return 1e-6 + 1e-12 * magnitude;
}

function segmentPoints(seg: PathSegment): number[] {
    switch (seg[0]) {
        case "L":
            return [...seg[1], ...seg[2]];
        case "C":
            return [...seg[1], ...seg[2], ...seg[3], ...seg[4]];
        case "Q":
            return [...seg[1], ...seg[2], ...seg[3]];
        case "A":
            return [...seg[1], seg[2], seg[3], seg[4], ...seg[7]];
    }
}

function distance(a: readonly number[], b: readonly number[]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function magnitudeOf(paths: Path[]): number {
    let m = 0;
    for (const p of paths) {
        for (const seg of p) {
            for (const v of segmentPoints(seg)) {
                if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
            }
        }
    }
    return m;
}

function checkFinite(paths: Path[]): string | null {
    for (let i = 0; i < paths.length; i++) {
        for (let j = 0; j < paths[i].length; j++) {
            const seg = paths[i][j];
            for (const v of segmentPoints(seg)) {
                if (!Number.isFinite(v)) {
                    return `path ${i} segment ${j} (${seg[0]}) has a non-finite component: ${v}`;
                }
            }
        }
    }
    return null;
}

/*
 A single returned `Path` may hold several closed loops back to back — an outer
 boundary followed by its holes — with no marker between them. A discontinuity
 therefore means "a new loop starts here", and the check is that the loop that
 just ended returned to where it began.
*/
function checkLoopsClose(paths: Path[], tol: number): string | null {
    for (let i = 0; i < paths.length; i++) {
        const segs = paths[i];
        if (segs.length === 0) continue;

        let loopStart = getStartPoint(segs[0]);
        let loopStartIndex = 0;

        for (let j = 1; j <= segs.length; j++) {
            const prevEnd = getEndPoint(segs[j - 1]);
            const isLast = j === segs.length;
            const gap = isLast
                ? Infinity
                : distance(prevEnd, getStartPoint(segs[j]));

            if (gap <= tol) continue;

            // Either the path ended or a new loop began; the loop we were in
            // must have come back to its own start.
            const closureGap = distance(prevEnd, loopStart);
            if (closureGap > tol) {
                return (
                    `path ${i} loop starting at segment ${loopStartIndex} does not close: ` +
                    `ends ${closureGap.toExponential(3)} away from its start (tolerance ${tol.toExponential(3)})`
                );
            }

            if (!isLast) {
                loopStart = getStartPoint(segs[j]);
                loopStartIndex = j;
            }
        }
    }
    return null;
}

/*
 An empty region comes back as a single zero-segment path (and, for at least
 one fracture case, as a zero-length array); both are the library saying
 "nothing here" and are fine. An empty path sitting *alongside* real ones is
 not — that is a face that was selected and then produced no boundary.
*/
function checkEmptyPaths(paths: Path[]): string | null {
    const empty = paths.filter((p) => p.length === 0).length;
    if (empty === 0 || empty === paths.length) return null;
    return `${empty} of ${paths.length} returned paths are empty while others are not`;
}

function checkNoDegenerateSegments(paths: Path[], tol: number): string | null {
    for (let i = 0; i < paths.length; i++) {
        for (let j = 0; j < paths[i].length; j++) {
            const seg = paths[i][j];
            // Only flag a segment whose every point collapses to one place; a
            // cubic with coincident endpoints but distinct controls is a
            // legitimate loop.
            const pts: number[][] = [];
            switch (seg[0]) {
                case "L":
                    pts.push(seg[1], seg[2]);
                    break;
                case "C":
                    pts.push(seg[1], seg[2], seg[3], seg[4]);
                    break;
                case "Q":
                    pts.push(seg[1], seg[2], seg[3]);
                    break;
                case "A":
                    if (Math.abs(seg[2]) <= tol || Math.abs(seg[3]) <= tol) {
                        return `path ${i} segment ${j} is an arc with a zero radius`;
                    }
                    pts.push(seg[1], seg[7]);
                    break;
            }
            if (pts.every((p) => distance(p, pts[0]) <= tol)) {
                return `path ${i} segment ${j} (${seg[0]}) is degenerate: all points within ${tol.toExponential(3)}`;
            }
        }
    }
    return null;
}

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

/*
 Runs one case under one operation and returns a description of the first
 structural problem found, or null if the output is well formed. Throws are
 caught and reported the same way so that they can be triaged through
 `expected-failures.json` like any other failure.
*/
function evaluate(dir: string, opName: OpName): string | null {
    const op = ops[opName];
    const inputs = readFixture(dir).inputs.map((input) => ({
        path: PathBool.pathFromPathData(input.d),
        fillRule: fillRules[input.fillRule],
    }));

    let result: Path[];
    let elapsed: number;
    try {
        const started = performance.now();
        result = new PathBool.PathBoolean(inputs).get(op);
        elapsed = performance.now() - started;
    } catch (e) {
        const err = e as Error;
        return `threw ${err.name}: ${err.message}`;
    }

    if (!Array.isArray(result))
        return `returned ${typeof result}, not an array`;

    if (elapsed > DURATION_BUDGET_MS) {
        // Skip the determinism re-run: it would double an already pathological
        // cost for no extra information.
        return `took ${(elapsed / 1000).toFixed(1)}s, over the ${
            DURATION_BUDGET_MS / 1000
        }s budget`;
    }

    let second: Path[];
    try {
        second = new PathBool.PathBoolean(inputs).get(op);
    } catch (e) {
        const err = e as Error;
        return `threw ${err.name} on the second run but not the first: ${err.message}`;
    }

    if (JSON.stringify(result) !== JSON.stringify(second)) {
        return "not deterministic: two runs on the same input differed";
    }

    const tol = toleranceFor(magnitudeOf(result));

    return (
        checkFinite(result) ??
        checkEmptyPaths(result) ??
        checkLoopsClose(result, tol) ??
        checkNoDegenerateSegments(result, tol)
    );
}

test.each(runs)(
    "$id $opName",
    ({ id, dir, opName }) => {
        assertOutcome(
            expectedFailures,
            EXPECTED_FAILURES_PATH,
            id,
            opName,
            evaluate(dir, opName),
        );
    },
    20000,
);
