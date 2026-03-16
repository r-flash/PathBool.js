#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import * as cheerio from "cheerio";
import { globSync } from "glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const OPERATION_NAMES = [
    "union",
    "difference",
    "intersection",
    "exclusion",
    "division",
    "fracture",
];

function parseList(values) {
    if (!values) return [];
    const raw = Array.isArray(values) ? values : [values];
    return raw.flatMap((value) =>
        value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
    );
}

function parseIntegerAtLeast(value, fallback, optionName, minValue) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minValue) {
        throw new Error(
            `Expected an integer >= ${minValue} for --${optionName}.`,
        );
    }
    return parsed;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegex(pattern) {
    const escaped = pattern
        .split("*")
        .map((chunk) => escapeRegex(chunk).replace(/\\\?/g, "."))
        .join(".*");
    return new RegExp(`^${escaped}$`);
}

function normalizeCaseName(rootDir, filePath) {
    const relativePath = path.relative(rootDir, filePath);
    const folder = path.dirname(relativePath);
    if (folder === ".") {
        return path.basename(filePath, path.extname(filePath));
    }
    return folder.split(path.sep).join("/");
}

function chooseFillRule($element, PathBool) {
    const fillRule = ($element.css("fill-rule") ?? $element.attr("fill-rule"))
        ?.toLowerCase()
        .trim();
    return fillRule === "evenodd"
        ? PathBool.FillRule.EvenOdd
        : PathBool.FillRule.NonZero;
}

async function loadCase(filePath, rootDir, idA, idB, PathBool) {
    const svg = await fs.readFile(filePath, "utf8");
    const $ = cheerio.load(svg, { xml: true });
    const $a = $(`#${idA}`);
    const $b = $(`#${idB}`);

    if ($a.length === 0) {
        throw new Error(`Missing element with id "${idA}" in ${filePath}.`);
    }
    if ($b.length === 0) {
        throw new Error(`Missing element with id "${idB}" in ${filePath}.`);
    }

    const pathDataA = $a.attr("d");
    const pathDataB = $b.attr("d");

    if (!pathDataA) {
        throw new Error(
            `Element "${idA}" is missing a "d" attribute in ${filePath}.`,
        );
    }
    if (!pathDataB) {
        throw new Error(
            `Element "${idB}" is missing a "d" attribute in ${filePath}.`,
        );
    }

    return {
        name: normalizeCaseName(rootDir, filePath),
        filePath,
        a: PathBool.pathFromPathData(pathDataA),
        b: PathBool.pathFromPathData(pathDataB),
        aFillRule: chooseFillRule($a, PathBool),
        bFillRule: chooseFillRule($b, PathBool),
    };
}

function matchCaseName(name, patterns) {
    if (patterns.length === 0) return true;
    return patterns.some((pattern) => {
        if (pattern.includes("*") || pattern.includes("?")) {
            return wildcardToRegex(pattern).test(name);
        }
        return name === pattern;
    });
}

function formatMs(value) {
    return value.toFixed(3);
}

function formatOpsPerSec(avgMs) {
    return (1000 / avgMs).toFixed(2);
}

function printTable(headers, rows) {
    const widths = headers.map((header, i) =>
        Math.max(header.length, ...rows.map((row) => String(row[i]).length)),
    );
    const renderRow = (row) =>
        row.map((value, i) => String(value).padEnd(widths[i], " ")).join("  ");
    console.log(renderRow(headers));
    console.log(widths.map((width) => "-".repeat(width)).join("  "));
    for (const row of rows) {
        console.log(renderRow(row));
    }
}

function benchmarkCaseOperation(
    PathBool,
    input,
    operation,
    iterations,
    warmup,
) {
    let sink = 0;
    for (let i = 0; i < warmup; i++) {
        sink += PathBool.pathBoolean(
            input.a,
            input.aFillRule,
            input.b,
            input.bFillRule,
            operation,
        ).length;
    }

    let totalMs = 0;
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        const result = PathBool.pathBoolean(
            input.a,
            input.aFillRule,
            input.b,
            input.bFillRule,
            operation,
        );
        const elapsed = performance.now() - t0;
        totalMs += elapsed;
        minMs = Math.min(minMs, elapsed);
        maxMs = Math.max(maxMs, elapsed);
        sink += result.length;
    }

    return {
        totalMs,
        minMs,
        maxMs,
        avgMs: totalMs / iterations,
        iterations,
        sink,
    };
}

function usage() {
    console.log(`Usage:
  npm run bench -- [options] [caseNameOrPattern...]

Options:
  --root <dir>          Root folder that contains benchmark SVG cases (default: bench/fixtures).
  --file <name>         SVG file name to load per case (default: original.svg).
  --id-a <id>           ID of first input element (default: a).
  --id-b <id>           ID of second input element (default: b).
  --cases <list>        Comma-separated and/or repeated case names or wildcards.
  --grep <regex>        Regex filter applied to case names.
  --ops <list>          Comma-separated operation subset.
  --iterations <n>      Timed iterations per case/op (default: 20).
  --warmup <n>          Warmup iterations per case/op (default: 5).
  --json                Print JSON result payload.
  --json-file <path>    Write JSON result payload to a file.
`);
}

async function main() {
    const parsed = parseArgs({
        allowPositionals: true,
        options: {
            root: { type: "string", short: "r" },
            file: { type: "string" },
            "id-a": { type: "string" },
            "id-b": { type: "string" },
            cases: { type: "string", short: "c", multiple: true },
            grep: { type: "string", short: "g" },
            ops: { type: "string", short: "o", multiple: true },
            iterations: { type: "string", short: "n" },
            warmup: { type: "string", short: "w" },
            json: { type: "boolean" },
            "json-file": { type: "string" },
            help: { type: "boolean", short: "h" },
        },
    });

    if (parsed.values.help) {
        usage();
        return;
    }

    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(thisDir, "..");
    const modulePath = path.resolve(projectRoot, "dist/path-bool.js");

    let PathBool;
    try {
        PathBool = await import(pathToFileURL(modulePath).href);
    } catch (_error) {
        throw new Error(
            `Failed to load ${modulePath}. Run "npm run build" first.`,
        );
    }

    const rootDir = path.resolve(parsed.values.root ?? "bench/fixtures");
    const fileName = parsed.values.file ?? "original.svg";
    const idA = parsed.values["id-a"] ?? "a";
    const idB = parsed.values["id-b"] ?? "b";
    const iterations = parseIntegerAtLeast(
        parsed.values.iterations,
        20,
        "iterations",
        1,
    );
    const warmup = parseIntegerAtLeast(parsed.values.warmup, 5, "warmup", 0);

    const selectedOps = parseList(parsed.values.ops).map((name) =>
        name.toLowerCase(),
    );
    const operationsToRun =
        selectedOps.length === 0 ? OPERATION_NAMES : selectedOps;
    const invalidOps = operationsToRun.filter(
        (name) => !OPERATION_NAMES.includes(name),
    );
    if (invalidOps.length > 0) {
        throw new Error(`Unknown operation(s): ${invalidOps.join(", ")}.`);
    }

    const nameFilters = [
        ...parseList(parsed.values.cases),
        ...parsed.positionals,
    ];
    const grepFilter = parsed.values.grep
        ? new RegExp(parsed.values.grep)
        : null;

    const candidateFiles = globSync(`**/${fileName}`, {
        cwd: rootDir,
        nodir: true,
        ignore: ["**/test-results/**"],
    }).map((relativePath) => path.join(rootDir, relativePath));

    if (candidateFiles.length === 0) {
        throw new Error(`No "${fileName}" files found in ${rootDir}.`);
    }

    const allCases = await Promise.all(
        candidateFiles.map((filePath) =>
            loadCase(filePath, rootDir, idA, idB, PathBool),
        ),
    );

    const selectedCases = allCases
        .filter((entry) => matchCaseName(entry.name, nameFilters))
        .filter((entry) => (grepFilter ? grepFilter.test(entry.name) : true))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (selectedCases.length === 0) {
        throw new Error("No benchmark cases matched the provided filters.");
    }

    const operationMap = {
        union: PathBool.PathBooleanOperation.Union,
        difference: PathBool.PathBooleanOperation.Difference,
        intersection: PathBool.PathBooleanOperation.Intersection,
        exclusion: PathBool.PathBooleanOperation.Exclusion,
        division: PathBool.PathBooleanOperation.Division,
        fracture: PathBool.PathBooleanOperation.Fracture,
    };

    console.log(
        `Benchmarking ${selectedCases.length} case(s), ${operationsToRun.length} operation(s), iterations=${iterations}, warmup=${warmup}.`,
    );

    const runStarted = performance.now();
    const results = [];
    let sink = 0;

    for (const input of selectedCases) {
        for (const opName of operationsToRun) {
            const summary = benchmarkCaseOperation(
                PathBool,
                input,
                operationMap[opName],
                iterations,
                warmup,
            );
            sink += summary.sink;
            results.push({
                caseName: input.name,
                operation: opName,
                ...summary,
            });
        }
    }

    const runElapsedMs = performance.now() - runStarted;

    printTable(
        ["Case", "Operation", "Avg (ms)", "Min (ms)", "Max (ms)", "Ops/s"],
        results.map((result) => [
            result.caseName,
            result.operation,
            formatMs(result.avgMs),
            formatMs(result.minMs),
            formatMs(result.maxMs),
            formatOpsPerSec(result.avgMs),
        ]),
    );

    const aggregateByOperation = operationsToRun.map((operation) => {
        const grouped = results.filter(
            (result) => result.operation === operation,
        );
        const totalMs = grouped.reduce((acc, item) => acc + item.totalMs, 0);
        const totalIters = grouped.reduce(
            (acc, item) => acc + item.iterations,
            0,
        );
        const minMs = Math.min(...grouped.map((item) => item.minMs));
        const maxMs = Math.max(...grouped.map((item) => item.maxMs));
        const avgMs = totalMs / totalIters;
        return { operation, totalMs, totalIters, avgMs, minMs, maxMs };
    });

    console.log("");
    printTable(
        ["Operation", "Avg (ms)", "Min (ms)", "Max (ms)", "Ops/s"],
        aggregateByOperation.map((result) => [
            result.operation,
            formatMs(result.avgMs),
            formatMs(result.minMs),
            formatMs(result.maxMs),
            formatOpsPerSec(result.avgMs),
        ]),
    );

    const totalTimedMs = results.reduce(
        (acc, result) => acc + result.totalMs,
        0,
    );
    const totalTimedIters = results.reduce(
        (acc, result) => acc + result.iterations,
        0,
    );
    console.log("");
    console.log(
        `Total: avg=${formatMs(totalTimedMs / totalTimedIters)} ms/op, timed=${formatMs(totalTimedMs)} ms, wall=${formatMs(runElapsedMs)} ms.`,
    );

    // Keep a visible dependency on benchmark outputs.
    if (sink === Number.MIN_SAFE_INTEGER) {
        console.log("Impossible sink:", sink);
    }

    const payload = {
        config: {
            rootDir,
            fileName,
            idA,
            idB,
            iterations,
            warmup,
            operations: operationsToRun,
            cases: selectedCases.map((entry) => entry.name),
        },
        summary: {
            timedTotalMs: totalTimedMs,
            wallTotalMs: runElapsedMs,
            averageMsPerOperation: totalTimedMs / totalTimedIters,
        },
        byOperation: aggregateByOperation,
        results,
    };

    if (parsed.values["json-file"]) {
        const jsonPath = path.resolve(parsed.values["json-file"]);
        await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
        console.log(`Wrote JSON report to ${jsonPath}`);
    }

    if (parsed.values.json) {
        console.log("");
        console.log(JSON.stringify(payload, null, 2));
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
