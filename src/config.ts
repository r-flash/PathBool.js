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
/*
 Below this, two incidence angles at a vertex count as equal and the edges are
 ordered by their angle a little way along the curve instead.

 It has to stay well clear of floating-point noise. Angles come out of `atan2`
 on computed tangents and are bounded by pi, so one ulp is already 2.2e-16:
 at 1e-16 the tie never fired for two curves that genuinely meet at the same
 angle, and the sort ordered them on rounding error. That is what made two
 tangent circles trace a face that doubled back on itself, leaving it with zero
 winding everywhere and no ear to find.

 The signal it falls through to is far larger than this bound — offsetting by
 EPS.param along a quarter-circle arc turns the tangent by about 1.6e-8 — so
 there is room for several orders of magnitude of margin on both sides.
*/
export const ANGLE_MIN_DIFF = 1e-12;

/*
 Ceiling on the parameter step the incidence-angle tie-break may take, for
 segments whose parametrization is slow enough that the shared arc-length step
 would otherwise carry it a long way along the curve — or off the end of it.
*/
export const MAX_TIE_BREAK_PARAM_STEP = 1e-3;

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
