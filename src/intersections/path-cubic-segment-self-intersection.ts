/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { PathCubicSegment } from "../primitives/PathSegment";

const EPS = 1e-12;

export function pathCubicSegmentSelfIntersection(
    seg: PathCubicSegment,
): [number, number] | null {
    // https://math.stackexchange.com/questions/3931865/self-intersection-of-a-cubic-bezier-interpretation-of-the-solution

    const A = seg[1];
    const B = seg[2];
    const C = seg[3];
    const D = seg[4];

    const ax = -A[0] + 3 * B[0] - 3 * C[0] + D[0];
    const ay = -A[1] + 3 * B[1] - 3 * C[1] + D[1];
    const bx = 3 * A[0] - 6 * B[0] + 3 * C[0];
    const by = 3 * A[1] - 6 * B[1] + 3 * C[1];
    const cx = -3 * A[0] + 3 * B[0];
    const cy = -3 * A[1] + 3 * B[1];

    const M = ay * bx - ax * by;
    const N = ax * cy - ay * cx;

    const K =
        (-3 * ax * ax * cy * cy +
            6 * ax * ay * cx * cy +
            4 * ax * bx * by * cy -
            4 * ax * by * by * cx -
            3 * ay * ay * cx * cx -
            4 * ay * bx * bx * cy +
            4 * ay * bx * by * cx) /
        (ax * ax * by * by - 2 * ax * ay * bx * by + ay * ay * bx * bx);

    if (K < 0) return null;

    const t1 = (N / M + Math.sqrt(K)) / 2;
    const t2 = (N / M - Math.sqrt(K)) / 2;

    if (EPS <= t1 && t1 <= 1 - EPS && EPS <= t2 && t2 <= 1 - EPS) {
        return [t1, t2];
    }

    return null;
}
