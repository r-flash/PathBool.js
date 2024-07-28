import { nodeResolve } from "@rollup/plugin-node-resolve";
import strip from "@rollup/plugin-strip";
import typescript from "@rollup/plugin-typescript";

const production = process.env.NODE_ENV === "production";

function getPlugins(shouldStrip) {
    return [
        nodeResolve(),
        typescript(),
        shouldStrip &&
            strip({
                include: "**/*.ts",
                debugger: false,
                functions: ["assert*"],
            }),
    ].filter(Boolean);
}

export default {
    input: "src/index.ts",
    output: {
        file: "dist/path-bool.js",
        format: "es",
        sourcemap: true,
    },
    plugins: getPlugins(production),
};
