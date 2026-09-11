/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { PathCubicSegment } from "../primitives/PathSegment";

export function pathCubicSegmentSelfIntersection(
    seg: PathCubicSegment,
): [number, number] | null {
    // P(t) = a*t^3 + b*t^2 + c*t + d. For distinct parameters t,u,
    // P(t)=P(u) gives a*((t+u)^2-tu) + b*(t+u) + c = 0.
    // Form coefficients from successive differences: translating the curve
    // must not turn endpoint closure into a tiny interior loop.
    const d0 = [seg[2][0] - seg[1][0], seg[2][1] - seg[1][1]];
    const d1 = [seg[3][0] - seg[2][0], seg[3][1] - seg[2][1]];
    const d2 = [seg[4][0] - seg[3][0], seg[4][1] - seg[3][1]];
    const a = [d2[0] - 2 * d1[0] + d0[0], d2[1] - 2 * d1[1] + d0[1]];
    const b = [3 * (d1[0] - d0[0]), 3 * (d1[1] - d0[1])];
    const c = [3 * d0[0], 3 * d0[1]];
    const cross = (v: number[], w: number[]) => v[0] * w[1] - v[1] * w[0];
    const denominator = cross(b, a);
    if (denominator === 0) return null;
    const sum = cross(a, c) / denominator;
    const discriminant = -3 * sum * sum - (4 * cross(b, c)) / denominator;
    if (!(discriminant >= 0)) return null;
    const difference = Math.sqrt(discriminant);
    const t = (sum - difference) / 2,
        u = (sum + difference) / 2;
    return Number.isFinite(t) && Number.isFinite(u) && t >= 0 && u <= 1
        ? [t, u]
        : null;
}
