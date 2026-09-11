import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

test("custom generation refuses to clear an unrelated directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "path-bool-generator-"));
    try {
        await mkdir(path.join(dir, "unrelated"));
        const sentinel = path.join(dir, "unrelated", "keep.txt");
        await writeFile(sentinel, "keep me");
        await assert.rejects(
            promisify(execFile)(process.execPath, [
                "scripts/generate-corpus.mjs",
                "--out",
                dir,
            ]),
            /unrecognized/,
        );
        assert.equal(await readFile(sentinel, "utf8"), "keep me");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
