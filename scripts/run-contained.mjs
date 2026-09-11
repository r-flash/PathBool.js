// The service is a sibling of the invoking application, so its memory limit
// includes test workers and native renderers without including the IDE.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const command = process.argv.slice(2);
if (!command.length) throw new Error("Usage: node scripts/run-contained.mjs <command> [arguments]");
if (process.platform !== "linux") throw new Error("Memory-contained validation requires Linux and a systemd user manager");
const available = Number(readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
const memory = 2 * 1024 ** 3;
if (!(available > memory + 512 * 1024 ** 2))
    throw new Error("Insufficient available memory to reserve the test budget and parent-process headroom");
const result = spawnSync("systemd-run", ["--user", "--wait", "--pipe", "--collect",
    "-p", `WorkingDirectory=${process.cwd()}`, "-p", `MemoryMax=${memory}`,
    "-p", "MemorySwapMax=0", "-p", "OOMPolicy=kill", "--", ...command], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) console.error("Validation did not complete successfully. For OOM or interruption, inspect the last start record in the correctness log; it remains an unresolved case.");
process.exitCode = result.status ?? 1;
