/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Generates the special-cased exemplar corpus under
 `src/__fixtures__/generated/<category>/<name>/original.svg`.

 Unlike the fuzzer, every case here exists for a nameable reason: a shape pair
 crossed with a relative placement that stresses one specific part of the
 pipeline (tangency, shared collinear edges, coincident vertices, winding under
 each fill rule, numeric conditioning). A failure reports as
 `touching/03-vertex-on-vertex intersection`, not as a hash.

 The output is committed so the corpus is stable across machines and diffs are
 reviewable. Re-run with `npm run gen-corpus` after editing this file.

 Placement and conditioning transforms are restricted to similarities (uniform
 scale + rotation + translation) because those map arcs to arcs: `rx`/`ry` scale
 and `phi` picks up the rotation, with no need to re-parametrize. A non-uniform
 scale would turn every circular arc into an ellipse with different endpoints
 and is deliberately out of scope.
*/
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const GENERATOR_VERSION = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(ROOT, "src", "__fixtures__", "generated");

// Rendered size for the raster tier; the viewBox is always square so this
// keeps the scale isotropic no matter how the scene is conditioned.
const RENDER_SIZE = 512;

/*
 Shape representation
 ====================
 A shape is a list of subpaths in a roughly unit-sized box around the origin.

   Subpath = { start: Vector, segs: Seg[] }
   Seg = ["L", end]
       | ["C", c1, c2, end]
       | ["Q", c, end]
       | ["A", rx, ry, phiDeg, largeArc, sweep, end]

 Every subpath closes explicitly (the last segment ends at `start`) so that
 reversal is a local operation and the trailing `Z` is only a marker.
*/

const KAPPA = 0.5522847498307936;

function polygon(points) {
    return [
        {
            start: points[0],
            segs: points
                .slice(1)
                .concat([points[0]])
                .map((p) => ["L", p]),
        },
    ];
}

function circleOfArcs(r, sweep = true) {
    // Four quarter arcs. `sweep = false` reverses the winding, which is what
    // makes an even-odd-independent hole under the non-zero rule.
    const pts = sweep
        ? [
              [r, 0],
              [0, r],
              [-r, 0],
              [0, -r],
              [r, 0],
          ]
        : [
              [r, 0],
              [0, -r],
              [-r, 0],
              [0, r],
              [r, 0],
          ];
    return {
        start: pts[0],
        segs: pts.slice(1).map((p) => ["A", r, r, 0, false, sweep, p]),
    };
}

function ellipsePoint(rx, ry, phiDeg, thetaDeg) {
    const phi = (phiDeg * Math.PI) / 180;
    const theta = (thetaDeg * Math.PI) / 180;
    const x = rx * Math.cos(theta);
    const y = ry * Math.sin(theta);
    return [
        x * Math.cos(phi) - y * Math.sin(phi),
        x * Math.sin(phi) + y * Math.cos(phi),
    ];
}

const SHAPES = {
    // Same circle, two representations. Cubic quarter-circles deviate from a
    // true circle by ~2.7e-4 of the radius, far above EPS.point, so pairing
    // these two is a near-coincidence stress case, not a true duplicate.
    "circle-arc": () => [circleOfArcs(1)],

    "circle-cubic": () => {
        const k = KAPPA;
        return [
            {
                start: [1, 0],
                segs: [
                    ["C", [1, k], [k, 1], [0, 1]],
                    ["C", [-k, 1], [-1, k], [-1, 0]],
                    ["C", [-1, -k], [-k, -1], [0, -1]],
                    ["C", [k, -1], [1, -k], [1, 0]],
                ],
            },
        ];
    },

    "ellipse-rot": () => {
        const rx = 1.4;
        const ry = 0.7;
        const phi = 30;
        const r = (phi * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        const p0 = [rx * c, rx * s];
        const p1 = [-rx * c, -rx * s];
        return [
            {
                start: p0,
                segs: [
                    ["A", rx, ry, phi, false, true, p1],
                    ["A", rx, ry, phi, false, true, p0],
                ],
            },
        ];
    },

    square: () =>
        polygon([
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ]),

    triangle: () => {
        const r = 1.15;
        return polygon(
            [90, 210, 330].map((deg) => {
                const a = (deg * Math.PI) / 180;
                return [r * Math.cos(a), r * Math.sin(a)];
            }),
        );
    },

    "round-rect": () => {
        const w = 1.6;
        const h = 1.1;
        const r = 0.35;
        return [
            {
                start: [-w + r, -h],
                segs: [
                    ["L", [w - r, -h]],
                    ["A", r, r, 0, false, true, [w, -h + r]],
                    ["L", [w, h - r]],
                    ["A", r, r, 0, false, true, [w - r, h]],
                    ["L", [-w + r, h]],
                    ["A", r, r, 0, false, true, [-w, h - r]],
                    ["L", [-w, -h + r]],
                    ["A", r, r, 0, false, true, [-w + r, -h]],
                ],
            },
        ];
    },

    // Self-intersecting: the core is wound twice, so non-zero and even-odd
    // disagree about whether it is filled.
    pentagram: () => {
        const verts = [0, 1, 2, 3, 4].map((k) => {
            const a = ((-90 + 72 * k) * Math.PI) / 180;
            return [Math.cos(a), Math.sin(a)];
        });
        return polygon([0, 2, 4, 1, 3].map((i) => verts[i]));
    },

    // Two subpaths with opposing winding: a hole under either fill rule.
    annulus: () => [circleOfArcs(1, true), circleOfArcs(0.5, false)],

    "c-shape": () => {
        const r1 = 1;
        const r2 = 0.55;
        const a0 = (40 * Math.PI) / 180;
        const a1 = (320 * Math.PI) / 180;
        const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
        return [
            {
                start: at(r1, a0),
                segs: [
                    ["A", r1, r1, 0, true, true, at(r1, a1)],
                    ["L", at(r2, a1)],
                    ["A", r2, r2, 0, true, false, at(r2, a0)],
                    ["L", at(r1, a0)],
                ],
            },
        ];
    },

    // Three teeth: many short parallel edges, which is what makes the
    // sort-by-angle and face-tracing stages work hardest.
    comb: () => {
        const pts = [
            [-1.2, -0.8],
            [1.2, -0.8],
            [1.2, 0.8],
        ];
        for (let i = 0; i < 3; i++) {
            const x0 = 0.8 - i * 0.8;
            const x1 = x0 - 0.4;
            pts.push([x0, 0.8], [x0, -0.1], [x1, -0.1], [x1, 0.8]);
        }
        pts.push([-1.2, 0.8]);
        return polygon(pts);
    },

    // Cubic with a vanishing derivative at t = 0.5: P3 = P0 + P1 - P2.
    "cusp-cubic": () => {
        const p0 = [-1, 0];
        const p1 = [0.6, 1.8];
        const p2 = [-0.6, 1.8];
        const p3 = [p0[0] + p1[0] - p2[0], p0[1] + p1[1] - p2[1]];
        const dy = -0.7;
        const sh = ([x, y]) => [x + 0.4, y + dy];
        return [
            {
                start: sh(p0),
                segs: [
                    ["C", sh(p1), sh(p2), sh(p3)],
                    ["L", sh(p0)],
                ],
            },
        ];
    },

    // Cubic that crosses itself: exercises splitAtSelfIntersections.
    "loop-cubic": () => [
        {
            start: [-1, -0.6],
            segs: [
                ["C", [2.2, 1.4], [-2.2, 1.4], [1, -0.6]],
                ["L", [-1, -0.6]],
            ],
        },
    ],

    // Square with a zero-area out-and-back spike.
    "degenerate-spike": () =>
        polygon([
            [-1, -1],
            [1, -1],
            [1, 1],
            [0, 1],
            [0, 2],
            [0, 1],
            [-1, 1],
        ]),

    // Wholly zero-area, in the shape of the degenerate-01 hand fixture.
    "zero-area-line": () =>
        polygon([
            [-1, 0],
            [1, 0],
        ]),

    "quad-blob": () => [
        {
            start: [1, 0],
            segs: [
                ["Q", [1, 1], [0, 1]],
                ["Q", [-1, 1], [-1, 0]],
                ["Q", [-1, -1], [0, -1]],
                ["Q", [1, -1], [1, 0]],
            ],
        },
    ],

    // Two disjoint squares in a single path: one input, two components, no
    // nesting between them. Distinct from `annulus`, whose two subpaths do
    // nest.
    "two-islands": () => [
        ...polygon([
            [-1.4, -0.6],
            [-0.4, -0.6],
            [-0.4, 0.6],
            [-1.4, 0.6],
        ]),
        ...polygon([
            [0.4, -0.6],
            [1.4, -0.6],
            [1.4, 0.6],
            [0.4, 0.6],
        ]),
    ],

    // Three rings of alternating winding: filled, hole, filled again. Two
    // levels of nesting inside one input, where `annulus` has one.
    bullseye: () => [
        circleOfArcs(1, true),
        circleOfArcs(0.7, false),
        circleOfArcs(0.35, true),
    ],

    // Two overlapping discs wound the same way, in one path. The lens where
    // they overlap is wound twice, so this is the pair where non-zero and
    // even-odd genuinely disagree without any single subpath being
    // self-intersecting.
    "two-discs": () => [
        ...applyShape([circleOfArcs(0.9)], sim(1, 0, -0.5, 0)),
        ...applyShape([circleOfArcs(0.9)], sim(1, 0, 0.5, 0)),
    ],

    // The unit circle traversed twice round in a single subpath. Every edge
    // is exactly coincident with another edge of the same path, so it stresses
    // `splitAtSelfIntersections` with total rather than transversal overlap.
    "double-circle": () => {
        const c = circleOfArcs(1);
        return [{ start: c.start, segs: [...c.segs, ...c.segs] }];
    },

    // Self-crossing quadrilateral whose two lobes wind oppositely, so the
    // fill rules agree that both are filled but the winding numbers differ.
    bowtie: () =>
        polygon([
            [-1, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
        ]),

    // Twelve teeth: the same pressure `comb` puts on sorting and face tracing,
    // an order of magnitude more of it, and radially rather than in parallel.
    gear: () => {
        const teeth = 12;
        const pts = [];
        for (let i = 0; i < teeth * 2; i++) {
            const a = (i * Math.PI) / teeth;
            const r = i % 2 === 0 ? 1 : 0.62;
            pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return polygon(pts);
    },

    // The unit square again, with a midpoint vertex on every edge. Paired with
    // `square` it gives coincident edges that disagree about where the
    // vertices are.
    "subdivided-square": () =>
        polygon([
            [-1, -1],
            [0, -1],
            [1, -1],
            [1, 0],
            [1, 1],
            [0, 1],
            [-1, 1],
            [-1, 0],
        ]),

    // The unit square once more, this time drawn with curve segments that are
    // all degenerate: a zero-length cubic, a cubic whose controls are
    // collinear with its endpoints, and a quadratic whose control sits on its
    // chord. Geometrically identical to `square`, structurally nothing like it.
    "degenerate-curves": () => [
        {
            start: [-1, -1],
            segs: [
                ["C", [-1, -1], [-1, -1], [-1, -1]],
                ["C", [-1 / 3, -1], [1 / 3, -1], [1, -1]],
                ["Q", [1, 0], [1, 1]],
                ["L", [-1, 1]],
                ["L", [-1, -1]],
            ],
        },
    ],

    // A wedge 0.002 across at its widest. The corpus renders at 512px over a
    // scene about two units across, so this is under half a pixel everywhere:
    // deliberately below what the raster tier can resolve and squarely within
    // what the area oracle can.
    sliver: () =>
        polygon([
            [-1, 0],
            [1, 0],
            [-1, 0.002],
        ]),

    // Arc closed by its chord, so the boundary is half curve and half line.
    "half-disc": () => [
        {
            start: [-1, 0],
            segs: [
                ["A", 1, 1, 0, false, true, [1, 0]],
                ["L", [-1, 0]],
            ],
        },
    ],

    // An annular sector just outside the unit circle, sharing 60 degrees of
    // its rim exactly. The shared stretch is *curved* and its ends fall in the
    // interior of `circle-arc`'s quarter arcs, where the existing
    // `edge-shared-*` cases only ever share straight edges at whole vertices.
    "rim-wedge": () => {
        const at = (r, deg) => {
            const a = (deg * Math.PI) / 180;
            return [r * Math.cos(a), r * Math.sin(a)];
        };
        return [
            {
                start: at(1, -30),
                segs: [
                    ["A", 1, 1, 0, false, true, at(1, 30)],
                    ["L", at(1.6, 30)],
                    ["A", 1.6, 1.6, 0, false, false, at(1.6, -30)],
                    ["L", at(1, -30)],
                ],
            },
        ];
    },

    // Annulus whose inner boundary is the unit circle traced backwards, so it
    // coincides with the whole of `circle-arc`'s boundary rather than part of
    // it.
    "ring-outside": () => [circleOfArcs(1.5, true), circleOfArcs(1, false)],

    // Two arcs that both take the long way round, so `largeArc` is set on
    // every segment. The two supporting circles meet only at the waist points,
    // giving a closed curve shaped like an upright peanut.
    "lens-large": () => [
        {
            start: [-0.6, 0],
            segs: [
                ["A", 1, 1, 0, true, true, [0.6, 0]],
                ["A", 1, 1, 0, true, true, [-0.6, 0]],
            ],
        },
    ],

    // Two semicircles whose radii are too small for the chord they span. SVG
    // F.6.6 says to scale both radii up by sqrt(lambda) — here a factor of
    // two — rather than reject the path, which makes this *exactly* the unit
    // circle after correction, and a coincidence case with `circle-arc`.
    "arc-overlong": () => [
        {
            start: [-1, 0],
            segs: [
                ["A", 0.5, 0.5, 0, false, true, [1, 0]],
                ["A", 0.5, 0.5, 0, false, true, [-1, 0]],
            ],
        },
    ],

    // The unit square with a zero-radius arc for its bottom edge. SVG F.6.2
    // says an arc with a zero radius is drawn as a straight line, so this too
    // is geometrically the plain square.
    "zero-radius-arc": () => [
        {
            start: [-1, -1],
            segs: [
                ["A", 0, 0, 0, false, true, [1, -1]],
                ["L", [1, 1]],
                ["L", [-1, 1]],
                ["L", [-1, -1]],
            ],
        },
    ],

    // `ellipse-rot` in the other exact SVG spelling of the same ellipse:
    // exchange the radii and turn the local frame by a quarter turn.
    "ellipse-rot-swapped": () => {
        const p0 = ellipsePoint(1.4, 0.7, 30, 0);
        const p1 = ellipsePoint(1.4, 0.7, 30, 180);
        return [
            {
                start: p0,
                segs: [
                    ["A", 0.7, 1.4, 120, false, true, p1],
                    ["A", 0.7, 1.4, 120, false, true, p0],
                ],
            },
        ];
    },

    // SVG takes the absolute values of arc radii. This is the unit circle in
    // that input spelling, paired with `circle-arc` below.
    "circle-negative-radii": () => {
        const circle = circleOfArcs(1);
        return [
            {
                start: circle.start,
                segs: circle.segs.map((seg) => [
                    "A",
                    -seg[1],
                    seg[2],
                    seg[3],
                    seg[4],
                    seg[5],
                    seg[6],
                ]),
            },
        ];
    },

    // `quad-blob` with each quadratic split exactly at t = 0.5 by De
    // Casteljau. The geometry is unchanged but none of its vertices line up
    // one-for-one with the original representation.
    "quad-blob-subdivided": () => [
        {
            start: [1, 0],
            segs: [
                ["Q", [1, 0.5], [0.75, 0.75]],
                ["Q", [0.5, 1], [0, 1]],
                ["Q", [-0.5, 1], [-0.75, 0.75]],
                ["Q", [-1, 0.5], [-1, 0]],
                ["Q", [-1, -0.5], [-0.75, -0.75]],
                ["Q", [-0.5, -1], [0, -1]],
                ["Q", [0.5, -1], [0.75, -0.75]],
                ["Q", [1, -0.5], [1, 0]],
            ],
        },
    ],

    // The cubic approximation of a circle, again split at t = 0.5 on every
    // quarter so the coincident run has interleaved vertices.
    "circle-cubic-subdivided": () => {
        const k = KAPPA;
        const h = (a, b) => (a + b) / 2;
        const split = (p0, p1, p2, p3) => {
            const p01 = [h(p0[0], p1[0]), h(p0[1], p1[1])];
            const p12 = [h(p1[0], p2[0]), h(p1[1], p2[1])];
            const p23 = [h(p2[0], p3[0]), h(p2[1], p3[1])];
            const p012 = [h(p01[0], p12[0]), h(p01[1], p12[1])];
            const p123 = [h(p12[0], p23[0]), h(p12[1], p23[1])];
            const p = [h(p012[0], p123[0]), h(p012[1], p123[1])];
            return [
                ["C", p01, p012, p],
                ["C", p123, p23, p3],
            ];
        };
        const quarters = [
            [
                [1, 0],
                [1, k],
                [k, 1],
                [0, 1],
            ],
            [
                [0, 1],
                [-k, 1],
                [-1, k],
                [-1, 0],
            ],
            [
                [-1, 0],
                [-1, -k],
                [-k, -1],
                [0, -1],
            ],
            [
                [0, -1],
                [k, -1],
                [1, -k],
                [1, 0],
            ],
        ];
        return [
            {
                start: [1, 0],
                segs: quarters.flatMap((points) => split(...points)),
            },
        ];
    },

    // An annular sector outside `ellipse-rot`. Its inner rim uses the
    // radii-swapped spelling and shares a 60-degree stretch whose ends lie in
    // the interiors of A's two half-ellipse arcs.
    "ellipse-rim-wedge-swapped": () => {
        const inner0 = ellipsePoint(1.4, 0.7, 30, -30);
        const inner1 = ellipsePoint(1.4, 0.7, 30, 30);
        const outer0 = ellipsePoint(2.1, 1.05, 30, -30);
        const outer1 = ellipsePoint(2.1, 1.05, 30, 30);
        return [
            {
                start: inner0,
                segs: [
                    ["A", 0.7, 1.4, 120, false, true, inner1],
                    ["L", outer1],
                    ["A", 2.1, 1.05, 30, false, false, outer0],
                    ["L", inner0],
                ],
            },
        ];
    },

    "same-endpoint-small-arc": () => [
        {
            start: [-1, -1],
            segs: [
                ["L", [1, -1]],
                ["A", 1, 1, 0, false, true, [1, -1]],
                ["L", [1, 1]],
                ["L", [-1, 1]],
                ["L", [-1, -1]],
            ],
        },
    ],

    "same-endpoint-large-arc": () => [
        {
            start: [-1, -1],
            segs: [
                ["L", [1, -1]],
                ["A", 1, 1, 0, true, true, [1, -1]],
                ["L", [1, 1]],
                ["L", [-1, 1]],
                ["L", [-1, -1]],
            ],
        },
    ],

    // Two identical circles traversed in opposite directions. Both fill
    // rules see an empty region when their signed/parity contributions cancel.
    "cancelled-circle": () => [circleOfArcs(1, true), circleOfArcs(1, false)],

    "zero-length-line-in-square": () =>
        polygon([
            [-1, -1],
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ]),

    "point-and-square": () => [
        { start: [0, 0], segs: [["L", [0, 0]]] },
        ...polygon([
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ]),
    ],

    "quadratic-spike": () => [
        {
            start: [-1, -1],
            segs: [
                ["L", [1, -1]],
                ["L", [1, 1]],
                ["L", [0, 1]],
                ["Q", [0.6, 2], [0, 3]],
                ["Q", [0.6, 2], [0, 1]],
                ["L", [-1, 1]],
                ["L", [-1, -1]],
            ],
        },
    ],

    "cubic-spike": () => [
        {
            start: [-1, -1],
            segs: [
                ["L", [1, -1]],
                ["L", [1, 1]],
                ["L", [0, 1]],
                ["C", [0.6, 1.5], [0.6, 2.5], [0, 3]],
                ["C", [0.6, 2.5], [0.6, 1.5], [0, 1]],
                ["L", [-1, 1]],
                ["L", [-1, -1]],
            ],
        },
    ],
};

/* Similarity transforms */

function sim(scale = 1, rotDeg = 0, tx = 0, ty = 0) {
    return { scale, rotDeg, tx, ty };
}

const ID = sim();

function applyPoint(s, [x, y]) {
    const r = (s.rotDeg * Math.PI) / 180;
    const c = Math.cos(r);
    const n = Math.sin(r);
    return [s.scale * (x * c - y * n) + s.tx, s.scale * (x * n + y * c) + s.ty];
}

function applySeg(s, seg) {
    switch (seg[0]) {
        case "L":
            return ["L", applyPoint(s, seg[1])];
        case "C":
            return [
                "C",
                applyPoint(s, seg[1]),
                applyPoint(s, seg[2]),
                applyPoint(s, seg[3]),
            ];
        case "Q":
            return ["Q", applyPoint(s, seg[1]), applyPoint(s, seg[2])];
        case "A":
            return [
                "A",
                seg[1] * s.scale,
                seg[2] * s.scale,
                seg[3] + s.rotDeg,
                seg[4],
                seg[5],
                applyPoint(s, seg[6]),
            ];
        default:
            throw new Error(`Unknown segment type ${seg[0]}.`);
    }
}

function applyShape(shape, s) {
    return shape.map((sp) => ({
        start: applyPoint(s, sp.start),
        segs: sp.segs.map((seg) => applySeg(s, seg)),
    }));
}

function segEnd(seg) {
    switch (seg[0]) {
        case "L":
            return seg[1];
        case "C":
            return seg[3];
        case "Q":
            return seg[2];
        case "A":
            return seg[6];
        default:
            throw new Error(`Unknown segment type ${seg[0]}.`);
    }
}

function reverseShape(shape) {
    return shape.map((sp) => {
        const starts = [sp.start, ...sp.segs.map(segEnd)];
        const segs = [];
        for (let i = sp.segs.length - 1; i >= 0; i--) {
            const seg = sp.segs[i];
            const to = starts[i];
            switch (seg[0]) {
                case "L":
                    segs.push(["L", to]);
                    break;
                case "C":
                    segs.push(["C", seg[2], seg[1], to]);
                    break;
                case "Q":
                    segs.push(["Q", seg[1], to]);
                    break;
                case "A":
                    segs.push([
                        "A",
                        seg[1],
                        seg[2],
                        seg[3],
                        seg[4],
                        !seg[5],
                        to,
                    ]);
                    break;
            }
        }
        return { start: starts[starts.length - 1], segs };
    });
}

/* Serialization */

// `String(n)` is the shortest representation that round-trips exactly, which
// matters for the 1e-9/1e-12 offset cases: rounding to a fixed number of
// digits would silently collapse them onto their partner.
function fmt(n) {
    return Object.is(n, -0) ? "0" : String(n);
}

function fmtPoint([x, y]) {
    return `${fmt(x)} ${fmt(y)}`;
}

function toPathData(shape) {
    const out = [];
    for (const sp of shape) {
        out.push(`M ${fmtPoint(sp.start)}`);
        for (const seg of sp.segs) {
            switch (seg[0]) {
                case "L":
                    out.push(`L ${fmtPoint(seg[1])}`);
                    break;
                case "C":
                    out.push(
                        `C ${fmtPoint(seg[1])} ${fmtPoint(seg[2])} ${fmtPoint(seg[3])}`,
                    );
                    break;
                case "Q":
                    out.push(`Q ${fmtPoint(seg[1])} ${fmtPoint(seg[2])}`);
                    break;
                case "A":
                    out.push(
                        `A ${fmt(seg[1])} ${fmt(seg[2])} ${fmt(seg[3])} ${
                            seg[4] ? 1 : 0
                        } ${seg[5] ? 1 : 0} ${fmtPoint(seg[6])}`,
                    );
                    break;
            }
        }
        out.push("Z");
    }
    return out.join(" ");
}

// Deliberately loose: control points and an arc's rx/ry bound the true extent
// from outside, which is all a viewBox needs.
function shapeBounds(shape) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const put = ([x, y], pad = 0) => {
        minX = Math.min(minX, x - pad);
        minY = Math.min(minY, y - pad);
        maxX = Math.max(maxX, x + pad);
        maxY = Math.max(maxY, y + pad);
    };

    for (const sp of shape) {
        put(sp.start);
        for (const seg of sp.segs) {
            switch (seg[0]) {
                case "L":
                    put(seg[1]);
                    break;
                case "C":
                    put(seg[1]);
                    put(seg[2]);
                    put(seg[3]);
                    break;
                case "Q":
                    put(seg[1]);
                    put(seg[2]);
                    break;
                case "A":
                    put(seg[6], Math.max(seg[1], seg[2]));
                    break;
            }
        }
    }

    return { minX, minY, maxX, maxY };
}

function squareViewBox(shapes) {
    let b = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
    };
    for (const shape of shapes) {
        const s = shapeBounds(shape);
        b = {
            minX: Math.min(b.minX, s.minX),
            minY: Math.min(b.minY, s.minY),
            maxX: Math.max(b.maxX, s.maxX),
            maxY: Math.max(b.maxY, s.maxY),
        };
    }

    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    // Guard against a zero extent (the wholly-degenerate cases).
    const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9) * 1.08;

    return {
        x: cx - extent / 2,
        y: cy - extent / 2,
        size: extent,
    };
}

function styleFor(fillRule) {
    // Fill only, no stroke: the raster tier compares coverage masks, and a
    // stroke would paint pixels that are not part of the filled region.
    return `fill:#ff0000;fill-rule:${fillRule}`;
}

function toSvg(aData, bData, fillRules, viewBox) {
    const vb = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.size)} ${fmt(
        viewBox.size,
    )}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Generated by scripts/generate-corpus.mjs; do not edit by hand. -->
<svg width="${RENDER_SIZE}"
     height="${RENDER_SIZE}"
     viewBox="${vb}"
     version="1.1"
     xmlns="http://www.w3.org/2000/svg">
    <path id="a"
          style="${styleFor(fillRules[0])}"
          d="${aData}"/>
    <path id="b"
          style="${styleFor(fillRules[1])}"
          d="${bData}"/>
</svg>
`;
}

/*
 Case table
 ==========
 Axes: shape pair x relative placement x fill rules x numeric conditioning.
 Written out as explicit groups rather than a blind cross product so that
 every case is one a human would have thought worth writing.
*/

const cases = [];

function add(c) {
    // Drop explicit `undefined`s so a group that passes `fill: c.fill` for
    // cases that do not set it still gets the default.
    const defined = Object.fromEntries(
        Object.entries(c).filter(([, v]) => v !== undefined),
    );
    cases.push({
        fill: ["nonzero", "nonzero"],
        conditioning: "origin",
        ...defined,
    });
}

function num(i) {
    return String(i + 1).padStart(2, "0");
}

/* -- overlap: generic crossings across the shape vocabulary -- */

const OVERLAP = sim(1, 0, 1.1, 0.55);

[
    ["circle-arc", "circle-arc"],
    ["circle-arc", "circle-cubic"],
    ["square", "circle-arc"],
    ["triangle", "square"],
    ["round-rect", "ellipse-rot"],
    ["quad-blob", "circle-cubic"],
    ["comb", "square"],
    ["c-shape", "circle-arc"],
    ["annulus", "square"],
    ["pentagram", "circle-arc"],
    ["cusp-cubic", "square"],
    ["loop-cubic", "circle-arc"],
    ["two-islands", "circle-arc"],
    ["bullseye", "square"],
    ["bowtie", "circle-arc"],
    ["lens-large", "square"],
    ["degenerate-curves", "triangle"],
    ["half-disc", "quad-blob"],
].forEach(([sa, sb], i) =>
    add({
        category: "overlap",
        name: `${num(i)}-${sa}-x-${sb}`,
        a: { shape: sa },
        b: { shape: sb, sim: OVERLAP },
        placement: "overlap",
        note: "generic transversal overlap",
    }),
);

/* -- touching: contact without transversal crossing -- */

const HALF_DIAGONAL = 0.5 * Math.SQRT2;

[
    {
        name: "tangent-external",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: sim(1, 0, 2, 0) },
        note: "circles meet at the single point (1, 0)",
    },
    {
        name: "tangent-internal",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: sim(0.5, 0, 0.5, 0) },
        note: "smaller circle touches the inside of the larger at (1, 0)",
    },
    {
        name: "vertex-on-vertex",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(1, 0, 2, 2) },
        note: "squares share exactly the corner (1, 1)",
    },
    {
        name: "vertex-on-edge",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(0.5, 45, 1 + HALF_DIAGONAL, 0) },
        note: "rotated square touches the middle of A's right edge with a vertex",
    },
    {
        name: "edge-shared-full",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(1, 0, 2, 0) },
        note: "collinear overlap along the whole of the edge x = 1",
    },
    {
        name: "edge-shared-partial",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(1, 0, 2, 1) },
        note: "collinear overlap along half of the edge x = 1",
    },
    {
        name: "edge-shared-inside",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(0.5, 0, 1.5, 0) },
        note: "B's whole left edge lies strictly inside A's right edge",
    },
    {
        name: "arc-shared-partial",
        a: { shape: "circle-arc" },
        b: { shape: "rim-wedge" },
        note: "B shares 60 degrees of A's rim: a coincident stretch that is curved, and whose ends fall inside A's quarter arcs rather than on its vertices",
    },
    {
        name: "arc-shared-full",
        a: { shape: "circle-arc" },
        b: { shape: "ring-outside" },
        note: "B's inner ring is the whole of A's boundary traced backwards",
    },
    {
        name: "circle-tangent-to-edge",
        a: { shape: "square" },
        b: { shape: "circle-arc", sim: sim(0.5, 0, 1.5, 0) },
        note: "curve meets line tangentially, where 01/02 have curve meeting curve",
    },
    {
        name: "circle-inscribed",
        a: { shape: "square" },
        b: { shape: "circle-arc" },
        note: "B is tangent to all four of A's edges at once, from inside",
    },
    {
        name: "vertex-on-arc",
        a: { shape: "circle-arc" },
        b: {
            shape: "square",
            sim: sim(0.5, 0, Math.SQRT1_2 + 0.5, Math.SQRT1_2 + 0.5),
        },
        note: "B's corner rests on A's rim at 45 degrees, strictly inside one of A's quarter arcs rather than on a vertex of either",
    },
    {
        name: "ellipse-arc-shared-swapped-partial",
        a: { shape: "ellipse-rot" },
        b: { shape: "ellipse-rim-wedge-swapped" },
        note: "B shares a 60-degree stretch of A's rotated ellipse but spells that rim with exchanged radii and a quarter-turned frame",
    },
    {
        name: "tangent-external-mid-arcs",
        a: { shape: "circle-arc" },
        b: {
            shape: "circle-arc",
            sim: sim(1, 0, Math.SQRT2, Math.SQRT2),
        },
        note: "equal circles touch externally at 45 degrees, in the interior of an arc on both paths",
    },
    {
        name: "tangent-internal-mid-arcs",
        a: { shape: "circle-arc" },
        b: {
            shape: "circle-arc",
            sim: sim(0.5, 0, 0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2),
        },
        note: "the smaller circle touches A internally at 45 degrees, in the interior of an arc on both paths",
    },
    {
        name: "four-vertices-on-edges",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(Math.SQRT2, 45) },
        note: "every vertex of A lands in the interior of an edge of B, producing four simultaneous vertex-on-edge crossings",
    },
].forEach((c, i) =>
    add({
        category: "touching",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        placement: c.name,
        note: c.note,
    }),
);

/* -- nesting: containment without boundary contact -- */

[
    {
        name: "circle-in-circle",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: sim(0.4) },
        note: "B strictly inside A",
    },
    {
        name: "circle-around-circle",
        a: { shape: "circle-arc", sim: sim(0.4) },
        b: { shape: "circle-arc" },
        note: "A strictly inside B (the reverse nesting order)",
    },
    {
        name: "square-in-circle",
        a: { shape: "circle-arc" },
        b: { shape: "square", sim: sim(0.5) },
        note: "straight-edged island inside a curved boundary",
    },
    {
        name: "circle-in-square",
        a: { shape: "square" },
        b: { shape: "circle-arc", sim: sim(0.5) },
        note: "curved island inside a straight boundary",
    },
    {
        name: "circle-in-annulus-hole",
        a: { shape: "annulus" },
        b: { shape: "circle-arc", sim: sim(0.3) },
        note: "B sits in A's hole, touching nothing: two levels of nesting",
    },
    {
        name: "circle-spanning-annulus",
        a: { shape: "annulus" },
        b: { shape: "circle-arc", sim: sim(0.75, 0, 0.6, 0) },
        note: "B crosses both rings of the annulus",
    },
    {
        name: "circle-in-bullseye-core",
        a: { shape: "bullseye" },
        b: { shape: "circle-arc", sim: sim(0.2) },
        note: "B sits in A's innermost filled disc: three levels of nesting to walk through before reaching it",
    },
    {
        name: "circle-in-bullseye-gap",
        a: { shape: "bullseye" },
        b: { shape: "circle-arc", sim: sim(0.15, 0, 0.52, 0) },
        note: "B sits in A's empty ring, so it is nested inside A and yet outside it",
    },
    {
        name: "two-islands-in-circle",
        a: { shape: "circle-arc", sim: sim(2) },
        b: { shape: "two-islands" },
        note: "both of B's components are contained, and neither contains the other",
    },
    {
        name: "annulus-in-annulus-hole",
        a: { shape: "annulus" },
        b: { shape: "annulus", sim: sim(0.4) },
        note: "a hole inside a hole inside a hole: four levels of alternating containment",
    },
].forEach((c, i) =>
    add({
        category: "nesting",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        placement: c.name,
        note: c.note,
    }),
);

/* -- coincident: identical or near-identical boundaries -- */

[
    {
        name: "identical-circle",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc" },
        note: "every edge of A coincides with an edge of B",
    },
    {
        name: "identical-square-reversed",
        a: { shape: "square" },
        b: { shape: "square", reversed: true },
        note: "same boundary, opposite winding",
    },
    {
        name: "identical-pentagram-evenodd",
        a: { shape: "pentagram" },
        b: { shape: "pentagram" },
        fill: ["evenodd", "evenodd"],
        note: "coincident boundaries that are themselves self-intersecting",
    },
    {
        name: "arc-vs-cubic-circle",
        a: { shape: "circle-arc" },
        b: { shape: "circle-cubic" },
        note: "same nominal circle, two representations, ~2.7e-4 apart: near-coincident but not equal",
    },
    {
        name: "offset-1e-9-square",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(1, 0, 1e-9, 0) },
        note: "offset below EPS.point: edges should merge",
    },
    {
        name: "offset-1e-12-circle",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: sim(1, 0, 0, 1e-12) },
        note: "offset at the edge of double precision for unit coordinates",
    },
    {
        name: "identical-circle-rotated-start",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: sim(1, 45) },
        note: "the same circle drawn from a different starting angle: the boundaries coincide but not one vertex of A meets a vertex of B",
    },
    {
        name: "identical-annulus",
        a: { shape: "annulus" },
        b: { shape: "annulus" },
        note: "coincident on both rings at once, with the two winding oppositely",
    },
    {
        name: "square-vs-subdivided-square",
        a: { shape: "square" },
        b: { shape: "subdivided-square" },
        note: "the same square with twice as many vertices, so every coincident edge has a vertex of B in its interior",
    },
    {
        name: "square-vs-degenerate-curves",
        a: { shape: "square" },
        b: { shape: "degenerate-curves" },
        note: "the same square drawn with a zero-length cubic, a collinear cubic and a collinear quadratic: identical geometry, no shared segment type",
    },
    {
        name: "circle-vs-overlong-radii",
        a: { shape: "circle-arc" },
        b: { shape: "arc-overlong" },
        note: "identical only if the SVG F.6.6 radius correction is applied; B's radii are half what its chords need",
    },
    {
        name: "square-vs-zero-radius-arc",
        a: { shape: "square" },
        b: { shape: "zero-radius-arc" },
        note: "identical only if a zero-radius arc is read as the straight line SVG F.6.2 says it is",
    },
    {
        name: "ellipse-vs-swapped-radii",
        a: { shape: "ellipse-rot" },
        b: { shape: "ellipse-rot-swapped" },
        note: "the same rotated ellipse with rx/ry exchanged and phi advanced by 90 degrees",
    },
    {
        name: "ellipse-vs-half-turn",
        a: { shape: "ellipse-rot" },
        b: { shape: "ellipse-rot", sim: sim(1, 180) },
        note: "the same ellipse with its frame and starting point advanced by half a turn",
    },
    {
        name: "circle-vs-negative-radius",
        a: { shape: "circle-arc" },
        b: { shape: "circle-negative-radii" },
        note: "the same circle with a negative rx, which SVG normalizes to its absolute value",
    },
    {
        name: "quadratic-vs-subdivided",
        a: { shape: "quad-blob" },
        b: { shape: "quad-blob-subdivided" },
        note: "the same quadratic boundary with every segment split at t = 0.5",
    },
    {
        name: "cubic-vs-subdivided",
        a: { shape: "circle-cubic" },
        b: { shape: "circle-cubic-subdivided" },
        note: "the same cubic boundary with every segment split at t = 0.5",
    },
    {
        name: "cubic-vs-reversed",
        a: { shape: "circle-cubic" },
        b: { shape: "circle-cubic", reversed: true },
        note: "the same cubic boundary traversed in the opposite direction",
    },
].forEach((c, i) =>
    add({
        category: "coincident",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        fill: c.fill,
        placement: c.name,
        note: c.note,
    }),
);

/* -- disjoint: no contact at all -- */

[
    {
        name: "square-and-circle",
        a: { shape: "square" },
        b: { shape: "circle-arc", sim: sim(1, 0, 5, 0) },
        note: "separated shapes: intersection is empty, union has two components",
    },
    {
        name: "annulus-and-square",
        a: { shape: "annulus" },
        b: { shape: "square", sim: sim(1, 0, 5, 0) },
        note: "a hole-bearing component alongside a separate solid one",
    },
    {
        name: "two-islands-and-bullseye",
        a: { shape: "two-islands" },
        b: { shape: "bullseye", sim: sim(1, 0, 5, 0) },
        note: "two multi-component inputs, five components between them, no contact anywhere",
    },
    {
        name: "island-between-islands",
        a: { shape: "two-islands" },
        b: { shape: "circle-arc", sim: sim(0.3) },
        note: "B fits in the gap between A's two components: disjoint from both, and contained by neither",
    },
].forEach((c, i) =>
    add({
        category: "disjoint",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        placement: c.name,
        note: c.note,
    }),
);

/* -- fill-rule: the same geometry read under each winding rule -- */

let fillRuleIndex = 0;

for (const fa of ["nonzero", "evenodd"]) {
    for (const fb of ["nonzero", "evenodd"]) {
        add({
            category: "fill-rule",
            name: `${num(fillRuleIndex++)}-pentagram-x-circle-${fa}-${fb}`,
            a: { shape: "pentagram" },
            b: { shape: "circle-arc", sim: sim(0.8, 0, 0.7, 0.4) },
            fill: [fa, fb],
            placement: "overlap",
            note: `self-intersecting A read as ${fa}, B as ${fb}`,
        });
    }
}

for (const fa of ["nonzero", "evenodd"]) {
    add({
        category: "fill-rule",
        name: `${num(fillRuleIndex++)}-annulus-x-square-${fa}`,
        a: { shape: "annulus" },
        b: { shape: "square", sim: sim(0.7, 0, 0.9, 0.4) },
        fill: [fa, "nonzero"],
        placement: "overlap",
        note: `opposing-winding subpaths read as ${fa}`,
    });
}

/*
 The pentagram and annulus cases above have their windings decided by a single
 self-intersecting subpath or by two subpaths that oppose each other. These two
 groups cover the remaining ways to reach a winding number the rules disagree
 about: two separate subpaths wound the *same* way and overlapping, and one
 subpath that simply goes round twice.
*/

for (const fa of ["nonzero", "evenodd"]) {
    add({
        category: "fill-rule",
        name: `${num(fillRuleIndex++)}-two-discs-x-square-${fa}`,
        a: { shape: "two-discs" },
        b: { shape: "square", sim: sim(0.8, 0, 0, 0.9) },
        fill: [fa, "nonzero"],
        placement: "overlap",
        note: `two same-winding subpaths overlapping in a doubly-wound lens, read as ${fa}: the lens is filled under non-zero and empty under even-odd`,
    });
}

for (const fa of ["nonzero", "evenodd"]) {
    add({
        category: "fill-rule",
        name: `${num(fillRuleIndex++)}-double-circle-x-square-${fa}`,
        a: { shape: "double-circle" },
        b: { shape: "square", sim: sim(0.8, 0, 0.9, 0.4) },
        fill: [fa, "nonzero"],
        placement: "overlap",
        note: `a circle traversed twice round in one subpath, read as ${fa}: the disc is filled under non-zero and wholly empty under even-odd`,
    });
}

for (const fa of ["nonzero", "evenodd"]) {
    add({
        category: "fill-rule",
        name: `${num(fillRuleIndex++)}-bowtie-x-circle-${fa}`,
        a: { shape: "bowtie" },
        b: { shape: "circle-arc", sim: sim(0.8, 0, 0.6, 0.3) },
        fill: [fa, "nonzero"],
        placement: "overlap",
        note: `opposite-winding lobes meeting at a self-crossing, read as ${fa}: both rules fill both lobes, so this pins that the rules agree where they should`,
    });
}

for (const fa of ["nonzero", "evenodd"]) {
    add({
        category: "fill-rule",
        name: `${num(fillRuleIndex++)}-cancelled-circle-x-square-${fa}`,
        a: { shape: "cancelled-circle" },
        b: { shape: "square" },
        fill: [fa, "nonzero"],
        placement: "coincident-opposite-winding",
        note: `two coincident circles traversed in opposite directions cancel under ${fa}, so A contributes no filled region`,
    });
}

for (const fill of ["nonzero", "evenodd"]) {
    add({
        category: "fill-rule",
        name: `${num(fillRuleIndex++)}-crossed-two-discs-${fill}`,
        a: { shape: "two-discs" },
        b: { shape: "two-discs", sim: sim(1, 90) },
        fill: [fill, fill],
        placement: "crossed-overlapping-subpaths",
        note: `two horizontal overlapping discs against two vertical ones, with both multiply-wound inputs read as ${fill}`,
    });
}

/* -- degenerate: zero-area geometry -- */

[
    {
        name: "spike-vs-square",
        a: { shape: "degenerate-spike" },
        b: { shape: "square", sim: sim(1, 0, 1.1, 0.55) },
        note: "zero-area spike protruding from an otherwise ordinary square",
    },
    {
        name: "spike-through-boundary",
        a: { shape: "degenerate-spike" },
        b: { shape: "square", sim: sim(0.8, 0, 0, 1.8) },
        note: "the spike is crossed by B's boundary",
    },
    {
        name: "parallel-lines",
        a: { shape: "zero-area-line" },
        b: { shape: "zero-area-line", sim: sim(1, 0, 0, 0.5) },
        note: "two wholly zero-area paths, not touching",
    },
    {
        name: "crossing-lines",
        a: { shape: "zero-area-line" },
        b: { shape: "zero-area-line", sim: sim(1, 90, 0, 0) },
        note: "two wholly zero-area paths crossing at the origin",
    },
    {
        name: "degenerate-curves-x-circle",
        a: { shape: "degenerate-curves" },
        b: { shape: "circle-arc", sim: sim(1, 0, 1.1, 0.55) },
        note: "a zero-length cubic, a collinear cubic and a collinear quadratic all cut by an ordinary curve",
    },
    {
        name: "sliver-x-square",
        a: { shape: "sliver" },
        b: { shape: "square", sim: sim(1, 0, 1.1, 0.55) },
        note: "a wedge under half a pixel thick crossing an ordinary edge: the area oracle can see the result, the raster oracle cannot",
    },
    {
        name: "crossing-slivers",
        a: { shape: "sliver" },
        b: { shape: "sliver", sim: sim(1, 90) },
        note: "two sub-pixel wedges crossing, so the intersection has an area of order 1e-6 and four vertices within 0.002 of each other",
    },
    {
        name: "spike-along-edge",
        a: { shape: "degenerate-spike" },
        b: { shape: "square", sim: sim(1, 0, 0, 3) },
        note: "the zero-area spike ends exactly on B's boundary, so the out-and-back pair terminates at a vertex it has to share",
    },
    {
        name: "zero-length-line-in-square",
        a: { shape: "zero-length-line-in-square" },
        b: { shape: "circle-arc", sim: OVERLAP },
        note: "an ordinary square contains a repeated vertex and therefore an explicit zero-length line",
    },
    {
        name: "point-subpath-and-square",
        a: { shape: "point-and-square" },
        b: { shape: "circle-arc", sim: OVERLAP },
        note: "a point-only closed subpath sits alongside an ordinary filled component",
    },
    {
        name: "quadratic-spike-x-square",
        a: { shape: "quadratic-spike" },
        b: { shape: "square", sim: sim(0.8, 0, 0, 2.4) },
        note: "a quadratic is followed by its exact reverse and the retraced curve is crossed by B",
    },
    {
        name: "cubic-spike-x-square",
        a: { shape: "cubic-spike" },
        b: { shape: "square", sim: sim(0.8, 0, 0, 2.4) },
        note: "a cubic is followed by its exact reverse and the retraced curve is crossed by B",
    },
].forEach((c, i) =>
    add({
        category: "degenerate",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        placement: c.name,
        note: c.note,
    }),
);

/* -- arcs: the corners of the SVG arc parametrization -- */

[
    {
        name: "large-arc-x-square",
        a: { shape: "lens-large" },
        b: { shape: "square", sim: sim(1, 0, 0.6, 0.8) },
        note: "every arc of A takes the long way round (largeArc set), which is the flag combination nothing else in the corpus uses",
    },
    {
        name: "overlong-radii-x-square",
        a: { shape: "arc-overlong" },
        b: { shape: "square", sim: sim(1, 0, 1.1, 0.55) },
        note: "A's radii are half what its chords need, so the F.6.6 correction has to fire before anything else can be right",
    },
    {
        name: "zero-radius-x-circle",
        a: { shape: "zero-radius-arc" },
        b: { shape: "circle-arc", sim: sim(1, 0, 1.1, 0.55) },
        note: "A's bottom edge is an arc of radius zero, which F.6.2 says to draw as a straight line",
    },
    {
        name: "ellipse-x-ellipse-crossed",
        a: { shape: "ellipse-rot" },
        b: { shape: "ellipse-rot", sim: sim(1, 70, 0.15, 0) },
        note: "two rotated ellipses at 70 degrees to each other: four transversal crossings, none of them on an axis of either",
    },
    {
        name: "half-disc-x-half-disc",
        a: { shape: "half-disc" },
        b: { shape: "half-disc", sim: sim(1, 180, 0, -0.5) },
        note: "each half-disc's chord crosses the other's arc, so all four crossings are curve-against-line and the two chords stay parallel",
    },
    {
        name: "sweep-flags-x-square",
        a: { shape: "c-shape" },
        b: { shape: "square", sim: sim(0.6, 0, 0.9, 0.5) },
        note: "A's outer and inner arcs run with opposite sweep flags and both have largeArc set",
    },
    {
        name: "same-endpoint-small-arc",
        a: { shape: "same-endpoint-small-arc" },
        b: { shape: "circle-arc", sim: OVERLAP },
        note: "an arc whose endpoints coincide is omitted, with largeArc clear",
    },
    {
        name: "same-endpoint-large-arc",
        a: { shape: "same-endpoint-large-arc" },
        b: { shape: "circle-arc", sim: OVERLAP },
        note: "an arc whose endpoints coincide is still omitted when largeArc is set",
    },
].forEach((c, i) =>
    add({
        category: "arcs",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        placement: c.name,
        note: c.note,
    }),
);

/* -- stress: many intersections at once -- */

[
    {
        name: "gear-x-circle",
        a: { shape: "gear" },
        b: { shape: "circle-arc", sim: sim(0.8) },
        note: "the circle cuts every one of the twelve teeth: 24 intersections spread over four arcs",
    },
    {
        name: "gear-x-gear",
        a: { shape: "gear" },
        b: { shape: "gear", sim: sim(1, 15) },
        note: "two gears offset by half a tooth, so the teeth interlock and every one of them crosses two of the other's edges",
    },
    {
        name: "comb-x-comb",
        a: { shape: "comb" },
        b: { shape: "comb", sim: sim(1, 90) },
        note: "two combs at right angles: the teeth of each cross the teeth of the other in a grid",
    },
    {
        name: "gear-x-annulus",
        a: { shape: "gear" },
        b: { shape: "annulus", sim: sim(0.9) },
        note: "both rings of the annulus cut the teeth, so the result is a ring of alternating faces",
    },
    {
        name: "gear-tangent-circle",
        a: { shape: "gear" },
        b: { shape: "circle-arc" },
        note: "the circle contains the gear and touches all twelve tooth tips at once",
    },
    {
        name: "bowtie-x-bowtie",
        a: { shape: "bowtie" },
        b: { shape: "bowtie", sim: sim(1, 45) },
        note: "two self-crossing polygons share their central crossing, creating an eight-way vertex",
    },
    {
        name: "pentagram-x-pentagram",
        a: { shape: "pentagram" },
        b: { shape: "pentagram", sim: sim(1, 36) },
        note: "two self-intersecting stars interleave at half a point step",
    },
    {
        name: "loop-cubic-x-loop-cubic",
        a: { shape: "loop-cubic" },
        b: { shape: "loop-cubic", sim: sim(1, 90) },
        note: "two self-crossing cubic loops collide with their singular structure centred together",
    },
    {
        name: "annulus-x-annulus",
        a: { shape: "annulus", sim: sim(1, 0, -0.45, 0) },
        b: { shape: "annulus", sim: sim(1, 0, 0.45, 0) },
        note: "both inner and outer rings of two offset annuli cross, producing nested alternating faces",
    },
    {
        name: "bullseye-x-annulus",
        a: { shape: "bullseye" },
        b: { shape: "annulus", sim: sim(0.9, 0, 0.5, 0.1) },
        note: "five nested rings across two inputs intersect away from their symmetry axes",
    },
    {
        name: "two-islands-x-two-islands",
        a: { shape: "two-islands" },
        b: { shape: "two-islands", sim: sim(1, 90) },
        note: "horizontal and vertical pairs of disconnected components overlap in four separate regions",
    },
].forEach((c, i) =>
    add({
        category: "stress",
        name: `${num(i)}-${c.name}`,
        a: c.a,
        b: c.b,
        placement: c.name,
        note: c.note,
    }),
);

/* -- conditioning: the same case at other positions, scales and angles -- */

const CONDITIONING = {
    far: sim(1, 0, 1e6, 1e6),
    small: sim(1e-3),
    large: sim(1e3),
    rotated: sim(1, 21.2),
    tiny: sim(1e-6),
    "small-and-far": sim(1e-3, 0, 1e6, 1e6),
};

const CONDITIONING_NOTES = {
    far: "translated to 1e6, where EPS.point is close to float noise",
    small: "scaled to 1e-3, where features are smaller than EPS.linear",
    large: "scaled to 1e3",
    rotated: "rotated off-axis, so nothing is axis-aligned any more",
    tiny: "scaled to 1e-6, three more orders of magnitude down than `small`, where the whole scene is the size of the unscaled EPS.point",
    "small-and-far":
        "scaled to 1e-3 *and* translated to 1e6: the two hard conditionings at once, where the scene is nine orders of magnitude smaller than its own offset and neighbouring doubles are ~2e-10 apart",
};

[
    {
        name: "overlap-circles",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: OVERLAP },
    },
    {
        name: "tangent-external",
        a: { shape: "circle-arc" },
        b: { shape: "circle-arc", sim: sim(1, 0, 2, 0) },
    },
    {
        name: "edge-shared-full",
        a: { shape: "square" },
        b: { shape: "square", sim: sim(1, 0, 2, 0) },
    },
    {
        // The one placement here whose coincident stretch is curved, and the
        // one most likely to come apart when the tolerances move relative to
        // the geometry.
        name: "arc-shared-full",
        a: { shape: "circle-arc" },
        b: { shape: "ring-outside" },
    },
].forEach((base, i) => {
    for (const [cond, condSim] of Object.entries(CONDITIONING)) {
        add({
            category: "conditioning",
            name: `${num(i)}-${base.name}-${cond}`,
            a: base.a,
            b: base.b,
            conditioning: cond,
            conditioningSim: condSim,
            placement: base.name,
            note: `${base.name}, ${CONDITIONING_NOTES[cond]}`,
        });
    }
});

/* Emit */

function buildShape(spec, condSim) {
    const build = SHAPES[spec.shape];
    if (!build) throw new Error(`Unknown shape ${spec.shape}.`);
    let shape = build();
    if (spec.reversed) shape = reverseShape(shape);
    if (spec.sim) shape = applyShape(shape, spec.sim);
    if (condSim) shape = applyShape(shape, condSim);
    return shape;
}

async function main() {
    // Clear out the category directories, but leave hand-maintained files at
    // the root of the corpus (expected-failures.json) alone.
    const existing = await fs
        .readdir(OUT_ROOT, { withFileTypes: true })
        .catch(() => []);
    for (const entry of existing) {
        if (entry.isDirectory()) {
            await fs.rm(path.join(OUT_ROOT, entry.name), {
                recursive: true,
                force: true,
            });
        }
    }
    await fs.mkdir(OUT_ROOT, { recursive: true });

    const manifest = [];
    const seen = new Set();

    for (const c of cases) {
        const id = `${c.category}/${c.name}`;
        if (seen.has(id)) throw new Error(`Duplicate case id ${id}.`);
        seen.add(id);

        const condSim = c.conditioningSim ?? null;
        const aShape = buildShape(c.a, condSim);
        const bShape = buildShape(c.b, condSim);

        const svg = toSvg(
            toPathData(aShape),
            toPathData(bShape),
            c.fill,
            squareViewBox([aShape, bShape]),
        );

        const dir = path.join(OUT_ROOT, c.category, c.name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "original.svg"), svg, "utf-8");

        manifest.push({
            id,
            category: c.category,
            name: c.name,
            shapes: [c.a.shape, c.b.shape],
            placement: c.placement,
            fillRules: c.fill,
            conditioning: c.conditioning,
            note: c.note,
        });
    }

    await fs.writeFile(
        path.join(OUT_ROOT, "manifest.json"),
        JSON.stringify(
            {
                generatorVersion: GENERATOR_VERSION,
                generator: "scripts/generate-corpus.mjs",
                renderSize: RENDER_SIZE,
                caseCount: manifest.length,
                cases: manifest,
            },
            null,
            4,
        ) + "\n",
        "utf-8",
    );

    const byCategory = new Map();
    for (const m of manifest) {
        byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
    }

    console.log(
        `Wrote ${manifest.length} cases to ${path.relative(ROOT, OUT_ROOT)}:`,
    );
    for (const [category, count] of byCategory) {
        console.log(`  ${category.padEnd(14)} ${count}`);
    }
}

await main();
