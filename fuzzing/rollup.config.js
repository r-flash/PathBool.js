import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
    input: "src/index.ts",
    external: /\/node_modules\//,
    output: {
        file: "fuzzing/build/path-bool.cjs",
        format: "commonjs",
        sourcemap: true,
    },
    plugins: [
        nodeResolve(),
        typescript({ compilerOptions: { declarationDir: "fuzzing/build" } }),
    ],
};
