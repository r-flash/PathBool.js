import { Epsilons } from "../config";
import { PathSegment, samplePathSegmentAt } from "../primitives/PathSegment";
import { Vector } from "../primitives/Vector";

function quadraticRoots(a: number, b: number, c: number): number[] {
    if (a === 0) return b === 0 ? [] : [-c / b];
    const d = b * b - 4 * a * c;
    if (d < 0) return [];
    const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(d)) / 2;
    return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}

/** Isolate roots between derivative extrema; no subdivision contact grouping. */
export function lineBezierIntersection(
    line: PathSegment,
    curve: PathSegment,
    eps: Epsilons,
): [number, number][] | null {
    if (line[0] !== "L" || (curve[0] !== "C" && curve[0] !== "Q")) return null;
    const dx = line[2][0] - line[1][0],
        dy = line[2][1] - line[1][1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return [];
    const ux = dx / length,
        uy = dy / length;
    const values = (curve.slice(1) as Vector[]).map((p) =>
        (p[0] === line[1][0] && p[1] === line[1][1]) ||
        (p[0] === line[2][0] && p[1] === line[2][1])
            ? 0
            : ux * (p[1] - line[1][1]) - uy * (p[0] - line[1][0]),
    );
    // A curve lying on the line needs overlap handling, not isolated roots.
    if (values.every((v) => v === 0)) return null;
    const at = (t: number) => {
        const v = values.slice();
        for (let n = v.length - 1; n > 0; n--)
            for (let i = 0; i < n; i++) v[i] = (1 - t) * v[i] + t * v[i + 1];
        return v[0];
    };
    const [a, b, c, d] = values;
    const extrema =
        curve[0] === "Q"
            ? quadraticRoots(0, a - 2 * b + c, b - a)
            : quadraticRoots(
                  -a + 3 * b - 3 * c + d,
                  2 * (a - 2 * b + c),
                  b - a,
              );
    const cuts = [
        0,
        ...extrema.filter((t) => t > 0 && t < 1).sort((a, b) => a - b),
        1,
    ];
    const roots = new Set<number>();
    // The distance controls and degree-three De Casteljau evaluation use
    // fewer than 32 rounded operations along any dependency chain. Retain a
    // stationary contact whose residual cannot be distinguished from that
    // arithmetic error; a geometry-length tolerance would merge real roots.
    const roundoff = 32 * Number.EPSILON * Math.max(...values.map(Math.abs));
    for (let i = 0; i < cuts.length; i++) {
        const t = cuts[i],
            f = at(t);
        if (
            f === 0 ||
            (i > 0 &&
                i < cuts.length - 1 &&
                Math.abs(f) <= roundoff &&
                at(cuts[i - 1]) < 0 === f < 0 &&
                at(cuts[i + 1]) < 0 === f < 0)
        )
            roots.add(t);
    }
    for (let i = 1; i < cuts.length; i++) {
        let lo = cuts[i - 1],
            hi = cuts[i],
            flo = at(lo),
            fhi = at(hi);
        if (flo === 0 || fhi === 0 || flo < 0 === fhi < 0) continue;
        for (;;) {
            const mid = (lo + hi) / 2;
            if (mid === lo || mid === hi) break;
            const f = at(mid);
            if (f === 0) {
                lo = hi = mid;
                break;
            }
            if (f < 0 === flo < 0) {
                lo = mid;
                flo = f;
            } else {
                hi = mid;
                fhi = f;
            }
        }
        roots.add(Math.abs(flo) <= Math.abs(fhi) ? lo : hi);
    }
    return [...roots]
        .sort((a, b) => a - b)
        .flatMap((t) => {
            const p = samplePathSegmentAt(curve, t);
            const s =
                (ux * (p[0] - line[1][0]) + uy * (p[1] - line[1][1])) / length;
            return s >= -eps.param && s <= 1 + eps.param
                ? [[Math.max(0, Math.min(1, s)), t] as [number, number]]
                : [];
        });
}
