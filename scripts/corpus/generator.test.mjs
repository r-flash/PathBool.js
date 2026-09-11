import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    readdir,
    rm,
} from "node:fs/promises";
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

test("fresh fixture trees regenerate byte-for-byte, including the manifest", async () => {
    const temp = await mkdtemp(
        path.join(os.tmpdir(), "path-bool-reproducible-"),
    );
    try {
        const snapshots = [];
        for (const name of ["first", "second"]) {
            const dir = path.join(temp, name);
            await promisify(execFile)(process.execPath, [
                "scripts/generate-corpus.mjs",
                "--out",
                dir,
            ]);
            const files = (
                await readdir(dir, { recursive: true, withFileTypes: true })
            )
                .filter((entry) => entry.isFile())
                .map((entry) =>
                    path.relative(dir, path.join(entry.parentPath, entry.name)),
                )
                .sort();
            const snapshot = [];
            for (const file of files)
                snapshot.push([
                    file,
                    await readFile(path.join(dir, file), "utf8"),
                ]);
            snapshots.push(snapshot);
            assert.equal(
                JSON.parse(
                    await readFile(path.join(dir, "manifest.json"), "utf8"),
                ).caseCount,
                424,
            );
        }
        assert.equal(snapshots[0].length, 840);
        assert.deepEqual(snapshots[0], snapshots[1]);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
