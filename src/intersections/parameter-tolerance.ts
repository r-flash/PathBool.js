import { Epsilons } from "../config";
import { arcSegmentToCenter, PathSegment } from "../primitives/PathSegment";
import { Vector } from "../primitives/Vector";

// A dimensionless parameter interval is not a geometric distance. Bound
// |P'| so discarding this much parameter cannot discard more than eps.point
// of curve. Bezier derivatives lie in the hull of their derivative controls;
// an ellipse's angular speed is bounded by its larger corrected radius.
export function parameterTolerance(seg: PathSegment, eps: Epsilons): number {
    let speed: number;
    if (seg[0] === "A") {
        const arc = arcSegmentToCenter(seg);
        speed = arc
            ? Math.abs(arc.deltaTheta) * Math.max(arc.rx, arc.ry)
            : Math.hypot(seg[7][0] - seg[1][0], seg[7][1] - seg[1][1]);
    } else {
        const points = seg.slice(1) as Vector[];
        speed =
            (points.length - 1) *
            Math.max(
                ...points
                    .slice(1)
                    .map((p, i) =>
                        Math.hypot(p[0] - points[i][0], p[1] - points[i][1]),
                    ),
            );
    }
    return Math.min(eps.param, eps.point / speed);
}
