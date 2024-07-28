/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { Vector } from "../primitives/Vector";

type LineSegment = [Vector, Vector];

const COLLINEAR_EPS = Number.MIN_VALUE * 64;

export function lineSegmentIntersection(
    [[x1, y1], [x2, y2]]: LineSegment,
    [[x3, y3], [x4, y4]]: LineSegment,
    eps: number,
): [number, number] | null {
    // https://en.wikipedia.org/wiki/Intersection_(geometry)#Two_line_segments

    const a1 = x2 - x1;
    const b1 = x3 - x4;
    const c1 = x3 - x1;
    const a2 = y2 - y1;
    const b2 = y3 - y4;
    const c2 = y3 - y1;

    const denom = a1 * b2 - a2 * b1;

    if (Math.abs(denom) < COLLINEAR_EPS) return null;

    const s = (c1 * b2 - c2 * b1) / denom;
    const t = (a1 * c2 - a2 * c1) / denom;

    if (-eps <= s && s <= 1 + eps && -eps <= t && t <= 1 + eps) {
        return [s, t];
    }

    return null;
}

export function lineSegmentsIntersect(
    seg1: LineSegment,
    seg2: LineSegment,
    eps: number,
) {
    return !!lineSegmentIntersection(seg1, seg2, eps);
}
