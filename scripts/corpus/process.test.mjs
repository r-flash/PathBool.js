import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { EvaluatorProcess } from "./process.cjs";

test("untimed workers receive the untimed setting and wait for completion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "path-bool-untimed-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(worker, 'process.on("message", () => setTimeout(() => process.send({failure: process.env.PATH_BOOL_UNTIMED === "1" ? null : "timed"}), 50));');
    const evaluator = new EvaluatorProcess("development", { worker, timeout: 0 });
    try {
        assert.equal((await evaluator.evaluate({})).failure, null);
    } finally {
        evaluator.close();
        await rm(dir, { recursive: true, force: true });
    }
});

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
