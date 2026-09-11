import { arcSegmentToCenter, PathSegment } from "./PathSegment";
import { Vector } from "./Vector";

const binomial = [
    [1],
    [1, 1],
    [1, 2, 1],
    [1, 3, 3, 1],
    [1, 4, 6, 4, 1],
    [1, 5, 10, 10, 5, 1],
];

/** Contribution to the signed area integral, relative to a nearby origin. */
export function segmentArea(segment: PathSegment, origin: Vector): number {
    const seg = segment.map((value) =>
        Array.isArray(value)
            ? [value[0] - origin[0], value[1] - origin[1]]
            : value,
    ) as PathSegment;
    if (seg[0] === "A") {
        const start = seg[1],
            end = seg[7],
            arc = arcSegmentToCenter(seg);
        if (!arc) return (start[0] * end[1] - start[1] * end[0]) / 2;
        const theta = arc.deltaTheta;
        let excess: number;
        if (Math.abs(theta) >= 1) excess = theta - Math.sin(theta);
        else {
            // theta - sin(theta) loses all digits for a very short arc.
            let term = (theta * theta * theta) / 6;
            excess = term;
            for (let degree = 5; ; degree += 2) {
                term *= (-theta * theta) / ((degree - 1) * degree);
                const next = excess + term;
                if (next === excess) break;
                excess = next;
            }
        }
        return (
            (start[0] * end[1] - start[1] * end[0] + arc.rx * arc.ry * excess) /
            2
        );
    }
    // Integrate Bernstein products directly. For degree n, P' has degree
    // n-1 and integral(B_i^n B_j^(n-1)) = C(n,i) C(n-1,j) /
    // (2n C(2n-1,i+j)). P' contributes n and area contributes another 1/2.
    const points = seg.slice(1) as Vector[];
    const n = points.length - 1;
    let total = 0,
        correction = 0;
    for (let i = 0; i <= n; i++)
        for (let j = 0; j < n; j++) {
            const dx = points[j + 1][0] - points[j][0];
            const dy = points[j + 1][1] - points[j][1];
            const term =
                ((points[i][0] * dy - points[i][1] * dx) *
                    binomial[n][i] *
                    binomial[n - 1][j]) /
                binomial[2 * n - 1][i + j] /
                4;
            const adjusted = term - correction,
                next = total + adjusted;
            correction = next - total - adjusted;
            total = next;
        }
    return total;
}
