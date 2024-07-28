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

export function rad2deg(rad: number) {
    return (rad / Math.PI) * 180;
}

export function deg2rad(deg: number) {
    return (deg / 180) * Math.PI;
}

export function vectorAngle(u: [number, number], v: [number, number]) {
    const EPS = 1e-12;

    const sign = Math.sign(u[0] * v[1] - u[1] * v[0]);

    if (
        sign === 0 &&
        Math.abs(u[0] + v[0]) < EPS &&
        Math.abs(u[1] + v[1]) < EPS
    ) {
        // TODO: u can be scaled
        return Math.PI;
    }

    return sign * Math.acos(vec2.dot(u, v) / vec2.len(u) / vec2.len(v));
}
