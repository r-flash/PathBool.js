/** @type {import("ts-jest").JestConfigWithTsJest} **/
export default {
    testEnvironment: "node",
    transform: {
        "^.+.tsx?$": ["ts-jest", {}],
    },
    roots: ["<rootDir>/src/"],
    // Shared helpers for the corpus suites; not test files themselves.
    testPathIgnorePatterns: [
        "/node_modules/",
        "<rootDir>/src/__tests__/support/",
    ],
};
