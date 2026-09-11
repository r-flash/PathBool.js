import { Resvg } from "@resvg/resvg-js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { extract, selectPairs, materializePair } from "./extract.mjs";
import {
    correctRadii,
    decode,
    transform,
    transformedData,
    fixtureSvg,
} from "./geometry.cjs";

test("decoding retains point commands, duplicate closes and collapsed segments", () => {
    const p = decode("M0 0L0 0z z M1 1 Q1 1 1 1z");
    assert.equal(p.commands.filter((c) => c[0] === "Z").length, 3);
    assert.equal(p.segments.length, 5);
    assert.equal(p.open, false);
    assert.equal(decode("m1 2 3 4 h1 v2").open, true);
    assert.deepEqual(decode("M0 0 L1 0 S2 1 3 0").segments.at(-1)[2], [1, 0]);
    assert.deepEqual(
        decode("M0 0 Q1 1 2 0 S3 1 4 0").segments.at(-1)[2],
        [2, 0],
    );
    assert.equal(decode("M0 0 A2 3 0 011 1").segments[0][6], 1);
});

test("affine arc transforms preserve independently rendered regions", () => {
    const ds = [
        "M40 10 A30 15 25 1 1 0 30 L0 0Z",
        "M0 0A1 2 40 0 1 30 20Z",
        "M0 0A0 2 0 0 1 30 20Z",
    ];
    for (const d of ds)
        for (const text of [
            "translate(20 25) rotate(17) scale(1.2 .7)",
            "translate(65 10) scale(-1 1) skewX(20)",
            "matrix(1 .2 .4 1 20 15)",
        ]) {
            const m = transform(text),
                actual = transformedData(d, m);
            const svg = (p) => fixtureSvg([p, { d: "" }], "-100 -100 300 300");
            const a = new Resvg(svg({ d, matrix: m })).render().pixels;
            const b = new Resvg(svg({ d: actual })).render().pixels;
            let error = 0;
            for (let i = 3; i < a.length; i += 4)
                error += Math.abs(a[i] - b[i]);
            assert.ok(
                error / ((a.length / 4) * 255) < 0.0002,
                `${d} / ${text}: ${error}`,
            );
        }
});

test("extracts whole compound paths with inherited CSS, nested transforms and context labels", () => {
    const svg =
        '<svg><style>.hole {fill-rule:evenodd}</style><g transform="translate(10 20)" class="hole"><path id="p" d="M0 0L1 0L1 1Z M.2 .2L.4 .2L.4 .4Z"/></g><defs><clipPath><path d="M0 0L1 0Z"/></clipPath></defs><path fill="none" d="M0 0L2 0"/><use href="#p"/></svg>';
    const out = extract(svg);
    assert.equal(out.paths.length, 3);
    assert.equal(out.paths[0].fillRule, "evenodd");
    assert.equal(out.paths[0].features.subpaths, 2);
    assert.equal(out.paths[0].matrix[4], 10);
    assert.equal(out.paths[1].context, "clipPath");
    assert.equal(out.paths[2].context, "stroke-only");
    assert.ok(out.exclusions.some((e) => e.kind === "use"));
    const pair = materializePair({
        a: out.paths[0],
        b: null,
        relationship: "empty-counterpart",
    });
    assert.ok(pair.oracle.includes(out.paths[0].d));
});

test("singular transforms stay local; unsupported contexts are explicit", () => {
    const result = extract(
        '<svg><path transform="scale(0 1)" d="M0 0L2 2Z"/><g style="transform:scale(2)"><path d="M0 0L1 1Z"/></g></svg>',
    );
    assert.equal(result.paths[0].local, true);
    assert.equal(result.paths[0].data, "M0 0L2 2Z");
    assert.match(result.exclusions[0].reason, /CSS transforms/);
    assert.throws(
        () => extract("<svg><style>@import url(a.css)</style></svg>"),
        /stylesheet/,
    );
    const nested = extract(
        '<svg><svg x="10" width="100" height="50" viewBox="0 0 10 10"><path d="M0 0L1 1Z"/></svg></svg>',
    );
    assert.deepEqual(nested.paths[0].matrix, [5, 0, 0, 5, 35, 0]);
});

test("transform results do not share mutable identity state", () => {
    const a = transform();
    a[4] = 100;
    assert.deepEqual(transform(), [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(transform("translate(2 3)"), [1, 0, 0, 1, 2, 3]);
});

test("reference radius correction preserves a genuine semicircle with tiny specified radii", () => {
    const d = "M0 0 A1e-11 1e-11 0 0 1 40 0 Z";
    const corrected = decode(correctRadii(d)).segments[0];
    assert.ok(Math.abs(corrected[2] - 20) < 1e-12);
    assert.ok(Math.abs(corrected[3] - 20) < 1e-12);
    assert.equal(decode(d).segments[0][2], 1e-11);
    assert.equal(correctRadii("M0 0A0 1 0 0 1 40 0Z"), "M0 0A0 1 0 0 1 40 0Z");
});
