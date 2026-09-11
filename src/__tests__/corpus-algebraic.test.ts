/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Algebraic corpus checks compare exact Green-theorem areas and boolean identities.
 The evaluator runs in an isolated, assertion-stripped production bundle.
 Independent area-oracle self-checks remain in this Jest suite.
*/
import { afterAll, expect, test } from "@jest/globals";
import * as path from "node:path";

import { createOracle } from "./support/algebraic-oracle";
import {
    CORPUS_ROOT,
    assertOutcome,
    discoverCases,
    loadExpectedFailures,
    readCaseMetadata,
} from "./support/corpus";
import { isolated, closeWorkers } from "./support/isolated";

type PathBoolModule = typeof import("../index");
let PathBool: PathBoolModule;

process.env.PATH_BOOL_DEV_ASSERTS = "0";
PathBool = require("../index") as PathBoolModule;

const EXPECTED_FAILURES_PATH = path.join(
    CORPUS_ROOT,
    "expected-failures-algebraic.json",
);

afterAll(closeWorkers);
const { IDENTITIES, areaOf } = createOracle(PathBool);
const expectedFailures = loadExpectedFailures(EXPECTED_FAILURES_PATH);
/* Self-check: the oracle has to be right before it can judge anything. */

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

const corpusCases = discoverCases().filter(
    (c) => !readCaseMetadata(c.dir).structuralOnly,
);

const runs = corpusCases.flatMap((c) =>
    IDENTITIES.map((identity) => ({ ...c, identity: identity.name })),
);

test("the generated corpus is present", () => {
    expect(corpusCases.length).toBeGreaterThan(0);
});

test.each(runs)(
    "$id $identity",
    async ({ id, dir, identity }) => {
        const failure = await isolated(dir, "algebraic", identity);

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
