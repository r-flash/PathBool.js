/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { Vector } from "./Vector";

export type AABB = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

export function boundingBoxContainsPoint(boundingBox: AABB, point: Vector) {
    return (
        point[0] >= boundingBox.left &&
        point[0] <= boundingBox.right &&
        point[1] >= boundingBox.top &&
        point[1] <= boundingBox.bottom
    );
}

export function boundingBoxesOverlap(a: AABB, b: AABB) {
    return (
        a.left <= b.right &&
        b.left <= a.right &&
        a.top <= b.bottom &&
        b.top <= a.bottom
    );
}

export function mergeBoundingBoxes(a: AABB | null, b: AABB): AABB {
    if (!a) return b;

    return {
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
        left: Math.min(a.left, b.left),
    };
}

export function extendBoundingBox(boundingBox: AABB | null, point: Vector) {
    if (!boundingBox) {
        return {
            top: point[1],
            right: point[0],
            bottom: point[1],
            left: point[0],
        };
    }

    return {
        top: Math.min(boundingBox.top, point[1]),
        right: Math.max(boundingBox.right, point[0]),
        bottom: Math.max(boundingBox.bottom, point[1]),
        left: Math.min(boundingBox.left, point[0]),
    };
}

export function boundingBoxMaxExtent(boundingBox: AABB) {
    return Math.max(
        boundingBox.right - boundingBox.left,
        boundingBox.bottom - boundingBox.top,
    );
}

export function boundingBoxAroundPoint(point: Vector, padding: number): AABB {
    return {
        top: point[1] - padding,
        right: point[0] + padding,
        bottom: point[1] + padding,
        left: point[0] - padding,
    };
}

export function expandBoundingBox(boundingBox: AABB, padding: number): AABB {
    return {
        top: boundingBox.top - padding,
        right: boundingBox.right + padding,
        bottom: boundingBox.bottom + padding,
        left: boundingBox.left - padding,
    };
}
