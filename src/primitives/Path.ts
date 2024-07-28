/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { PathCommand, toAbsoluteCommands } from "./PathCommand";
import { PathSegment } from "./PathSegment";
import { Vector, vectorsEqual } from "./Vector";

export type Path = PathSegment[];

function reflectControlPoint(point: Vector, controlPoint: Vector): Vector {
    return [2 * point[0] - controlPoint[0], 2 * point[1] - controlPoint[1]];
}

export function* pathFromCommands(
    commands: Iterable<PathCommand>,
): Iterable<PathSegment> {
    let firstPoint: Vector | null = null;
    let lastPoint: Vector | null = null;
    let lastControlPoint: Vector | null = null;

    function badSequence(): never {
        throw new Error("Bad SVG path data sequence.");
    }

    for (const cmd of toAbsoluteCommands(commands)) {
        switch (cmd[0]) {
            case "M":
                lastPoint = firstPoint = cmd[1];
                lastControlPoint = null;
                break;
            case "L":
                if (!lastPoint) badSequence();
                yield ["L", lastPoint, cmd[1]];
                lastPoint = cmd[1];
                lastControlPoint = null;
                break;
            case "C":
                if (!lastPoint) badSequence();
                yield ["C", lastPoint, cmd[1], cmd[2], cmd[3]];
                lastPoint = cmd[3];
                lastControlPoint = cmd[2];
                break;
            case "S":
                if (!lastPoint) badSequence();
                if (!lastControlPoint) badSequence(); // TODO: really?
                yield [
                    "C",
                    lastPoint,
                    reflectControlPoint(lastPoint, lastControlPoint),
                    cmd[1],
                    cmd[2],
                ];
                lastPoint = cmd[2];
                lastControlPoint = cmd[1];
                break;
            case "Q":
                if (!lastPoint) badSequence();
                yield ["Q", lastPoint, cmd[1], cmd[2]];
                lastPoint = cmd[2];
                lastControlPoint = cmd[1];
                break;
            case "T":
                if (!lastPoint) badSequence();
                if (!lastControlPoint) badSequence(); // TODO: really?
                lastControlPoint = reflectControlPoint(
                    lastPoint,
                    lastControlPoint,
                );
                yield ["Q", lastPoint, lastControlPoint, cmd[1]];
                lastPoint = cmd[1];
                break;
            case "A":
                if (!lastPoint) badSequence();
                yield [
                    "A",
                    lastPoint,
                    cmd[1],
                    cmd[2],
                    cmd[3],
                    cmd[4],
                    cmd[5],
                    cmd[6],
                ];
                lastPoint = cmd[6];
                lastControlPoint = null;
                break;
            case "Z":
            case "z":
                if (!lastPoint) badSequence();
                if (!firstPoint) badSequence(); // TODO: really?
                yield ["L", lastPoint, firstPoint];
                lastPoint = firstPoint;
                lastControlPoint = null;
                break;
        }
    }
}

export function* pathToCommands(
    segments: Iterable<PathSegment>,
    eps: number = 1e-4,
): Iterable<PathCommand> {
    let lastPoint: Vector | null = null;
    for (const seg of segments) {
        if (!lastPoint || !vectorsEqual(seg[1], lastPoint, eps)) {
            yield ["M", seg[1]];
        }

        switch (seg[0]) {
            case "L":
                yield ["L", (lastPoint = seg[2])];
                break;
            case "C":
                yield ["C", seg[2], seg[3], (lastPoint = seg[4])];
                break;
            case "Q":
                yield ["Q", seg[2], (lastPoint = seg[3])];
                break;
            case "A":
                yield [
                    "A",
                    seg[2],
                    seg[3],
                    seg[4],
                    seg[5],
                    seg[6],
                    (lastPoint = seg[7]),
                ];
                break;
        }
    }
}
