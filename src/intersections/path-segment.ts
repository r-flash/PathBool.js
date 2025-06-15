/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { vec2 } from "gl-matrix";

import { Epsilons } from "../Epsilons";
import {
    AABB,
    boundingBoxesOverlap,
    boundingBoxMaxExtent,
} from "../primitives/AABB";
import {
    PathSegment,
    pathSegmentBoundingBox,
    splitSegmentAt,
} from "../primitives/PathSegment";
import { createVector, Vector, vectorsEqual } from "../primitives/Vector";
import { lerp } from "../util/math";
import { lineSegmentIntersection, lineSegmentsIntersect } from "./line-segment";
import { lineSegmentAABBIntersect } from "./line-segment-AABB";

type IntersectionSegment = {
    seg: PathSegment;
    startParam: number;
    endParam: number;
    boundingBox: AABB;
};

function subdivideIntersectionSegment(
    intSeg: IntersectionSegment,
): IntersectionSegment[] {
    const [seg0, seg1] = splitSegmentAt(intSeg.seg, 0.5);
    const midParam = (intSeg.startParam + intSeg.endParam) / 2;
    return [
        {
            seg: seg0,
            startParam: intSeg.startParam,
            endParam: midParam,
            boundingBox: pathSegmentBoundingBox(seg0),
        },
        {
            seg: seg1,
            startParam: midParam,
            endParam: intSeg.endParam,
            boundingBox: pathSegmentBoundingBox(seg1),
        },
    ];
}

function pathSegmentToLineSegment(seg: PathSegment): [Vector, Vector] {
    switch (seg[0]) {
        case "L":
            return [seg[1], seg[2]];
        case "C":
            return [seg[1], seg[4]];
        case "Q":
            return [seg[1], seg[3]];
        case "A":
            return [seg[1], seg[7]];
    }
}

function intersectionSegmentsOverlap(
    { seg: seg0, boundingBox: boundingBox0 }: IntersectionSegment,
    { seg: seg1, boundingBox: boundingBox1 }: IntersectionSegment,
    eps: Epsilons,
) {
    if (seg0[0] === "L") {
        if (seg1[0] === "L") {
            return lineSegmentsIntersect(
                [seg0[1], seg0[2]],
                [seg1[1], seg1[2]],
                eps,
            );
        } else {
            return lineSegmentAABBIntersect([seg0[1], seg0[2]], boundingBox1);
        }
    } else {
        if (seg1[0] === "L") {
            return lineSegmentAABBIntersect([seg1[1], seg1[2]], boundingBox0);
        } else {
            return boundingBoxesOverlap(boundingBox0, boundingBox1);
        }
    }
}

export function segmentsEqual(
    seg0: PathSegment,
    seg1: PathSegment,
    eps: number,
): boolean {
    const type = seg0[0];

    if (seg1[0] !== type) return false;

    switch (type) {
        case "L":
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, eps)
            );
        case "C":
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, eps) &&
                vectorsEqual(seg0[3], seg1[3] as Vector, eps) &&
                vectorsEqual(seg0[4], seg1[4] as Vector, eps)
            );
        case "Q":
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, eps) &&
                vectorsEqual(seg0[3], seg1[3] as Vector, eps)
            );
        case "A": {
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                Math.abs(seg0[2] - (seg1[2] as number)) < eps &&
                Math.abs(seg0[3] - (seg1[3] as number)) < eps &&
                (Math.abs(seg0[2] - seg0[3]) < eps ||
                    Math.abs(seg0[4] - (seg1[4] as number)) < eps) && // TODO: Handle rotations by Pi/2.
                seg0[5] === seg1[5] &&
                seg0[6] === seg1[6] &&
                vectorsEqual(seg0[7], seg1[7] as Vector, eps)
            );
        }
    }
}

function lineSegmentsCollinear(
    a: [Vector, Vector],
    b: [Vector, Vector],
    eps: number,
): boolean {
    const da = vec2.sub([0, 0], a[1], a[0]);
    const db = vec2.sub([0, 0], b[1], b[0]);
    vec2.normalize(da, da);
    vec2.normalize(db, db);
    const dot = Math.abs(vec2.dot(da, db));
    return Math.abs(dot - 1) < eps;
}

const collinearLineSegmentIntersection = (() => {
    const da = createVector();
    const db = createVector();
    const a0b0 = createVector();
    const a0b1 = createVector();
    const b0a0 = createVector();
    const b0a1 = createVector();

    return function collinearLineSegmentIntersection(
        a: [Vector, Vector],
        b: [Vector, Vector],
    ): [number, number][] {
        vec2.sub(da, a[1], a[0]);
        vec2.sub(db, b[1], b[0]);

        // Divide by len^2, i.e., normalize and pre-divide by len.
        vec2.scale(da, da, 1 / vec2.sqrLen(da));
        vec2.scale(db, db, 1 / vec2.sqrLen(db));

        const pairs: [number, number][] = [];

        vec2.sub(a0b0, b[0], a[0]);
        const s0 = vec2.dot(a0b0, da);
        if (s0 >= 0 && s0 <= 1) {
            pairs.push([s0, 0]);
        }

        vec2.sub(a0b1, b[1], a[0]);
        const s1 = vec2.dot(a0b1, da);
        if (s1 >= 0 && s1 <= 1) {
            pairs.push([s1, 1]);
        }

        vec2.sub(b0a0, a[0], b[0]);
        const t0 = vec2.dot(b0a0, db);
        if (t0 >= 0 && t0 <= 1) {
            pairs.push([0, t0]);
        }

        vec2.sub(b0a1, a[1], b[0]);
        const t1 = vec2.dot(b0a1, db);
        if (t1 >= 0 && t1 <= 1) {
            pairs.push([1, t1]);
        }

        return pairs;
    };
})();

export function pathSegmentIntersection(
    seg0: PathSegment,
    seg1: PathSegment,
    eps: Epsilons,
): [number, number][] {
    if (seg0[0] === "L" && seg1[0] === "L") {
        const segLine0: [Vector, Vector] = [seg0[1], seg0[2]];
        const segLine1: [Vector, Vector] = [seg1[1], seg1[2]];

        if (lineSegmentsCollinear(segLine0, segLine1, eps.collinear)) {
            return collinearLineSegmentIntersection(segLine0, segLine1);
        }

        const st = lineSegmentIntersection(segLine0, segLine1, eps);

        return st ? [st] : [];
    }

    // https://math.stackexchange.com/questions/20321/how-can-i-tell-when-two-cubic-b%C3%A9zier-curves-intersect

    let pairs: [IntersectionSegment, IntersectionSegment][] = [
        [
            {
                seg: seg0,
                startParam: 0,
                endParam: 1,
                boundingBox: pathSegmentBoundingBox(seg0),
            },
            {
                seg: seg1,
                startParam: 0,
                endParam: 1,
                boundingBox: pathSegmentBoundingBox(seg1),
            },
        ],
    ];

    const params: [number, number][] = [];

    function isLinear(seg: IntersectionSegment) {
        return (
            boundingBoxMaxExtent(seg.boundingBox) <= eps.linear ||
            seg.endParam - seg.startParam < eps.param
        );
    }

    while (pairs.length) {
        const nextPairs: [IntersectionSegment, IntersectionSegment][] = [];

        for (const [seg0, seg1] of pairs) {
            if (segmentsEqual(seg0.seg, seg1.seg, eps.point)) {
                // TODO: move this outside of this loop?
                continue; // TODO: what to do?
            }

            const isLinear0 = isLinear(seg0);
            const isLinear1 = isLinear(seg1);

            if (isLinear0 && isLinear1) {
                const lineSegment0 = pathSegmentToLineSegment(seg0.seg);
                const lineSegment1 = pathSegmentToLineSegment(seg1.seg);
                const st = lineSegmentIntersection(
                    lineSegment0,
                    lineSegment1,
                    eps,
                );
                if (st) {
                    params.push([
                        lerp(seg0.startParam, seg0.endParam, st[0]),
                        lerp(seg1.startParam, seg1.endParam, st[1]),
                    ]);
                }
            } else {
                const subdivided0 = isLinear0
                    ? [seg0]
                    : subdivideIntersectionSegment(seg0);
                const subdivided1 = isLinear1
                    ? [seg1]
                    : subdivideIntersectionSegment(seg1);

                for (const seg0 of subdivided0) {
                    for (const seg1 of subdivided1) {
                        if (intersectionSegmentsOverlap(seg0, seg1, eps)) {
                            nextPairs.push([seg0, seg1]);
                        }
                    }
                }
            }
        }

        pairs = nextPairs;
    }

    return params;
}
