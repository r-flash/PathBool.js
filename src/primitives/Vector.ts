/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

export type Vector = [number, number];

export function createVector(): Vector {
    return [0, 0];
}

export function vectorsEqual(a: Vector, b: Vector, eps: number = 0) {
    return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}
