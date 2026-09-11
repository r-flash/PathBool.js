import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildCorpus } from "./build-corpus.mjs";
import {
    DEFAULT_CACHE,
    DEFAULT_MANIFEST,
    readManifest,
    atomicJson,
} from "./corpus/collect.mjs";
import { hash } from "./corpus/extract.mjs";
import { EvaluatorProcess } from "./corpus/process.cjs";

const { values } = parseArgs({
    options: {
        manifest: { type: "string", default: DEFAULT_MANIFEST },
        cache: { type: "string", default: DEFAULT_CACHE },
        timeout: { type: "string", default: "10000" },
        limit: { type: "string" },
        cases: { type: "string" },
    },
});
const timeout = Number(values.timeout),
    limit = values.limit === undefined ? Infinity : Number(values.limit);
if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    !(limit === Infinity || (Number.isSafeInteger(limit) && limit > 0))
)
    throw new Error("Invalid timeout or limit");
const manifest = await readManifest(values.manifest);
if (!manifest.sources.length)
    throw new Error(
        "No artwork manifest. Run npm run scrape-paths -- --count 300 first.",
    );
await buildCorpus();
const workers = Object.fromEntries(
    ["development", "production"].map((mode) => [
        mode,
        new EvaluatorProcess(mode, { timeout }),
    ]),
);
const report = {
    manifest: values.manifest,
    timeout,
    results: [],
    failures: 0,
    excluded: 0,
    cases: 0,
};
const ops = [
    "union",
    "difference",
    "intersection",
    "exclusion",
    "division",
    "fracture",
];
const expectedFile = path.join(
    path.dirname(values.manifest),
    "expected-failures.json",
);
const expected = await readFile(expectedFile, "utf8")
    .then(JSON.parse)
    .catch((e) => {
        if (e.code === "ENOENT") return {};
        throw e;
    });
const selected = new Set(values.cases?.split(",") ?? []);
try {
    const catalog = await workers.production.evaluate({
        dir: "",
        tier: "catalog",
        key: "",
    });
    if (!catalog.identities)
        throw new Error(
            catalog.failure ?? "Worker failed to supply identity list",
        );
    for (const source of manifest.sources) {
        let raw;
        try {
            raw = await readFile(
                path.join(values.cache, "raw", `${source.sha256}.svg`),
            );
        } catch {
            throw new Error(
                `Missing cached source ${source.id}; run npm run scrape-paths -- --replay`,
            );
        }
        if (hash(raw) !== source.sha256)
            throw new Error(`Cached source hash mismatch: ${source.id}`);
        for (let i = 0; i < source.cases.length; i++) {
            const id = `${source.id}/${String(i).padStart(2, "0")}`;
            if (selected.size && !selected.has(id)) continue;
            if (report.cases >= limit) break;
            const dir = path.join(values.cache, "fixtures", id);
            const meta = JSON.parse(
                await readFile(path.join(dir, "case.json"), "utf8"),
            );
            if (
                JSON.stringify({ ...meta, source: undefined }) !==
                JSON.stringify(source.cases[i])
            )
                throw new Error(
                    `Fixture recipe mismatch: ${id}; replay the manifest`,
                );
            report.cases++;
            for (const mode of ["development", "production"]) {
                for (const tier of ["tier0", "algebraic", "raster"]) {
                    if (mode === "development" && tier !== "tier0") continue;
                    for (const key of tier === "algebraic"
                        ? catalog.identities
                        : ops) {
                        const outcome = await workers[mode].evaluate({
                            dir,
                            tier,
                            key,
                        });
                        const name = `${mode}/${tier}/${key}`,
                            reason = expected[id]?.[name];
                        const status =
                            outcome.kind === "excluded"
                                ? "excluded"
                                : reason
                                  ? outcome.failure
                                      ? "expected-failure"
                                      : "unexpected-pass"
                                  : outcome.failure
                                    ? "failure"
                                    : "pass";
                        if (
                            status === "failure" ||
                            status === "unexpected-pass"
                        )
                            report.failures++;
                        if (status === "excluded") report.excluded++;
                        report.results.push({
                            id,
                            mode,
                            tier,
                            key,
                            status,
                            ...outcome,
                            ...(reason ? { expectedReason: reason } : {}),
                            reproduce: `npm run test:artwork-corpus -- --cases ${id} --timeout ${timeout}`,
                        });
                    }
                }
            }
            console.log(
                `${id}: ${report.cases} cases, ${report.failures} findings`,
            );
            await atomicJson(
                path.join(values.cache, "test-report.json"),
                report,
            );
        }
        if (report.cases >= limit) break;
    }
    if (!report.cases)
        throw new Error("No cases matched the requested selection");
} finally {
    for (const worker of Object.values(workers)) worker.close();
    await atomicJson(path.join(values.cache, "test-report.json"), report);
}
console.log(
    `${report.cases} cases; ${report.failures} findings; ${report.excluded} explicitly excluded evaluations. Report: ${values.cache}/test-report.json`,
);
if (report.failures) process.exitCode = 1;
