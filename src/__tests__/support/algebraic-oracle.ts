import type { Path } from "../../index";
import type { AnySegment, Vec } from "./area";
import { originFor, signedArea } from "./area";
import { readFixture } from "./corpus";
import type { OpName } from "./corpus";

type PathBoolModule = typeof import("../../index");

export function createOracle(PathBool: PathBoolModule) {
    const ops: Record<OpName, number> = {
        union: PathBool.PathBooleanOperation.Union,
        difference: PathBool.PathBooleanOperation.Difference,
        intersection: PathBool.PathBooleanOperation.Intersection,
        exclusion: PathBool.PathBooleanOperation.Exclusion,
        division: PathBool.PathBooleanOperation.Division,
        fracture: PathBool.PathBooleanOperation.Fracture,
    };

    const fillRules = {
        nonzero: PathBool.FillRule.NonZero,
        evenodd: PathBool.FillRule.EvenOdd,
    };

    /*
 Relative to the largest area in play. Not tighter than this because the
 pipeline splits curves at intersection points located to within EPS.param, and
 a split point a hair off the true curve moves the enclosed area by a
 correspondingly small amount. The residuals observed across the corpus sit
 several orders of magnitude below this.
*/
    const AREA_TOL_REL = 1e-7;

    const DURATION_BUDGET_MS = 5000;

    /* Measurements for one case */

    type Measures = {
        /* A op B */
        U: number;
        I: number;
        D: number;
        X: number;
        /* B op A */
        Uba: number;
        Iba: number;
        Xba: number;
        Dba: number;
        /* Partitions */
        divisionFaces: number[];
        fractureFaces: number[];
        fractureFacesBa: number[];
        divisionSum: number;
        fractureSum: number;
        tol: number;
    };

    type CaseData = { error: string } | { error: null; measures: Measures };

    const cache = new Map<string, CaseData>();

    function absArea(paths: Path[], origin: Vec): number {
        let total = 0;
        for (const p of paths) {
            total += signedArea(p as unknown as AnySegment[], origin);
        }
        return Math.abs(total);
    }

    function faceAreas(paths: Path[], origin: Vec): number[] {
        return paths
            .filter((p) => p.length > 0)
            .map((p) => signedArea(p as unknown as AnySegment[], origin));
    }

    function measure(dir: string): CaseData {
        const cached = cache.get(dir);
        if (cached !== undefined) return cached;

        const computed = computeMeasures(dir);
        cache.set(dir, computed);
        return computed;
    }

    function computeMeasures(dir: string): CaseData {
        const inputs = readFixture(dir).inputs.map((input) => ({
            path: PathBool.pathFromPathData(input.d),
            fillRule: fillRules[input.fillRule],
        }));

        const origin = originFor([
            inputs[0].path as unknown as AnySegment[],
            inputs[1].path as unknown as AnySegment[],
        ]);

        let ab: Record<OpName, Path[]>;
        let ba: Record<OpName, Path[]>;
        try {
            const started = performance.now();

            const forward = new PathBool.PathBoolean(inputs);
            const reverse = new PathBool.PathBoolean([inputs[1], inputs[0]]);

            const collect = (b: InstanceType<PathBoolModule["PathBoolean"]>) =>
                Object.fromEntries(
                    Object.entries(ops).map(([name, op]) => [name, b.get(op)]),
                ) as Record<OpName, Path[]>;

            ab = collect(forward);
            ba = collect(reverse);

            const elapsed = performance.now() - started;
            if (process.env.PATH_BOOL_UNTIMED !== "1" && elapsed > DURATION_BUDGET_MS) {
                return {
                    error: `took ${(elapsed / 1000).toFixed(1)}s, over the ${
                        DURATION_BUDGET_MS / 1000
                    }s budget`,
                };
            }
        } catch (e) {
            const err = e as Error;
            return { error: `threw ${err.name}: ${err.message}` };
        }

        const divisionFaces = faceAreas(ab.division, origin);
        const fractureFaces = faceAreas(ab.fracture, origin);
        const fractureFacesBa = faceAreas(ba.fracture, origin);

        const U = absArea(ab.union, origin);
        const I = absArea(ab.intersection, origin);
        const D = absArea(ab.difference, origin);
        const X = absArea(ab.exclusion, origin);
        const Uba = absArea(ba.union, origin);
        const Iba = absArea(ba.intersection, origin);
        const Xba = absArea(ba.exclusion, origin);
        const Dba = absArea(ba.difference, origin);

        const scale = Math.max(1e-30, U, Uba, X, Xba);

        return {
            error: null,
            measures: {
                U,
                I,
                D,
                X,
                Uba,
                Iba,
                Xba,
                Dba,
                divisionFaces,
                fractureFaces,
                fractureFacesBa,
                divisionSum: divisionFaces.reduce((s, a) => s + Math.abs(a), 0),
                fractureSum: fractureFaces.reduce((s, a) => s + Math.abs(a), 0),
                tol: AREA_TOL_REL * scale,
            },
        };
    }

    /* Identities */

    function near(
        label: string,
        lhs: number,
        rhs: number,
        tol: number,
    ): string | null {
        const residual = Math.abs(lhs - rhs);
        if (residual <= tol) return null;
        return (
            `${label}: ${lhs.toPrecision(12)} vs ${rhs.toPrecision(12)}, ` +
            `off by ${residual.toExponential(3)} (tolerance ${tol.toExponential(3)})`
        );
    }

    // All faces of a partition should wind the same way. A face with the opposite
    // sign is a hole that escaped as a face, or a boundary traced backwards.
    function sameOrientation(label: string, faces: number[]): string | null {
        const signs = new Set(faces.filter((a) => a !== 0).map(Math.sign));
        if (signs.size <= 1) return null;
        return `${label}: faces disagree about orientation (${faces
            .map((a) => a.toExponential(3))
            .join(", ")})`;
    }

    type Identity = {
        name: string;
        check: (m: Measures) => string | null;
    };

    const IDENTITIES: Identity[] = [
        {
            // A xor B is exactly what A u B has that A n B does not.
            name: "exclusion-is-union-minus-intersection",
            check: (m) =>
                near("|A xor B| vs |A u B| - |A n B|", m.X, m.U - m.I, m.tol),
        },
        {
            // The three disjoint pieces of the union have to add back up to it.
            // This is the inclusion-exclusion identity restated without reference
            // to the inputs' own areas.
            name: "union-is-sum-of-its-three-parts",
            check: (m) =>
                near(
                    "|A u B| vs |A \\ B| + |A n B| + |B \\ A|",
                    m.U,
                    m.D + m.I + m.Dba,
                    m.tol,
                ),
        },
        {
            // Division selects faces by flags[0], so its faces tile A exactly.
            name: "division-tiles-a",
            check: (m) =>
                near(
                    "sum of Division faces vs |A \\ B| + |A n B|",
                    m.divisionSum,
                    m.D + m.I,
                    m.tol,
                ),
        },
        {
            name: "fracture-tiles-union",
            check: (m) =>
                near(
                    "sum of Fracture faces vs |A u B|",
                    m.fractureSum,
                    m.U,
                    m.tol,
                ),
        },
        {
            name: "commutative-union",
            check: (m) => near("|A u B| vs |B u A|", m.U, m.Uba, m.tol),
        },
        {
            name: "commutative-intersection",
            check: (m) => near("|A n B| vs |B n A|", m.I, m.Iba, m.tol),
        },
        {
            name: "commutative-exclusion",
            check: (m) => near("|A xor B| vs |B xor A|", m.X, m.Xba, m.tol),
        },
        {
            /*
         Fracture selects on `flags.some`, so swapping the inputs must produce
         the same set of faces. Compared as a sorted multiset of areas rather
         than a total, because a total hides two faces trading area.
        */
            name: "commutative-fracture",
            check: (m) => {
                const lhs = m.fractureFaces.map(Math.abs).sort((x, y) => x - y);
                const rhs = m.fractureFacesBa
                    .map(Math.abs)
                    .sort((x, y) => x - y);
                if (lhs.length !== rhs.length) {
                    return (
                        `Fracture returns ${lhs.length} faces for (A, B) but ` +
                        `${rhs.length} for (B, A)`
                    );
                }
                for (let i = 0; i < lhs.length; i++) {
                    const failure = near(
                        `Fracture face ${i} of ${lhs.length} (sorted by area)`,
                        lhs[i],
                        rhs[i],
                        m.tol,
                    );
                    if (failure !== null) return failure;
                }
                return null;
            },
        },
        {
            name: "partition-orientation",
            check: (m) =>
                sameOrientation("Division", m.divisionFaces) ??
                sameOrientation("Fracture", m.fractureFaces),
        },
        {
            // Monotonicity. Cheap, and it catches a result that is wildly too big
            // even when the identities above happen to balance.
            name: "parts-fit-inside-the-union",
            check: (m) => {
                if (m.I > m.U + m.tol) {
                    return `|A n B| (${m.I.toPrecision(12)}) exceeds |A u B| (${m.U.toPrecision(12)})`;
                }
                if (m.D > m.U + m.tol) {
                    return `|A \\ B| (${m.D.toPrecision(12)}) exceeds |A u B| (${m.U.toPrecision(12)})`;
                }
                return null;
            },
        },
    ];

    function areaOf(d: string): number {
        const p = PathBool.pathFromPathData(d) as unknown as AnySegment[];
        return signedArea(p, originFor([p]));
    }

    return { measure, IDENTITIES, areaOf };
}
