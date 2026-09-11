import { parseArgs } from "node:util";

import { collect } from "./corpus/collect.mjs";

const { values } = parseArgs({
    options: {
        count: { type: "string", default: "300" },
        replay: { type: "boolean" },
        manifest: { type: "string" },
        cache: { type: "string" },
    },
});
const count = Number(values.count);
if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("--count must be a positive integer");
const report = await collect({
    count,
    replay: values.replay,
    manifestFile: values.manifest,
    cache: values.cache,
});
console.log(JSON.stringify(report, null, 2));
if (report.shortfall || report.failures.length) process.exitCode = 1;
