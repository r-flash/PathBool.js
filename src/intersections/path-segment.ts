/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { vec2 } from "gl-matrix";

import { Epsilons } from "../config";
import { NEARLY_LINEAR_EPS } from "../config";
import {
    AABB,
    boundingBoxesOverlap,
    boundingBoxMaxExtent,
} from "../primitives/AABB";
import {
    arcSegmentToCenter,
    PathSegment,
    pathSegmentBoundingBox,
    isNearlyLinearSegment,
    normalizeArcSegment,
    reversePathSegment,
    samplePathSegmentAt,
    pathSegmentTangentAtInto,
    splitSegmentAt,
} from "../primitives/PathSegment";
import { createVector, Vector, vectorsEqual } from "../primitives/Vector";
import { deg2rad, lerp } from "../util/math";
import { circularArcIntersection } from "./circular-arcs";
import { lineBezierIntersection } from "./line-bezier";
import { lineSegmentIntersection, lineSegmentsIntersect } from "./line-segment";
import { lineSegmentAABBIntersect } from "./line-segment-AABB";
import { parameterTolerance } from "./parameter-tolerance";

type IntersectionSegment = {
    seg: PathSegment;
    startParam: number;
    endParam: number;
    boundingBox: AABB;
};

function hasAtMostOneCrossing(a: PathSegment, b: PathSegment): boolean {
    const differences = (seg: PathSegment) => {
        const points = seg.slice(1) as Vector[];
        return points
            .slice(1)
            .map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]] as Vector)
            .filter((v) => v[0] !== 0 || v[1] !== 0);
    };
    const da = differences(a),
        db = differences(b);
    if (!da.length || !db.length) return false;
    const monotone = (d: Vector[], axis: number) =>
        d.every((v) => v[axis] > 0) || d.every((v) => v[axis] < 0);
    if (![0, 1].some((axis) => monotone(da, axis) && monotone(db, axis)))
        return false;
    // Bezier derivatives lie in the convex hull of these control differences.
    // A shared monotone coordinate makes both curves graphs. Disjoint slope
    // ranges make their difference monotone, so it has at most one zero.
    let sign = 0;
    for (const u of da)
        for (const v of db) {
            const p = u[0] * v[1],
                q = u[1] * v[0],
                cross = p - q;
            // Cover the short subtraction/product dependency chain; a determinant
            // indistinguishable from zero cannot certify separate tangent ranges.
            if (
                !Number.isFinite(cross) ||
                Math.abs(cross) <=
                    8 * Number.EPSILON * (Math.abs(p) + Math.abs(q)) +
                        Number.MIN_VALUE
            )
                return false;
            const next = Math.sign(cross);
            if (sign && sign !== next) return false;
            sign = next;
        }
    return true;
}

function subdivideIntersectionSegment(
    intSeg: IntersectionSegment,
): IntersectionSegment[] {
    const [seg0, seg1] = splitSegmentAt(intSeg.seg, 0.5);
    const midParam = (intSeg.startParam + intSeg.endParam) / 2;
    if (!(intSeg.startParam < midParam && midParam < intSeg.endParam))
        throw new Error(
            "Intersection subdivision cannot advance its parameter interval",
        );
    return [
        {
            seg: seg0,
            startParam: intSeg.startParam,
            endParam: midParam,
            boundingBox: pathSegmentBoundingBox(seg0),
        },
        {
            seg: seg1,
            startParam: midParam,
            endParam: intSeg.endParam,
            boundingBox: pathSegmentBoundingBox(seg1),
        },
    ];
}

function pathSegmentToLineSegment(seg: PathSegment): [Vector, Vector] {
    switch (seg[0]) {
        case "L":
            return [seg[1], seg[2]];
        case "C":
            return [seg[1], seg[4]];
        case "Q":
            return [seg[1], seg[3]];
        case "A":
            return [seg[1], seg[7]];
    }
}

function intersectionSegmentsOverlap(
    { seg: seg0, boundingBox: boundingBox0 }: IntersectionSegment,
    { seg: seg1, boundingBox: boundingBox1 }: IntersectionSegment,
    eps: Epsilons,
) {
    if (seg0[0] === "L") {
        if (seg1[0] === "L") {
            return lineSegmentsIntersect(
                [seg0[1], seg0[2]],
                [seg1[1], seg1[2]],
                eps,
            );
        } else {
            return lineSegmentAABBIntersect([seg0[1], seg0[2]], boundingBox1);
        }
    } else {
        if (seg1[0] === "L") {
            return lineSegmentAABBIntersect([seg1[1], seg1[2]], boundingBox0);
        } else {
            return boundingBoxesOverlap(boundingBox0, boundingBox1);
        }
    }
}

export function segmentsEqual(
    seg0: PathSegment,
    seg1: PathSegment,
    eps: number,
): boolean {
    const type = seg0[0];

    if (seg1[0] !== type) return false;

    switch (type) {
        case "L":
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, eps)
            );
        case "C":
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, eps) &&
                vectorsEqual(seg0[3], seg1[3] as Vector, eps) &&
                vectorsEqual(seg0[4], seg1[4] as Vector, eps)
            );
        case "Q":
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2] as Vector, eps) &&
                vectorsEqual(seg0[3], seg1[3] as Vector, eps)
            );
        case "A": {
            return (
                vectorsEqual(seg0[1], seg1[1], eps) &&
                Math.abs(seg0[2] - (seg1[2] as number)) < eps &&
                Math.abs(seg0[3] - (seg1[3] as number)) < eps &&
                (Math.abs(seg0[2] - seg0[3]) < eps ||
                    Math.abs(seg0[4] - (seg1[4] as number)) < eps) && // TODO: Handle rotations by Pi/2.
                seg0[5] === seg1[5] &&
                seg0[6] === seg1[6] &&
                vectorsEqual(seg0[7], seg1[7] as Vector, eps)
            );
        }
    }
}

function lineSegmentsCollinear(
    a: [Vector, Vector],
    b: [Vector, Vector],
    eps: number,
): boolean {
    // Parallel directions alone do not establish collinearity; nor is a
    // normalized dot product exactly one for every truly parallel pair.
    // Bound the perpendicular displacement of both endpoints, symmetrically.
    const onLine = (line: [Vector, Vector], points: [Vector, Vector]) => {
        const dx = line[1][0] - line[0][0],
            dy = line[1][1] - line[0][1];
        const length = Math.hypot(dx, dy);
        if (length === 0) return false;
        return points.every(
            (p) =>
                Math.abs(dx * (p[1] - line[0][1]) - dy * (p[0] - line[0][0])) <=
                eps * length,
        );
    };
    return onLine(a, b) && onLine(b, a);
}

function collinearLineSegmentIntersection(
    a: [Vector, Vector],
    b: [Vector, Vector],
): [number, number][] {
    // Project onto A's dominant coordinate, then intersect parameter intervals.
    // Reporting their endpoints once avoids duplicate rounded endpoint splits.
    const axis =
        Math.abs(a[1][0] - a[0][0]) >= Math.abs(a[1][1] - a[0][1]) ? 0 : 1;
    const delta = a[1][axis] - a[0][axis];
    if (delta === 0) return [];
    const s0 = (b[0][axis] - a[0][axis]) / delta;
    const s1 = (b[1][axis] - a[0][axis]) / delta;
    if (s0 === s1) return [];
    const lo = Math.max(0, Math.min(s0, s1)),
        hi = Math.min(1, Math.max(s0, s1));
    if (lo > hi) return [];
    const pair = (s: number): [number, number] => [
        s,
        Math.max(0, Math.min(1, (s - s0) / (s1 - s0))),
    ];
    return lo === hi ? [pair(lo)] : [pair(lo), pair(hi)];
}

/* One reported crossing: where it lands on each curve, and how far apart the
 two curves are at those parameters. */
type Candidate = {
    t0: number;
    t1: number;
    gap: number;
};

/*
 Collapses the many reports a single crossing can generate back into one.

 Where two curves meet at a shallow angle, subdivision cannot separate the
 crossing from its surroundings: it keeps bisecting until the leaves are
 straight enough to intersect as lines, and then a whole run of neighbouring
 leaf pairs each report a hit. A circle against the cubic that approximates it
 produced 146 points across the two paths where 8 are geometrically possible,
 and every spurious one becomes a vertex, an edge, and eventually a sliver
 face — that case ended up with 103 faces claiming to be the outer one.

 Two reports are the same crossing when the curves stay within eps.point of
 each other all the way between them. That asks the question directly, in the
 terms the rest of the library already uses for whether two places are the
 same place, and it distinguishes the two situations that matter: curves that
 osculate stay together across the whole run of spurious reports, while curves
 that cross transversally have pulled well apart before the next genuine
 crossing.

 Earlier attempts keyed on the subdivision's own leaves instead — their
 adjacency, then their size as a measure of how well a report is placed. Both
 failed, and in opposite directions. Leaves are far finer than the spread of
 reports around an osculating contact, so grouping by them left it in pieces;
 and they are far coarser than the true accuracy of a transversal crossing,
 where the line-line solve inside the leaf is good to the leaf's sagitta
 rather than its width, so grouping by them merged genuinely distinct
 crossings in real-02 and lost five faces.

 The representative is the report whose parameters put the two curves closest
 together, not an average of the group. The split points these produce have to
 land within eps.point of each other or the graph will not merge them into a
 single vertex, and averaging across a group spanning 2.7e-4 breaks exactly
 that.
*/
const SEPARATION_SAMPLES = 8;

// Refine both curve parameters together. A correspondence constrained to a
// straight line in parameter space can miss a second, shallow crossing.
function refineRoot(
    seg0: PathSegment,
    seg1: PathSegment,
    initial: Candidate,
): Candidate {
    if (seg0[0] === "A" || seg1[0] === "A") return initial;
    let best = initial;
    const roundoff =
        32 *
        Number.EPSILON *
        (segmentCoordinateScale(seg0) + segmentCoordinateScale(seg1));
    const a = createVector(),
        b = createVector();
    for (;;) {
        const p = samplePathSegmentAt(seg0, best.t0),
            q = samplePathSegmentAt(seg1, best.t1);
        pathSegmentTangentAtInto(seg0, best.t0, a);
        pathSegmentTangentAtInto(seg1, best.t1, b);
        const det = a[0] * b[1] - a[1] * b[0];
        if (det === 0 || best.gap <= roundoff) return best;
        const fx = p[0] - q[0],
            fy = p[1] - q[1];
        const dt0 = -(fx * b[1] - fy * b[0]) / det,
            dt1 = -(fx * a[1] - fy * a[0]) / det;
        if (!Number.isFinite(dt0) || !Number.isFinite(dt1)) return best;
        let step = 1;
        for (;;) {
            const t0 = Math.max(0, Math.min(1, best.t0 + step * dt0));
            const t1 = Math.max(0, Math.min(1, best.t1 + step * dt1));
            if (t0 === best.t0 && t1 === best.t1) return best;
            const p = samplePathSegmentAt(seg0, t0),
                q = samplePathSegmentAt(seg1, t1);
            const gap = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (gap < best.gap) {
                const improvement = best.gap - gap;
                best = { t0, t1, gap };
                if (improvement <= roundoff) return best;
                break;
            }
            step /= 2;
        }
    }
}

function segmentCoordinateScale(seg: PathSegment): number {
    return Math.max(
        ...seg.flatMap((value) =>
            Array.isArray(value) ? value.map(Math.abs) : [],
        ),
        ...(seg[0] === "A" ? [Math.abs(seg[2]), Math.abs(seg[3])] : []),
    );
}

function rootUncertainty(
    seg0: PathSegment,
    seg1: PathSegment,
    candidate: Candidate,
): [number, number] {
    // This arithmetic envelope covers polynomial evaluation. Arc sampling
    // also reconstructs an ellipse and uses transcendental functions, so its
    // contacts retain the geometric grouping check below.
    if (seg0[0] === "A" || seg1[0] === "A") return [Infinity, Infinity];
    const a = createVector(),
        b = createVector();
    pathSegmentTangentAtInto(seg0, candidate.t0, a);
    pathSegmentTangentAtInto(seg1, candidate.t1, b);
    const determinant = Math.abs(a[0] * b[1] - a[1] * b[0]);
    if (determinant === 0) return [Infinity, Infinity];
    // Sampling and tangent evaluation each have a short arithmetic dependency
    // chain. Propagate their rounding envelope through the inverse Jacobian;
    // unlike a fixed angular threshold, this scales with the actual geometry.
    const error =
        candidate.gap +
        32 *
            Number.EPSILON *
            (segmentCoordinateScale(seg0) + segmentCoordinateScale(seg1));
    // Near a multiple root, the Newton correction underestimates parameter
    // error by its multiplicity. Bezout bounds that multiplicity by the
    // product of degrees (a conic for an ellipse, at most cubic for Beziers).
    const degree = (seg: PathSegment) =>
        seg[0] === "C" ? 3 : seg[0] === "L" ? 1 : 2;
    const multiplicity = degree(seg0) * degree(seg1);
    return [
        (multiplicity * error * Math.hypot(...b)) / determinant,
        (multiplicity * error * Math.hypot(...a)) / determinant,
    ];
}

function staysTogether(
    seg0: PathSegment,
    seg1: PathSegment,
    a: Candidate,
    b: Candidate,
    eps: Epsilons,
): boolean {
    const ua = rootUncertainty(seg0, seg1, a),
        ub = rootUncertainty(seg0, seg1, b);
    if (
        Math.abs(a.t0 - b.t0) > ua[0] + ub[0] + eps.param ||
        Math.abs(a.t1 - b.t1) > ua[1] + ub[1] + eps.param
    )
        return false;
    for (let k = 1; k < SEPARATION_SAMPLES; k++) {
        const s = k / SEPARATION_SAMPLES;
        const p = samplePathSegmentAt(seg0, lerp(a.t0, b.t0, s));
        const q = samplePathSegmentAt(seg1, lerp(a.t1, b.t1, s));
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > eps.point) return false;
    }
    return true;
}

/*
 Two arcs of one ellipse, solved rather than subdivided.

 Bisection cannot resolve a shared arc: the two curves never separate, so it
 recurses to the leaf size the whole way along the overlap and reports a hit
 from every leaf pair that reaches the bottom. The leaf-level short-circuits
 further down only rescue the case where both sides cover the same extent and
 so halve into matching pieces — a quarter arc against that same quarter arc,
 forwards or reversed. A quarter arc against the 60 degrees of it a neighbour
 shares, or against the semicircle that contains it, never lines up however far
 down the recursion goes, and the entire run is bisected.

 The centre parametrization answers it outright. Two arcs lying on one ellipse
 overlap over an interval of angle, which intersects in closed form, and the
 ends of that interval convert straight back to a parameter on each arc. It is
 the curved counterpart of what `lineSegmentsCollinear` does for a pair of
 lines, and the reason sharing a straight edge is cheap where sharing a curved
 one is not.

 Returning null means "not a common ellipse, subdivide as usual". An empty
 array is an answer — two arcs of one ellipse whose angles do not meet — and
 not an abstention.
*/
const TAU_ARC = 2 * Math.PI;

function coincidentArcIntersection(
    seg0: PathSegment,
    seg1: PathSegment,
    eps: Epsilons,
): [number, number][] | null {
    if (seg0[0] !== "A" || seg1[0] !== "A") return null;

    const c0 = arcSegmentToCenter(normalizeArcSegment(seg0));
    const c1 = arcSegmentToCenter(normalizeArcSegment(seg1));
    if (!c0 || !c1) return null;

    if (
        Math.abs(c0.center[0] - c1.center[0]) > eps.point ||
        Math.abs(c0.center[1] - c1.center[1]) > eps.point ||
        Math.abs(c0.rx - c1.rx) > eps.point ||
        Math.abs(c0.ry - c1.ry) > eps.point
    ) {
        return null;
    }

    const biggest = Math.max(c0.rx, c0.ry);
    if (!(biggest > 0)) return null;
    // How far round the rim `eps.point` reaches. Everything angular below is
    // measured against this so the test means the same thing at any size.
    const angleEps = eps.point / biggest;

    /*
     A circle looks the same however it is turned, an ellipse only after half a
     turn. The remaining way to spell one ellipse — radii swapped and a quarter
     turn applied — is left to the subdivision rather than guessed at.
    */
    if (Math.abs(c0.rx - c0.ry) > eps.point) {
        const turned = Math.abs((((c0.phi - c1.phi) % 180) + 180) % 180);
        if (Math.min(turned, 180 - turned) > (angleEps * 180) / Math.PI) {
            return null;
        }
    }

    if (
        Math.abs(c0.deltaTheta) < angleEps ||
        Math.abs(c1.deltaTheta) < angleEps
    ) {
        return null;
    }

    /*
     `theta` is measured in the ellipse's own frame, the one `phi` turns it
     into, so two arcs of the same circle written with different `phi` have
     ranges that cannot be compared until both are brought into the world
     frame. Adding `phi` does exactly that for a circle, where the frame is a
     symmetry and the world angle is `theta + phi`; and it stays consistent for
     an ellipse written half a turn around, where `phi + 180` and `theta + pi`
     name the same point. Those are the only two spellings accepted above.

     Comparing the two ranges without this makes two drawings of one circle
     look as though their angles never meet. There is no safety net for that:
     this function is authoritative when it returns an array, so the pair would
     be reported as not intersecting at all.
    */
    const off0 = deg2rad(c0.phi);
    const off1 = deg2rad(c1.phi);

    // Each arc as an increasing interval of angle; direction is carried by
    // `deltaTheta` and put back when converting to a parameter.
    const span = (c: typeof c0, off: number): [number, number] => {
        const a = c.theta1 + off;
        const b = c.theta1 + c.deltaTheta + off;
        return a <= b ? [a, b] : [b, a];
    };
    const [lo0, hi0] = span(c0, off0);
    const [lo1, hi1] = span(c1, off1);

    const paramAt = (c: typeof c0, off: number, theta: number) => {
        const t = (theta - off - c.theta1) / c.deltaTheta;
        return t < 0 ? 0 : t > 1 ? 1 : t;
    };

    /*
     Neither arc spans more than a full turn, so at most two whole-turn shifts
     of the second can meet the first, and the overlap is at most two intervals.
    */
    const out: [number, number][] = [];
    const kFrom = Math.floor((lo0 - hi1) / TAU_ARC);
    const kTo = Math.ceil((hi0 - lo1) / TAU_ARC);
    for (let k = kFrom; k <= kTo; k++) {
        const shift = k * TAU_ARC;
        const from = Math.max(lo0, lo1 + shift);
        const to = Math.min(hi0, hi1 + shift);
        if (to < from - angleEps) continue;

        if (to - from <= angleEps) {
            // Meeting at a single angle: a contact, not an overlap.
            const mid = (from + to) / 2;
            out.push([paramAt(c0, off0, mid), paramAt(c1, off1, mid - shift)]);
            continue;
        }

        out.push([paramAt(c0, off0, from), paramAt(c1, off1, from - shift)]);
        out.push([paramAt(c0, off0, to), paramAt(c1, off1, to - shift)]);
    }

    return out;
}

/*
 Whether two pieces of curve are the same piece traversed opposite ways.

 Reversing allocates, and this sits in the subdivision's innermost loop, so the
 endpoints are checked first: they have to cross-match before it is worth
 building the reversed segment at all.
*/
function segmentEndPoint(seg: PathSegment): Vector {
    switch (seg[0]) {
        case "L":
            return seg[2];
        case "C":
            return seg[4];
        case "Q":
            return seg[3];
        case "A":
            return seg[7];
    }
}

function leavesCoincideReversed(
    seg0: PathSegment,
    seg1: PathSegment,
    eps: Epsilons,
): boolean {
    if (seg0[0] !== seg1[0]) return false;

    // `seg[1]` is the start point whatever the type. Read the endpoints in
    // place rather than through `pathSegmentToLineSegment`, which builds a
    // pair: this runs on every surviving leaf pair of every subdivision.
    if (
        !vectorsEqual(seg0[1], segmentEndPoint(seg1), eps.point) ||
        !vectorsEqual(segmentEndPoint(seg0), seg1[1], eps.point)
    ) {
        return false;
    }

    return segmentsEqual(seg0, reversePathSegment(seg1), eps.point);
}

/*
 Recovers the stretch a group of reports covers, when it covers one at all.

 A group whose members stay together over a run is not one crossing seen many
 times over; it is an overlap, and collapsing it to a point dissolves a shared
 boundary. How many reports the group holds says nothing about which of the two
 it is: a coincident pair can come out of grouping as a single report, while
 two curves that merely run close together and cross repeatedly leave several.
 The run's *extent* is the signal, and it is what this reads.

 Two segments of the same type that coincide do so under a linear
 correspondence between their parameters: the same arc of the same circle, the
 same stretch of the same line. So the ends of the run are wherever that
 correspondence first leaves either segment's [0, 1] range, and can be solved
 for rather than searched. The outermost reports are no use on their own —
 each sits somewhere inside the last leaf that still overlapped, which is
 `eps.linear` across, where the split has to land within `eps.point` of its
 partner or `findVertices` will not merge the two into one vertex.

 Returns null when the group turns out not to describe an overlap, and the
 caller falls back to treating it as a single contact. Every reason to bail is
 checked against the geometry rather than assumed: the correspondence has to be
 well conditioned, the run has to be longer than `eps.point` — otherwise it is
 a point contact wearing a group's clothes — and the two curves have to stay
 within `eps.point` of each other all along the stretch that comes back. The
 correspondence is fitted from two reports, so that last check is what stops a
 bad fit from splitting where there is nothing to split.
*/
const OVERLAP_VERIFY_SAMPLES = 16;

function overlapEnds(
    seg0: PathSegment,
    seg1: PathSegment,
    group: Candidate[],
    eps: Epsilons,
): [[number, number], [number, number]] | null {
    if (group.length < 2) return null;

    const first = group[0];
    const last = group[group.length - 1];

    const dt0 = last.t0 - first.t0;
    const dt1 = last.t1 - first.t1;
    if (Math.abs(dt0) < eps.param || Math.abs(dt1) < eps.param) return null;

    const slope = dt1 / dt0;
    if (!Number.isFinite(slope)) return null;

    const t1At = (t0: number) => first.t1 + (t0 - first.t0) * slope;
    const t0At = (t1: number) => first.t0 + (t1 - first.t1) / slope;

    // Where the correspondence keeps both parameters inside their own segment.
    const bound0 = t0At(0);
    const bound1 = t0At(1);
    let lo = Math.max(0, Math.min(bound0, bound1));
    let hi = Math.min(1, Math.max(bound0, bound1));
    if (!(hi > lo)) return null;

    const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
    // Land exactly on the ends rather than a hair inside them, so that
    // `splitAtIntersections` recognizes and drops a split it should not make.
    const snap = (t: number) => (t < eps.param ? 0 : t > 1 - eps.param ? 1 : t);

    lo = snap(lo);
    hi = snap(hi);

    const ends: [[number, number], [number, number]] = [
        [lo, snap(clamp01(t1At(lo)))],
        [hi, snap(clamp01(t1At(hi)))],
    ];

    const a = samplePathSegmentAt(seg0, ends[0][0]);
    const b = samplePathSegmentAt(seg0, ends[1][0]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps.point) return null;

    for (let k = 0; k <= OVERLAP_VERIFY_SAMPLES; k++) {
        const s = k / OVERLAP_VERIFY_SAMPLES;
        const p = samplePathSegmentAt(seg0, lerp(ends[0][0], ends[1][0], s));
        const q = samplePathSegmentAt(seg1, lerp(ends[0][1], ends[1][1], s));
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > eps.point) return null;
    }

    return ends;
}

function groupCandidates(
    seg0: PathSegment,
    seg1: PathSegment,
    candidates: Candidate[],
    eps: Epsilons,
): [number, number][] {
    if (candidates.length <= 1) {
        return candidates.map((c) => [c.t0, c.t1]);
    }

    const sorted = [...candidates].sort((a, b) => a.t0 - b.t0);
    const groups: Candidate[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const group = groups[groups.length - 1];
        const previous = group[group.length - 1];
        if (staysTogether(seg0, seg1, previous, sorted[i], eps)) {
            group.push(sorted[i]);
        } else {
            groups.push([sorted[i]]);
        }
    }

    /*
     Only same-type pairs are considered for overlap. `findVertices` merges
     coincident edges with `segmentsEqual`, which compares representations and
     rejects two spellings of the same curve out of hand — a line against a
     zero-radius arc, or against a cubic whose controls are collinear, are
     identical to the last bit and still report as different. Splitting a pair
     the merge will then refuse to join would leave two edges lying on top of
     each other bounding nothing between them, which is worse than reporting a
     single contact where an overlap exists. `lineariseDegenerateSegment` is
     what brings such pairs to a common spelling early enough for this test to
     accept them.
    */
    const sameType = seg0[0] === seg1[0];

    return groups.flatMap((group) => {
        const ends = sameType ? overlapEnds(seg0, seg1, group, eps) : null;
        if (ends) return ends as [number, number][];
        return [refineContact(seg0, seg1, group) as [number, number]];
    });
}

/*
 Pins a grouped contact down to where the curves actually meet.

 The reports in a group are scattered along the run the subdivision could not
 resolve, and the nearest of them can still sit well off the true contact: on
 the circle-against-its-own-cubic case the best report of one group was 2.4e-5
 away from the tangency. That is small, but splitting both curves there rather
 than at the contact leaves them crossing at a shallow angle instead of
 touching, and the incidence angles at the resulting vertex then differ by
 1.4e-7 — far too much for the sort to recognize as a tie, so it orders them on
 that instead of on curvature and traces the faces wrongly.

 The group brackets the contact, so a golden-section search along the straight
 correspondence between its outermost reports finds it. Only groups with
 something to refine are touched: a single report comes from a leaf pair that
 crossed squarely, where the line-line solve inside the leaf is already as good
 as this could be.
*/
const INV_GOLDEN = (Math.sqrt(5) - 1) / 2;

function refineContact(
    seg0: PathSegment,
    seg1: PathSegment,
    group: Candidate[],
): [number, number] {
    let best = group[0];
    for (const c of group) if (c.gap < best.gap) best = c;
    if (group.length < 2) return [best.t0, best.t1];

    // The group is in order of t0, so its ends bracket the contact.
    const first = group[0];
    const last = group[group.length - 1];
    const at = (s: number): Candidate => {
        const t0 = lerp(first.t0, last.t0, s);
        const t1 = lerp(first.t1, last.t1, s);
        const p = samplePathSegmentAt(seg0, t0);
        const q = samplePathSegmentAt(seg1, t1);
        return { t0, t1, gap: Math.hypot(p[0] - q[0], p[1] - q[1]) };
    };

    let lo = 0;
    let hi = 1;
    let c = hi - INV_GOLDEN * (hi - lo);
    let d = lo + INV_GOLDEN * (hi - lo);
    let fc = at(c);
    let fd = at(d);
    while (lo < c && c < d && d < hi) {
        if (fc.gap < fd.gap) {
            hi = d;
            d = c;
            fd = fc;
            c = hi - INV_GOLDEN * (hi - lo);
            fc = at(c);
        } else {
            lo = c;
            c = d;
            fc = fd;
            d = lo + INV_GOLDEN * (hi - lo);
            fd = at(d);
        }
    }

    const refined = fc.gap < fd.gap ? fc : fd;
    return refined.gap < best.gap
        ? [refined.t0, refined.t1]
        : [best.t0, best.t1];
}

function polynomialHullsOverlap(a: PathSegment, b: PathSegment): boolean {
    const pa = a.slice(1) as Vector[],
        pb = b.slice(1) as Vector[];
    const origin = pa[0];
    const roundoff =
        32 *
        Number.EPSILON *
        (segmentCoordinateScale(a) + segmentCoordinateScale(b));
    // Any separating axis proves the convex control hulls disjoint. Testing
    // every control-polygon pair includes every hull edge without constructing
    // either hull; projection is relative to one point to avoid cancellation.
    for (const polygon of [pa, pb])
        for (let i = 0; i < polygon.length; i++)
            for (let j = i + 1; j < polygon.length; j++) {
                const dx = polygon[j][0] - polygon[i][0],
                    dy = polygon[j][1] - polygon[i][1];
                if (dx === 0 && dy === 0) continue;
                const project = (p: Vector) =>
                    dx * (p[1] - origin[1]) - dy * (p[0] - origin[0]);
                const va = pa.map(project),
                    vb = pb.map(project),
                    error = roundoff * Math.hypot(dx, dy);
                if (
                    Math.max(...va) < Math.min(...vb) - error ||
                    Math.max(...vb) < Math.min(...va) - error
                )
                    return false;
            }
    return true;
}

export function pathSegmentIntersection(
    a: PathSegment,
    b: PathSegment,
    eps: Epsilons,
): [number, number][] {
    const resolution = eps.point;
    // Nearby polynomial curves are not necessarily coincident. Bound that
    // comparison by evaluation error, independently of subdivision resolution.
    if (a[0] !== "A" && b[0] !== "A")
        eps = {
            ...eps,
            point: Math.min(
                eps.point,
                32 *
                    Number.EPSILON *
                    (segmentCoordinateScale(a) + segmentCoordinateScale(b)),
            ),
        };
    eps = {
        ...eps,
        param: Math.min(parameterTolerance(a, eps), parameterTolerance(b, eps)),
    };
    // Give each unordered pair the same numerical solve regardless of which
    // operand the broad-phase traversal encounters first. This does not decide
    // correctness: the resulting arrangement still faces independent coverage
    // and area checks, but avoids two answers from rounding-dependent seeds.
    if (JSON.stringify(a) > JSON.stringify(b))
        return intersectOrdered(b, a, eps, resolution).map(([s, t]) => [t, s]);
    return intersectOrdered(a, b, eps, resolution);
}

function intersectOrdered(
    origSeg0: PathSegment,
    origSeg1: PathSegment,
    eps: Epsilons,
    resolution: number,
): [number, number][] {
    const seg0 = origSeg0;
    const seg1 = origSeg1;
    if (seg0[0] === "L" && seg1[0] === "L") {
        const segLine0: [Vector, Vector] = [seg0[1], seg0[2]];
        const segLine1: [Vector, Vector] = [seg1[1], seg1[2]];

        if (lineSegmentsCollinear(segLine0, segLine1, eps.point)) {
            return collinearLineSegmentIntersection(segLine0, segLine1);
        }

        const st = lineSegmentIntersection(segLine0, segLine1, eps);

        return st ? [st] : [];
    }

    const lineBezier = lineBezierIntersection(seg0, seg1, eps);
    if (lineBezier) return lineBezier;
    const reversedLineBezier = lineBezierIntersection(seg1, seg0, eps);
    if (reversedLineBezier) return reversedLineBezier.map(([a, b]) => [b, a]);

    const coincidentArcs = coincidentArcIntersection(seg0, seg1, eps);
    if (coincidentArcs) return coincidentArcs;
    const circularArcs = circularArcIntersection(seg0, seg1, eps);
    if (circularArcs) return circularArcs;

    // https://math.stackexchange.com/questions/20321/how-can-i-tell-when-two-cubic-b%C3%A9zier-curves-intersect

    let pairs: [IntersectionSegment, IntersectionSegment][] = [
        [
            {
                seg: seg0,
                startParam: 0,
                endParam: 1,
                boundingBox: pathSegmentBoundingBox(seg0),
            },
            {
                seg: seg1,
                startParam: 0,
                endParam: 1,
                boundingBox: pathSegmentBoundingBox(seg1),
            },
        ],
    ];

    const polynomialPair = seg0[0] !== "A" && seg1[0] !== "A";
    const coincidenceTolerance = eps.point;
    const candidates: Candidate[] = [];

    function pushCandidate(t0: number, t1: number) {
        const p = samplePathSegmentAt(origSeg0, t0);
        const q = samplePathSegmentAt(origSeg1, t1);
        candidates.push({
            t0,
            t1,
            gap: Math.hypot(p[0] - q[0], p[1] - q[1]),
        });
    }

    // Connected segments provide exact endpoint roots. Seed them explicitly:
    // subdivision near a tangent can otherwise report only an approximate
    // nearby contact and introduce a spurious short edge.
    for (const t0 of polynomialPair ? [0, 1] : []) {
        const p = t0 ? segmentEndPoint(seg0) : seg0[1];
        for (const t1 of [0, 1]) {
            const q = t1 ? segmentEndPoint(seg1) : seg1[1];
            if (p[0] === q[0] && p[1] === q[1]) pushCandidate(t0, t1);
        }
    }

    function pushLineSegmentIntersection(
        seg0: IntersectionSegment,
        seg1: IntersectionSegment,
    ) {
        const lineSegment0 = pathSegmentToLineSegment(seg0.seg);
        const lineSegment1 = pathSegmentToLineSegment(seg1.seg);
        const st = lineSegmentIntersection(lineSegment0, lineSegment1, eps);
        if (st) {
            pushCandidate(
                lerp(seg0.startParam, seg0.endParam, st[0]),
                lerp(seg1.startParam, seg1.endParam, st[1]),
            );
        }
    }

    function isLinear(seg: IntersectionSegment) {
        return (
            isNearlyLinearSegment(
                seg.seg,
                Math.min(NEARLY_LINEAR_EPS, eps.point / 4),
            ) ||
            boundingBoxMaxExtent(seg.boundingBox) <= eps.linear ||
            seg.endParam - seg.startParam < eps.param
        );
    }

    function withinPointResolution(seg: IntersectionSegment) {
        const box = seg.boundingBox;
        return (
            isNearlyLinearSegment(seg.seg, 0) ||
            Math.hypot(box.right - box.left, box.bottom - box.top) <=
                resolution ||
            seg.endParam - seg.startParam < eps.param
        );
    }

    // Depth first traversal keeps pending work proportional to subdivision
    // depth rather than the breadth of a coincident run. No pair is discarded.
    while (pairs.length) {
        const [seg0, seg1] = pairs.pop()!;
        if (segmentsEqual(seg0.seg, seg1.seg, coincidenceTolerance)) {
            /*
                 The two leaves are the same piece of curve. Record how far the
                 run reaches rather than dropping the pair: `groupCandidates`
                 recovers the shared stretch from the ends of the reports, so
                 with nothing recorded here a boundary shared exactly — one
                 whose parametrizations line up leaf for leaf — yields no
                 reports along its whole length. Subdividing further is
                 pointless either way, so the pair stops here.
                */
            pushCandidate(seg0.startParam, seg1.startParam);
            pushCandidate(seg0.endParam, seg1.endParam);
            continue;
        }

        if (
            leavesCoincideReversed(seg0.seg, seg1.seg, {
                ...eps,
                point: coincidenceTolerance,
            })
        ) {
            /*
                 The same, for a leaf traversed the other way round. It needs a
                 test of its own because `segmentsEqual` compares endpoints in
                 order and so never fires on a reversed pair; without it the
                 subdivision grinds the whole coincident run down to
                 `eps.linear`, which for a pair sharing a long stretch is
                 thousands of leaf pairs and seconds of work. The
                 correspondence crosses over: the start of one leaf is the end
                 of the other.
                */
            pushCandidate(seg0.startParam, seg1.endParam);
            pushCandidate(seg0.endParam, seg1.startParam);
            continue;
        }

        if (polynomialPair && !polynomialHullsOverlap(seg0.seg, seg1.seg))
            continue;
        let isLinear0 = isLinear(seg0);
        let isLinear1 = isLinear(seg1);
        if (
            polynomialPair &&
            isLinear0 &&
            isLinear1 &&
            !hasAtMostOneCrossing(seg0.seg, seg1.seg)
        ) {
            // Flatness cannot rule out a shallow excursion with two crossings.
            // If their tangent ranges do not certify a single crossing, refine
            // until no two points in either remaining piece can be distinct
            // vertices at the configured geometric resolution.
            isLinear0 = withinPointResolution(seg0);
            isLinear1 = withinPointResolution(seg1);
        }

        if (isLinear0 && isLinear1) {
            pushLineSegmentIntersection(seg0, seg1);
        } else {
            let subdivided0: IntersectionSegment[];
            let subdivided1: IntersectionSegment[];

            if (!isLinear0 && !isLinear1) {
                /*
                     Split only the larger piece when their boxes differ. In
                     addition to avoiding an unnecessary four-way product,
                     this lets an exact De Casteljau child meet the unsplit
                     copy of that child on the next iteration, where
                     `segmentsEqual` recognizes the coincident run outright.
                     Splitting both sides forever preserves their 2:1
                     parameter-size ratio and reduces an identical curve to
                     thousands of leaves before discovering the same fact.
                    */
                const extent0 = boundingBoxMaxExtent(seg0.boundingBox);
                const extent1 = boundingBoxMaxExtent(seg1.boundingBox);
                if (extent0 > extent1) {
                    subdivided0 = subdivideIntersectionSegment(seg0);
                    subdivided1 = [seg1];
                } else if (extent1 > extent0) {
                    subdivided0 = [seg0];
                    subdivided1 = subdivideIntersectionSegment(seg1);
                } else {
                    subdivided0 = subdivideIntersectionSegment(seg0);
                    subdivided1 = subdivideIntersectionSegment(seg1);
                }
            } else {
                subdivided0 = isLinear0
                    ? [seg0]
                    : subdivideIntersectionSegment(seg0);
                subdivided1 = isLinear1
                    ? [seg1]
                    : subdivideIntersectionSegment(seg1);
            }

            for (const seg0 of subdivided0) {
                for (const seg1 of subdivided1) {
                    if (intersectionSegmentsOverlap(seg0, seg1, eps)) {
                        pairs.push([seg0, seg1]);
                    }
                }
            }
        }
    }

    return groupCandidates(
        origSeg0,
        origSeg1,
        candidates.map((c) => refineRoot(origSeg0, origSeg1, c)),
        eps,
    );
}
