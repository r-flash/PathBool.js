/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { vec2 } from "gl-matrix";

export const TAU = 2 * Math.PI;

export function linMap(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
) {
    return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

export function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

export function deg2rad(deg: number) {
    return (deg / 180) * Math.PI;
}

/*
 Signed angle from `u` to `v`, in (-pi, pi].

 By atan2 of the cross and dot products rather than acos of the normalized
 dot, which matters more than it looks. acos is ill-conditioned at both ends
 of its range: for a small angle theta its absolute error is about eps/theta,
 so the *relative* error is about eps/theta^2. Arc subdivision re-derives a
 sub-arc's centre parametrization from its endpoints at every level, so that
 error compounds — halving a quarter circle, the recovered deltaTheta was off
 by 1.4e-8 relative at depth 15 and 1.9e-2 at depth 25, and by depth 29 the
 recovery failed outright.

 That is not only an accuracy problem. Bounding boxes that stop shrinking stop
 the intersection finder pruning, so it would grind through thousands of pairs
 per level; fixing this cut the test suite from 205s to 87s.

 atan2 also removes a cliff. The old sign came from Math.sign of the cross
 product, which for nearly parallel vectors could round to zero or to the
 wrong sign; a flipped sign then met `if (fS && deltaTheta < 0) deltaTheta +=
 TAU` in arcSegmentToCenter and turned a hair-thin arc into a nearly complete
 one. atan2 carries the sign itself, and returns pi for antiparallel vectors
 without needing the special case that used to be here.
*/
export function vectorAngle(u: [number, number], v: [number, number]) {
    return Math.atan2(u[0] * v[1] - u[1] * v[0], vec2.dot(u, v));
}
