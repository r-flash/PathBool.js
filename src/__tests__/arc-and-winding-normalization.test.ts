/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from "@jest/globals";

import { epsilonsForExtent } from "../config";
import * as PathBool from "../index";
import type { Path } from "../primitives/Path";
import {
    getEndPoint,
    reversePathSegment,
    splitSegmentAt,
} from "../primitives/PathSegment";

function canonicalizePath(path: Path): string {
    if (path.length === 0) return "";
    const reverse = [...path].reverse().map(reversePathSegment);
    return [path, reverse]
        .map((p) => PathBool.pathToPathData(p, 1e-6))
        .sort()[0];
}

function serialize(paths: Path[]): string {
    return paths.map(canonicalizePath).sort().join("|");
}

describe("equivalent arc spellings", () => {
    const p = [1.4 * Math.cos(Math.PI / 6), 1.4 * Math.sin(Math.PI / 6)];
    const q = [-p[0], -p[1]];
    const regular = PathBool.pathFromPathData(
        `M ${p[0]} ${p[1]} A 1.4 0.7 30 0 1 ${q[0]} ${q[1]}`,
    );

    test("swapped radii and a quarter-turned frame share the whole arc", () => {
        const swapped = PathBool.pathFromPathData(
            `M ${p[0]} ${p[1]} A 0.7 1.4 120 0 1 ${q[0]} ${q[1]}`,
        );
        expect(
            PathBool.pathSegmentIntersection(
                regular[0],
                swapped[0],
                epsilonsForExtent(3),
            ),
        ).toEqual([
            [0, 0],
            [1, 1],
        ]);
    });

    test("negative radii are read by absolute value", () => {
        const signed = PathBool.pathFromPathData(
            `M ${p[0]} ${p[1]} A -1.4 0.7 30 0 1 ${q[0]} ${q[1]}`,
        );
        expect(
            PathBool.pathSegmentIntersection(
                regular[0],
                signed[0],
                epsilonsForExtent(3),
            ),
        ).toEqual([
            [0, 0],
            [1, 1],
        ]);
    });
});

describe("omitted and cancelling geometry", () => {
    const other = PathBool.pathFromPathData("M 3 -1 L 5 -1 L 5 1 L 3 1 Z");

    test("same-endpoint arcs are omitted under either large-arc flag", () => {
        const make = (large: number) =>
            PathBool.pathFromPathData(
                `M -1 -1 L 1 -1 A 1 1 0 ${large} 1 1 -1 L 1 1 L -1 1 L -1 -1 Z`,
            );
        const outputs = [0, 1].map((large) => {
            const boolean = new PathBool.PathBoolean([
                { path: make(large), fillRule: PathBool.FillRule.NonZero },
                { path: other, fillRule: PathBool.FillRule.NonZero },
            ]);
            return [0, 1, 2, 3, 4, 5].map((op) => serialize(boolean.get(op)));
        });
        expect(outputs[1]).toEqual(outputs[0]);
    });

    for (const fillRule of [
        PathBool.FillRule.NonZero,
        PathBool.FillRule.EvenOdd,
    ]) {
        test(`opposite traversals cancel under ${PathBool.FillRule[fillRule]}`, () => {
            const forward = PathBool.pathFromPathData(
                "M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 0 1 -1 0 A 1 1 0 0 1 0 -1 A 1 1 0 0 1 1 0 Z",
            );
            const cancelled = forward.concat(
                [...forward].reverse().map(reversePathSegment),
            );
            const boolean = new PathBool.PathBoolean([
                { path: cancelled, fillRule },
                { path: other, fillRule: PathBool.FillRule.NonZero },
            ]);

            expect(
                serialize(
                    boolean.get(PathBool.PathBooleanOperation.Intersection),
                ),
            ).toBe("");
            expect(
                serialize(boolean.get(PathBool.PathBooleanOperation.Union)),
            ).toBe(serialize([other]));
        });
    }
});

test("subdivided arcs preserve their boundary vertices exactly", () => {
    const arcs = PathBool.pathFromPathData(
        "M 1 0 A 1 1 0 0 1 0 1 A 1 1 0 0 1 -1 0 A 1 1 0 0 1 0 -1 A 1 1 0 0 1 1 0",
    );
    for (const arc of arcs)
        for (const t of [0.25, 0.5, 0.75]) {
            const [first, second] = splitSegmentAt(arc, t);
            expect(first[1]).toEqual(arc[1]);
            expect(getEndPoint(first)).toEqual(second[1]);
            expect(getEndPoint(second)).toEqual(getEndPoint(arc));
        }
});
