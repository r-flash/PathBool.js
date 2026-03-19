/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

const DEV_ASSERTS_ENV =
    typeof process !== "undefined" && process.env.PATH_BOOL_DEV_ASSERTS;
export const DEV_ASSERTS =
    DEV_ASSERTS_ENV === "1"
        ? true
        : DEV_ASSERTS_ENV === "0"
          ? false
          : typeof process !== "undefined" &&
            process.env.NODE_ENV !== "production";

// Caps for subdivision/refinement to avoid hangs on adversarial inputs
export const MAX_SUBDIVISION_ITERS = 128;
export const MAX_SUBSEGMENTS_PER_ORIG_SEGMENT = 1024;
export const MAX_INTERSECTION_PAIRS = 20000;
export const MAX_TANGENT_SAMPLE_ITERS = 6;

// Numerical precision
export const NEARLY_LINEAR_EPS = 1e-10;
export const TANGENT_MIN_LEN_SQ = 1e-16;
export const ANGLE_MIN_DIFF = 1e-16;

// Geometry precision
export type Epsilons = {
    point: number;
    linear: number;
    param: number;
    collinear: number;
};

export const EPS: Epsilons = {
    point: 1e-6,
    linear: 1e-4,
    param: 1e-8,
    collinear: Number.MIN_VALUE * 64,
};
