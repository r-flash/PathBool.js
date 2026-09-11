import * as library from "../../index";
import { createOracle as algebraic } from "./algebraic-oracle";
import { readCaseMetadata } from "./corpus";
import { createOracle as raster } from "./raster-oracle";
import { createOracle as structural } from "./tier0-oracle";

let previous: string | null = null;
let structure: ReturnType<typeof structural>;
let pixels: ReturnType<typeof raster>;
let areas: ReturnType<typeof algebraic>;

process.on(
    "message",
    ({ dir, tier, key }: { dir: string; tier: string; key: any }) => {
        try {
            if (dir !== previous) {
                structure = structural(library);
                pixels = raster(library);
                areas = algebraic(library);
                previous = dir;
            }
            if (tier === "catalog") {
                process.send!({
                    failure: null,
                    identities: areas.IDENTITIES.map((i) => i.name),
                });
                return;
            }
            const meta = readCaseMetadata(dir);
            if (meta.structuralOnly && tier !== "tier0") {
                process.send!({
                    failure: null,
                    kind: "excluded",
                    reason: meta.structuralOnly,
                });
                return;
            }
            let failure: string | null;
            if (tier === "tier0") failure = structure.evaluate(dir, key);
            else if (tier === "equivalence")
                failure = pixels.compareWithClean(dir, key);
            else if (tier === "raster") failure = pixels.evaluate(dir, key);
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
