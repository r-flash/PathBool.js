/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

/*
 Exact signed area of a path, by Green's theorem:

     A = 1/2 * closed-integral of (x dy - y dx)

 Written independently of `src/` on purpose — it is an oracle, so it must not
 share code with the thing it measures. It takes segments as plain tuples
 rather than importing the library's types for the same reason (and because
 the corpus suites each `require` the library only after setting
 `PATH_BOOL_DEV_ASSERTS`, so this file must not pull it in).

 The integrand is exact for every segment type:

 - Lines are the shoelace term.
 - For a quadratic or cubic, `x y' - y x'` is a polynomial of degree at most 5,
   and 4-node Gauss-Legendre integrates degree 7 exactly. So this is not an
   approximation despite looking like quadrature.
 - Arcs get a closed form. With P = C + u where u is the ellipse vector,
       x dy - y dx = (Cx duy - Cy dux) + (ux duy - uy dux)
   The second term is invariant under the arc's rotation, leaving rx*ry*dTheta;
   the first telescopes to the endpoint displacement. So the whole integral is
       rx*ry*dTheta + Cx*(yEnd - yStart) - Cy*(xEnd - xStart)

 Callers should pass an `origin` near the geometry. Signed area is analytically
 translation invariant, but the products in the integrand are not: for a
 unit-sized shape sitting at 1e6, the terms reach 1e12 and cancellation eats
 roughly eight digits. Subtracting a local origin first keeps the arithmetic at
 the scale of the shape.
*/

export type Vec = readonly [number, number];

// Mirrors the library's segment tuples structurally, without importing them.
export type AnySegment =
    | readonly ["L", Vec, Vec]
    | readonly ["C", Vec, Vec, Vec, Vec]
    | readonly ["Q", Vec, Vec, Vec]
    | readonly ["A", Vec, number, number, number, boolean, boolean, Vec];

// 4-node Gauss-Legendre on [-1, 1], remapped to [0, 1] at the call site.
const GAUSS_NODES = [
    -0.8611363115940526, -0.3399810435848563, 0.3399810435848563,
    0.8611363115940526,
];
const GAUSS_WEIGHTS = [
    0.3478548451374538, 0.6521451548625461, 0.6521451548625461,
    0.3478548451374538,
];

const TAU = 2 * Math.PI;

function sub(p: Vec, origin: Vec): Vec {
    return [p[0] - origin[0], p[1] - origin[1]];
}

function angleBetween(u: Vec, v: Vec): number {
    return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
}

/* Contribution of one segment to the closed integral of (x dy - y dx). */
function segmentIntegral(seg: AnySegment, origin: Vec): number {
    switch (seg[0]) {
        case "L": {
            const [x0, y0] = sub(seg[1], origin);
            const [x1, y1] = sub(seg[2], origin);
            return x0 * y1 - x1 * y0;
        }

        case "Q": {
            const p0 = sub(seg[1], origin);
            const c = sub(seg[2], origin);
            const p1 = sub(seg[3], origin);
            let total = 0;
            for (let i = 0; i < GAUSS_NODES.length; i++) {
                const t = 0.5 * (GAUSS_NODES[i] + 1);
                const w = 0.5 * GAUSS_WEIGHTS[i];
                const s = 1 - t;
                const x = s * s * p0[0] + 2 * s * t * c[0] + t * t * p1[0];
                const y = s * s * p0[1] + 2 * s * t * c[1] + t * t * p1[1];
                const dx = 2 * (s * (c[0] - p0[0]) + t * (p1[0] - c[0]));
                const dy = 2 * (s * (c[1] - p0[1]) + t * (p1[1] - c[1]));
                total += w * (x * dy - y * dx);
            }
            return total;
        }

        case "C": {
            const p0 = sub(seg[1], origin);
            const c1 = sub(seg[2], origin);
            const c2 = sub(seg[3], origin);
            const p1 = sub(seg[4], origin);
            let total = 0;
            for (let i = 0; i < GAUSS_NODES.length; i++) {
                const t = 0.5 * (GAUSS_NODES[i] + 1);
                const w = 0.5 * GAUSS_WEIGHTS[i];
                const s = 1 - t;
                const b0 = s * s * s;
                const b1 = 3 * s * s * t;
                const b2 = 3 * s * t * t;
                const b3 = t * t * t;
                const x = b0 * p0[0] + b1 * c1[0] + b2 * c2[0] + b3 * p1[0];
                const y = b0 * p0[1] + b1 * c1[1] + b2 * c2[1] + b3 * p1[1];
                const d0 = 3 * s * s;
                const d1 = 6 * s * t;
                const d2 = 3 * t * t;
                const dx =
                    d0 * (c1[0] - p0[0]) +
                    d1 * (c2[0] - c1[0]) +
                    d2 * (p1[0] - c2[0]);
                const dy =
                    d0 * (c1[1] - p0[1]) +
                    d1 * (c2[1] - c1[1]) +
                    d2 * (p1[1] - c2[1]);
                total += w * (x * dy - y * dx);
            }
            return total;
        }

        case "A": {
            const start = sub(seg[1], origin);
            const end = sub(seg[7], origin);
            let rx = Math.abs(seg[2]);
            let ry = Math.abs(seg[3]);
            const phi = (seg[4] * Math.PI) / 180;
            const largeArc = seg[5];
            const sweep = seg[6];

            // Per the SVG spec an arc with coincident endpoints or a zero
            // radius degenerates to a line (or to nothing).
            if (rx === 0 || ry === 0) {
                return start[0] * end[1] - end[0] * start[1];
            }
            if (start[0] === end[0] && start[1] === end[1]) return 0;

            // Endpoint to centre parametrization (SVG F.6.5).
            const cosPhi = Math.cos(phi);
            const sinPhi = Math.sin(phi);
            const dx = (start[0] - end[0]) / 2;
            const dy = (start[1] - end[1]) / 2;
            const x1p = cosPhi * dx + sinPhi * dy;
            const y1p = -sinPhi * dx + cosPhi * dy;

            const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
            if (lambda > 1) {
                const s = Math.sqrt(lambda);
                rx *= s;
                ry *= s;
            }

            const num =
                rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
            const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
            const factor =
                (largeArc !== sweep ? 1 : -1) *
                Math.sqrt(Math.max(0, num) / den);
            const cxp = (factor * (rx * y1p)) / ry;
            const cyp = (factor * -(ry * x1p)) / rx;

            const cx = cosPhi * cxp - sinPhi * cyp + (start[0] + end[0]) / 2;
            const cy = sinPhi * cxp + cosPhi * cyp + (start[1] + end[1]) / 2;

            const u: Vec = [(x1p - cxp) / rx, (y1p - cyp) / ry];
            const v: Vec = [(-x1p - cxp) / rx, (-y1p - cyp) / ry];

            let deltaTheta = angleBetween(u, v);
            if (!sweep && deltaTheta > 0) deltaTheta -= TAU;
            if (sweep && deltaTheta < 0) deltaTheta += TAU;

            // Integrate the positive function 1-cos(t) for short arcs. This
            // independent quadrature avoids the sector/triangle cancellation
            // and the production implementation's Taylor recurrence.
            let excess = deltaTheta - Math.sin(deltaTheta);
            if (Math.abs(deltaTheta) < 1) {
                const integrate = (lo: number, hi: number) =>
                    ((hi - lo) / 2) *
                    GAUSS_NODES.reduce((sum, node, i) => {
                        const t = (lo + hi) / 2 + ((hi - lo) * node) / 2;
                        return (
                            sum + GAUSS_WEIGHTS[i] * 2 * Math.sin(t / 2) ** 2
                        );
                    }, 0);
                const pending = [[0, deltaTheta]];
                excess = 0;
                while (pending.length) {
                    const [lo, hi] = pending.pop()!;
                    const mid = (lo + hi) / 2;
                    const whole = integrate(lo, hi),
                        halves = integrate(lo, mid) + integrate(mid, hi);
                    if (
                        mid === lo ||
                        mid === hi ||
                        Math.abs(halves - whole) <=
                            8 * Number.EPSILON * Math.abs(halves)
                    )
                        excess += halves;
                    else pending.push([lo, mid], [mid, hi]);
                }
            }
            return start[0] * end[1] - start[1] * end[0] + rx * ry * excess;
        }
    }
}

/*
 Signed area of one path. Positive or negative according to the winding
 direction; a path holding an outer loop plus correctly oriented holes sums to
 the filled area.
*/
export function signedArea(path: readonly AnySegment[], origin: Vec): number {
    let total = 0;
    let remainder = 0;
    for (const seg of path) {
        const value = segmentIntegral(seg, origin),
            next = total + value;
        remainder +=
            Math.abs(total) >= Math.abs(value)
                ? total - next + value
                : value - next + total;
        total = next;
    }
    total += remainder;
    return total / 2;
}

/* A local origin for the arithmetic: the centre of everything passed in. */
export function originFor(paths: readonly (readonly AnySegment[])[]): Vec {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const put = (p: Vec) => {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
    };

    for (const path of paths) {
        for (const seg of path) {
            switch (seg[0]) {
                case "L":
                    put(seg[1]);
                    put(seg[2]);
                    break;
                case "Q":
                    put(seg[1]);
                    put(seg[2]);
                    put(seg[3]);
                    break;
                case "C":
                    put(seg[1]);
                    put(seg[2]);
                    put(seg[3]);
                    put(seg[4]);
                    break;
                case "A":
                    put(seg[1]);
                    put(seg[7]);
                    break;
            }
        }
    }

    if (!Number.isFinite(minX)) return [0, 0];
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}
