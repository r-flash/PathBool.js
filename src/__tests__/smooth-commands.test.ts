import { expect, test } from "@jest/globals";

import { pathFromPathData } from "../index";

// The first control of S/T is the current point unless the preceding command
// belongs to the same curve family. These pairs spell exactly the same curve.
test.each([
    ["M0 0 S2 3 4 5", "M0 0 C0 0 2 3 4 5"],
    ["M0 0 L1 2 S3 4 5 6", "M0 0 L1 2 C1 2 3 4 5 6"],
    ["M0 0 Q1 2 3 4 S5 6 7 8", "M0 0 Q1 2 3 4 C3 4 5 6 7 8"],
    ["M0 0 C1 2 3 4 5 6 S7 8 9 10", "M0 0 C1 2 3 4 5 6 C7 8 7 8 9 10"],
    ["M0 0 T4 5", "M0 0 Q0 0 4 5"],
    ["M0 0 L1 2 T3 4", "M0 0 L1 2 Q1 2 3 4"],
    ["M0 0 C1 2 3 4 5 6 T7 8", "M0 0 C1 2 3 4 5 6 Q5 6 7 8"],
    ["M0 0 Q1 2 3 4 T5 6 T7 8", "M0 0 Q1 2 3 4 Q5 6 5 6 Q5 6 7 8"],
    ["M1 2 l3 4 s5 6 7 8", "M1 2 L4 6 C4 6 9 12 11 14"],
    ["M1 2 l3 4 t5 6", "M1 2 L4 6 Q4 6 9 12"],
    ["M1 2 Q3 4 5 6 Z T7 8", "M1 2 Q3 4 5 6 Z Q1 2 7 8"],
    [
        "M1 2 C3 4 5 6 7 8 M9 10 S11 12 13 14",
        "M1 2 C3 4 5 6 7 8 M9 10 C9 10 11 12 13 14",
    ],
])("expands %s", (smooth, explicit) => {
    expect(pathFromPathData(smooth)).toEqual(pathFromPathData(explicit));
});
