/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
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
import { Vector, vectorsEqual } from "../primitives/Vector";
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
) {
    if (seg0[0] === "L") {
        if (seg1[0] === "L") {
            return lineSegmentsIntersect(
                [seg0[1], seg0[2]],
                [seg1[1], seg1[2]],
                1e-6, // TODO: configurable
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
    pointEpsilon: number,
): boolean {
    const type = seg0[0];

    if (seg1[0] !== type) return false;

    switch (type) {
        case "L":
            return (
                vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, pointEpsilon)
            );
        case "C":
            return (
                vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, pointEpsilon) &&
                vectorsEqual(seg0[3], seg1[3] as Vector, pointEpsilon) &&
                vectorsEqual(seg0[4], seg1[4] as Vector, pointEpsilon)
            );
        case "Q":
            return (
                vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, pointEpsilon) &&
                vectorsEqual(seg0[3], seg1[3] as Vector, pointEpsilon)
            );
        case "A":
            return (
                vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                Math.abs(seg0[2] - (seg1[2] as number)) < pointEpsilon &&
                Math.abs(seg0[3] - (seg1[3] as number)) < pointEpsilon &&
                Math.abs(seg0[4] - (seg1[4] as number)) < pointEpsilon && // TODO: Phi can be anything if rx = ry. Also, handle rotations by Pi/2.
                seg0[5] === seg1[5] &&
                seg0[6] === seg1[6] &&
                vectorsEqual(seg0[7], seg1[7] as Vector, pointEpsilon)
            );
    }
}

export function pathSegmentIntersection(
    seg0: PathSegment,
    seg1: PathSegment,
    endpoints: boolean,
    eps: Epsilons,
): [number, number][] {
    if (seg0[0] === "L" && seg1[0] === "L") {
        const st = lineSegmentIntersection(
            [seg0[1], seg0[2]],
            [seg1[1], seg1[2]],
            eps.param,
        );
        if (st) {
            if (
                !endpoints &&
                (st[0] < eps.param || st[0] > 1 - eps.param) &&
                (st[1] < eps.param || st[1] > 1 - eps.param)
            ) {
                return [];
            }
            return [st];
        }
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

    while (pairs.length) {
        const nextPairs: [IntersectionSegment, IntersectionSegment][] = [];

        for (const [seg0, seg1] of pairs) {
            if (segmentsEqual(seg0.seg, seg1.seg, eps.point)) {
                // TODO: move this outside of this loop?
                continue; // TODO: what to do?
            }

            const isLinear0 =
                boundingBoxMaxExtent(seg0.boundingBox) <= eps.linear;
            const isLinear1 =
                boundingBoxMaxExtent(seg1.boundingBox) <= eps.linear;

            if (isLinear0 && isLinear1) {
                const lineSegment0 = pathSegmentToLineSegment(seg0.seg);
                const lineSegment1 = pathSegmentToLineSegment(seg1.seg);
                const st = lineSegmentIntersection(
                    lineSegment0,
                    lineSegment1,
                    eps.param,
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
                        if (intersectionSegmentsOverlap(seg0, seg1)) {
                            nextPairs.push([seg0, seg1]);
                        }
                    }
                }
            }
        }

        pairs = nextPairs;
    }

    if (!endpoints) {
        return params.filter(
            ([s, t]) =>
                (s > eps.param && s < 1 - eps.param) ||
                (t > eps.param && t < 1 - eps.param),
        );
    }

    return params;
}
