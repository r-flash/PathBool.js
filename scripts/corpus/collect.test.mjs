import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    collect,
    commonsCandidate,
    commonsDiscovery,
    httpClient,
} from "./collect.mjs";

const sample = '<svg><path d="M0 0L20 0L20 20Z"/></svg>';
const candidate = (n) => ({
    id: `commons-${n}`,
    author: `author-${n}`,
    downloadUrl: `https://example.test/${n}`,
    rights: { license: "CC0" },
});
async function* candidates(n) {
    for (let i = 0; i < n; i++) yield candidate(i);
}

test("manifest replay, extension, duplicate sources and byte verification", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "path-bool-collect-"));
    const manifestFile = path.join(temp, "manifest.json"),
        cache = path.join(temp, "cache");
    let downloads = 0;
    const get = async (url) => {
        downloads++;
        return Buffer.from(
            sample.replace("20 0", `${20 + Number(url.split("/").at(-1))} 0`),
        );
    };
    try {
        const first = await collect({
            count: 2,
            manifestFile,
            cache,
            get,
            discover: candidates(3),
            log: () => {},
        });
        assert.equal(first.total, 2);
        const original = JSON.parse(await readFile(manifestFile, "utf8"));
        await collect({
            count: 3,
            manifestFile,
            cache,
            get,
            discover: candidates(4),
            log: () => {},
        });
        const extended = JSON.parse(await readFile(manifestFile, "utf8"));
        assert.deepEqual(extended.sources.slice(0, 2), original.sources);
        const prior = downloads;
        assert.equal(
            (
                await collect({
                    replay: true,
                    manifestFile,
                    cache,
                    get,
                    log: () => {},
                })
            ).shortfall,
            0,
        );
        assert.equal(downloads, prior);
        await writeFile(
            path.join(cache, "raw", `${original.sources[0].sha256}.svg`),
            "wrong bytes",
        );
        const bad = await collect({
            replay: true,
            manifestFile,
            cache,
            get,
            log: () => {},
        });
        assert.equal(bad.failures.length, 1);
        assert.match(bad.failures[0].reason, /Hash mismatch/);
        assert.equal(bad.shortfall, 1);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test("identical artwork bytes are accepted only once", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "path-bool-duplicates-"));
    try {
        const report = await collect({
            count: 2,
            manifestFile: path.join(temp, "manifest.json"),
            cache: path.join(temp, "cache"),
            get: async () => Buffer.from(sample),
            discover: candidates(3),
            log: () => {},
        });
        assert.equal(report.total, 1);
        assert.equal(report.shortfall, 1);
        assert.equal(report.excluded.length, 2);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test("rights filters and MediaWiki continuation", async () => {
    const page = (n) => ({
        pageid: n,
        imageinfo: [
            {
                mime: "image/svg+xml",
                url: "https://example.test/a.svg",
                extmetadata: {
                    LicenseShortName: { value: "Public domain" },
                    License: { value: "pd-self" },
                },
            },
        ],
    });
    assert.ok(commonsCandidate(page(1)));
    const ccby = page(2);
    ccby.imageinfo[0].extmetadata.LicenseShortName.value = "CC BY 4.0";
    assert.equal(commonsCandidate(ccby), null);
    const ambiguous = page(3);
    delete ambiguous.imageinfo[0].extmetadata.License;
    assert.equal(commonsCandidate(ambiguous), null);
    const urls = [];
    const get = async (url) => {
        urls.push(url);
        return Buffer.from(
            JSON.stringify(
                urls.length === 1
                    ? {
                          query: { pages: { 1: page(1) } },
                          continue: { gsroffset: 50 },
                      }
                    : { query: { pages: { 2: page(2) } } },
            ),
        );
    };
    const found = [];
    for await (const c of commonsDiscovery(get, {
        queries: ["ornament"],
        maxPages: 3,
    }))
        found.push(c);
    assert.equal(found.length, 2);
    assert.match(urls[1], /gsroffset=50/);
});

test("HTTP retry honors throttling, rejects oversized data and recovers interrupted streams", async () => {
    let requests = 0;
    const pauses = [];
    const get = httpClient({
        interval: 0,
        pause: async (ms) => pauses.push(ms),
        fetcher: async () =>
            ++requests === 1
                ? new Response("busy", {
                      status: 429,
                      headers: { "retry-after": "2" },
                  })
                : new Response("ok"),
    });
    assert.equal((await get("https://example.test")).toString(), "ok");
    assert.ok(pauses.includes(2000));
    await assert.rejects(
        httpClient({
            interval: 0,
            pause: async () => {},
            maxBytes: 1,
            fetcher: async () => new Response("too big"),
        })("https://example.test"),
        /exceeds/,
    );
    let attempts = 0;
    const interrupted = httpClient({
        interval: 0,
        pause: async () => {},
        fetcher: async () =>
            ++attempts === 1
                ? new Response(
                      new ReadableStream({
                          start(c) {
                              c.error(new Error("interrupted"));
                          },
                      }),
                  )
                : new Response("complete"),
    });
    assert.equal(
        (await interrupted("https://example.test")).toString(),
        "complete",
    );
});
