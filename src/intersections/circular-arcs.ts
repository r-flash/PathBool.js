import { Epsilons } from "../config";
import { arcSegmentToCenter, PathSegment } from "../primitives/PathSegment";
import { Vector } from "../primitives/Vector";

export function circularArcIntersection(
    a: PathSegment,
    b: PathSegment,
    eps: Epsilons,
): [number, number][] | null {
    if (
        a[0] !== "A" ||
        b[0] !== "A" ||
        Math.abs(a[2]) !== Math.abs(a[3]) ||
        Math.abs(b[2]) !== Math.abs(b[3])
    )
        return null;
    const ca = arcSegmentToCenter(a),
        cb = arcSegmentToCenter(b);
    if (!ca || !cb) return null;
    const dx = cb.center[0] - ca.center[0],
        dy = cb.center[1] - ca.center[1];
    const d = Math.hypot(dx, dy);
    if (d === 0) return null;
    const ux = dx / d,
        uy = dy / d;
    let points: Vector[];
    const shared = [a[1], a[7]].find((p) =>
        [b[1], b[7]].some((q) => p[0] === q[0] && p[1] === q[1]),
    );
    if (shared) {
        // One root is known exactly from the SVG endpoints. Factor it out
        // rather than subtracting nearly equal squared radii at tangency.
        const step =
            -2 *
            ((shared[0] - ca.center[0]) * -uy +
                (shared[1] - ca.center[1]) * ux);
        points = [shared, [shared[0] - uy * step, shared[1] + ux * step]];
    } else {
        const sum = ca.rx + cb.rx,
            difference = ca.rx - cb.rx;
        if (d > sum || d < Math.abs(difference)) return [];
        const along = (d + (difference * sum) / d) / 2;
        const h =
            Math.sqrt(
                Math.max(
                    0,
                    (sum - d) * (sum + d) * (d - difference) * (d + difference),
                ),
            ) /
            (2 * d);
        const x = ca.center[0] + ux * along,
            y = ca.center[1] + uy * along;
        points = [
            [x - uy * h, y + ux * h],
            [x + uy * h, y - ux * h],
        ];
    }
    const parameter = (seg: typeof a, c: typeof ca, p: Vector) => {
        if (p[0] === seg[1][0] && p[1] === seg[1][1]) return 0;
        if (p[0] === seg[7][0] && p[1] === seg[7][1]) return 1;
        const x = seg[1][0] - c.center[0],
            y = seg[1][1] - c.center[1];
        const px = p[0] - c.center[0],
            py = p[1] - c.center[1];
        let angle = Math.atan2(x * py - y * px, x * px + y * py);
        const tau = 2 * Math.PI;
        if (c.deltaTheta > 0 && angle < -eps.param * Math.abs(c.deltaTheta))
            angle += tau;
        if (c.deltaTheta < 0 && angle > eps.param * Math.abs(c.deltaTheta))
            angle -= tau;
        const t = angle / c.deltaTheta;
        return t >= -eps.param && t <= 1 + eps.param
            ? Math.max(0, Math.min(1, t))
            : null;
    };
    const out: [number, number][] = [];
    for (const p of points) {
        const s = parameter(a, ca, p),
            t = parameter(b, cb, p);
        if (
            s !== null &&
            t !== null &&
            !out.some(([u, v]) => u === s && v === t)
        )
            out.push([s, t]);
    }
    return out;
}
