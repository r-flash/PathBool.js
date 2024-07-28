/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { mat2, mat2d, vec2 } from "gl-matrix";

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
    const rotationMatrix = mat2.create();
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
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        if (rx === 0 || ry === 0) {
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
        const multiplier = Math.sqrt(
            (rx2 * ry2 - rx2 * y1Prime2 - ry2 * x1Prime2) /
                (rx2 * y1Prime2 + ry2 * x1Prime2),
        );
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
    const rotationMatrix = mat2.create();

    return function arcSegmentFromCenter({
        center,
        theta1,
        deltaTheta,
        rx,
        ry,
        phi,
    }: PathArcSegmentCenterParametrization): PathArcSegment {
        // https://svgwg.org/svg2-draft/implnote.html#ArcConversionCenterToEndpoint
        mat2.fromRotation(rotationMatrix, phi); // TODO: sign (also in sampleAt)

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

export const samplePathSegmentAt = (() => {
    const p01 = createVector();
    const p12 = createVector();
    const p23 = createVector();
    const p012 = createVector();
    const p123 = createVector();
    const p = createVector();

    return function samplePathSegmentAt(seg: PathSegment, t: number): Vector {
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
                vec2.rotate(p, p, [0, 0], phi); // TODO: sign (also in fromCenter)
                vec2.add(p, p, center);
                break;
            }
        }

        return [p[0], p[1]];
    };
})();

export const arcSegmentToCubics = (() => {
    const fromUnit = mat2d.create();
    const matrix = mat2d.create();

    return function arcSegmentToCubics(
        arc: PathArcSegment,
        maxDeltaTheta: number = Math.PI / 2,
    ): PathCubicSegment[] | [PathLineSegment] {
        const centerParametrization = arcSegmentToCenter(arc);

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

    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const b = 6 * (p0 - 2 * p1 + p2);
    const c = 3 * (p1 - p0);
    const D = b * b - 4 * a * c;

    if (D < 0 || a === 0) {
        // TODO: if a=0, solve linear
        return [min, max];
    }

    const sqrtD = Math.sqrt(D);

    const t0 = (-b - sqrtD) / (2 * a);
    if (0 < t0 && t0 < 1) {
        const x0 = evalCubic1d(p0, p1, p2, p3, t0);
        min = Math.min(min, x0);
        max = Math.max(max, x0);
    }

    const t1 = (-b + sqrtD) / (2 * a);
    if (0 < t1 && t1 < 1) {
        const x1 = evalCubic1d(p0, p1, p2, p3, t1);
        min = Math.min(min, x1);
        max = Math.max(max, x1);
    }

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

export function pathSegmentBoundingBox(seg: PathSegment): AABB {
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
            const centerParametrization = arcSegmentToCenter(seg);

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
                // FIXME: the following gives false positives, resulting in larger boxes
                if (
                    inInterval(-Math.PI, theta1, theta2) ||
                    inInterval(Math.PI, theta1, theta2)
                ) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0] - rx,
                        center[1],
                    ]);
                }
                if (
                    inInterval(-Math.PI / 2, theta1, theta2) ||
                    inInterval((3 * Math.PI) / 2, theta1, theta2)
                ) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0],
                        center[1] - ry,
                    ]);
                }
                if (
                    inInterval(0, theta1, theta2) ||
                    inInterval(2 * Math.PI, theta1, theta2)
                ) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0] + rx,
                        center[1],
                    ]);
                }
                if (
                    inInterval(Math.PI / 2, theta1, theta2) ||
                    inInterval((5 * Math.PI) / 2, theta1, theta2)
                ) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0],
                        center[1] + ry,
                    ]);
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
    const centerParametrization = arcSegmentToCenter(seg);

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
