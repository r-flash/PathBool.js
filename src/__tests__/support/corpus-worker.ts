import * as library from "../../index";
import { createOracle as algebraic } from "./algebraic-oracle";
import { readCaseMetadata } from "./corpus";
import { createOracle as raster } from "./raster-oracle";
import { createOracle as structural } from "./structural-oracle";

let previous: string | null = null;
let previousTier: string | null = null;
let structure: ReturnType<typeof structural>;
let pixels: ReturnType<typeof raster>;
let areas: ReturnType<typeof algebraic>;

process.on(
    "message",
    async ({ dir, tier, key }: { dir: string; tier: string; key: any }) => {
        try {
            // A completed oracle must not keep entire arrangements alive while
            // another oracle renders partitions of the same large input.
            if (dir !== previous || tier !== previousTier) {
                structure = structural(library);
                pixels = raster(library);
                areas = algebraic(library);
                previous = dir;
                previousTier = tier;
            }
            if (tier === "catalog") {
                process.send!({
                    failure: null,
                    identities: areas.IDENTITIES.map((i) => i.name),
                });
                return;
            }
            const meta = readCaseMetadata(dir);
            if (meta.structuralOnly && tier !== "structural") {
                process.send!({
                    failure: null,
                    kind: "excluded",
                    reason: meta.structuralOnly,
                });
                return;
            }
            let failure: string | null;
            if (tier === "structural") failure = structure.evaluate(dir, key);
            else if (tier === "equivalence")
                failure = pixels.compareWithClean(dir, key);
            else if (tier === "raster")
                failure = await pixels.evaluate(dir, key);
            else if (tier === "algebraic") {
                const data = areas.measure(dir);
                failure =
                    data.error !== null
                        ? data.error
                        : areas.IDENTITIES.find((i) => i.name === key)!.check(
                              data.measures,
                          );
            } else throw new Error(`Unknown tier ${tier}`);
            process.send!({ failure, kind: failure ? "oracle" : "pass" });
        } catch (error) {
            process.send!({
                failure: `${error.name}: ${error.message}`,
                kind: "exception",
            });
        }
    },
);
