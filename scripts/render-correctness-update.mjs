// Reproduce the static figures in docs/updates/2026-09-12/.
// Run through scripts/run-contained.mjs; no geometry deadline is imposed.
import { nodeResolve } from "@rollup/plugin-node-resolve";
import strip from "@rollup/plugin-strip";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import ts from "typescript";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
process.env.PATH_BOOL_DEV_ASSERTS = "0";
const beforeRevision = "780ecef",
    afterRevision = "6e24ce4";
const cache = ".cache/path-bool/update-2026-09-12";
const output = "docs/updates/2026-09-12/img";
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const git = (...args) =>
    execFileSync("git", args, {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
const files = git("ls-tree", "-r", "--name-only", beforeRevision, "src")
    .trim()
    .split("\n")
    .filter((file) => file.endsWith(".ts") && !file.includes("/__"));
for (const file of files) {
    const destination = path.join(cache, "before", file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, git("show", `${beforeRevision}:${file}`));
}
// Build the baseline source with production assertions stripped. Its checked-in
// bundle may predate the source revision, so do not use that bundle as baseline.
const bundle = await rollup({
    input: path.join(cache, "before/src/index.ts"),
    external: ["gl-matrix"],
    plugins: [
        nodeResolve({ extensions: [".js", ".ts"] }),
        {
            name: "report-typescript",
            transform(code, id) {
                if (id.endsWith(".ts"))
                    return ts.transpileModule(code, {
                        compilerOptions: {
                            target: ts.ScriptTarget.ES2020,
                            module: ts.ModuleKind.ESNext,
                        },
                    }).outputText;
            },
        },
        strip({ include: "**/*.ts", functions: ["assert*"], debugger: false }),
    ],
});
await bundle.write({ file: path.join(cache, "before.mjs"), format: "es" });
await bundle.close();
fs.writeFileSync(
    path.join(cache, "after.mjs"),
    git("show", `${afterRevision}:dist/path-bool.js`),
);
fs.writeFileSync(
    path.join(cache, "issue.mjs"),
    ts.transpileModule(
        git(
            "show",
            `${afterRevision}:src/__fixtures__/reported-issues/issue-3.ts`,
        ),
        {
            compilerOptions: {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.ESNext,
            },
        },
    ).outputText,
);
const load = (name) =>
    import(new URL(`../${cache}/${name}.mjs`, import.meta.url));
const before = await load("before"),
    after = await load("after");
const { issue3RetracedTriangle: issue } = await load("issue");
const escape = (value) =>
    String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;");
const blue = "#2563a6",
    orange = "#d97706",
    green = "#238636",
    red = "#c43131";
const svg = (title, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300" role="img"><title>${escape(title)}</title><rect width="480" height="300" fill="white"/>${body}</svg>\n`;
const write = (name, title, body) =>
    fs.writeFileSync(`${output}/${name}.svg`, svg(title, body));
const curve = (lib, p, color, fill = "none", width = 2) =>
    `<path d="${escape(lib.pathToPathData(p, 0))}" fill="${fill}" fill-rule="evenodd" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
const frame = (box, body) =>
    `<svg x="18" y="18" width="444" height="264" viewBox="${box}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
const boolean = (lib, paths, op) =>
    new lib.PathBoolean(
        paths.map((path) => ({ path, fillRule: lib.FillRule.EvenOdd })),
    ).get(op);
const resultSvg = (lib, paths, color, box) =>
    frame(box, paths.map((p) => curve(lib, p, color, color + "35")).join(""));

// The browser-native spelling is a reference; it does not pass through our parser.
const smooth = "M10 70 Q30 0 60 70 S90 0 115 70";
const smoothBox = "0 -10 125 160";
write(
    "smooth-input",
    "Native SVG smooth-command reference",
    frame(
        smoothBox,
        `<path d="${smooth}" fill="none" stroke="${blue}" stroke-width="3" vector-effect="non-scaling-stroke"/>`,
    ),
);
for (const [label, lib, color] of [
    ["before", before, red],
    ["after", after, green],
]) {
    const p = lib.pathFromPathData(smooth),
        control = p[1][2];
    const guide = `<path d="M60 70 L${control.join(" ")} L90 0 L115 70" fill="none" stroke="#9ca3af" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/><circle cx="${control[0]}" cy="${control[1]}" r="2" fill="${color}"/>`;
    write(
        `smooth-${label}`,
        `Smooth cubic control point ${label}`,
        frame(smoothBox, guide + curve(lib, p, color, "none", 3)),
    );
}
assert.deepEqual(after.pathFromPathData(smooth)[1][2], [60, 70]);

const longInputs = ["M0 0 H2 V1000000000 H0 Z", "M1 1 H3 V2 H1 Z"].map(
    after.pathFromPathData,
);
const box = "-0.3 0.4 3.6 2.2";
write(
    "long-input",
    "Cropped view of a tall rectangle and a small rectangle",
    frame(
        box,
        curve(after, longInputs[0], blue, blue + "30") +
            curve(after, longInputs[1], orange, orange + "40"),
    ),
);
const longResults = {};
for (const [label, lib, color] of [
    ["before", before, red],
    ["after", after, green],
]) {
    const result = boolean(
        lib,
        longInputs,
        lib.PathBooleanOperation.Intersection,
    );
    longResults[label] = result;
    write(
        `long-${label}`,
        `Intersection beside a long edge ${label}`,
        resultSvg(lib, result, color, box),
    );
}
assert.equal(
    Math.max(
        ...longResults.before
            .flat()
            .flatMap((s) => s.slice(1).map((p) => p[0])),
    ),
    3,
);
assert.equal(
    Math.max(
        ...longResults.after.flat().flatMap((s) => s.slice(1).map((p) => p[0])),
    ),
    2,
);

const issueBox = "664.48 420.40 0.64 0.64";
write(
    "issue-input",
    "Issue 3 triangle and separate retraced line",
    frame(
        issueBox,
        curve(after, issue.a, blue, blue + "30") +
            curve(after, issue.b, orange),
    ),
);
const issueResults = {};
for (const [label, lib, color] of [
    ["before", before, red],
    ["after", after, green],
]) {
    const result = boolean(
        lib,
        [issue.a, issue.b],
        lib.PathBooleanOperation.Exclusion,
    );
    issueResults[label] = result;
    write(
        `issue-${label}`,
        `Issue 3 exclusion ${label}`,
        resultSvg(lib, result, color, issueBox),
    );
}
const closed = (paths) =>
    paths.every((p) =>
        p.every((s, i) => {
            const next = p[(i + 1) % p.length][1],
                end = s.at(-1);
            return next[0] === end[0] && next[1] === end[1];
        }),
    );
assert.equal(closed(issueResults.before), false);
assert.equal(closed(issueResults.after), true);

// A signed-gap plot, with independently derived gap t*(1e-5 - t/2).
// The dots are the solver's reported parameters; the curve is the exact formula.
const qa = ["Q", [0, 0], [0.5, 0], [1, 1]],
    qb = ["Q", [0, 0], [0.5, 5e-6], [1, 0.50001]];
const px = (t) => 60 + (t / 2e-5) * 350,
    py = (gap) => 230 - (gap / 5e-11) * 160;
let line = "";
for (let i = 0; i <= 100; i++) {
    const t = (2e-5 * i) / 100;
    line += `${i ? "L" : "M"}${px(t)} ${py(t * (1e-5 - t / 2))} `;
}
const axes = `<g font-family="sans-serif" font-size="13" fill="#4b5563"><path d="M60 40 V230 H440" fill="none" stroke="#9ca3af"/><text x="55" y="255">0</text><text x="220" y="255">0.00001</text><text x="382" y="255">0.00002</text><text x="440" y="280">t</text><text x="16" y="27">Vertical gap: B − A</text><text x="9" y="75">5e−11</text><text x="39" y="234">0</text></g><path d="${line}" fill="none" stroke="${blue}" stroke-width="3"/>`;
const roots = {};
for (const [label, lib, color] of [
    ["before", before, red],
    ["after", after, green],
]) {
    roots[label] = lib.pathSegmentIntersection(qa, qb, {
        point: 1e-6,
        linear: 1e-4,
        param: 1e-8,
        collinear: 0,
    });
    write(
        `crossing-${label}`,
        `Reported roots ${label}: ${roots[label].length}`,
        axes +
            roots[label]
                .map(
                    ([t]) =>
                        `<circle cx="${px(t)}" cy="230" r="6" fill="${color}" stroke="white" stroke-width="2"/>`,
                )
                .join(""),
    );
}
assert.equal(roots.before.length, 1);
assert.equal(roots.after.length, 2);
fs.writeFileSync(
    "docs/updates/2026-09-12/demos.json",
    JSON.stringify(
        {
            beforeRevision,
            afterRevision,
            smoothPath: smooth,
            longRectangleHeight: 1e9,
            roots,
            issue3Closed: { before: false, after: true },
        },
        null,
        2,
    ) + "\n",
);
console.log("Wrote eleven SVG figures and their revision metadata.");
