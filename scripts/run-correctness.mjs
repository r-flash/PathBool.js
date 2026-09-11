// Untimed checks; run this process in a memory-contained service. Results are
// appended before and after each job so an OOM cannot erase the active input.
import { globSync } from "glob";
import { createHash } from "node:crypto";
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    copyFileSync,
    existsSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { EvaluatorProcess } from "./corpus/process.cjs";

const { values } = parseArgs({
    options: {
        root: { type: "string", default: "src/__fixtures__/generated" },
        cases: { type: "string" },
        output: {
            type: "string",
            default: ".cache/path-bool/correctness.jsonl",
        },
        resume: { type: "boolean", default: false },
    },
});
const ops = [
    "union",
    "difference",
    "intersection",
    "exclusion",
    "division",
    "fracture",
];
mkdirSync(path.dirname(values.output), { recursive: true });
const completed = new Map();
const log = (entry) =>
    appendFileSync(values.output, JSON.stringify(entry) + "\n");
const selected = values.cases && new Set(values.cases.split(","));
const dirs = globSync(`${values.root}/*/*/original.svg`)
    .map(path.dirname)
    .sort()
    .filter(
        (dir) => !selected || selected.has(path.relative(values.root, dir)),
    );
if (!dirs.length) throw new Error("No fixtures matched");
const digest = createHash("sha256");
for (const file of [
    "scripts/corpus/geometry.cjs",
    "scripts/run-correctness.mjs",
    "scripts/corpus/process.cjs",
    ".cache/path-bool/build/development.mjs",
    ".cache/path-bool/build/production.mjs",
    ...dirs.flatMap((dir) =>
        globSync(
            `${dir}/{original.svg,oracle.svg,case.json,clean/original.svg}`,
        ).sort(),
    ),
]) {
    digest.update(path.resolve(file));
    digest.update(readFileSync(file));
}
const fingerprint = digest.digest("hex");
const buildDir = path.resolve(".cache/path-bool/runs", fingerprint);
mkdirSync(buildDir, { recursive: true });
for (const mode of ["development", "production"]) {
    const file = path.join(buildDir, `${mode}.mjs`);
    if (!existsSync(file))
        writeFileSync(
            file,
            readFileSync(
                `.cache/path-bool/build/${mode}.mjs`,
                "utf8",
            ).replaceAll(
                "../../../scripts/corpus/geometry.cjs",
                "./geometry.cjs",
            ),
        );
}
if (!existsSync(path.join(buildDir, "geometry.cjs")))
    copyFileSync(
        "scripts/corpus/geometry.cjs",
        path.join(buildDir, "geometry.cjs"),
    );
if (values.resume) {
    const lines = readFileSync(values.output, "utf8").trim().split("\n");
    if (JSON.parse(lines[0]).fingerprint !== fingerprint)
        throw new Error("Cannot resume: build, inputs or selection changed");
    for (const line of lines) {
        if (!line) continue;
        const entry = JSON.parse(line);
        if (entry.event === "result") completed.set(entry.id, entry.result);
    }
} else {
    writeFileSync(
        values.output,
        JSON.stringify({ event: "run", fingerprint, root: values.root }) + "\n",
        { flag: "wx" },
    );
}
const workers = Object.fromEntries(
    ["development", "production"].map((mode) => [
        mode,
        new EvaluatorProcess(mode, {
            timeout: 0,
            worker: path.join(buildDir, `${mode}.mjs`),
        }),
    ]),
);
let failures = 0;
try {
    const catalog = await workers.production.evaluate({
        dir: "",
        tier: "catalog",
    });
    if (!catalog.identities)
        throw new Error(catalog.failure ?? "Missing identities");
    for (const dir of dirs) {
        const caseId = path.relative(values.root, dir);
        for (const mode of ["development", "production"]) {
            for (const tier of mode === "development"
                ? ["structural"]
                : [
                      "structural",
                      "algebraic",
                      "raster",
                      ...(globSync(`${dir}/clean/original.svg`).length
                          ? ["equivalence"]
                          : []),
                  ]) {
                for (const key of tier === "algebraic"
                    ? catalog.identities
                    : ops) {
                    const id = `${caseId}/${mode}/${tier}/${key}`;
                    let result = completed.get(id);
                    if (!result) {
                        log({ event: "start", id, dir });
                        result = await workers[mode].evaluate({
                            dir,
                            tier,
                            key,
                        });
                        log({ event: "result", id, result });
                    }
                    if (result.failure) failures++;
                }
            }
            // An idle build retains its arrangements and native allocations.
            // Only one build is needed at a time; release it before the next.
            workers[mode].close();
        }
        console.log(`${caseId}: ${failures} cumulative failures`);
    }
} finally {
    for (const worker of Object.values(workers)) worker.close();
}
console.log(`Results: ${values.output}; failures: ${failures}`);
if (failures) process.exitCode = 1;
