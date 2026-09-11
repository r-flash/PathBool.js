import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

import {
    extract,
    selectPairs,
    materializePair,
    hash,
    EXTRACTION_VERSION,
} from "./extract.mjs";

export const QUERIES = [
    "flower ornament",
    "animal silhouette",
    "lettering calligraphy",
    "map geography",
    "diagram science",
    "symbol sign",
    "plant botanical",
    "decorative border",
    "illustration cartoon",
    "geometric pattern",
];
export const DEFAULT_MANIFEST = "src/__fixtures__/artworks/manifest.json";
export const DEFAULT_CACHE = ".cache/path-bool/artworks";
export const emptyManifest = () => ({
    version: 1,
    extractionVersion: EXTRACTION_VERSION,
    selectionVersion: 1,
    queries: QUERIES,
    authorLimit: 5,
    sources: [],
});
export const json = (value) => JSON.stringify(value, null, 4) + "\n";

export async function atomicJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, json(value));
    await rename(temp, file);
}

/** Serial HTTP requests, including retries and body reads. No retry can bypass pacing. */
export function httpClient({
    fetcher = fetch,
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    random = Math.random,
    interval = 2000,
    maxBytes = 8 * 1024 * 1024,
} = {}) {
    let next = 0,
        queue = Promise.resolve(),
        halted;
    async function request(url, headers) {
        if (halted) throw halted;
        for (let attempt = 0; attempt < 4; attempt++) {
            // Chunk long server delays so Node's timer range cannot shorten them.
            let wait = Math.max(0, next - now());
            while (wait > 60000) {
                await pause(60000);
                wait -= 60000;
            }
            await pause(wait);
            next = now() + interval;
            let retryAfter, failure;
            try {
                const response = await fetcher(url, {
                    headers: {
                        "User-Agent":
                            "PathBoolCorpus/1.0 (https://github.com/r-flash/PathBool.js)",
                        ...headers,
                    },
                    signal: AbortSignal.timeout(30000),
                });
                retryAfter = response.headers.get("retry-after");
                if (!response.ok) {
                    await response.body?.cancel();
                    const error = new Error(`HTTP ${response.status}: ${url}`);
                    error.permanent =
                        response.status !== 429 && response.status < 500;
                    if (response.status === 401 || response.status === 403) {
                        halted = Object.assign(error, { code: "HTTP_CIRCUIT" });
                    }
                    throw error;
                }
                if (Number(response.headers.get("content-length")) > maxBytes) {
                    await response.body?.cancel();
                    throw Object.assign(
                        new Error(`Download exceeds ${maxBytes} bytes`),
                        { permanent: true },
                    );
                }
                const chunks = [];
                let size = 0;
                for await (const chunk of response.body) {
                    size += chunk.length;
                    if (size > maxBytes)
                        throw Object.assign(
                            new Error(`Download exceeds ${maxBytes} bytes`),
                            { permanent: true },
                        );
                    chunks.push(chunk);
                }
                const bytes = Buffer.concat(chunks);
                // MediaWiki can return load-shedding errors with HTTP 200.
                if (new URL(url).hostname === "commons.wikimedia.org") {
                    let data;
                    try {
                        data = JSON.parse(bytes.toString());
                    } catch {
                        /* Non-JSON download. */
                    }
                    if (data?.error) {
                        const error = new Error(
                            `Commons API: ${data.error.code}: ${data.error.info}`,
                        );
                        error.permanent = !["maxlag", "ratelimited"].includes(
                            data.error.code,
                        );
                        throw error;
                    }
                }
                return bytes;
            } catch (error) {
                if (error.permanent) throw error;
                failure = error;
            }
            // Never shorten Retry-After. Invalid/missing values use jittered backoff.
            const delay =
                retryAfter && /^\d+$/.test(retryAfter)
                    ? Number(retryAfter) * 1000
                    : Date.parse(retryAfter) - now();
            const backoff = 5000 * 2 ** attempt + random() * 1000;
            next = Math.max(
                next,
                now() + (Number.isFinite(delay) ? Math.max(0, delay) : backoff),
            );
            if (attempt === 3) {
                halted = Object.assign(
                    new Error(
                        `HTTP circuit stopped after four attempts: ${failure.message}`,
                    ),
                    { code: "HTTP_CIRCUIT" },
                );
                throw halted;
            }
        }
    }
    return (url, headers = {}) => {
        const result = queue.then(() => request(url, headers));
        queue = result.catch(() => {});
        return result;
    };
}

/** Public discovery snapshots expire after a day; revision-keyed downloads do not. */
export function cachedReader(
    get,
    directory,
    { ttl = Infinity, now = Date.now } = {},
) {
    return async (url, revision = "") => {
        const file = path.join(
            directory,
            `${hash(Buffer.from(json([url, revision])))}.json`,
        );
        try {
            const saved = JSON.parse(await readFile(file, "utf8"));
            const bytes = Buffer.from(saved.bytes, "base64");
            if (now() - saved.savedAt < ttl && hash(bytes) === saved.sha256)
                return bytes;
        } catch (error) {
            if (error.code && error.code !== "ENOENT") throw error;
        }
        const bytes = await get(url);
        await atomicJson(file, {
            savedAt: now(),
            sha256: hash(bytes),
            bytes: bytes.toString("base64"),
        });
        return bytes;
    };
}

export function commonsCandidate(page) {
    if (!Number.isSafeInteger(page.pageid) || page.pageid < 1) return null;
    const info = page.imageinfo?.[0],
        meta = info?.extmetadata ?? {};
    if (info?.mime !== "image/svg+xml") return null;
    const value = (k) => meta[k]?.value ?? "";
    const license = value("LicenseShortName"),
        url = value("LicenseUrl"),
        code = value("License");
    const cc0 =
        /^CC0(?: 1\.0)?$/i.test(license) ||
        /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/i.test(
            url,
        );
    const pd = /^Public domain$/i.test(license) && /^pd(?:-|$)/i.test(code);
    if (!cc0 && !pd) return null;
    if (value("Copyrighted") === "True" && !cc0) return null;
    if (
        /copyright violations|disputed copyright|deletion requests/i.test(
            value("Categories"),
        )
    )
        return null;
    return {
        id: `commons-${page.pageid}`,
        source: "commons",
        title: page.title,
        pageUrl: info.descriptionurl,
        downloadUrl: info.url,
        revision: info.timestamp,
        sourceSha1: info.sha1,
        author:
            value("Artist")
                .replace(/<[^>]*>/g, "")
                .trim() || "unknown",
        rights: { license, code, url, evidence: meta },
        bytes: info.size,
    };
}

export async function* commonsDiscovery(
    get,
    { queries = QUERIES, maxPages = 10, onReject = () => {} } = {},
) {
    const states = queries.map((query) => ({ query, offset: 0, done: false }));
    for (let round = 0; round < maxPages; round++)
        for (const state of states) {
            if (state.done) continue;
            const u = new URL("https://commons.wikimedia.org/w/api.php");
            u.search = new URLSearchParams({
                action: "query",
                format: "json",
                generator: "search",
                gsrnamespace: "6",
                gsrlimit: "50",
                gsrsearch: `filetype:drawing ${state.query}`,
                gsroffset: String(state.offset),
                prop: "imageinfo",
                iiprop: "url|timestamp|sha1|mime|size|extmetadata",
                iilimit: "1",
                maxlag: "5",
            });
            const response = JSON.parse((await get(u.href)).toString());
            if (response.error)
                throw new Error(
                    `Commons API: ${response.error.code}: ${response.error.info}`,
                );
            const pages = Object.values(response.query?.pages ?? {}).sort(
                (a, b) => (a.index ?? 0) - (b.index ?? 0),
            );
            for (const page of pages) {
                const candidate = commonsCandidate(page);
                if (candidate) yield { ...candidate, query: state.query };
                else
                    onReject({
                        id: `commons-${page.pageid}`,
                        kind: "rights-or-format",
                        reason: "Not an SVG with unambiguous public-domain/CC0 metadata.",
                    });
            }
            const next = response.continue?.gsroffset;
            state.done = next === undefined;
            state.offset = next;
        }
}

export async function readManifest(file) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return emptyManifest();
        throw error;
    }
}

function featureKeys(paths) {
    return [
        ...new Set(
            paths.flatMap((p) => [
                `complexity:${p.features.complexity}`,
                `fill:${p.fillRule}`,
                `context:${p.context}`,
                ...Object.entries(p.features.commands)
                    .filter(([, n]) => n)
                    .map(([k]) => `command:${k}`),
                ...(p.features.subpaths > 1 ? ["compound"] : []),
                ...(p.features.open ? ["open"] : []),
                ...(p.features.collapsed ? ["collapsed"] : []),
                ...(p.features.closedCurves ? ["closed-cubic"] : []),
                p.features.extent < 1
                    ? "scale:tiny"
                    : p.features.extent > 10000
                      ? "scale:large"
                      : "scale:ordinary",
            ]),
        ),
    ];
}

export async function materialize(entry, bytes, cache, parsed) {
    if (hash(bytes) !== entry.sha256)
        throw new Error(`Hash mismatch for ${entry.id}`);
    const extracted = parsed ?? extract(bytes.toString("utf8"));
    const pairs = selectPairs(extracted.paths);
    const recipes = pairs.map((p) => materializePair(p));
    if (
        entry.cases &&
        json(recipes.map((r) => r.metadata)) !== json(entry.cases)
    )
        throw new Error(
            `Extraction recipe changed for ${entry.id}; explicit manifest migration required`,
        );
    for (let i = 0; i < recipes.length; i++) {
        const dir = path.join(
            cache,
            "fixtures",
            entry.id,
            String(i).padStart(2, "0"),
        );
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "original.svg"), recipes[i].original);
        await writeFile(path.join(dir, "oracle.svg"), recipes[i].oracle);
        await atomicJson(path.join(dir, "case.json"), {
            source: entry.id,
            ...recipes[i].metadata,
        });
    }
    return { extracted, recipes };
}

export async function collect({
    count = 300,
    replay = false,
    manifestFile = DEFAULT_MANIFEST,
    cache = DEFAULT_CACHE,
    get = httpClient(),
    discover,
    log = console.log,
} = {}) {
    const manifest = await readManifest(manifestFile),
        report = {
            accepted: 0,
            available: 0,
            excluded: [],
            failures: [],
            coverage: {},
        };
    if (
        manifest.version !== 1 ||
        manifest.extractionVersion !== EXTRACTION_VERSION ||
        manifest.selectionVersion !== 1
    )
        throw new Error("Unsupported manifest/extraction version");
    const ids = new Set();
    for (const entry of manifest.sources) {
        if (
            !/^[a-z][a-z0-9-]*$/.test(entry.id) ||
            !/^[a-f0-9]{64}$/.test(entry.sha256) ||
            ids.has(entry.id)
        ) {
            throw new Error(
                "Invalid or duplicate source identity/hash in manifest",
            );
        }
        ids.add(entry.id);
    }
    await mkdir(path.join(cache, "raw"), { recursive: true });
    const identities = new Set(),
        hashes = new Set(),
        authors = new Map();
    const coverage = report.coverage;
    for (const key of [
        "command:L",
        "command:Q",
        "command:C",
        "command:A",
        "fill:nonzero",
        "fill:evenodd",
        "complexity:small",
        "complexity:medium",
        "complexity:large",
        "compound",
        "open",
        "collapsed",
        "closed-cubic",
        "scale:tiny",
        "scale:ordinary",
        "scale:large",
    ])
        coverage[key] = 0;
    // Existing selections are immutable; hydrate them even when extending.
    for (const entry of manifest.sources) {
        identities.add(entry.id);
        hashes.add(entry.sha256);
        authors.set(entry.author, (authors.get(entry.author) ?? 0) + 1);
        for (const key of entry.features)
            coverage[key] = (coverage[key] ?? 0) + 1;
        try {
            const file = path.join(cache, "raw", `${entry.sha256}.svg`);
            let bytes = await readFile(file).catch((e) => {
                if (e.code !== "ENOENT") throw e;
                return null;
            });
            if (!bytes) {
                bytes = await get(entry.downloadUrl);
                if (hash(bytes) !== entry.sha256)
                    throw new Error(`Hash mismatch for ${entry.id}`);
                await writeFile(file, bytes);
            }
            await materialize(entry, bytes, cache);
            report.available++;
        } catch (error) {
            report.failures.push({
                id: entry.id,
                kind: "replay",
                reason: error.message,
            });
        }
    }
    if (!replay && manifest.sources.length < count) {
        const candidates =
            discover ??
            commonsDiscovery(
                cachedReader(get, path.join(cache, "discovery"), {
                    ttl: 86400000,
                }),
                {
                    queries: manifest.queries,
                    onReject: (e) => report.excluded.push(e),
                },
            );
        // Small candidate windows allow feature-balanced selection without
        // downloading the whole catalogue. Recorded choices govern replay.
        const download = cachedReader(get, path.join(cache, "downloads"));
        let window = [];
        const flush = async () => {
            while (window.length && manifest.sources.length < count) {
                window.sort(
                    (a, b) =>
                        b.keys.reduce(
                            (s, k) => s + 1 / (1 + (coverage[k] ?? 0)),
                            0,
                        ) -
                            a.keys.reduce(
                                (s, k) => s + 1 / (1 + (coverage[k] ?? 0)),
                                0,
                            ) || a.entry.id.localeCompare(b.entry.id),
                );
                const { entry, bytes, keys, parsed } = window.shift();
                if ((authors.get(entry.author) ?? 0) >= manifest.authorLimit) {
                    report.excluded.push({
                        id: entry.id,
                        kind: "author-cap",
                        reason: "Author contribution limit",
                    });
                    continue;
                }
                const { extracted, recipes } = await materialize(
                    entry,
                    bytes,
                    cache,
                    parsed,
                );
                Object.assign(entry, {
                    features: keys,
                    extractionExclusions: extracted.exclusions,
                    cases: recipes.map((r) => r.metadata),
                    pathCount: extracted.paths.length,
                    paths: extracted.paths
                        .filter((p) =>
                            recipes.some((r) =>
                                r.metadata.operands.some(
                                    (o) => o.location === p.location,
                                ),
                            ),
                        )
                        .map((p) => ({
                            location: p.location,
                            elementId: p.elementId,
                            dHash: p.dHash,
                            matrix: p.sourceMatrix,
                            local: p.local,
                            fillRule: p.fillRule,
                            features: p.features,
                            context: p.context,
                        })),
                });
                manifest.sources.push(entry);
                authors.set(entry.author, (authors.get(entry.author) ?? 0) + 1);
                for (const key of keys)
                    coverage[key] = (coverage[key] ?? 0) + 1;
                await atomicJson(manifestFile, manifest);
                report.accepted++;
                report.available++;
                log(
                    `Accepted ${manifest.sources.length}/${count}: ${entry.id} (${entry.pathCount} paths)`,
                );
            }
        };
        try {
            for await (const candidate of candidates) {
                if (identities.has(candidate.id)) continue;
                identities.add(candidate.id);
                if (
                    (authors.get(candidate.author) ?? 0) >= manifest.authorLimit
                ) {
                    report.excluded.push({
                        id: candidate.id,
                        kind: "author-cap",
                        reason: "Author contribution limit",
                    });
                    continue;
                }
                try {
                    const bytes = await download(
                            candidate.downloadUrl,
                            json([candidate.revision, candidate.sourceSha1]),
                        ),
                        sha256 = hash(bytes);
                    if (hashes.has(sha256)) {
                        report.excluded.push({
                            id: candidate.id,
                            kind: "duplicate",
                            reason: "Identical source bytes",
                        });
                        continue;
                    }
                    const parsed = extract(bytes.toString("utf8"));
                    if (!parsed.paths.some((p) => p.features.segments)) {
                        report.excluded.push({
                            id: candidate.id,
                            kind: "extraction",
                            reason: "No supported nonempty paths",
                            details: parsed.exclusions,
                        });
                        continue;
                    }
                    hashes.add(sha256);
                    await writeFile(
                        path.join(cache, "raw", `${sha256}.svg`),
                        bytes,
                    );
                    window.push({
                        entry: {
                            ...candidate,
                            sha256,
                            retrievedAt: new Date().toISOString(),
                        },
                        bytes,
                        parsed,
                        keys: featureKeys(parsed.paths),
                    });
                    if (window.length >= 12) await flush();
                } catch (error) {
                    if (error.code === "HTTP_CIRCUIT") throw error;
                    report.excluded.push({
                        id: candidate.id,
                        kind: "download-or-extraction",
                        reason: error.message,
                    });
                }
                if (manifest.sources.length >= count) break;
            }
            await flush();
        } catch (error) {
            report.failures.push({ kind: "discovery", reason: error.message });
            await flush();
        }
    }
    report.pathCount = manifest.sources.reduce(
        (sum, entry) => sum + (entry.pathCount ?? entry.paths?.length ?? 0),
        0,
    );
    report.pairCount = manifest.sources.reduce(
        (sum, entry) => sum + (entry.cases?.length ?? 0),
        0,
    );
    report.queryCoverage = {};
    for (const entry of manifest.sources)
        report.queryCoverage[entry.query ?? "custom"] =
            (report.queryCoverage[entry.query ?? "custom"] ?? 0) + 1;
    report.selectedCoverage = {};
    for (const entry of manifest.sources)
        for (const key of featureKeys(entry.paths ?? []))
            report.selectedCoverage[key] =
                (report.selectedCoverage[key] ?? 0) + 1;
    report.selectionGaps = Object.keys(coverage).filter(
        (key) => coverage[key] > 0 && !report.selectedCoverage[key],
    );
    report.coverageGaps = Object.entries(coverage)
        .filter(([, n]) => n === 0)
        .map(([key]) => key);
    report.total = manifest.sources.length;
    report.requested = replay ? manifest.sources.length : count;
    report.shortfall = Math.max(0, report.requested - report.available);
    await atomicJson(
        path.join(
            cache,
            replay ? "replay-report.json" : "collection-report.json",
        ),
        report,
    );
    if (!manifest.sources.length) await atomicJson(manifestFile, manifest);
    return report;
}
