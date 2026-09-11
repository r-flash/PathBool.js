import { EvaluatorProcess } from "../../../scripts/corpus/process.cjs";
import type { EvaluationTier } from "../../../scripts/corpus/process.cjs";

const workers = new Map<string, InstanceType<typeof EvaluatorProcess>>();

export async function isolated(
    dir: string,
    tier: EvaluationTier,
    key: string,
): Promise<string | null> {
    const mode = tier === "tier0" ? "development" : "production";
    if (!workers.has(mode)) workers.set(mode, new EvaluatorProcess(mode));
    const result = await workers.get(mode)!.evaluate({ dir, tier, key });
    return result.failure;
}

export function closeWorkers() {
    for (const worker of workers.values()) worker.close();
    workers.clear();
}
