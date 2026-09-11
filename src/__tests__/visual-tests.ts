/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { expect, test } from "@jest/globals";
import { Resvg } from "@resvg/resvg-js";
import * as cheerio from "cheerio";
import { globSync } from "glob";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { FillRule, Path, PathBooleanInput } from "../index";

type PathBoolModule = typeof import("../index");
let PathBool: PathBoolModule;

const TOLERANCE = 80;

process.env.PATH_BOOL_DEV_ASSERTS = "0";
PathBool = require("../index") as PathBoolModule;

const ops = {
    union: PathBool.PathBooleanOperation.Union,
    difference: PathBool.PathBooleanOperation.Difference,
    intersection: PathBool.PathBooleanOperation.Intersection,
    exclusion: PathBool.PathBooleanOperation.Exclusion,
    division: PathBool.PathBooleanOperation.Division,
    fracture: PathBool.PathBooleanOperation.Fracture,
};

// The variadic suite only has ground truth for the operations whose meaning is
// independent of input order.
const symmetricOps = {
    union: ops.union,
    intersection: ops.intersection,
    exclusion: ops.exclusion,
    fracture: ops.fracture,
};

const fillRules: Partial<Record<string, FillRule>> = {
    nonzero: PathBool.FillRule.NonZero,
    evenodd: PathBool.FillRule.EvenOdd,
};

function fillRuleOf($element: cheerio.Cheerio<any>): FillRule {
    return (
        fillRules[$element.css("fill-rule") ?? "nonzero"] ??
        PathBool.FillRule.NonZero
    );
}

/*
 Renders our result paths (cloning `$template` for its style) and the committed
 ground-truth SVG, writes both into `<dir>/test-results/`, and asserts every
 pixel matches within TOLERANCE.
*/
async function renderAndCompare(
    $: cheerio.CheerioAPI,
    $template: cheerio.Cheerio<any>,
    dir: string,
    opName: string,
    result: Path[],
) {
    for (const resultPath of result) {
        $template
            .clone()
            .attr("d", PathBool.pathToPathData(resultPath, 1e-4))
            .removeAttr("id")
            .insertBefore($template);
    }
    // Drop the original template path so only our results are rendered. Callers
    // must have already removed every other source path.
    $template.remove();
    const oursCode = $.html();

    const destinationPath = path.join(
        dir,
        "test-results",
        `${opName}-ours.svg`,
    );
    await fs.writeFile(destinationPath, oursCode, "utf-8");

    const groundTruthPath = path.join(dir, `${opName}.svg`);
    const groundTruthCode = await fs.readFile(groundTruthPath, "utf-8");

    const oursRender = new Resvg(oursCode).render();
    const groundTruthRender = new Resvg(groundTruthCode).render();

    const width = oursRender.width;

    const oursPngPath = path.join(dir, "test-results", `${opName}-ours.png`);
    await fs.writeFile(oursPngPath, new Uint8Array(oursRender.asPng()));
    const groundTruthPngPath = path.join(dir, "test-results", `${opName}.png`);
    await fs.writeFile(
        groundTruthPngPath,
        new Uint8Array(groundTruthRender.asPng()),
    );

    const oursPixels = new Uint8Array(oursRender.pixels);
    const groundTruthPixels = new Uint8Array(groundTruthRender.pixels);

    for (let i = 0; i < oursPixels.length; i++) {
        const difference = Math.abs(oursPixels[i] - groundTruthPixels[i]);
        if (difference > TOLERANCE) {
            const j = Math.floor(i / 4);
            const channel = i - j * 4;
            const x = j % width;
            const y = Math.floor(j / width);
            throw new Error(
                `Difference ${difference} larger than tolerance ${TOLERANCE} at [${x}, ${y}], channel ${channel}.`,
            );
        }
    }

    const $gt = cheerio.load(groundTruthCode);
    expect(result.length).toStrictEqual($gt("path").length);
}

const binaryFolders = globSync("src/__fixtures__/visual-tests/*/").flatMap(
    (dir) =>
        Object.entries(ops).map(([opName, op]) => ({
            name: path.basename(dir),
            dir,
            opName,
            op,
        })),
);

test.each(binaryFolders)("$name $opName", async ({ dir, opName, op }) => {
    await fs.mkdir(path.join(dir, "test-results"), { recursive: true });

    const originalPath = path.join(dir, "original.svg");
    const originalCode = await fs.readFile(originalPath, "utf-8");

    const $ = cheerio.load(originalCode, { xml: true });
    const $a = $(`#a`);
    const $b = $(`#b`);
    const a = PathBool.pathFromPathData($a.attr("d")!);
    const b = PathBool.pathFromPathData($b.attr("d")!);
    const aFillRule = fillRuleOf($a);
    const bFillRule = fillRuleOf($b);

    const result = new PathBool.PathBoolean([
        { path: a, fillRule: aFillRule },
        { path: b, fillRule: bFillRule },
    ]).get(op);

    const fuzzTestingStr = $a.attr("d") + "\n" + $b.attr("d");
    $b.remove();
    await renderAndCompare($, $a, dir, opName, result);

    const hash = crypto.createHash("sha256");
    hash.update(fuzzTestingStr);
    const digest = hash.digest("hex");
    await fs.writeFile(`fuzzing/corpus/test-${digest}`, fuzzTestingStr);
});

const variadicFolders = globSync(
    "src/__fixtures__/visual-tests-variadic/*/",
).flatMap((dir) =>
    Object.entries(symmetricOps).map(([opName, op]) => ({
        name: path.basename(dir),
        dir,
        opName,
        op,
    })),
);

test.each(variadicFolders)(
    "variadic $name $opName",
    async ({ dir, opName, op }) => {
        await fs.mkdir(path.join(dir, "test-results"), { recursive: true });

        const originalPath = path.join(dir, "original.svg");
        const originalCode = await fs.readFile(originalPath, "utf-8");

        const $ = cheerio.load(originalCode, { xml: true });
        const $paths = $("path");

        const inputs: PathBooleanInput[] = $paths.toArray().map((element) => {
            const $element = $(element);
            return {
                path: PathBool.pathFromPathData($element.attr("d")!),
                fillRule: fillRuleOf($element),
            };
        });

        const result = new PathBool.PathBoolean(inputs).get(op);

        // Use the first path as the style template; remove the rest up front so
        // renderAndCompare only has the template left to drop.
        const $template = $paths.first();
        $paths.slice(1).remove();
        await renderAndCompare($, $template, dir, opName, result);
    },
);
