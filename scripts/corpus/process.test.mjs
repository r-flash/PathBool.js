import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { EvaluatorProcess } from "./process.cjs";

test("kills a synchronous hang and processes the next job in a fresh worker", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "path-bool-worker-")),
        worker = path.join(dir, "worker.cjs");
    await writeFile(
        worker,
        'process.on("message", job => { if(job.hang) while(true) {} else process.send({failure:null}); });',
    );
    const evaluator = new EvaluatorProcess("development", {
        worker,
        timeout: 300,
    });
    try {
        assert.equal(
            (await evaluator.evaluate({ hang: true })).kind,
            "timeout",
        );
        assert.equal((await evaluator.evaluate({ hang: false })).failure, null);
    } finally {
        evaluator.close();
        await rm(dir, { recursive: true, force: true });
    }
});
