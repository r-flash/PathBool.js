/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { AABB } from "../primitives/AABB";
import { Vector } from "../primitives/Vector";

type LineSegment = [Vector, Vector];

// https://en.wikipedia.org/wiki/Cohen%E2%80%93Sutherland_algorithm

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 1 << 1;
const BOTTOM = 1 << 2;
const TOP = 1 << 3;

function outCode(x: number, y: number, boundingBox: AABB) {
    let code = INSIDE;

    if (x < boundingBox.left) {
        code |= LEFT;
    } else if (x > boundingBox.right) {
        code |= RIGHT;
    }

    if (y < boundingBox.top) {
        code |= BOTTOM;
    } else if (y > boundingBox.bottom) {
        code |= TOP;
    }

    return code;
}

export function lineSegmentAABBIntersect(seg: LineSegment, boundingBox: AABB) {
    let [[x0, y0], [x1, y1]] = seg;

    let outcode0 = outCode(x0, y0, boundingBox);
    let outcode1 = outCode(x1, y1, boundingBox);

    while (true) {
        if (!(outcode0 | outcode1)) {
            // bitwise OR is 0: both points inside window; trivially accept and exit loop
            return true;
        } else if (outcode0 & outcode1) {
            // bitwise AND is not 0: both points share an outside zone (LEFT, RIGHT, TOP,
            // or BOTTOM), so both must be outside window; exit loop (accept is false)
            return false;
        } else {
            const { top, right, bottom, left } = boundingBox;

            // failed both tests, so calculate the line segment to clip
            // from an outside point to an intersection with clip edge
            let x: number, y: number;

            // At least one endpoint is outside the clip rectangle; pick it.
            const outcodeOut = outcode1 > outcode0 ? outcode1 : outcode0;

            // Now find the intersection point;
            // use formulas:
            //   slope = (y1 - y0) / (x1 - x0)
            //   x = x0 + (1 / slope) * (ym - y0), where ym is ymin or ymax
            //   y = y0 + slope * (xm - x0), where xm is xmin or xmax
            // No need to worry about divide-by-zero because, in each case, the
            // outcode bit being tested guarantees the denominator is non-zero

            if (outcodeOut & TOP) {
                // point is above the clip window
                x = x0 + ((x1 - x0) * (bottom - y0)) / (y1 - y0);
                y = bottom;
            } else if (outcodeOut & BOTTOM) {
                // point is below the clip window
                x = x0 + ((x1 - x0) * (top - y0)) / (y1 - y0);
                y = top;
            } else if (outcodeOut & RIGHT) {
                // point is to the right of clip window
                y = y0 + ((y1 - y0) * (right - x0)) / (x1 - x0);
                x = right;
            } else if (outcodeOut & LEFT) {
                // point is to the left of clip window
                y = y0 + ((y1 - y0) * (left - x0)) / (x1 - x0);
                x = left;
            }

            // Now we move outside point to intersection point to clip
            // and get ready for next pass.
            if (outcodeOut == outcode0) {
                x0 = x!;
                y0 = y!;
                outcode0 = outCode(x0, y0, boundingBox);
            } else {
                x1 = x!;
                y1 = y!;
                outcode1 = outCode(x1, y1, boundingBox);
            }
        }
    }
}
