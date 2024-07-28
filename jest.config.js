/** @type {import("ts-jest").JestConfigWithTsJest} **/
export default {
    testEnvironment: "node",
    transform: {
        "^.+.tsx?$": ["ts-jest", {}],
    },
    roots: ["<rootDir>/src/"],
};
