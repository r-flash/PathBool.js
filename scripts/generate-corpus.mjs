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

const GENERATOR_VERSION = 1;

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

/* -- conditioning: the same case at other positions, scales and angles -- */

const CONDITIONING = {
    far: sim(1, 0, 1e6, 1e6),
    small: sim(1e-3),
    large: sim(1e3),
    rotated: sim(1, 21.2),
};

const CONDITIONING_NOTES = {
    far: "translated to 1e6, where EPS.point is close to float noise",
    small: "scaled to 1e-3, where features are smaller than EPS.linear",
    large: "scaled to 1e3",
    rotated: "rotated off-axis, so nothing is axis-aligned any more",
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
