import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("correctness runs snapshot helpers and reject stale resume results", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "path-bool-correctness-"));
    const runner = fileURLToPath(
        new URL("../run-correctness.mjs", import.meta.url),
    );
    const put = (name, contents) => {
        const file = path.join(cwd, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, contents);
    };
    const output = "results.jsonl";
    const run = (...extra) =>
        spawnSync(process.execPath, [runner, "--output", output, ...extra], {
            cwd,
            encoding: "utf8",
        });
    try {
        put("scripts/run-correctness.mjs", readFileSync(runner));
        put(
            "scripts/corpus/process.cjs",
            readFileSync(new URL("./process.cjs", import.meta.url)),
        );
        put("scripts/corpus/geometry.cjs", "exports.marker = 'original';");
        put("src/__fixtures__/generated/category/case/original.svg", "<svg/>");
        const worker = `import geometry from "../../../scripts/corpus/geometry.cjs";
            process.on("message", job => process.send(job.tier === "catalog"
                ? { failure: null, identities: ["identity"] }
                : { failure: null, marker: geometry.marker, source: import.meta.url }));`;
        for (const mode of ["development", "production"])
            put(`.cache/path-bool/build/${mode}.mjs`, worker);
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        const before = readFileSync(path.join(cwd, output), "utf8");
        const rows = before.trim().split("\n").map(JSON.parse);
        const results = rows.filter((row) => row.event === "result");
        assert.ok(results.length > 0);
        for (const { result } of results) {
            assert.equal(result.marker, "original");
            assert.ok(result.source.includes(`/runs/${rows[0].fingerprint}/`));
        }
        assert.equal(run("--resume").status, 0);
        assert.equal(readFileSync(path.join(cwd, output), "utf8"), before);

        // A start without a result must be retried rather than silently skipped.
        const removed = results.at(-1);
        put(
            output,
            rows
                .filter((row) => row !== removed)
                .map(JSON.stringify)
                .join("\n") + "\n",
        );
        assert.equal(run("--resume").status, 0);
        const resumed = readFileSync(path.join(cwd, output), "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert.equal(resumed.at(-1).id, removed.id);
        assert.equal(resumed.at(-1).event, "result");

        put("scripts/corpus/geometry.cjs", "exports.marker = 'changed';");
        const stale = run("--resume");
        assert.notEqual(stale.status, 0);
        assert.match(stale.stderr, /Cannot resume/);
        assert.notEqual(
            run().status,
            0,
            "fresh runs must not overwrite results",
        );
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
