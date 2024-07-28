/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { lineSegmentAABBIntersect } from "./intersections/line-segment-AABB";
import {
    AABB,
    boundingBoxesOverlap,
    mergeBoundingBoxes,
} from "./primitives/AABB";
import { Vector } from "./primitives/Vector";

type LineSegment = [Vector, Vector];

export class QuadTree<T> {
    static fromPairs<T>(
        pairs: [AABB, T][],
        depth: number,
        innerNodeCapacity: number = 8,
    ): QuadTree<T> {
        if (pairs.length === 0) {
            throw new Error("QuadTree.fromPairs: at least one pair needed.");
        }

        let boundingBox = pairs[0][0];
        for (let i = 1; i < pairs.length; i++) {
            boundingBox = mergeBoundingBoxes(boundingBox, pairs[i][0]);
        }

        const tree = new QuadTree<T>(boundingBox, depth, innerNodeCapacity);

        for (const [key, value] of pairs) {
            tree.insert(key, value);
        }

        return tree;
    }

    protected subtrees:
        | [QuadTree<T>, QuadTree<T>, QuadTree<T>, QuadTree<T>]
        | null = null;
    protected pairs: [AABB, T][] = [];

    constructor(
        readonly boundingBox: AABB,
        readonly depth: number,
        readonly innerNodeCapacity: number = 16,
    ) {}

    insert(boundingBox: AABB, value: T) {
        if (!boundingBoxesOverlap(boundingBox, this.boundingBox)) return false;

        if (this.depth > 0 && this.pairs.length >= this.innerNodeCapacity) {
            this.ensureSubtrees();
            for (let i = 0; i < this.subtrees!.length; i++) {
                const tree = this.subtrees![i];
                tree.insert(boundingBox, value);
            }
        } else {
            this.pairs.push([boundingBox, value]);
        }

        return true;
    }

    find(boundingBox: AABB, set: Set<T> = new Set()): Set<T> {
        if (!boundingBoxesOverlap(boundingBox, this.boundingBox)) return set;

        for (let i = 0; i < this.pairs.length; i++) {
            const [key, value] = this.pairs[i];
            if (boundingBoxesOverlap(boundingBox, key)) {
                set.add(value);
            }
        }

        if (this.subtrees) {
            for (let i = 0; i < this.subtrees.length; i++) {
                const tree = this.subtrees[i];
                tree.find(boundingBox, set);
            }
        }

        return set;
    }

    findOnLineSegment(seg: LineSegment, set: Set<T> = new Set()): Set<T> {
        if (!lineSegmentAABBIntersect(seg, this.boundingBox)) return set;

        for (const [key, value] of this.pairs) {
            if (lineSegmentAABBIntersect(seg, key)) {
                set.add(value);
            }
        }

        if (this.subtrees) {
            for (const tree of this.subtrees) {
                tree.findOnLineSegment(seg, set);
            }
        }

        return set;
    }

    private ensureSubtrees() {
        if (this.subtrees) return;

        const { top, right, bottom, left } = this.boundingBox;
        const midX = (this.boundingBox.left + this.boundingBox.right) / 2;
        const midY = (this.boundingBox.top + this.boundingBox.bottom) / 2;

        this.subtrees = [
            new QuadTree(
                { top, right: midX, bottom: midY, left },
                this.depth - 1,
                this.innerNodeCapacity,
            ),
            new QuadTree(
                { top, right, bottom: midY, left: midX },
                this.depth - 1,
                this.innerNodeCapacity,
            ),
            new QuadTree(
                { top: midY, right: midX, bottom, left },
                this.depth - 1,
                this.innerNodeCapacity,
            ),
            new QuadTree(
                { top: midY, right, bottom, left: midX },
                this.depth - 1,
                this.innerNodeCapacity,
            ),
        ];
    }
}
