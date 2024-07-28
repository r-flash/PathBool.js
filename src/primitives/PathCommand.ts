/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { Vector } from "./Vector";

export type AbsolutePathCommand =
    | ["M", Vector]
    | ["L", Vector]
    | ["C", Vector, Vector, Vector]
    | ["S", Vector, Vector]
    | ["Q", Vector, Vector]
    | ["T", Vector]
    | ["A", number, number, number, boolean, boolean, Vector]
    | ["Z"]
    | ["z"];

type RelativePathCommand =
    | ["H", number]
    | ["V", number]
    | ["m", number, number]
    | ["l", number, number]
    | ["h", number]
    | ["v", number]
    | ["c", number, number, number, number, number, number]
    | ["s", number, number, number, number]
    | ["q", number, number, number, number]
    | ["t", number, number]
    | ["a", number, number, number, boolean, boolean, number, number];

export type PathCommand = AbsolutePathCommand | RelativePathCommand;

export function* toAbsoluteCommands(
    commands: Iterable<PathCommand>,
): Iterable<AbsolutePathCommand> {
    let lastPoint: Vector = [0, 0];
    let firstPoint = lastPoint;

    for (const cmd of commands) {
        switch (cmd[0]) {
            case "M":
                yield cmd;
                lastPoint = firstPoint = cmd[1];
                break;
            case "L":
                yield cmd;
                lastPoint = cmd[1];
                break;
            case "C":
                yield cmd;
                lastPoint = cmd[3];
                break;
            case "S":
                yield cmd;
                lastPoint = cmd[2];
                break;
            case "Q":
                yield cmd;
                lastPoint = cmd[2];
                break;
            case "T":
                yield cmd;
                lastPoint = cmd[1];
                break;
            case "A":
                yield cmd;
                lastPoint = cmd[6];
                break;
            case "Z":
            case "z":
                lastPoint = firstPoint;
                yield ["Z"];
                break;
            case "H":
                lastPoint = [cmd[1], lastPoint[1]];
                yield ["L", lastPoint];
                break;
            case "V":
                lastPoint = [lastPoint[0], cmd[1]];
                yield ["L", lastPoint];
                break;
            case "m":
                lastPoint = firstPoint = [
                    lastPoint[0] + cmd[1],
                    lastPoint[1] + cmd[2],
                ];
                yield ["M", lastPoint];
                break;
            case "l":
                lastPoint = [lastPoint[0] + cmd[1], lastPoint[1] + cmd[2]];
                yield ["L", lastPoint];
                break;
            case "h":
                lastPoint = [lastPoint[0] + cmd[1], lastPoint[1]];
                yield ["L", lastPoint];
                break;
            case "v":
                lastPoint = [lastPoint[0], lastPoint[1] + cmd[1]];
                yield ["L", lastPoint];
                break;
            case "c":
                yield [
                    "C",
                    [lastPoint[0] + cmd[1], lastPoint[1] + cmd[2]],
                    [lastPoint[0] + cmd[3], lastPoint[1] + cmd[4]],
                    (lastPoint = [
                        lastPoint[0] + cmd[5],
                        lastPoint[1] + cmd[6],
                    ]),
                ];
                break;
            case "s":
                yield [
                    "S",
                    [lastPoint[0] + cmd[1], lastPoint[1] + cmd[2]],
                    (lastPoint = [
                        lastPoint[0] + cmd[3],
                        lastPoint[1] + cmd[4],
                    ]),
                ];
                break;
            case "q":
                yield [
                    "Q",
                    [lastPoint[0] + cmd[1], lastPoint[1] + cmd[2]],
                    (lastPoint = [
                        lastPoint[0] + cmd[3],
                        lastPoint[1] + cmd[4],
                    ]),
                ];
                break;
            case "t":
                yield [
                    "T",
                    (lastPoint = [
                        lastPoint[0] + cmd[1],
                        lastPoint[1] + cmd[2],
                    ]),
                ];
                break;
            case "a":
                yield [
                    "A",
                    cmd[1],
                    cmd[2],
                    cmd[3],
                    cmd[4],
                    cmd[5],
                    (lastPoint = [
                        lastPoint[0] + cmd[6],
                        lastPoint[1] + cmd[7],
                    ]),
                ];
                break;
        }
    }
}
