/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { mat2, mat2d, vec2 } from "gl-matrix";

import { assertCondition, assertUnreachableValue } from "../assert";
import { NEARLY_LINEAR_EPS } from "../config";
import { deg2rad, lerp, TAU, vectorAngle } from "../util/math";
import {
    AABB,
    boundingBoxAroundPoint,
    expandBoundingBox,
    extendBoundingBox,
    mergeBoundingBoxes,
} from "./AABB";
import { createVector, Vector } from "./Vector";

export type PathLineSegment = ["L", Vector, Vector];

export type PathCubicSegment = ["C", Vector, Vector, Vector, Vector];

export type PathQuadraticSegment = ["Q", Vector, Vector, Vector];

export type PathArcSegment = [
    "A",
    Vector,
    number, // rx
    number, // ry
    number, // rotation
    boolean, // large-arc-flag
    boolean, // sweep-flag
    Vector,
];

export type PathSegment =
    | PathLineSegment
    | PathCubicSegment
    | PathQuadraticSegment
    | PathArcSegment;

type PathArcSegmentCenterParametrization = {
    center: Vector;
    theta1: number;
    deltaTheta: number;
    rx: number;
    ry: number;
    phi: number;
};

/*
 gl-matrix allocates its matrices as Float32Array unless the host application
 changes ARRAY_TYPE globally, which a library has no business doing — a
 consumer may be feeding the same gl-matrix straight into WebGL buffers and
 want float32.

 Float32 costs about nine digits, and everything here flows through these
 matrices. An arc's rotation matrix rounded to float32 shifts the recovered
 centre parametrization by ~1e-8, which is enormous next to EPS.param: the arc
 then no longer passes through its own stated endpoint, and its tangent at
 that endpoint is wrong by the same order. That is far bigger than the
 differences the incidence-angle sort has to resolve, so tangent curves ended
 up ordered wrongly around a vertex.

 The identity initializers match what mat2.create()/mat2d.create() return.
*/
function createMat2(): mat2 {
    return new Float64Array([1, 0, 0, 1]);
}

function createMat2d(): mat2d {
    return new Float64Array([1, 0, 0, 1, 0, 0]);
}

function isFiniteNumber(value: number): boolean {
    return Number.isFinite(value);
}

function isFiniteVector([x, y]: Vector): boolean {
    return Number.isFinite(x) && Number.isFinite(y);
}

function normalizeArcRotationDegrees(phi: number): number {
    if (!Number.isFinite(phi)) return 0;
    let normalized = ((phi % 360) + 360) % 360;
    if (normalized > 180) normalized -= 360;
    return normalized;
}

function pointLineDistance(
    p: Vector,
    a: Vector,
    b: Vector,
    eps: number,
): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= eps * eps) {
        const px = p[0] - a[0];
        const py = p[1] - a[1];
        return Math.hypot(px, py);
    }
    const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx);
    return cross / Math.sqrt(lenSq);
}

export function isNearlyLinearSegment(
    seg: PathSegment,
    eps: number = NEARLY_LINEAR_EPS,
): boolean {
    const a = seg[1];
    const b = getEndPoint(seg);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx * dx + dy * dy <= eps * eps) return true;

    switch (seg[0]) {
        case "L":
            return true;
        case "Q":
            return pointLineDistance(seg[2], a, b, eps) <= eps;
        case "C":
            return (
                pointLineDistance(seg[2], a, b, eps) <= eps &&
                pointLineDistance(seg[3], a, b, eps) <= eps
            );
        case "A":
            return (
                !Number.isFinite(seg[2]) ||
                !Number.isFinite(seg[3]) ||
                Math.abs(seg[2]) <= eps ||
                Math.abs(seg[3]) <= eps
            );
    }
}

export function normalizeArcSegment(seg: PathArcSegment): PathArcSegment {
    const phi = normalizeArcRotationDegrees(seg[4]);
    return ["A", seg[1], seg[2], seg[3], phi, seg[5], seg[6], seg[7]];
}

export function getStartPoint(seg: PathSegment): Vector {
    return seg[1];
}

export function getEndPoint(seg: PathSegment): Vector {
    switch (seg[0]) {
        case "L":
            return seg[2];
        case "C":
            return seg[4];
        case "Q":
            return seg[3];
        case "A":
            return seg[7];
    }
}

export function reversePathSegment(seg: PathSegment): PathSegment {
    switch (seg[0]) {
        case "L":
            return ["L", seg[2], seg[1]];
        case "C":
            return ["C", seg[4], seg[3], seg[2], seg[1]];
        case "Q":
            return ["Q", seg[3], seg[2], seg[1]];
        case "A":
            return [
                "A",
                seg[7],
                seg[2],
                seg[3],
                seg[4],
                seg[5],
                !seg[6],
                seg[1],
            ];
    }
}

export const arcSegmentToCenter = (() => {
    const xy1Prime = createVector();
    const rotationMatrix = createMat2();
    const addend = createVector();
    const cxy = createVector();

    return function arcSegmentToCenter([
        _A,
        xy1,
        rx,
        ry,
        phi,
        fA,
        fS,
        xy2,
    ]: PathArcSegment): PathArcSegmentCenterParametrization | null {
        if (!isFiniteVector(xy1) || !isFiniteVector(xy2)) {
            return null;
        }
        phi = normalizeArcRotationDegrees(phi);
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        if (
            !isFiniteNumber(rx) ||
            !isFiniteNumber(ry) ||
            Math.abs(rx) <= NEARLY_LINEAR_EPS ||
            Math.abs(ry) <= NEARLY_LINEAR_EPS
        ) {
            return null;
        }

        // https://svgwg.org/svg2-draft/implnote.html#ArcConversionEndpointToCenter

        mat2.fromRotation(rotationMatrix, -deg2rad(phi));

        vec2.sub(xy1Prime, xy1, xy2);
        vec2.scale(xy1Prime, xy1Prime, 0.5);
        vec2.transformMat2(xy1Prime, xy1Prime, rotationMatrix);

        let rx2 = rx * rx;
        let ry2 = ry * ry;
        const x1Prime2 = xy1Prime[0] * xy1Prime[0];
        const y1Prime2 = xy1Prime[1] * xy1Prime[1];

        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        const lambda = x1Prime2 / rx2 + y1Prime2 / ry2 + 1e-12; // small epsilon needed because of float precision
        if (lambda > 1) {
            const lambdaSqrt = Math.sqrt(lambda);
            rx *= lambdaSqrt;
            ry *= lambdaSqrt;
            const lambdaAbs = Math.abs(lambda);
            rx2 *= lambdaAbs;
            ry2 *= lambdaAbs;
        }

        const sign = fA === fS ? -1 : 1;
        const denom = rx2 * y1Prime2 + ry2 * x1Prime2;
        if (denom === 0) return null;
        const numer = rx2 * ry2 - rx2 * y1Prime2 - ry2 * x1Prime2;
        const ratio = Math.max(0, numer / denom);
        const multiplier = Math.sqrt(ratio);
        const cxPrime = sign * multiplier * ((rx * xy1Prime[1]) / ry);
        const cyPrime = sign * multiplier * ((-ry * xy1Prime[0]) / rx);

        mat2.transpose(rotationMatrix, rotationMatrix);
        vec2.add(addend, xy1, xy2);
        vec2.scale(addend, addend, 0.5);
        vec2.transformMat2(cxy, [cxPrime, cyPrime], rotationMatrix);
        vec2.add(cxy, cxy, addend);

        const vec1: Vector = [
            (xy1Prime[0] - cxPrime) / rx,
            (xy1Prime[1] - cyPrime) / ry,
        ];
        const theta1 = vectorAngle([1, 0], vec1);
        let deltaTheta = vectorAngle(vec1, [
            (-xy1Prime[0] - cxPrime) / rx,
            (-xy1Prime[1] - cyPrime) / ry,
        ]);

        if (!fS && deltaTheta > 0) {
            deltaTheta -= TAU;
        } else if (fS && deltaTheta < 0) {
            deltaTheta += TAU;
        }

        return {
            center: [cxy[0], cxy[1]],
            theta1,
            deltaTheta,
            rx,
            ry,
            phi,
        };
    };
})();

export const arcSegmentFromCenter = (() => {
    const xy1 = createVector();
    const xy2 = createVector();
    const rotationMatrix = createMat2();

    return function arcSegmentFromCenter({
        center,
        theta1,
        deltaTheta,
        rx,
        ry,
        phi,
    }: PathArcSegmentCenterParametrization): PathArcSegment {
        // https://svgwg.org/svg2-draft/implnote.html#ArcConversionCenterToEndpoint
        // `phi` is in degrees, as everywhere else in a PathArcSegment, while
        // fromRotation takes radians. Rotating by phi directly puts the arc
        // somewhere else entirely — invisibly so at phi = 0, which is why only
        // rotated arcs were affected.
        mat2.fromRotation(rotationMatrix, deg2rad(phi));

        vec2.set(xy1, rx * Math.cos(theta1), ry * Math.sin(theta1));
        vec2.transformMat2(xy1, xy1, rotationMatrix);
        vec2.add(xy1, xy1, center);

        vec2.set(
            xy2,
            rx * Math.cos(theta1 + deltaTheta),
            ry * Math.sin(theta1 + deltaTheta),
        );
        vec2.transformMat2(xy2, xy2, rotationMatrix);
        vec2.add(xy2, xy2, center);

        const fA = Math.abs(deltaTheta) > Math.PI;

        const fS = deltaTheta > 0;

        return ["A", [xy1[0], xy1[1]], rx, ry, phi, fA, fS, [xy2[0], xy2[1]]];
    };
})();

export const samplePathSegmentAtInto = (() => {
    const p01 = createVector();
    const p12 = createVector();
    const p23 = createVector();
    const p012 = createVector();
    const p123 = createVector();
    const p = createVector();

    return function samplePathSegmentAtInto(
        seg: PathSegment,
        t: number,
        out: Vector,
    ): Vector {
        if (isNearlyLinearSegment(seg)) {
            vec2.lerp(p, seg[1], getEndPoint(seg), t);
            out[0] = p[0];
            out[1] = p[1];
            return out;
        }
        switch (seg[0]) {
            case "L":
                vec2.lerp(p, seg[1], seg[2], t);
                break;
            case "C":
                vec2.lerp(p01, seg[1], seg[2], t);
                vec2.lerp(p12, seg[2], seg[3], t);
                vec2.lerp(p23, seg[3], seg[4], t);
                vec2.lerp(p012, p01, p12, t);
                vec2.lerp(p123, p12, p23, t);
                vec2.lerp(p, p012, p123, t);
                break;
            case "Q":
                vec2.lerp(p01, seg[1], seg[2], t);
                vec2.lerp(p12, seg[2], seg[3], t);
                vec2.lerp(p, p01, p12, t);
                break;
            case "A": {
                const centerParametrization = arcSegmentToCenter(seg);
                if (!centerParametrization) {
                    // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
                    vec2.lerp(p, seg[1], seg[7], t);
                    break;
                }
                const { deltaTheta, phi, theta1, rx, ry, center } =
                    centerParametrization;
                const theta = theta1 + t * deltaTheta;
                vec2.set(p, rx * Math.cos(theta), ry * Math.sin(theta));
                // Degrees to radians, as in arcSegmentFromCenter above.
                vec2.rotate(p, p, [0, 0], deg2rad(phi));
                vec2.add(p, p, center);
                break;
            }
        }

        out[0] = p[0];
        out[1] = p[1];
        return out;
    };
})();

export const samplePathSegmentAt = (() => {
    const out = createVector();

    return function samplePathSegmentAt(seg: PathSegment, t: number): Vector {
        samplePathSegmentAtInto(seg, t, out);
        return [out[0], out[1]];
    };
})();

export const pathSegmentTangentAtInto = (() => {
    const tmp = createVector();

    return function pathSegmentTangentAtInto(
        seg: PathSegment,
        t: number,
        out: Vector,
    ): Vector {
        if (isNearlyLinearSegment(seg)) {
            const start = seg[1];
            const end = getEndPoint(seg);
            out[0] = end[0] - start[0];
            out[1] = end[1] - start[1];
            return out;
        }

        assertCondition(seg[0] !== "L", "Linear segment not marked as linear");

        switch (seg[0]) {
            case "Q": {
                const p0 = seg[1];
                const p1 = seg[2];
                const p2 = seg[3];
                const ax = p1[0] - p0[0];
                const ay = p1[1] - p0[1];
                const bx = p2[0] - p1[0];
                const by = p2[1] - p1[1];
                out[0] = 2 * ((1 - t) * ax + t * bx);
                out[1] = 2 * ((1 - t) * ay + t * by);
                return out;
            }
            case "C": {
                const p0 = seg[1];
                const p1 = seg[2];
                const p2 = seg[3];
                const p3 = seg[4];
                const ax = p1[0] - p0[0];
                const ay = p1[1] - p0[1];
                const bx = p2[0] - p1[0];
                const by = p2[1] - p1[1];
                const cx = p3[0] - p2[0];
                const cy = p3[1] - p2[1];
                const u = 1 - t;
                out[0] = 3 * (u * u * ax + 2 * u * t * bx + t * t * cx);
                out[1] = 3 * (u * u * ay + 2 * u * t * by + t * t * cy);
                return out;
            }
            case "A": {
                const centerParametrization = arcSegmentToCenter(
                    normalizeArcSegment(seg),
                );
                if (!centerParametrization) {
                    out[0] = seg[7][0] - seg[1][0];
                    out[1] = seg[7][1] - seg[1][1];
                    return out;
                }
                const { deltaTheta, phi, theta1, rx, ry } =
                    centerParametrization;
                const theta = theta1 + t * deltaTheta;
                const cosPhi = Math.cos(deg2rad(phi));
                const sinPhi = Math.sin(deg2rad(phi));
                const dx = -rx * Math.sin(theta) * deltaTheta;
                const dy = ry * Math.cos(theta) * deltaTheta;
                tmp[0] = cosPhi * dx - sinPhi * dy;
                tmp[1] = sinPhi * dx + cosPhi * dy;
                out[0] = tmp[0];
                out[1] = tmp[1];
                return out;
            }
        }

        assertUnreachableValue(seg[0], "Unexpected segment type " + seg[0]);
    };
})();

export const pathSegmentTangentAt = (() => {
    const out = createVector();

    return function pathSegmentTangentAt(seg: PathSegment, t: number): Vector {
        pathSegmentTangentAtInto(seg, t, out);
        return [out[0], out[1]];
    };
})();

export const arcSegmentToCubics = (() => {
    const fromUnit = createMat2d();
    const matrix = createMat2d();

    return function arcSegmentToCubics(
        arc: PathArcSegment,
        maxDeltaTheta: number = Math.PI / 2,
    ): PathCubicSegment[] | [PathLineSegment] {
        const centerParametrization = arcSegmentToCenter(
            normalizeArcSegment(arc),
        );

        if (!centerParametrization) {
            // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
            // "If rx = 0 or ry = 0, then treat this as a straight line from (x1, y1) to (x2, y2) and stop."
            return [["L", arc[1], arc[7]]];
        }

        const { center, theta1, deltaTheta, rx, ry } = centerParametrization;

        const count = Math.ceil(Math.abs(deltaTheta) / maxDeltaTheta);

        mat2d.fromTranslation(fromUnit, center);
        mat2d.rotate(fromUnit, fromUnit, deg2rad(arc[4]));
        mat2d.scale(fromUnit, fromUnit, [rx, ry]);

        // https://pomax.github.io/bezierinfo/#circles_cubic
        const cubics: PathCubicSegment[] = [];
        const theta = deltaTheta / count;
        const k = (4 / 3) * Math.tan(theta / 4);
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for (let i = 0; i < count; i++) {
            const start: Vector = [1, 0];
            const control1: Vector = [1, k];
            const control2: Vector = [
                cosTheta + k * sinTheta,
                sinTheta - k * cosTheta,
            ];
            const end: Vector = [cosTheta, sinTheta];

            mat2d.fromRotation(matrix, theta1 + i * theta);
            mat2d.mul(matrix, fromUnit, matrix);
            vec2.transformMat2d(start, start, matrix);
            vec2.transformMat2d(control1, control1, matrix);
            vec2.transformMat2d(control2, control2, matrix);
            vec2.transformMat2d(end, end, matrix);

            cubics.push(["C", start, control1, control2, end]);
        }

        return cubics;
    };
})();

function evalCubic1d(
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    t: number,
) {
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, p3, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    return lerp(p012, p123, t);
}

function cubicBoundingInterval(p0: number, p1: number, p2: number, p3: number) {
    let min = Math.min(p0, p3);
    let max = Math.max(p0, p3);

    function consider(t: number) {
        if (!(0 < t && t < 1)) return;
        const x = evalCubic1d(p0, p1, p2, p3, t);
        min = Math.min(min, x);
        max = Math.max(max, x);
    }

    // The derivative, a*t^2 + b*t + c, whose roots are the interior extremes.
    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const b = 6 * (p0 - 2 * p1 + p2);
    const c = 3 * (p1 - p0);

    /*
     `a` vanishes whenever 3*(p1 - p2) === p0 - p3, which every cubic that is
     symmetric in this coordinate satisfies — p1 === p2 with p0 === p3. That is
     an ordinary shape, not a corner case: any symmetric arch or loop.

     Rounding leaves `a` at about 1e-16 rather than exactly zero, so the old
     `a === 0` test never fired and the quadratic formula went ahead and
     divided by the noise. For the control values -0.6, 1.4, 1.4, -0.6 it
     returned t = 0.889 where the extreme is at 0.5, and the interval came back
     as -0.6 .. -0.0074 for a curve reaching 0.9. Comparing `a` against the
     other coefficients instead of against zero is what makes the test mean
     anything; below that the derivative is linear and has one root.
    */
    if (Math.abs(a) <= 1e-12 * Math.max(Math.abs(b), Math.abs(c))) {
        if (b !== 0) consider(-c / b);
        return [min, max];
    }

    const D = b * b - 4 * a * c;
    if (D < 0) return [min, max];

    /*
     Solved through `q` rather than by the schoolbook formula twice: taking
     both roots as (-b +- sqrt(D)) / 2a subtracts two nearly equal numbers for
     whichever sign opposes b, and loses most of that root's precision.
    */
    const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(D));
    consider(q / a);
    if (q !== 0) consider(c / q);

    return [min, max];
}

function evalQuadratic1d(p0: number, p1: number, p2: number, t: number) {
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    return lerp(p01, p12, t);
}

function quadraticBoundingInterval(p0: number, p1: number, p2: number) {
    let min = Math.min(p0, p2);
    let max = Math.max(p0, p2);

    const denominator = p0 - 2 * p1 + p2;

    if (denominator === 0) {
        return [min, max];
    }

    const t = (p0 - p1) / denominator;
    if (0 <= t && t <= 1) {
        const x = evalQuadratic1d(p0, p1, p2, t);
        min = Math.min(min, x);
        max = Math.max(max, x);
    }

    return [min, max];
}

function inInterval(x: number, x0: number, x1: number) {
    const mapped = (x - x0) / (x1 - x0);
    return 0 <= mapped && mapped <= 1;
}

/*
 Whether an arc sweeping from `theta1` to `theta2` passes through `target`,
 which is an angle in the same measure, up to whole turns.

 A sweep is at most one full turn, so at most one representative of `target`
 can fall inside it: lift `target` to the first one at or above the low end
 and ask whether it is still below the high end. That replaces testing a
 couple of hand-picked representatives, which could not cover every way a
 sweep straddles the branch cut.
*/
function sweepContainsAngle(target: number, theta1: number, theta2: number) {
    const lo = Math.min(theta1, theta2);
    const hi = Math.max(theta1, theta2);
    return target + TAU * Math.ceil((lo - target) / TAU) <= hi;
}

export function pathSegmentBoundingBox(seg: PathSegment): AABB {
    if (isNearlyLinearSegment(seg)) {
        const start = seg[1];
        const end = getEndPoint(seg);
        return {
            top: Math.min(start[1], end[1]),
            right: Math.max(start[0], end[0]),
            bottom: Math.max(start[1], end[1]),
            left: Math.min(start[0], end[0]),
        };
    }
    switch (seg[0]) {
        case "L":
            return {
                top: Math.min(seg[1][1], seg[2][1]),
                right: Math.max(seg[1][0], seg[2][0]),
                bottom: Math.max(seg[1][1], seg[2][1]),
                left: Math.min(seg[1][0], seg[2][0]),
            };
        case "C": {
            const [left, right] = cubicBoundingInterval(
                seg[1][0],
                seg[2][0],
                seg[3][0],
                seg[4][0],
            );
            const [top, bottom] = cubicBoundingInterval(
                seg[1][1],
                seg[2][1],
                seg[3][1],
                seg[4][1],
            );
            return { top, right, bottom, left };
        }
        case "Q": {
            const [left, right] = quadraticBoundingInterval(
                seg[1][0],
                seg[2][0],
                seg[3][0],
            );
            const [top, bottom] = quadraticBoundingInterval(
                seg[1][1],
                seg[2][1],
                seg[3][1],
            );
            return { top, right, bottom, left };
        }
        case "A": {
            const centerParametrization = arcSegmentToCenter(
                normalizeArcSegment(seg),
            );

            if (!centerParametrization) {
                return extendBoundingBox(
                    boundingBoxAroundPoint(seg[1], 0),
                    seg[7],
                );
            }

            const { theta1, deltaTheta, phi, center, rx, ry } =
                centerParametrization;

            if (phi === 0 || rx === ry) {
                const theta2 = theta1 + deltaTheta;
                let boundingBox = extendBoundingBox(
                    boundingBoxAroundPoint(seg[1], 0),
                    seg[7],
                );
                /*
                 The four axis extremes, as angles in the parametrization's
                 own frame.

                 With rx === ry the parametrization angle is measured in the
                 ellipse's frame and only then turned by phi, so the extreme
                 the world sees at angle a is reached at a - phi. Testing the
                 unturned angles let a small arc claim an extreme it never
                 goes near: written with phi = 45 a circle's arc came out with
                 a box 8.8 times its own chord, and 20 times at phi = 135.
                 Boxes that big are still correct, but they stop the
                 intersection finder pruning anything.

                 phi is 0 in the other case this branch handles, so the offset
                 simply vanishes there.
                */
                const offset = deg2rad(phi);
                const extremes: [number, Vector][] = [
                    [Math.PI - offset, [center[0] - rx, center[1]]],
                    [-Math.PI / 2 - offset, [center[0], center[1] - ry]],
                    [-offset, [center[0] + rx, center[1]]],
                    [Math.PI / 2 - offset, [center[0], center[1] + ry]],
                ];
                for (const [angle, point] of extremes) {
                    if (sweepContainsAngle(angle, theta1, theta2)) {
                        boundingBox = extendBoundingBox(boundingBox, point);
                    }
                }
                return expandBoundingBox(boundingBox, 1e-11); // TODO: get rid of expansion
            }

            // TODO: don't convert to cubics
            const cubics = arcSegmentToCubics(seg, Math.PI / 16);
            let boundingBox: AABB | null = null;
            for (const seg of cubics) {
                boundingBox = mergeBoundingBoxes(
                    boundingBox,
                    pathSegmentBoundingBox(seg),
                );
            }
            if (!boundingBox) {
                return boundingBoxAroundPoint(seg[1], 0); //  TODO: what to do here?
            }
            return boundingBox;
        }
    }
}

function splitLinearSegmentAt(
    seg: PathLineSegment,
    t: number,
): [PathLineSegment, PathLineSegment] {
    const a = seg[1];
    const b = seg[2];

    const p = vec2.lerp(createVector(), a, b, t) as Vector;

    return [
        ["L", a, p],
        ["L", p, b],
    ];
}

export function splitCubicSegmentAt(
    seg: PathCubicSegment,
    t: number,
): [PathCubicSegment, PathCubicSegment] {
    // https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm
    const p0 = seg[1];
    const p1 = seg[2];
    const p2 = seg[3];
    const p3 = seg[4];

    const p01 = vec2.lerp(createVector(), p0, p1, t) as Vector;
    const p12 = vec2.lerp(createVector(), p1, p2, t) as Vector;
    const p23 = vec2.lerp(createVector(), p2, p3, t) as Vector;
    const p012 = vec2.lerp(createVector(), p01, p12, t) as Vector;
    const p123 = vec2.lerp(createVector(), p12, p23, t) as Vector;
    const p = vec2.lerp(createVector(), p012, p123, t) as Vector;

    return [
        ["C", p0, p01, p012, p],
        ["C", p, p123, p23, p3],
    ];
}

function splitQuadraticSegmentAt(
    seg: PathQuadraticSegment,
    t: number,
): [PathQuadraticSegment, PathQuadraticSegment] {
    // https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm
    const p0 = seg[1];
    const p1 = seg[2];
    const p2 = seg[3];

    const p01 = vec2.lerp(createVector(), p0, p1, t) as Vector;
    const p12 = vec2.lerp(createVector(), p1, p2, t) as Vector;
    const p = vec2.lerp(createVector(), p01, p12, t) as Vector;

    return [
        ["Q", p0, p01, p],
        ["Q", p, p12, p2],
    ];
}

function splitArcSegmentAt(
    seg: PathArcSegment,
    t: number,
): [PathArcSegment, PathArcSegment] | [PathLineSegment, PathLineSegment] {
    const centerParametrization = arcSegmentToCenter(normalizeArcSegment(seg));

    if (!centerParametrization) {
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        return splitLinearSegmentAt(["L", seg[1], seg[7]], t);
    }

    const midDeltaTheta = centerParametrization.deltaTheta * t;
    return [
        arcSegmentFromCenter({
            ...centerParametrization,
            deltaTheta: midDeltaTheta,
        }),
        arcSegmentFromCenter({
            ...centerParametrization,
            theta1: centerParametrization.theta1 + midDeltaTheta,
            deltaTheta: centerParametrization.deltaTheta - midDeltaTheta,
        }),
    ];
}

export function splitSegmentAt(
    seg: PathSegment,
    t: number,
): [PathSegment, PathSegment] {
    if (isNearlyLinearSegment(seg)) {
        return splitLinearSegmentAt(["L", seg[1], getEndPoint(seg)], t);
    }
    switch (seg[0]) {
        case "L":
            return splitLinearSegmentAt(seg, t);
        case "C":
            return splitCubicSegmentAt(seg, t);
        case "Q":
            return splitQuadraticSegmentAt(seg, t);
        case "A":
            return splitArcSegmentAt(seg, t);
    }
}
