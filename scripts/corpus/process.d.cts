export type BuildMode = "development" | "production";
export type EvaluationTier = "structural" | "raster" | "algebraic" | "equivalence";

export type EvaluationJob =
    | { dir: string; tier: EvaluationTier; key: string }
    | { dir: string; tier: "catalog"; key?: never };

export interface EvaluationResult {
    failure: string | null;
    elapsedMs: number;
    kind?: "pass" | "oracle" | "exception" | "excluded" | "worker" | "timeout";
    reason?: string;
    identities?: string[];
}

export interface EvaluatorOptions {
    /** Zero disables the watchdog and computation-duration checks. */
    timeout?: number;
    worker?: string;
}

/** A sequential corpus worker with an optional per-job deadline. */
export class EvaluatorProcess {
    constructor(mode: BuildMode, options?: EvaluatorOptions);
    mode: BuildMode;
    timeout: number;
    worker: string;
    evaluate(job: EvaluationJob): Promise<EvaluationResult>;
    run(job: EvaluationJob): Promise<EvaluationResult>;
    close(): void;
}
