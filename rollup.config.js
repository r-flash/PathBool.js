import { nodeResolve } from "@rollup/plugin-node-resolve";
import strip from "@rollup/plugin-strip";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

const production = process.env.NODE_ENV === "production";

function getPlugins(shouldMinify, shouldStrip) {
    return [
        nodeResolve(),
        typescript(),
        shouldStrip &&
            strip({
                include: "**/*.ts",
                debugger: false,
                functions: ["assert*"],
            }),
        shouldMinify &&
            terser({
                ecma: 2020,
                module: true,
            }),
    ].filter(Boolean);
}

export default [
    {
        input: "src/index.ts",
        output: {
            file: "dist/path-bool.js",
            format: "es",
            sourcemap: true,
        },
        plugins: getPlugins(false, production),
    },
    {
        input: "src/index.core.ts",
        output: {
            file: "dist/path-bool.core.js",
            format: "es",
            sourcemap: true,
        },
        plugins: getPlugins(false, true),
    },
    {
        input: "src/index.ts",
        output: {
            file: "docs/js/path-bool.js",
            format: "es",
            sourcemap: true,
        },
        plugins: getPlugins(false, true),
    },
    {
        input: "src/index.ts",
        output: {
            file: "dist/path-bool.umd.js",
            format: "umd",
            sourcemap: true,
            name: "PathBool",
        },
        plugins: getPlugins(production, production),
    },
    {
        input: "src/index.core.ts",
        output: {
            file: "dist/path-bool.core.umd.js",
            format: "umd",
            sourcemap: true,
            name: "PathBool",
        },
        plugins: getPlugins(true, true),
    },
];
