/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Tier 2 of the generated-corpus suite: an independent oracle for the *answers*,
 not just their shape.

 The generated fixtures have no committed ground truth on purpose — blessing
 our own output would freeze whatever bugs the generator happened to trip. So
 the expected result is derived instead, from resvg, which never runs any of
 our boolean code:

   1. render path A on its own, under its own fill rule -> coverage mask MA
   2. render path B on its own                          -> coverage mask MB
   3. combine the two masks with plain pixel arithmetic:
        union        max(MA, MB)         difference   min(MA, 255 - MB)
        intersection min(MA, MB)         exclusion    max - min
   4. render our result and compare

 Division and Fracture have no single expected mask, so they are checked as
 partitions instead: render every returned face separately and require the
 per-pixel *sum* of their coverages to equal the region being partitioned
 (A for Division, since it selects faces by `flags[0]`; A|B for Fracture). One
 comparison catches both halves of the property — a missing face makes the sum
 too low, an overlapping pair makes it too high.

 Antialiasing is handled by exclusion rather than by tolerance. Pixels where
 either input is partially covered are collected into a boundary band, dilated
 by a couple of pixels, and skipped. Every remaining pixel is fully inside or
 fully outside both inputs, so the comparison there is essentially exact — a
 good deal stricter than the per-channel TOLERANCE of 80 the hand-fixture
 visual suite runs with. A boolean operation never invents an edge that is not
 already an edge of an input, so the band is built from the inputs alone; a
 result boundary appearing anywhere else is a bug, and lands outside the band
 where it will be caught.

 Known blind spot: features thinner than a pixel are invisible here. That is
 what the algebraic checks are for.

 Runs with `PATH_BOOL_DEV_ASSERTS = "0"`, like `visual-tests.ts`. Note that
 this is *not* the same as the shipped code path: only the three gated
 invariant-check blocks in `path-boolean.ts` consult that flag. Bare
 `assertUnreachable`/`assertEqual` calls — including "No ear in polygon found"
 and "Multiple outer faces found" — throw regardless, and are removed only by
 `@rollup/plugin-strip` in the production bundle. So a case that trips one of
 those still throws here and cannot be judged on its pixels; in the shipped
 build the same input would sail past the violated invariant and return
 something. Covering that would mean running this suite against `dist/` the way
 `bench/` does.
*/
import { expect, test } from "@jest/globals";
import { Resvg } from "@resvg/resvg-js";
import * as cheerio from "cheerio";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Path } from "../index";
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

process.env.PATH_BOOL_DEV_ASSERTS = "0";
PathBool = require("../index") as PathBoolModule;

const EXPECTED_FAILURES_PATH = path.join(
    CORPUS_ROOT,
    "expected-failures-raster.json",
);

const expectedFailures = loadExpectedFailures(EXPECTED_FAILURES_PATH);

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

// Coverage is read from the alpha channel, so anything below this counts as
// empty and anything above 255 - this counts as solid. Only ever applied to
// pixels outside the boundary band, where the true value is 0 or 255.
const ALPHA_EPS = 16;

// How far the antialiased fringe of an input edge can reach. resvg's is one
// pixel; two gives room for the result's own fringe to sit on top of it.
const BAND_RADIUS = 2;

// Same reasoning as tier 0: one corpus case is pathologically slow, and this
// turns that into a reported finding instead of a mysteriously long suite.
const DURATION_BUDGET_MS = 5000;

const MAX_REPORTED_PIXELS = 4;

/* Rendering */

type Mask = {
    width: number;
    height: number;
    alpha: Uint8Array;
};

function renderMask(svgCode: string): Mask {
    const rendered = new Resvg(svgCode).render();
    const pixels = rendered.pixels;
    const alpha = new Uint8Array(rendered.width * rendered.height);
    for (let i = 0; i < alpha.length; i++) {
        alpha[i] = pixels[i * 4 + 3];
    }
    return { width: rendered.width, height: rendered.height, alpha };
}

/*
 Everything is drawn with the viewBox moved to the origin.

 resvg cannot resolve geometry sitting at a large offset: rendering one
 fixture's already-computed result at 1e6 disagreed with its own inputs on 105
 pixels, and rendering the identical numbers translated to the origin
 disagreed on none. That is the rasterizer, not the library, and without this
 the oracle reports a defect that is entirely its own.

 The shift is applied equally to the inputs, the result and the viewBox, so
 what the comparison means is unchanged — and the library still does its work
 at the original coordinates, which is the thing under test.
*/
function viewBoxShift(code: string): [number, number] {
    const vb = cheerio
        .load(code, { xml: true })("svg")
        .attr("viewBox")!
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    return [-vb[0], -vb[1]];
}

function shiftPath(path: Path, [dx, dy]: [number, number]): Path {
    const at = (v: readonly number[]) =>
        [v[0] + dx, v[1] + dy] as [number, number];
    return path.map((seg) => {
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
                    seg[2],
                    seg[3],
                    seg[4],
                    seg[5],
                    seg[6],
                    at(seg[7]),
                ];
        }
    }) as Path;
}

function shiftedSvg(code: string, paths: Path[]): string {
    const shift = viewBoxShift(code);
    const $ = cheerio.load(code, { xml: true });
    const $svg = $("svg");
    const vb = $svg
        .attr("viewBox")!
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    $svg.attr("viewBox", `0 0 ${vb[2]} ${vb[3]}`);
    $("path").remove();
    for (const p of paths) {
        $svg.append(
            `<path style="fill:#ff0000;fill-rule:nonzero" d="${PathBool.pathToPathData(
                shiftPath(p, shift),
                1e-6,
            )}"/>`,
        );
    }
    return $.html();
}

/*
 Results are always filled non-zero: the pipeline is supposed to emit outer
 boundaries and holes with opposing orientation, so a hole that only shows up
 under even-odd is an orientation bug worth failing on.
*/
function withPaths(code: string, paths: Path[]): string {
    return shiftedSvg(code, paths);
}

/*
 One input on its own, re-emitted through the same path so that it is shifted
 and serialized exactly like the result it will be compared against.
*/
function withOnly(code: string, keepId: "a" | "b"): string {
    const $ = cheerio.load(code, { xml: true });
    const d = $(`#${keepId}`).attr("d")!;
    const fillRule = $(`#${keepId}`).css("fill-rule") ?? "nonzero";
    const svg = shiftedSvg(code, [PathBool.pathFromPathData(d)]);
    // Preserve the input's own fill rule; the result form always uses non-zero.
    return svg.replace("fill-rule:nonzero", `fill-rule:${fillRule}`);
}

/* Boundary band */

// Separable max filter: a pixel joins the band if any pixel within
// BAND_RADIUS (Chebyshev) is partially covered by either input.
function dilate(flags: Uint8Array, width: number, height: number, r: number) {
    const horizontal = new Uint8Array(flags.length);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let hit = 0;
            const lo = Math.max(0, x - r);
            const hi = Math.min(width - 1, x + r);
            for (let k = lo; k <= hi; k++) {
                if (flags[row + k]) {
                    hit = 1;
                    break;
                }
            }
            horizontal[row + x] = hit;
        }
    }

    const out = new Uint8Array(flags.length);
    for (let y = 0; y < height; y++) {
        const lo = Math.max(0, y - r);
        const hi = Math.min(height - 1, y + r);
        for (let x = 0; x < width; x++) {
            let hit = 0;
            for (let k = lo; k <= hi; k++) {
                if (horizontal[k * width + x]) {
                    hit = 1;
                    break;
                }
            }
            out[y * width + x] = hit;
        }
    }
    return out;
}

function boundaryBand(a: Mask, b: Mask): Uint8Array {
    const partial = new Uint8Array(a.alpha.length);
    for (let i = 0; i < partial.length; i++) {
        const pa = a.alpha[i];
        const pb = b.alpha[i];
        partial[i] =
            (pa > ALPHA_EPS && pa < 255 - ALPHA_EPS) ||
            (pb > ALPHA_EPS && pb < 255 - ALPHA_EPS)
                ? 1
                : 0;
    }
    return dilate(partial, a.width, a.height, BAND_RADIUS);
}

/* Comparison */

type Mismatch = {
    count: number;
    considered: number;
    samples: string[];
};

function compare(
    expectedAlpha: Uint8Array,
    actualAlpha: Uint8Array,
    band: Uint8Array,
    width: number,
): Mismatch {
    let count = 0;
    let considered = 0;
    const samples: string[] = [];

    for (let i = 0; i < expectedAlpha.length; i++) {
        if (band[i]) continue;
        considered++;

        const want = expectedAlpha[i] >= 128;
        const got = actualAlpha[i] >= 128;
        if (want === got) continue;

        count++;
        if (samples.length < MAX_REPORTED_PIXELS) {
            samples.push(
                `[${i % width}, ${Math.floor(i / width)}] expected ${
                    want ? "filled" : "empty"
                }, got ${actualAlpha[i]}`,
            );
        }
    }

    return { count, considered, samples };
}

/*
 On failure, drop a coarse map next to the fixture. `#` is a pixel we got wrong,
 `.` is agreement, `~` is skipped boundary band. Cheap to produce, and enough to
 tell "the whole region is inverted" from "one sliver leaked".
*/
function asciiMap(
    expectedAlpha: Uint8Array,
    actualAlpha: Uint8Array,
    band: Uint8Array,
    width: number,
    height: number,
): string {
    const cols = 64;
    const step = Math.max(1, Math.floor(width / cols));
    const lines: string[] = [];

    for (let y = 0; y < height; y += step * 2) {
        let line = "";
        for (let x = 0; x < width; x += step) {
            let wrong = false;
            let banded = false;
            for (let dy = 0; dy < step * 2 && y + dy < height; dy++) {
                for (let dx = 0; dx < step && x + dx < width; dx++) {
                    const i = (y + dy) * width + x + dx;
                    if (band[i]) {
                        banded = true;
                        continue;
                    }
                    if (expectedAlpha[i] >= 128 !== actualAlpha[i] >= 128) {
                        wrong = true;
                    }
                }
            }
            line += wrong ? "#" : banded ? "~" : ".";
        }
        lines.push(line);
    }

    return lines.join("\n");
}

function writeReport(
    dir: string,
    opName: string,
    body: string,
    oursSvg: string | null,
) {
    const out = path.join(dir, "test-results");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${opName}-mismatch.txt`), body, "utf-8");
    if (oursSvg !== null) {
        fs.writeFileSync(
            path.join(out, `${opName}-ours.svg`),
            oursSvg,
            "utf-8",
        );
        fs.writeFileSync(
            path.join(out, `${opName}-ours.png`),
            new Uint8Array(new Resvg(oursSvg).render().asPng()),
        );
    }
}

/* Per-case input masks, computed once and reused across the six operations. */

type Inputs = {
    a: Mask;
    b: Mask;
    band: Uint8Array;
};

const inputCache = new Map<string, Inputs>();

function inputsFor(dir: string, code: string): Inputs {
    let cached = inputCache.get(dir);
    if (cached === undefined) {
        const a = renderMask(withOnly(code, "a"));
        const b = renderMask(withOnly(code, "b"));
        cached = { a, b, band: boundaryBand(a, b) };
        inputCache.set(dir, cached);
    }
    return cached;
}

/* Expected masks */

function combine(
    opName: OpName,
    a: Uint8Array,
    b: Uint8Array,
): Uint8Array | null {
    const out = new Uint8Array(a.length);
    switch (opName) {
        case "union":
            for (let i = 0; i < a.length; i++) out[i] = Math.max(a[i], b[i]);
            return out;
        case "intersection":
            for (let i = 0; i < a.length; i++) out[i] = Math.min(a[i], b[i]);
            return out;
        case "difference":
            for (let i = 0; i < a.length; i++)
                out[i] = Math.min(a[i], 255 - b[i]);
            return out;
        case "exclusion":
            for (let i = 0; i < a.length; i++)
                out[i] = Math.max(a[i], b[i]) - Math.min(a[i], b[i]);
            return out;
        default:
            // Division and Fracture are checked as partitions instead.
            return null;
    }
}

/* The check */

function evaluate(dir: string, opName: OpName): string | null {
    const { code, inputs } = readFixture(dir);

    const parsed = inputs.map((input) => ({
        path: PathBool.pathFromPathData(input.d),
        fillRule: fillRules[input.fillRule],
    }));

    let result: Path[];
    let elapsed: number;
    try {
        const started = performance.now();
        result = new PathBool.PathBoolean(parsed).get(ops[opName]);
        elapsed = performance.now() - started;
    } catch (e) {
        const err = e as Error;
        return `threw ${err.name}: ${err.message}`;
    }

    if (elapsed > DURATION_BUDGET_MS) {
        return `took ${(elapsed / 1000).toFixed(1)}s, over the ${
            DURATION_BUDGET_MS / 1000
        }s budget`;
    }

    const { a, b, band } = inputsFor(dir, code);
    const { width, height } = a;

    const isPartition = opName === "division" || opName === "fracture";

    // For a partition the "actual" mask is the per-pixel sum of the faces'
    // coverages, so an overlap between two faces shows up as a value above 255.
    let actual: Uint8Array;
    let expectedAlpha: Uint8Array;
    let oursSvg: string | null = null;

    if (isPartition) {
        const sum = new Uint32Array(a.alpha.length);
        for (const face of result) {
            if (face.length === 0) continue;
            const faceMask = renderMask(withPaths(code, [face]));
            for (let i = 0; i < sum.length; i++) sum[i] += faceMask.alpha[i];
        }

        expectedAlpha =
            opName === "division"
                ? a.alpha
                : combine("union", a.alpha, b.alpha)!;

        // Report an overlap distinctly from a hole: both break the partition,
        // but they are different bugs.
        let overlapping = 0;
        for (let i = 0; i < sum.length; i++) {
            if (!band[i] && sum[i] > 255 + ALPHA_EPS) overlapping++;
        }
        if (overlapping > 0) {
            oursSvg = withPaths(code, result);
            writeReport(
                dir,
                opName,
                `${result.length} faces overlap on ${overlapping} pixels outside the boundary band.\n`,
                oursSvg,
            );
            return `faces are not disjoint: ${overlapping} pixels are covered by more than one of the ${result.length} returned faces`;
        }

        actual = new Uint8Array(sum.length);
        for (let i = 0; i < sum.length; i++) {
            actual[i] = Math.min(255, sum[i]);
        }
    } else {
        expectedAlpha = combine(opName, a.alpha, b.alpha)!;
        oursSvg = withPaths(code, result);
        actual = renderMask(oursSvg).alpha;
    }

    // Guard against the oracle going vacuous. If the whole expected region is
    // thin enough to be swallowed by the antialiasing band there is nothing
    // left to compare, and reporting a pass would be a lie. (A legitimately
    // empty expected region is fine: the check then still verifies that we
    // produced nothing outside the band.)
    // Counts *solid* pixels, not merely half-covered ones. Where the two
    // inputs share a boundary, min(MA, MB) sits near 128 all along it, which
    // is an artifact of combining two antialiased edges rather than real area;
    // treating that as an expected region would flag every zero-area
    // intersection as unjudgeable.
    let expectedFilled = 0;
    let expectedFilledOutsideBand = 0;
    for (let i = 0; i < expectedAlpha.length; i++) {
        if (expectedAlpha[i] < 255 - ALPHA_EPS) continue;
        expectedFilled++;
        if (!band[i]) expectedFilledOutsideBand++;
    }
    if (expectedFilled > 0 && expectedFilledOutsideBand === 0) {
        return (
            `the oracle cannot judge this case: the entire expected region ` +
            `(${expectedFilled} px) lies inside the boundary band`
        );
    }

    const { count, considered, samples } = compare(
        expectedAlpha,
        actual,
        band,
        width,
    );

    if (count === 0) return null;

    if (oursSvg === null) oursSvg = withPaths(code, result);
    writeReport(
        dir,
        opName,
        `${count} of ${considered} compared pixels disagree ` +
            `(${((100 * count) / Math.max(1, considered)).toFixed(2)}%).\n` +
            samples.map((s) => `  ${s}`).join("\n") +
            `\n\n# = wrong, . = agrees, ~ = boundary band (skipped)\n\n` +
            asciiMap(expectedAlpha, actual, band, width, height) +
            "\n",
        oursSvg,
    );

    return (
        `${count} of ${considered} compared pixels disagree with the ` +
        `${isPartition ? "partition" : "raster"} oracle ` +
        `(${((100 * count) / Math.max(1, considered)).toFixed(2)}%); ` +
        `first: ${samples[0]}. See ${path.join(dir, "test-results", `${opName}-mismatch.txt`)}`
    );
}

/* Wiring */

const corpusCases = discoverCases();

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
    ({ id, dir, opName }) => {
        assertOutcome(
            expectedFailures,
            EXPECTED_FAILURES_PATH,
            id,
            opName,
            evaluate(dir, opName),
        );
    },
    30000,
);
