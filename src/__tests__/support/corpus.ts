/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
/*
 Shared scaffolding for the suites that run over `src/__fixtures__/generated/`.

 Deliberately does not import `../index`: each corpus suite picks its own
 `PATH_BOOL_DEV_ASSERTS` setting and then `require`s the library itself, which
 only works if nothing has pulled the module in beforehand. This file therefore
 hands back path data as strings and lets the caller parse them.
*/
import * as cheerio from "cheerio";
import { globSync } from "glob";
import * as fs from "node:fs";
import * as path from "node:path";

export const CORPUS_ROOT =
    process.env.PATH_BOOL_CORPUS_ROOT ?? "src/__fixtures__/generated";

export const OP_NAMES = [
    "union",
    "difference",
    "intersection",
    "exclusion",
    "division",
    "fracture",
] as const;

export type OpName = (typeof OP_NAMES)[number];

export type FillRuleName = "nonzero" | "evenodd";

export type CorpusCase = {
    id: string;
    category: string;
    name: string;
    dir: string;
};

export function discoverCases(root: string = CORPUS_ROOT): CorpusCase[] {
    return globSync(`${root}/*/*/original.svg`)
        .map((file) => {
            const dir = path.dirname(file);
            const name = path.basename(dir);
            const category = path.basename(path.dirname(dir));
            return { id: `${category}/${name}`, category, name, dir };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
}

export type FixtureInput = {
    d: string;
    fillRule: FillRuleName;
};

export type Fixture = {
    code: string;
    inputs: FixtureInput[];
};

export function readFixture(dir: string): Fixture {
    const code = fs.readFileSync(path.join(dir, "original.svg"), "utf-8");
    const $ = cheerio.load(code, { xml: true });

    const inputs = [$("#a"), $("#b")].map(($el) => ({
        d: $el.attr("d")!,
        fillRule: (($el.css("fill-rule") as FillRuleName) ??
            "nonzero") as FillRuleName,
    }));

    const oracle = path.join(dir, "oracle.svg");
    return {
        code: fs.existsSync(oracle) ? fs.readFileSync(oracle, "utf-8") : code,
        inputs,
    };
}

/*
 Known-bad cases, keyed by `<category>/<name>` then operation name, with a
 reason. Each suite keeps its own list, because they disagree about what
 counts as a failure: tier 0 runs with the dev asserts on and stops at the
 first thrown invariant, while the raster oracle runs the production code path
 and judges the pixels that come out of it.
*/
export type ExpectedFailures = Record<string, Record<string, string>>;

export function loadExpectedFailures(file: string): ExpectedFailures {
    return fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf-8")) as ExpectedFailures)
        : {};
}

/*
 Reconciles what happened against the list. A listed case that starts passing
 is an error too — that is what stops the list from rotting, since fixing a bug
 then tells you exactly which entries to delete.
*/
export function assertOutcome(
    expected: ExpectedFailures,
    file: string,
    id: string,
    opName: string,
    failure: string | null,
): void {
    const reason = expected[id]?.[opName];

    if (reason === undefined) {
        if (failure !== null) throw new Error(failure);
        return;
    }

    if (failure === null) {
        throw new Error(
            `${id} ${opName} is listed in ${file} (${reason}) but now passes. ` +
                `Remove the entry.`,
        );
    }
}

export function readCaseMetadata(dir: string): Record<string, any> {
    const file = path.join(dir, "case.json");
    return fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, "utf-8"))
        : {};
}
