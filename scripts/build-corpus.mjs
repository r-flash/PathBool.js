// Test-only bundles: production assertions are stripped without touching dist/.
import { nodeResolve } from "@rollup/plugin-node-resolve";
import strip from "@rollup/plugin-strip";
import typescript from "@rollup/plugin-typescript";
import { mkdir, rename } from "node:fs/promises";
import { rollup } from "rollup";

export async function buildCorpus() {
    await mkdir(".cache/path-bool/build", { recursive: true });
    for (const mode of ["development", "production"]) {
        const bundle = await rollup({
            input: "src/__tests__/support/corpus-worker.ts",
            external: (id) =>
                id.endsWith(".cjs") ||
                (!id.startsWith(".") &&
                    !id.startsWith("/") &&
                    !id.endsWith(".ts")),
            plugins: [
                nodeResolve(),
                typescript({
                    compilerOptions: {
                        declaration: false,
                        declarationDir: undefined,
                    },
                }),
                mode === "production" &&
                    strip({
                        include: "**/*.ts",
                        exclude: "**/__tests__/**",
                        functions: ["assert*"],
                        debugger: false,
                    }),
            ].filter(Boolean),
        });
        await bundle.write({
            file: `.cache/path-bool/build/${mode}.${process.pid}.tmp.mjs`,
            format: "es",
        });
        await bundle.close();
        await rename(
            `.cache/path-bool/build/${mode}.${process.pid}.tmp.mjs`,
            `.cache/path-bool/build/${mode}.mjs`,
        );
    }
}

if (process.argv[1]?.endsWith("build-corpus.mjs")) await buildCorpus();
