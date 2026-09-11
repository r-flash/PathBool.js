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

// Numerical precision
export const NEARLY_LINEAR_EPS = 1e-10;
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
    collinear: 0,
};

/*
 `point` and `linear` are lengths, so they only mean anything relative to the
 size of the geometry. The values above are not scale-free constants; they are
 the right values for a scene about fifty units across, which is what the hand
 fixtures happen to be. Shrink the same drawing and they stop working: at a
 scene 2.2e-3 across, subdivision stopped while a chord still spanned a large
 fraction of its arc, so intersection points landed about 1e-6 out — further
 apart than `point`, so the vertices that should have merged did not, and the
 output was left open by most of the width of the scene.

 The two have to move together. Scaling one and not the other pulled two
 overlapping circles into a single circle: `point` decides which endpoints are
 the same vertex, `linear` decides how finely a curve is chopped before those
 endpoints are computed, and the second has to stay well clear of the first.
*/
const REFERENCE_EXTENT = 50;

/*
 Derived from the extent of the geometry, not from how far it sits from the
 origin. The arrangement constructor separately translates distant geometry
 toward the origin to preserve arithmetic precision; increasing tolerances
 would merge details instead of restoring that precision.

 Only ever downwards. How fine the detail in a drawing is does not follow how
 big the drawing is: a 900-unit logo is drawn with much the same absolute
 precision as a 48-unit icon, so the values above are about right for both,
 and scaling them up by eighteen swallowed the detail in the 900-unit one
 whole. Scaling down has no such hazard — a tighter tolerance merges less —
 and it is the only direction the failure was ever in.
*/
export function epsilonsForExtent(extent: number): Epsilons {
    const scale =
        Number.isFinite(extent) && extent > 0
            ? Math.min(1, extent / REFERENCE_EXTENT)
            : 1;
    return {
        point: EPS.point * scale,
        linear: EPS.linear * scale,
        // Parameter tolerance is dimensionless; the default determinant threshold is exactly zero.
        param: EPS.param,
        collinear: EPS.collinear,
    };
}
