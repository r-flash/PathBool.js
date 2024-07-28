/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { Path, pathFromCommands, pathToCommands } from "./primitives/Path";
import { PathCommand } from "./primitives/PathCommand";
import { Vector } from "./primitives/Vector";
import { isBoolean, isNumber, isString } from "./util/generic";
import { map } from "./util/iterators";

const eof = Symbol();

export function* commandsFromPathData(d: string): Iterable<PathCommand> {
    const reFloat = /\s*,?\s*(-?\d*(?:\d\.|\.\d|\d)\d*(?:[eE][+\-]?\d+)?)/y;
    const reCmd = /\s*([MLCSQTAZHVmlhvcsqtaz])/y;
    const reBool = /\s*,?\s*([01])/y;

    let i = 0;

    let lastCmd = "M";

    function getCmd() {
        if (i >= d.length - 1) return eof;

        reCmd.lastIndex = i;
        const match = reCmd.exec(d);

        // https://razrfalcon.github.io/notes-on-svg-parsing/path-data.html#implicit-sequential-moveto-commands
        if (!match) {
            switch (lastCmd) {
                case "M":
                    return "L";
                case "m":
                    return "l";
                default:
                    return lastCmd;
            }
        }

        i = reCmd.lastIndex;
        return match[1];
    }

    function getFloat() {
        reFloat.lastIndex = i;
        const match = reFloat.exec(d);

        if (!match) {
            throw new Error(
                `Invalid path data. Expected a number at index ${i}.`,
            );
        }

        i = reFloat.lastIndex;
        return Number(match[1]);
    }

    function getBool() {
        reBool.lastIndex = i;
        const match = reBool.exec(d);

        if (!match) {
            throw new Error(
                `Invalid path data. Expected a flag at index ${i}.`,
            );
        }

        i = reBool.lastIndex;
        return match[1] === "1";
    }

    while (true) {
        const cmd = getCmd();

        switch (cmd) {
            case "M":
                yield [(lastCmd = "M"), [getFloat(), getFloat()]];
                break;
            case "L":
                yield [(lastCmd = "L"), [getFloat(), getFloat()]];
                break;
            case "C":
                yield [
                    (lastCmd = "C"),
                    [getFloat(), getFloat()],
                    [getFloat(), getFloat()],
                    [getFloat(), getFloat()],
                ];
                break;
            case "S":
                yield [
                    (lastCmd = "S"),
                    [getFloat(), getFloat()],
                    [getFloat(), getFloat()],
                ];
                break;
            case "Q":
                yield [
                    (lastCmd = "Q"),
                    [getFloat(), getFloat()],
                    [getFloat(), getFloat()],
                ];
                break;
            case "T":
                yield [(lastCmd = "T"), [getFloat(), getFloat()]];
                break;
            case "A":
                yield [
                    (lastCmd = "A"),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getBool(),
                    getBool(),
                    [getFloat(), getFloat()],
                ];
                break;
            case "Z":
            case "z":
                yield [(lastCmd = "Z")];
                break;
            case "H":
                yield [(lastCmd = "H"), getFloat()];
                break;
            case "V":
                yield [(lastCmd = "V"), getFloat()];
                break;
            case "m":
                yield [(lastCmd = "m"), getFloat(), getFloat()];
                break;
            case "l":
                yield [(lastCmd = "l"), getFloat(), getFloat()];
                break;
            case "h":
                yield [(lastCmd = "h"), getFloat()];
                break;
            case "v":
                yield [(lastCmd = "v"), getFloat()];
                break;
            case "c":
                yield [
                    (lastCmd = "c"),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                ];
                break;
            case "s":
                yield [
                    (lastCmd = "s"),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                ];
                break;
            case "q":
                yield [
                    (lastCmd = "q"),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                ];
                break;
            case "t":
                yield [(lastCmd = "t"), getFloat(), getFloat()];
                break;
            case "a":
                yield [
                    (lastCmd = "a"),
                    getFloat(),
                    getFloat(),
                    getFloat(),
                    getBool(),
                    getBool(),
                    getFloat(),
                    getFloat(),
                ];
                break;
            case eof:
                return;
        }
    }
}

export function pathFromPathData(d: string): Path {
    return [...pathFromCommands(commandsFromPathData(d))];
}

export function pathToPathData(path: Path, eps: number = 1e-4): string {
    function mapParam(param: string | number | boolean | Vector) {
        if (isString(param)) return param;
        if (isNumber(param)) return param.toFixed(12);
        if (isBoolean(param)) return param ? "1" : "0";
        return param.map((c) => c.toFixed(12)).join(",");
    }

    return [
        ...map(pathToCommands(path, eps), (cmd) => cmd.map(mapParam).join(" ")),
    ].join(" ");
}
