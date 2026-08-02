/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Tier 1 of the generated-corpus suite: algebraic identities over exact areas,
 no rendering.

 The raster oracle in `corpus-raster.test.ts` can only see what a 512x512 grid
 can resolve. Anything thinner than a pixel — a sliver left behind at a near
 tangency, a hairline face duplicated in a partition — is invisible to it. This
 tier closes that gap by measuring the *exact* signed area of the output curves
 (Green's theorem, closed form per segment type, see `support/area.ts`) and
 checking relations that must hold whatever the geometry is.

 Every identity here relates results to *other results*, never to the inputs.
 That is deliberate: the area of an input path is not well defined without
 already knowing how its fill rule resolves self-intersections, which is a
 large part of what the pipeline is being tested on. Asking whether
 `area(A u B) + area(A n B) == area(A) + area(B)` would beg the question for
 the pentagram and annulus cases; asking whether
 `area(A u B) == area(A \ B) + area(A n B) + area(B \ A)` does not, and catches
 the same errors.

 Running Difference both ways round gives `B \ A` for free, since `PathBoolean`
 does the expensive geometric work once in its constructor and `get` is cheap.
*/
import { expect, test } from "@jest/globals";
import * as path from "node:path";

import type { Path } from "../index";
import type { AnySegment, Vec } from "./support/area";
import { originFor, signedArea } from "./support/area";
import {
    CORPUS_ROOT,
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
    "expected-failures-algebraic.json",
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

/*
 Relative to the largest area in play. Not tighter than this because the
 pipeline splits curves at intersection points located to within EPS.param, and
 a split point a hair off the true curve moves the enclosed area by a
 correspondingly small amount. The residuals observed across the corpus sit
 several orders of magnitude below this.
*/
const AREA_TOL_REL = 1e-7;

const DURATION_BUDGET_MS = 5000;

/* Measurements for one case */

type Measures = {
    /* A op B */
    U: number;
    I: number;
    D: number;
    X: number;
    /* B op A */
    Uba: number;
    Iba: number;
    Xba: number;
    Dba: number;
    /* Partitions */
    divisionFaces: number[];
    fractureFaces: number[];
    fractureFacesBa: number[];
    divisionSum: number;
    fractureSum: number;
    tol: number;
};

type CaseData = { error: string } | { error: null; measures: Measures };

const cache = new Map<string, CaseData>();

function absArea(paths: Path[], origin: Vec): number {
    let total = 0;
    for (const p of paths) {
        total += signedArea(p as unknown as AnySegment[], origin);
    }
    return Math.abs(total);
}

function faceAreas(paths: Path[], origin: Vec): number[] {
    return paths
        .filter((p) => p.length > 0)
        .map((p) => signedArea(p as unknown as AnySegment[], origin));
}

function measure(dir: string): CaseData {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;

    const computed = computeMeasures(dir);
    cache.set(dir, computed);
    return computed;
}

function computeMeasures(dir: string): CaseData {
    const inputs = readFixture(dir).inputs.map((input) => ({
        path: PathBool.pathFromPathData(input.d),
        fillRule: fillRules[input.fillRule],
    }));

    const origin = originFor([
        inputs[0].path as unknown as AnySegment[],
        inputs[1].path as unknown as AnySegment[],
    ]);

    let ab: Record<OpName, Path[]>;
    let ba: Record<OpName, Path[]>;
    try {
        const started = performance.now();

        const forward = new PathBool.PathBoolean(inputs);
        const reverse = new PathBool.PathBoolean([inputs[1], inputs[0]]);

        const collect = (b: InstanceType<PathBoolModule["PathBoolean"]>) =>
            Object.fromEntries(
                Object.entries(ops).map(([name, op]) => [name, b.get(op)]),
            ) as Record<OpName, Path[]>;

        ab = collect(forward);
        ba = collect(reverse);

        const elapsed = performance.now() - started;
        if (elapsed > DURATION_BUDGET_MS) {
            return {
                error: `took ${(elapsed / 1000).toFixed(1)}s, over the ${
                    DURATION_BUDGET_MS / 1000
                }s budget`,
            };
        }
    } catch (e) {
        const err = e as Error;
        return { error: `threw ${err.name}: ${err.message}` };
    }

    const divisionFaces = faceAreas(ab.division, origin);
    const fractureFaces = faceAreas(ab.fracture, origin);
    const fractureFacesBa = faceAreas(ba.fracture, origin);

    const U = absArea(ab.union, origin);
    const I = absArea(ab.intersection, origin);
    const D = absArea(ab.difference, origin);
    const X = absArea(ab.exclusion, origin);
    const Uba = absArea(ba.union, origin);
    const Iba = absArea(ba.intersection, origin);
    const Xba = absArea(ba.exclusion, origin);
    const Dba = absArea(ba.difference, origin);

    const scale = Math.max(1, U, Uba, X, Xba);

    return {
        error: null,
        measures: {
            U,
            I,
            D,
            X,
            Uba,
            Iba,
            Xba,
            Dba,
            divisionFaces,
            fractureFaces,
            fractureFacesBa,
            divisionSum: divisionFaces.reduce((s, a) => s + Math.abs(a), 0),
            fractureSum: fractureFaces.reduce((s, a) => s + Math.abs(a), 0),
            tol: AREA_TOL_REL * scale,
        },
    };
}

/* Identities */

function near(
    label: string,
    lhs: number,
    rhs: number,
    tol: number,
): string | null {
    const residual = Math.abs(lhs - rhs);
    if (residual <= tol) return null;
    return (
        `${label}: ${lhs.toPrecision(12)} vs ${rhs.toPrecision(12)}, ` +
        `off by ${residual.toExponential(3)} (tolerance ${tol.toExponential(3)})`
    );
}

// All faces of a partition should wind the same way. A face with the opposite
// sign is a hole that escaped as a face, or a boundary traced backwards.
function sameOrientation(label: string, faces: number[]): string | null {
    const signs = new Set(faces.filter((a) => a !== 0).map(Math.sign));
    if (signs.size <= 1) return null;
    return `${label}: faces disagree about orientation (${faces
        .map((a) => a.toExponential(3))
        .join(", ")})`;
}

type Identity = {
    name: string;
    check: (m: Measures) => string | null;
};

const IDENTITIES: Identity[] = [
    {
        // A xor B is exactly what A u B has that A n B does not.
        name: "exclusion-is-union-minus-intersection",
        check: (m) =>
            near("|A xor B| vs |A u B| - |A n B|", m.X, m.U - m.I, m.tol),
    },
    {
        // The three disjoint pieces of the union have to add back up to it.
        // This is the inclusion-exclusion identity restated without reference
        // to the inputs' own areas.
        name: "union-is-sum-of-its-three-parts",
        check: (m) =>
            near(
                "|A u B| vs |A \\ B| + |A n B| + |B \\ A|",
                m.U,
                m.D + m.I + m.Dba,
                m.tol,
            ),
    },
    {
        // Division selects faces by flags[0], so its faces tile A exactly.
        name: "division-tiles-a",
        check: (m) =>
            near(
                "sum of Division faces vs |A \\ B| + |A n B|",
                m.divisionSum,
                m.D + m.I,
                m.tol,
            ),
    },
    {
        name: "fracture-tiles-union",
        check: (m) =>
            near("sum of Fracture faces vs |A u B|", m.fractureSum, m.U, m.tol),
    },
    {
        name: "commutative-union",
        check: (m) => near("|A u B| vs |B u A|", m.U, m.Uba, m.tol),
    },
    {
        name: "commutative-intersection",
        check: (m) => near("|A n B| vs |B n A|", m.I, m.Iba, m.tol),
    },
    {
        name: "commutative-exclusion",
        check: (m) => near("|A xor B| vs |B xor A|", m.X, m.Xba, m.tol),
    },
    {
        /*
         Fracture selects on `flags.some`, so swapping the inputs must produce
         the same set of faces. Compared as a sorted multiset of areas rather
         than a total, because a total hides two faces trading area.
        */
        name: "commutative-fracture",
        check: (m) => {
            const lhs = m.fractureFaces.map(Math.abs).sort((x, y) => x - y);
            const rhs = m.fractureFacesBa.map(Math.abs).sort((x, y) => x - y);
            if (lhs.length !== rhs.length) {
                return (
                    `Fracture returns ${lhs.length} faces for (A, B) but ` +
                    `${rhs.length} for (B, A)`
                );
            }
            for (let i = 0; i < lhs.length; i++) {
                const failure = near(
                    `Fracture face ${i} of ${lhs.length} (sorted by area)`,
                    lhs[i],
                    rhs[i],
                    m.tol,
                );
                if (failure !== null) return failure;
            }
            return null;
        },
    },
    {
        name: "partition-orientation",
        check: (m) =>
            sameOrientation("Division", m.divisionFaces) ??
            sameOrientation("Fracture", m.fractureFaces),
    },
    {
        // Monotonicity. Cheap, and it catches a result that is wildly too big
        // even when the identities above happen to balance.
        name: "parts-fit-inside-the-union",
        check: (m) => {
            if (m.I > m.U + m.tol) {
                return `|A n B| (${m.I.toPrecision(12)}) exceeds |A u B| (${m.U.toPrecision(12)})`;
            }
            if (m.D > m.U + m.tol) {
                return `|A \\ B| (${m.D.toPrecision(12)}) exceeds |A u B| (${m.U.toPrecision(12)})`;
            }
            return null;
        },
    },
];

/* Self-check: the oracle has to be right before it can judge anything. */

function areaOf(d: string): number {
    const p = PathBool.pathFromPathData(d) as unknown as AnySegment[];
    return signedArea(p, originFor([p]));
}

test("the area oracle measures known shapes exactly", () => {
    const unitCircleArcs =
        "M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 0 1 -1 0 A 1 1 0 0 1 0 -1 A 1 1 0 0 1 1 0 Z";
    expect(Math.abs(areaOf(unitCircleArcs))).toBeCloseTo(Math.PI, 12);

    const square = "M -1 -1 L 1 -1 L 1 1 L -1 1 L -1 -1 Z";
    expect(Math.abs(areaOf(square))).toBeCloseTo(4, 12);

    const triangle = "M 0 0 L 4 0 L 0 3 L 0 0 Z";
    expect(Math.abs(areaOf(triangle))).toBeCloseTo(6, 12);

    // Half-ellipse pair. Axis aligned, so the endpoints sit exactly on the
    // major axis and no radius correction is needed.
    const ellipse = "M 1.4 0 A 1.4 0.7 0 0 1 -1.4 0 A 1.4 0.7 0 0 1 1.4 0 Z";
    expect(Math.abs(areaOf(ellipse))).toBeCloseTo(Math.PI * 1.4 * 0.7, 12);

    // The same ellipse turned 30 degrees, with the endpoints moved onto the
    // rotated major axis so that it stays a valid arc. Area is invariant under
    // rotation; a couple of digits go to the trigonometry in the endpoints.
    const phi = 30;
    const ex = 1.4 * Math.cos((phi * Math.PI) / 180);
    const ey = 1.4 * Math.sin((phi * Math.PI) / 180);
    const rotated =
        `M ${ex} ${ey} A 1.4 0.7 ${phi} 0 1 ${-ex} ${-ey} ` +
        `A 1.4 0.7 ${phi} 0 1 ${ex} ${ey} Z`;
    expect(Math.abs(areaOf(rotated))).toBeCloseTo(Math.PI * 1.4 * 0.7, 9);

    // Quadratics: this is exactly 2/3 of its 2x1 bounding box.
    const parabola = "M -1 0 Q 0 3 1 0 L -1 0 Z";
    expect(Math.abs(areaOf(parabola))).toBeCloseTo(2, 12);

    // Opposed windings cancel: outer disc minus a hole of a quarter the area.
    const annulus =
        "M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 0 1 -1 0 A 1 1 0 0 1 0 -1 A 1 1 0 0 1 1 0 Z " +
        "M 0.5 0 A 0.5 0.5 0 0 0 0 -0.5 A 0.5 0.5 0 0 0 -0.5 0 A 0.5 0.5 0 0 0 0 0.5 A 0.5 0.5 0 0 0 0.5 0 Z";
    expect(Math.abs(areaOf(annulus))).toBeCloseTo(Math.PI * 0.75, 12);

    // Translation invariance is what lets `origin` be subtracted at all, and
    // it is the property that keeps the 1e6-conditioned cases meaningful.
    const farSquare =
        "M 999999 999999 L 1000001 999999 L 1000001 1000001 L 999999 1000001 L 999999 999999 Z";
    expect(Math.abs(areaOf(farSquare))).toBeCloseTo(4, 9);
});

test("the area oracle applies the SVG radius correction", () => {
    /*
     An arc whose endpoints are too far apart for the radii given: the chord
     from (1.4, 0) to (-1.4, 0) is 2*rx long, which only fits an unrotated
     ellipse. SVG F.6.6 says to scale both radii by sqrt(lambda) until it fits
     rather than reject the path, and at phi = 30 that lambda is 1.75. Getting
     this wrong is silent — the arc still draws — so it is pinned here.

     Only to six places: scaling the radii lands lambda back on exactly 1,
     which is precisely where the centre solve degenerates (its numerator goes
     to zero), so the centre picks up an offset of order 1e-8. That is the
     conditioning of the arc parametrization at that boundary, not slack in the
     integral — the well-conditioned shapes above match to twelve places.
    */
    const overlong = "M 1.4 0 A 1.4 0.7 30 0 1 -1.4 0 A 1.4 0.7 30 0 1 1.4 0 Z";
    expect(Math.abs(areaOf(overlong))).toBeCloseTo(
        Math.PI * 1.4 * 0.7 * 1.75,
        6,
    );
});

test("the area oracle rejects a wrong area", () => {
    // Guards against a self-check that would pass no matter what.
    const square = "M -1 -1 L 1 -1 L 1 1 L -1 1 L -1 -1 Z";
    expect(Math.abs(areaOf(square))).not.toBeCloseTo(4.1, 6);
});

/* Wiring */

const corpusCases = discoverCases();

const runs = corpusCases.flatMap((c) =>
    IDENTITIES.map((identity) => ({ ...c, identity: identity.name })),
);

test("the generated corpus is present", () => {
    expect(corpusCases.length).toBeGreaterThan(0);
});

test.each(runs)(
    "$id $identity",
    ({ id, dir, identity }) => {
        const data = measure(dir);
        const failure =
            data.error !== null
                ? data.error
                : IDENTITIES.find((i) => i.name === identity)!.check(
                      data.measures,
                  );

        assertOutcome(
            expectedFailures,
            EXPECTED_FAILURES_PATH,
            id,
            identity,
            failure,
        );
    },
    30000,
);
