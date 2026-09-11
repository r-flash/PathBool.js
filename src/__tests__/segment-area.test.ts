import { expect, test } from "@jest/globals";

import { pathFromPathData } from "../index";
import { segmentArea } from "../primitives/segment-area";
import { signedArea } from "./support/area";

test.each([
    "M0 0L3 0L3 2L0 2Z",
    "M0 0Q3 4 6 0Z",
    "M0 0C2 6 4 -2 6 0Z",
    "M0 0C3 4 -3 4 0 0Z",
    "M2 0A2 1 0 0 1 -2 0A2 1 0 0 1 2 0Z",
])("analytic segment integrals agree with independent quadrature: %s", (d) => {
    const path = pathFromPathData(d);
    expect(
        path.reduce((sum, seg) => sum + segmentArea(seg, [0, 0]), 0),
    ).toBeCloseTo(signedArea(path, [0, 0]), 12);
});

test("a thin translated rectangle keeps its orientation", () => {
    const path = pathFromPathData("M1000000 1000000h0.001v0.000001h-0.001Z");
    const area = path.reduce(
        (sum, seg) => sum + segmentArea(seg, path[0][1]),
        0,
    );
    expect(area).toBeGreaterThan(0);
    expect(area).toBeCloseTo(signedArea(path, path[0][1]), 20);
});

test("a short circular segment retains its area below sector-subtraction precision", () => {
    const theta = 1e-7;
    const end: [number, number] = [Math.cos(theta), Math.sin(theta)];
    const path = [
        ["A", [1, 0], 1, 1, 0, false, true, end],
        ["L", end, [1, 0]],
    ] as const;
    const measured = signedArea(path, [1, 0]);
    // Area = (theta-sin(theta))/2 = theta^3/12 + O(theta^5).
    expect(measured / (theta ** 3 / 12)).toBeCloseTo(1, 12);
    expect(
        path.reduce((sum, seg) => sum + segmentArea(seg as any, [1, 0]), 0) /
            measured,
    ).toBeCloseTo(1, 12);
});
