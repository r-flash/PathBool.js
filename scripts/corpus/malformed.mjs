import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { fixtureSvg, transformedData, viewBox } from "./geometry.cjs";

const square = "M 0 0 L 40 0 L 40 40 L 0 40 Z";
const tail = "L 40 0 L 40 40 L 0 40 Z";
const circle = "M 40 20 A 20 20 0 0 1 0 20 A 20 20 0 0 1 40 20 Z";
const templates = [
    ["collapsed-line", `M 0 0 L 0 0 ${tail}`, square],
    ["collapsed-quadratic", `M 0 0 Q 0 0 0 0 ${tail}`, square],
    ["collapsed-cubic", `M 0 0 C 0 0 0 0 0 0 ${tail}`, square],
    [
        "collapsed-run",
        `M 0 0 ${"L 0 0 Q 0 0 0 0 C 0 0 0 0 0 0 ".repeat(4)}${tail}`,
        square,
    ],
    ["closing-residue", `${square.slice(0, -1)} L 0 0 Z Z`, square],
    ["point-subpaths", `M -5 -5 Z ${square} M 45 45 L 45 45 Z`, square],
    ["line-spike", `M 0 0 L -10 0 L 0 0 ${tail}`, square],
    ["quadratic-spike", `M 0 0 Q -20 0 0 0 ${tail}`, square],
    ["cubic-retrace", `M 0 0 C -20 0 20 0 0 0 ${tail}`, square],
    ["straight-quadratic", "M 0 0 Q 20 0 40 0 L 40 40 L 0 40 Z", square],
    ["straight-cubic", "M 0 0 C 10 0 30 0 40 0 L 40 40 L 0 40 Z", square],
    ["overshooting-controls", "M 0 0 C -30 0 70 0 40 0 L 40 40 L 0 40 Z", null],
    ["stationary-endpoints", "M 0 0 C 0 0 40 40 40 40 L 0 40 Z", null],
    ["cusp", "M 0 0 C 40 40 -40 40 0 0 L 40 0 L 40 40 Z", null],
    ["closed-cubic-loop", "M 0 0 C 40 0 0 40 0 0 Z", null],
    ["short-chord-large-loop", "M 0 0 C 40 0 0 40 1e-9 0 Z", null],
    ["zero-radius-arc", `M 0 0 A 0 20 35 1 1 40 0 L 40 40 L 0 40 Z`, square],
    ["omitted-arc", `M 0 0 A 20 10 35 1 1 0 0 ${tail}`, square],
    ["corrected-small-radii", "M 0 0 A 1e-8 1e-8 0 0 1 40 0 Z", null],
    [
        "signed-wrapped-arcs",
        "M 40 20 A -20 20 720 0 1 0 20 A 20 -20 -360 0 1 40 20 Z",
        circle,
    ],
    [
        "swapped-arc-axes",
        "M 40 20 A 10 20 90 0 1 0 20 A 20 10 0 0 1 40 20 Z",
        null,
    ],
    [
        "duplicate-same-winding",
        `${square} ${square}`,
        null,
        "winding-dependent",
    ],
    [
        "duplicate-opposite-winding",
        `${square} M 0 0 L 0 40 L 40 40 L 40 0 Z`,
        "",
    ],
    [
        "subdivided-duplicate",
        `${square} M 0 0 L 20 0 L 40 0 Q 40 20 40 40 L 0 40 Z`,
        null,
        "winding-dependent",
    ],
    ["dangling-branch", `${square} M 20 20 L 60 20`, null, "structural-only"],
    [
        "disconnected-fragments",
        "M -10 10 L 50 10 M 0 0 Q 20 40 40 0",
        null,
        "structural-only",
    ],
    [
        "hole-residue",
        `${square} M 10 10 L 10 30 L 30 30 L 30 10 Q 30 10 30 10 L 10 10 Z`,
        null,
    ],
    [
        "combined-residue",
        `M -5 -5 Z M 0 0 L 0 0 Q -20 0 0 0 A 10 10 0 1 0 0 0 ${tail}`,
        square,
    ],
];
const partners = {
    crossing: "M 20 -10 L 50 -10 L 50 30 L 20 30 Z",
    inside: "M 10 10 L 30 10 L 30 30 L 10 30 Z",
    outside: "M 50 50 L 60 50 L 60 60 L 50 60 Z",
    boundary: "M 40 0 L 60 0 L 60 40 L 40 40 Z",
    empty: "",
    identical: square,
};
const fills = [
    ["nonzero", "nonzero"],
    ["evenodd", "evenodd"],
    ["nonzero", "evenodd"],
    ["evenodd", "nonzero"],
];

export function malformedCases() {
    const cases = [];
    for (const [family, d, clean, relationship] of templates) {
        for (let i = 0; i < 8; i++) {
            const placement = Object.keys(partners)[i % 6];
            const matrix =
                i === 6
                    ? [1e-7, 0, 0, 1e-7, 0, 0]
                    : i === 7
                      ? [1, 0, 0, 1, 1e6, -1e6]
                      : [1, 0, 0, 1, 0, 0];
            cases.push({
                name: `${family}-${placement}-${i}`,
                family,
                inputs: [
                    d,
                    placement === "identical" ? d : partners[placement],
                ].map((p, n) => ({
                    d: transformedData(p, matrix),
                    fillRule: fills[i % 4][n],
                })),
                relationship:
                    relationship ??
                    (clean !== null
                        ? "geometry-preserving"
                        : "geometry-changing"),
                ...(clean !== null
                    ? { cleanA: transformedData(clean, matrix) }
                    : {}),
                ...(relationship === "structural-only"
                    ? {
                          structuralOnly:
                              "Open fragments have no established filled-region contract.",
                      }
                    : {}),
                placement,
                conditioning: i === 6 ? "tiny" : i === 7 ? "far" : "ordinary",
            });
        }
    }
    // Thresholds are explicit data, not read from implementation constants.
    for (const delta of [0, 1e-11, 1e-10, 1e-9, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3]) {
        const variants = {
            "corrected-radius": `M 0 0 A ${delta} ${delta} 0 0 1 40 0 Z`,
            "near-linear": `M 0 0 Q 20 ${delta} 40 0 L 40 40 L 0 40 Z`,
            "short-edge": `M 0 0 L ${delta} 0 ${tail}`,
            sliver: `M 0 0 L 40 0 L 40 ${delta} L 0 ${delta} Z`,
            "narrow-hole": `${square} M 10 10 L 10 30 L ${10 + delta} 30 L ${10 + delta} 10 Z`,
            "tiny-island": `${square} M 50 50 L ${50 + delta} 50 L ${50 + delta} ${50 + delta} L 50 ${50 + delta} Z`,
            "near-touch": `M ${40 + delta} 0 L 60 0 L 60 40 L ${40 + delta} 40 Z`,
        };
        for (const [family, d] of Object.entries(variants))
            cases.push({
                name: `${family}-${delta}`,
                family,
                inputs: [
                    { d, fillRule: "nonzero" },
                    {
                        d: family === "near-touch" ? square : partners.crossing,
                        fillRule: "evenodd",
                    },
                ],
                relationship: "geometry-changing",
                threshold: delta,
                placement: "crossing",
                conditioning: "ordinary",
            });
    }
    return cases;
}

export async function emitMalformed(root) {
    const entries = [];
    for (const c of malformedCases()) {
        const dir = path.join(root, "malformed", c.name);
        await mkdir(dir, { recursive: true });
        const vb = viewBox(c.inputs.map((i) => i.d));
        await writeFile(
            path.join(dir, "original.svg"),
            fixtureSvg(c.inputs, vb),
        );
        await writeFile(
            path.join(dir, "case.json"),
            JSON.stringify(c, null, 4) + "\n",
        );
        if (c.cleanA !== undefined) {
            await mkdir(path.join(dir, "clean"), { recursive: true });
            await writeFile(
                path.join(dir, "clean", "original.svg"),
                fixtureSvg([{ ...c.inputs[0], d: c.cleanA }, c.inputs[1]], vb),
            );
        }
        entries.push({
            id: `malformed/${c.name}`,
            category: "malformed",
            name: c.name,
            family: c.family,
            fillRules: c.inputs.map((i) => i.fillRule),
            placement: c.placement,
            conditioning: c.conditioning,
            relationship: c.relationship,
        });
    }
    return entries;
}
