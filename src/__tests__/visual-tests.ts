/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { expect, test } from "@jest/globals";
import { Resvg } from "@resvg/resvg-js";
import * as cheerio from "cheerio";
import { globSync } from "glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import * as PathBool from "../path-boolean";
import { pathFromPathData, pathToPathData } from "../path-data";

const TOLERANCE = 80;

const ops = {
    union: PathBool.PathBooleanOperation.Union,
    difference: PathBool.PathBooleanOperation.Difference,
    intersection: PathBool.PathBooleanOperation.Intersection,
    exclusion: PathBool.PathBooleanOperation.Exclusion,
    division: PathBool.PathBooleanOperation.Division,
    fracture: PathBool.PathBooleanOperation.Fracture,
};

const fillRules = {
    nonzero: PathBool.FillRule.NonZero,
    evenodd: PathBool.FillRule.EvenOdd,
};

const folders = globSync("src/__fixtures__/visual-tests/*/").flatMap((dir) =>
    Object.entries(ops).map(([opName, op]) => ({
        name: path.basename(dir),
        dir,
        opName,
        op,
    })),
);

test.each(folders)("$name $opName", async ({ dir, opName, op }) => {
    await fs.mkdir(path.join(dir, "test-results"), { recursive: true });

    const originalPath = path.join(dir, "original.svg");
    const originalCode = await fs.readFile(originalPath, "utf-8");

    const $ = cheerio.load(originalCode, { xml: true });
    const $a = $(`#a`);
    const $b = $(`#b`);
    const a = pathFromPathData($a.attr("d")!);
    const b = pathFromPathData($b.attr("d")!);
    const aFillRule =
        fillRules[$a.css("fill-rule") ?? "nonzero"] ??
        PathBool.FillRule.NonZero;
    const bFillRule =
        fillRules[$b.css("fill-rule") ?? "nonzero"] ??
        PathBool.FillRule.NonZero;

    const result = PathBool.pathBoolean(a, aFillRule, b, bFillRule, op)!;
    for (const path of result) {
        $a.clone()
            .attr("d", pathToPathData(path, 1e-4))
            .removeAttr("id")
            .insertBefore($a);
    }
    $a.remove();
    $b.remove();
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
    await fs.writeFile(oursPngPath, oursRender.asPng());
    const groundTruthPngPath = path.join(dir, "test-results", `${opName}.png`);
    await fs.writeFile(groundTruthPngPath, groundTruthRender.asPng());

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
});
