// https://en.wikipedia.org/wiki/Cohen%E2%80%93Sutherland_algorithm
const INSIDE = 0;
const LEFT = 1;
const RIGHT = 1 << 1;
const BOTTOM = 1 << 2;
const TOP = 1 << 3;
function outCode(x, y, boundingBox) {
    let code = INSIDE;
    if (x < boundingBox.left) {
        code |= LEFT;
    }
    else if (x > boundingBox.right) {
        code |= RIGHT;
    }
    if (y < boundingBox.top) {
        code |= BOTTOM;
    }
    else if (y > boundingBox.bottom) {
        code |= TOP;
    }
    return code;
}
function lineSegmentAABBIntersect(seg, boundingBox) {
    let [[x0, y0], [x1, y1]] = seg;
    let outcode0 = outCode(x0, y0, boundingBox);
    let outcode1 = outCode(x1, y1, boundingBox);
    while (true) {
        if (!(outcode0 | outcode1)) {
            // bitwise OR is 0: both points inside window; trivially accept and exit loop
            return true;
        }
        else if (outcode0 & outcode1) {
            // bitwise AND is not 0: both points share an outside zone (LEFT, RIGHT, TOP,
            // or BOTTOM), so both must be outside window; exit loop (accept is false)
            return false;
        }
        else {
            const { top, right, bottom, left } = boundingBox;
            // failed both tests, so calculate the line segment to clip
            // from an outside point to an intersection with clip edge
            let x, y;
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
            }
            else if (outcodeOut & BOTTOM) {
                // point is below the clip window
                x = x0 + ((x1 - x0) * (top - y0)) / (y1 - y0);
                y = top;
            }
            else if (outcodeOut & RIGHT) {
                // point is to the right of clip window
                y = y0 + ((y1 - y0) * (right - x0)) / (x1 - x0);
                x = right;
            }
            else if (outcodeOut & LEFT) {
                // point is to the left of clip window
                y = y0 + ((y1 - y0) * (left - x0)) / (x1 - x0);
                x = left;
            }
            // Now we move outside point to intersection point to clip
            // and get ready for next pass.
            if (outcodeOut == outcode0) {
                x0 = x;
                y0 = y;
                outcode0 = outCode(x0, y0, boundingBox);
            }
            else {
                x1 = x;
                y1 = y;
                outcode1 = outCode(x1, y1, boundingBox);
            }
        }
    }
}

function boundingBoxesOverlap(a, b) {
    return (a.left <= b.right &&
        b.left <= a.right &&
        a.top <= b.bottom &&
        b.top <= a.bottom);
}
function mergeBoundingBoxes(a, b) {
    if (!a)
        return b;
    return {
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
        left: Math.min(a.left, b.left),
    };
}
function extendBoundingBox(boundingBox, point) {
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
function boundingBoxMaxExtent(boundingBox) {
    return Math.max(boundingBox.right - boundingBox.left, boundingBox.bottom - boundingBox.top);
}
function boundingBoxAroundPoint(point, padding) {
    return {
        top: point[1] - padding,
        right: point[0] + padding,
        bottom: point[1] + padding,
        left: point[0] - padding,
    };
}
function expandBoundingBox(boundingBox, padding) {
    return {
        top: boundingBox.top - padding,
        right: boundingBox.right + padding,
        bottom: boundingBox.bottom + padding,
        left: boundingBox.left - padding,
    };
}

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
class QuadTree {
    static fromPairs(pairs, depth, innerNodeCapacity = 8) {
        if (pairs.length === 0) {
            throw new Error("QuadTree.fromPairs: at least one pair needed.");
        }
        let boundingBox = pairs[0][0];
        for (let i = 1; i < pairs.length; i++) {
            boundingBox = mergeBoundingBoxes(boundingBox, pairs[i][0]);
        }
        const tree = new QuadTree(boundingBox, depth, innerNodeCapacity);
        for (const [key, value] of pairs) {
            tree.insert(key, value);
        }
        return tree;
    }
    constructor(boundingBox, depth, innerNodeCapacity = 16) {
        this.boundingBox = boundingBox;
        this.depth = depth;
        this.innerNodeCapacity = innerNodeCapacity;
        this.subtrees = null;
        this.pairs = [];
    }
    insert(boundingBox, value) {
        if (!boundingBoxesOverlap(boundingBox, this.boundingBox))
            return false;
        if (this.depth > 0 && this.pairs.length >= this.innerNodeCapacity) {
            this.ensureSubtrees();
            for (let i = 0; i < this.subtrees.length; i++) {
                const tree = this.subtrees[i];
                tree.insert(boundingBox, value);
            }
        }
        else {
            this.pairs.push([boundingBox, value]);
        }
        return true;
    }
    find(boundingBox, set = new Set()) {
        if (!boundingBoxesOverlap(boundingBox, this.boundingBox))
            return set;
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
    findOnLineSegment(seg, set = new Set()) {
        if (!lineSegmentAABBIntersect(seg, this.boundingBox))
            return set;
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
    ensureSubtrees() {
        if (this.subtrees)
            return;
        const { top, right, bottom, left } = this.boundingBox;
        const midX = (this.boundingBox.left + this.boundingBox.right) / 2;
        const midY = (this.boundingBox.top + this.boundingBox.bottom) / 2;
        this.subtrees = [
            new QuadTree({ top, right: midX, bottom: midY, left }, this.depth - 1, this.innerNodeCapacity),
            new QuadTree({ top, right, bottom: midY, left: midX }, this.depth - 1, this.innerNodeCapacity),
            new QuadTree({ top: midY, right: midX, bottom, left }, this.depth - 1, this.innerNodeCapacity),
            new QuadTree({ top: midY, right, bottom, left: midX }, this.depth - 1, this.innerNodeCapacity),
        ];
    }
}

const EPS$1 = 1e-12;
function pathCubicSegmentSelfIntersection(seg) {
    // https://math.stackexchange.com/questions/3931865/self-intersection-of-a-cubic-bezier-interpretation-of-the-solution
    const A = seg[1];
    const B = seg[2];
    const C = seg[3];
    const D = seg[4];
    const ax = -A[0] + 3 * B[0] - 3 * C[0] + D[0];
    const ay = -A[1] + 3 * B[1] - 3 * C[1] + D[1];
    const bx = 3 * A[0] - 6 * B[0] + 3 * C[0];
    const by = 3 * A[1] - 6 * B[1] + 3 * C[1];
    const cx = -3 * A[0] + 3 * B[0];
    const cy = -3 * A[1] + 3 * B[1];
    const M = ay * bx - ax * by;
    const N = ax * cy - ay * cx;
    const K = (-3 * ax * ax * cy * cy +
        6 * ax * ay * cx * cy +
        4 * ax * bx * by * cy -
        4 * ax * by * by * cx -
        3 * ay * ay * cx * cx -
        4 * ay * bx * bx * cy +
        4 * ay * bx * by * cx) /
        (ax * ax * by * by - 2 * ax * ay * bx * by + ay * ay * bx * bx);
    if (K < 0)
        return null;
    const t1 = (N / M + Math.sqrt(K)) / 2;
    const t2 = (N / M - Math.sqrt(K)) / 2;
    if (EPS$1 <= t1 && t1 <= 1 - EPS$1 && EPS$1 <= t2 && t2 <= 1 - EPS$1) {
        return [t1, t2];
    }
    return null;
}

/**
 * Common utilities
 * @module glMatrix
 */
// Configuration Constants
var ARRAY_TYPE = typeof Float32Array !== 'undefined' ? Float32Array : Array;
if (!Math.hypot) Math.hypot = function () {
  var y = 0,
      i = arguments.length;

  while (i--) {
    y += arguments[i] * arguments[i];
  }

  return Math.sqrt(y);
};

/**
 * 2x2 Matrix
 * @module mat2
 */

/**
 * Creates a new identity mat2
 *
 * @returns {mat2} a new 2x2 matrix
 */

function create$2() {
  var out = new ARRAY_TYPE(4);

  if (ARRAY_TYPE != Float32Array) {
    out[1] = 0;
    out[2] = 0;
  }

  out[0] = 1;
  out[3] = 1;
  return out;
}
/**
 * Transpose the values of a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {ReadonlyMat2} a the source matrix
 * @returns {mat2} out
 */

function transpose(out, a) {
  // If we are transposing ourselves we can skip a few steps but have to cache
  // some values
  if (out === a) {
    var a1 = a[1];
    out[1] = a[2];
    out[2] = a1;
  } else {
    out[0] = a[0];
    out[1] = a[2];
    out[2] = a[1];
    out[3] = a[3];
  }

  return out;
}
/**
 * Creates a matrix from a given angle
 * This is equivalent to (but much faster than):
 *
 *     mat2.identity(dest);
 *     mat2.rotate(dest, dest, rad);
 *
 * @param {mat2} out mat2 receiving operation result
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2} out
 */

function fromRotation$1(out, rad) {
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  out[0] = c;
  out[1] = s;
  out[2] = -s;
  out[3] = c;
  return out;
}

/**
 * 2x3 Matrix
 * @module mat2d
 * @description
 * A mat2d contains six elements defined as:
 * <pre>
 * [a, b,
 *  c, d,
 *  tx, ty]
 * </pre>
 * This is a short form for the 3x3 matrix:
 * <pre>
 * [a, b, 0,
 *  c, d, 0,
 *  tx, ty, 1]
 * </pre>
 * The last column is ignored so the array is shorter and operations are faster.
 */

/**
 * Creates a new identity mat2d
 *
 * @returns {mat2d} a new 2x3 matrix
 */

function create$1() {
  var out = new ARRAY_TYPE(6);

  if (ARRAY_TYPE != Float32Array) {
    out[1] = 0;
    out[2] = 0;
    out[4] = 0;
    out[5] = 0;
  }

  out[0] = 1;
  out[3] = 1;
  return out;
}
/**
 * Multiplies two mat2d's
 *
 * @param {mat2d} out the receiving matrix
 * @param {ReadonlyMat2d} a the first operand
 * @param {ReadonlyMat2d} b the second operand
 * @returns {mat2d} out
 */

function multiply(out, a, b) {
  var a0 = a[0],
      a1 = a[1],
      a2 = a[2],
      a3 = a[3],
      a4 = a[4],
      a5 = a[5];
  var b0 = b[0],
      b1 = b[1],
      b2 = b[2],
      b3 = b[3],
      b4 = b[4],
      b5 = b[5];
  out[0] = a0 * b0 + a2 * b1;
  out[1] = a1 * b0 + a3 * b1;
  out[2] = a0 * b2 + a2 * b3;
  out[3] = a1 * b2 + a3 * b3;
  out[4] = a0 * b4 + a2 * b5 + a4;
  out[5] = a1 * b4 + a3 * b5 + a5;
  return out;
}
/**
 * Rotates a mat2d by the given angle
 *
 * @param {mat2d} out the receiving matrix
 * @param {ReadonlyMat2d} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2d} out
 */

function rotate$1(out, a, rad) {
  var a0 = a[0],
      a1 = a[1],
      a2 = a[2],
      a3 = a[3],
      a4 = a[4],
      a5 = a[5];
  var s = Math.sin(rad);
  var c = Math.cos(rad);
  out[0] = a0 * c + a2 * s;
  out[1] = a1 * c + a3 * s;
  out[2] = a0 * -s + a2 * c;
  out[3] = a1 * -s + a3 * c;
  out[4] = a4;
  out[5] = a5;
  return out;
}
/**
 * Scales the mat2d by the dimensions in the given vec2
 *
 * @param {mat2d} out the receiving matrix
 * @param {ReadonlyMat2d} a the matrix to translate
 * @param {ReadonlyVec2} v the vec2 to scale the matrix by
 * @returns {mat2d} out
 **/

function scale$1(out, a, v) {
  var a0 = a[0],
      a1 = a[1],
      a2 = a[2],
      a3 = a[3],
      a4 = a[4],
      a5 = a[5];
  var v0 = v[0],
      v1 = v[1];
  out[0] = a0 * v0;
  out[1] = a1 * v0;
  out[2] = a2 * v1;
  out[3] = a3 * v1;
  out[4] = a4;
  out[5] = a5;
  return out;
}
/**
 * Creates a matrix from a given angle
 * This is equivalent to (but much faster than):
 *
 *     mat2d.identity(dest);
 *     mat2d.rotate(dest, dest, rad);
 *
 * @param {mat2d} out mat2d receiving operation result
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2d} out
 */

function fromRotation(out, rad) {
  var s = Math.sin(rad),
      c = Math.cos(rad);
  out[0] = c;
  out[1] = s;
  out[2] = -s;
  out[3] = c;
  out[4] = 0;
  out[5] = 0;
  return out;
}
/**
 * Creates a matrix from a vector translation
 * This is equivalent to (but much faster than):
 *
 *     mat2d.identity(dest);
 *     mat2d.translate(dest, dest, vec);
 *
 * @param {mat2d} out mat2d receiving operation result
 * @param {ReadonlyVec2} v Translation vector
 * @returns {mat2d} out
 */

function fromTranslation(out, v) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
  out[4] = v[0];
  out[5] = v[1];
  return out;
}
/**
 * Alias for {@link mat2d.multiply}
 * @function
 */

var mul = multiply;

/**
 * 2 Dimensional Vector
 * @module vec2
 */

/**
 * Creates a new, empty vec2
 *
 * @returns {vec2} a new 2D vector
 */

function create() {
  var out = new ARRAY_TYPE(2);

  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
  }

  return out;
}
/**
 * Set the components of a vec2 to the given values
 *
 * @param {vec2} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @returns {vec2} out
 */

function set(out, x, y) {
  out[0] = x;
  out[1] = y;
  return out;
}
/**
 * Adds two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {ReadonlyVec2} a the first operand
 * @param {ReadonlyVec2} b the second operand
 * @returns {vec2} out
 */

function add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  return out;
}
/**
 * Subtracts vector b from vector a
 *
 * @param {vec2} out the receiving vector
 * @param {ReadonlyVec2} a the first operand
 * @param {ReadonlyVec2} b the second operand
 * @returns {vec2} out
 */

function subtract(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  return out;
}
/**
 * Scales a vec2 by a scalar number
 *
 * @param {vec2} out the receiving vector
 * @param {ReadonlyVec2} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec2} out
 */

function scale(out, a, b) {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  return out;
}
/**
 * Calculates the length of a vec2
 *
 * @param {ReadonlyVec2} a vector to calculate length of
 * @returns {Number} length of a
 */

function length(a) {
  var x = a[0],
      y = a[1];
  return Math.hypot(x, y);
}
/**
 * Calculates the dot product of two vec2's
 *
 * @param {ReadonlyVec2} a the first operand
 * @param {ReadonlyVec2} b the second operand
 * @returns {Number} dot product of a and b
 */

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}
/**
 * Performs a linear interpolation between two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {ReadonlyVec2} a the first operand
 * @param {ReadonlyVec2} b the second operand
 * @param {Number} t interpolation amount, in the range [0-1], between the two inputs
 * @returns {vec2} out
 */

function lerp$1(out, a, b, t) {
  var ax = a[0],
      ay = a[1];
  out[0] = ax + t * (b[0] - ax);
  out[1] = ay + t * (b[1] - ay);
  return out;
}
/**
 * Transforms the vec2 with a mat2
 *
 * @param {vec2} out the receiving vector
 * @param {ReadonlyVec2} a the vector to transform
 * @param {ReadonlyMat2} m matrix to transform with
 * @returns {vec2} out
 */

function transformMat2(out, a, m) {
  var x = a[0],
      y = a[1];
  out[0] = m[0] * x + m[2] * y;
  out[1] = m[1] * x + m[3] * y;
  return out;
}
/**
 * Transforms the vec2 with a mat2d
 *
 * @param {vec2} out the receiving vector
 * @param {ReadonlyVec2} a the vector to transform
 * @param {ReadonlyMat2d} m matrix to transform with
 * @returns {vec2} out
 */

function transformMat2d(out, a, m) {
  var x = a[0],
      y = a[1];
  out[0] = m[0] * x + m[2] * y + m[4];
  out[1] = m[1] * x + m[3] * y + m[5];
  return out;
}
/**
 * Rotate a 2D vector
 * @param {vec2} out The receiving vec2
 * @param {ReadonlyVec2} a The vec2 point to rotate
 * @param {ReadonlyVec2} b The origin of the rotation
 * @param {Number} rad The angle of rotation in radians
 * @returns {vec2} out
 */

function rotate(out, a, b, rad) {
  //Translate point to the origin
  var p0 = a[0] - b[0],
      p1 = a[1] - b[1],
      sinC = Math.sin(rad),
      cosC = Math.cos(rad); //perform rotation and translate to correct position

  out[0] = p0 * cosC - p1 * sinC + b[0];
  out[1] = p0 * sinC + p1 * cosC + b[1];
  return out;
}
/**
 * Alias for {@link vec2.length}
 * @function
 */

var len = length;
/**
 * Alias for {@link vec2.subtract}
 * @function
 */

var sub = subtract;
/**
 * Perform some operation over an array of vec2s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec2. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec2s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */

(function () {
  var vec = create();
  return function (a, stride, offset, count, fn, arg) {
    var i, l;

    if (!stride) {
      stride = 2;
    }

    if (!offset) {
      offset = 0;
    }

    if (count) {
      l = Math.min(count * stride + offset, a.length);
    } else {
      l = a.length;
    }

    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
    }

    return a;
  };
})();

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
const TAU = 2 * Math.PI;
function linMap(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
function deg2rad(deg) {
    return (deg / 180) * Math.PI;
}
function vectorAngle(u, v) {
    const EPS = 1e-12;
    const sign = Math.sign(u[0] * v[1] - u[1] * v[0]);
    if (sign === 0 &&
        Math.abs(u[0] + v[0]) < EPS &&
        Math.abs(u[1] + v[1]) < EPS) {
        // TODO: u can be scaled
        return Math.PI;
    }
    return sign * Math.acos(dot(u, v) / len(u) / len(v));
}

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
function createVector() {
    return [0, 0];
}
function vectorsEqual(a, b, eps = 0) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
function getStartPoint(seg) {
    return seg[1];
}
function getEndPoint(seg) {
    switch (seg[0]) {
        case "L":
            return seg[2];
        case "C":
            return seg[4];
        case "Q":
            return seg[3];
        case "A":
            return seg[7];
    }
}
function reversePathSegment(seg) {
    switch (seg[0]) {
        case "L":
            return ["L", seg[2], seg[1]];
        case "C":
            return ["C", seg[4], seg[3], seg[2], seg[1]];
        case "Q":
            return ["Q", seg[3], seg[2], seg[1]];
        case "A":
            return [
                "A",
                seg[7],
                seg[2],
                seg[3],
                seg[4],
                seg[5],
                !seg[6],
                seg[1],
            ];
    }
}
const arcSegmentToCenter = (() => {
    const xy1Prime = createVector();
    const rotationMatrix = create$2();
    const addend = createVector();
    const cxy = createVector();
    return function arcSegmentToCenter([_A, xy1, rx, ry, phi, fA, fS, xy2,]) {
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        if (rx === 0 || ry === 0) {
            return null;
        }
        // https://svgwg.org/svg2-draft/implnote.html#ArcConversionEndpointToCenter
        fromRotation$1(rotationMatrix, -deg2rad(phi));
        sub(xy1Prime, xy1, xy2);
        scale(xy1Prime, xy1Prime, 0.5);
        transformMat2(xy1Prime, xy1Prime, rotationMatrix);
        let rx2 = rx * rx;
        let ry2 = ry * ry;
        const x1Prime2 = xy1Prime[0] * xy1Prime[0];
        const y1Prime2 = xy1Prime[1] * xy1Prime[1];
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        const lambda = x1Prime2 / rx2 + y1Prime2 / ry2 + 1e-12; // small epsilon needed because of float precision
        if (lambda > 1) {
            const lambdaSqrt = Math.sqrt(lambda);
            rx *= lambdaSqrt;
            ry *= lambdaSqrt;
            const lambdaAbs = Math.abs(lambda);
            rx2 *= lambdaAbs;
            ry2 *= lambdaAbs;
        }
        const sign = fA === fS ? -1 : 1;
        const multiplier = Math.sqrt((rx2 * ry2 - rx2 * y1Prime2 - ry2 * x1Prime2) /
            (rx2 * y1Prime2 + ry2 * x1Prime2));
        const cxPrime = sign * multiplier * ((rx * xy1Prime[1]) / ry);
        const cyPrime = sign * multiplier * ((-ry * xy1Prime[0]) / rx);
        transpose(rotationMatrix, rotationMatrix);
        add(addend, xy1, xy2);
        scale(addend, addend, 0.5);
        transformMat2(cxy, [cxPrime, cyPrime], rotationMatrix);
        add(cxy, cxy, addend);
        const vec1 = [
            (xy1Prime[0] - cxPrime) / rx,
            (xy1Prime[1] - cyPrime) / ry,
        ];
        const theta1 = vectorAngle([1, 0], vec1);
        let deltaTheta = vectorAngle(vec1, [
            (-xy1Prime[0] - cxPrime) / rx,
            (-xy1Prime[1] - cyPrime) / ry,
        ]);
        if (!fS && deltaTheta > 0) {
            deltaTheta -= TAU;
        }
        else if (fS && deltaTheta < 0) {
            deltaTheta += TAU;
        }
        return {
            center: [cxy[0], cxy[1]],
            theta1,
            deltaTheta,
            rx,
            ry,
            phi,
        };
    };
})();
const arcSegmentFromCenter = (() => {
    const xy1 = createVector();
    const xy2 = createVector();
    const rotationMatrix = create$2();
    return function arcSegmentFromCenter({ center, theta1, deltaTheta, rx, ry, phi, }) {
        // https://svgwg.org/svg2-draft/implnote.html#ArcConversionCenterToEndpoint
        fromRotation$1(rotationMatrix, phi); // TODO: sign (also in sampleAt)
        set(xy1, rx * Math.cos(theta1), ry * Math.sin(theta1));
        transformMat2(xy1, xy1, rotationMatrix);
        add(xy1, xy1, center);
        set(xy2, rx * Math.cos(theta1 + deltaTheta), ry * Math.sin(theta1 + deltaTheta));
        transformMat2(xy2, xy2, rotationMatrix);
        add(xy2, xy2, center);
        const fA = Math.abs(deltaTheta) > Math.PI;
        const fS = deltaTheta > 0;
        return ["A", [xy1[0], xy1[1]], rx, ry, phi, fA, fS, [xy2[0], xy2[1]]];
    };
})();
const samplePathSegmentAt = (() => {
    const p01 = createVector();
    const p12 = createVector();
    const p23 = createVector();
    const p012 = createVector();
    const p123 = createVector();
    const p = createVector();
    return function samplePathSegmentAt(seg, t) {
        switch (seg[0]) {
            case "L":
                lerp$1(p, seg[1], seg[2], t);
                break;
            case "C":
                lerp$1(p01, seg[1], seg[2], t);
                lerp$1(p12, seg[2], seg[3], t);
                lerp$1(p23, seg[3], seg[4], t);
                lerp$1(p012, p01, p12, t);
                lerp$1(p123, p12, p23, t);
                lerp$1(p, p012, p123, t);
                break;
            case "Q":
                lerp$1(p01, seg[1], seg[2], t);
                lerp$1(p12, seg[2], seg[3], t);
                lerp$1(p, p01, p12, t);
                break;
            case "A": {
                const centerParametrization = arcSegmentToCenter(seg);
                if (!centerParametrization) {
                    // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
                    lerp$1(p, seg[1], seg[7], t);
                    break;
                }
                const { deltaTheta, phi, theta1, rx, ry, center } = centerParametrization;
                const theta = theta1 + t * deltaTheta;
                set(p, rx * Math.cos(theta), ry * Math.sin(theta));
                rotate(p, p, [0, 0], phi); // TODO: sign (also in fromCenter)
                add(p, p, center);
                break;
            }
        }
        return [p[0], p[1]];
    };
})();
const arcSegmentToCubics = (() => {
    const fromUnit = create$1();
    const matrix = create$1();
    return function arcSegmentToCubics(arc, maxDeltaTheta = Math.PI / 2) {
        const centerParametrization = arcSegmentToCenter(arc);
        if (!centerParametrization) {
            // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
            // "If rx = 0 or ry = 0, then treat this as a straight line from (x1, y1) to (x2, y2) and stop."
            return [["L", arc[1], arc[7]]];
        }
        const { center, theta1, deltaTheta, rx, ry } = centerParametrization;
        const count = Math.ceil(Math.abs(deltaTheta) / maxDeltaTheta);
        fromTranslation(fromUnit, center);
        rotate$1(fromUnit, fromUnit, deg2rad(arc[4]));
        scale$1(fromUnit, fromUnit, [rx, ry]);
        // https://pomax.github.io/bezierinfo/#circles_cubic
        const cubics = [];
        const theta = deltaTheta / count;
        const k = (4 / 3) * Math.tan(theta / 4);
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        for (let i = 0; i < count; i++) {
            const start = [1, 0];
            const control1 = [1, k];
            const control2 = [
                cosTheta + k * sinTheta,
                sinTheta - k * cosTheta,
            ];
            const end = [cosTheta, sinTheta];
            fromRotation(matrix, theta1 + i * theta);
            mul(matrix, fromUnit, matrix);
            transformMat2d(start, start, matrix);
            transformMat2d(control1, control1, matrix);
            transformMat2d(control2, control2, matrix);
            transformMat2d(end, end, matrix);
            cubics.push(["C", start, control1, control2, end]);
        }
        return cubics;
    };
})();
function evalCubic1d(p0, p1, p2, p3, t) {
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, p3, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    return lerp(p012, p123, t);
}
function cubicBoundingInterval(p0, p1, p2, p3) {
    let min = Math.min(p0, p3);
    let max = Math.max(p0, p3);
    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const b = 6 * (p0 - 2 * p1 + p2);
    const c = 3 * (p1 - p0);
    const D = b * b - 4 * a * c;
    if (D < 0 || a === 0) {
        // TODO: if a=0, solve linear
        return [min, max];
    }
    const sqrtD = Math.sqrt(D);
    const t0 = (-b - sqrtD) / (2 * a);
    if (0 < t0 && t0 < 1) {
        const x0 = evalCubic1d(p0, p1, p2, p3, t0);
        min = Math.min(min, x0);
        max = Math.max(max, x0);
    }
    const t1 = (-b + sqrtD) / (2 * a);
    if (0 < t1 && t1 < 1) {
        const x1 = evalCubic1d(p0, p1, p2, p3, t1);
        min = Math.min(min, x1);
        max = Math.max(max, x1);
    }
    return [min, max];
}
function evalQuadratic1d(p0, p1, p2, t) {
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    return lerp(p01, p12, t);
}
function quadraticBoundingInterval(p0, p1, p2) {
    let min = Math.min(p0, p2);
    let max = Math.max(p0, p2);
    const denominator = p0 - 2 * p1 + p2;
    if (denominator === 0) {
        return [min, max];
    }
    const t = (p0 - p1) / denominator;
    if (0 <= t && t <= 1) {
        const x = evalQuadratic1d(p0, p1, p2, t);
        min = Math.min(min, x);
        max = Math.max(max, x);
    }
    return [min, max];
}
function inInterval(x, x0, x1) {
    const mapped = (x - x0) / (x1 - x0);
    return 0 <= mapped && mapped <= 1;
}
function pathSegmentBoundingBox(seg) {
    switch (seg[0]) {
        case "L":
            return {
                top: Math.min(seg[1][1], seg[2][1]),
                right: Math.max(seg[1][0], seg[2][0]),
                bottom: Math.max(seg[1][1], seg[2][1]),
                left: Math.min(seg[1][0], seg[2][0]),
            };
        case "C": {
            const [left, right] = cubicBoundingInterval(seg[1][0], seg[2][0], seg[3][0], seg[4][0]);
            const [top, bottom] = cubicBoundingInterval(seg[1][1], seg[2][1], seg[3][1], seg[4][1]);
            return { top, right, bottom, left };
        }
        case "Q": {
            const [left, right] = quadraticBoundingInterval(seg[1][0], seg[2][0], seg[3][0]);
            const [top, bottom] = quadraticBoundingInterval(seg[1][1], seg[2][1], seg[3][1]);
            return { top, right, bottom, left };
        }
        case "A": {
            const centerParametrization = arcSegmentToCenter(seg);
            if (!centerParametrization) {
                return extendBoundingBox(boundingBoxAroundPoint(seg[1], 0), seg[7]);
            }
            const { theta1, deltaTheta, phi, center, rx, ry } = centerParametrization;
            if (phi === 0 || rx === ry) {
                const theta2 = theta1 + deltaTheta;
                let boundingBox = extendBoundingBox(boundingBoxAroundPoint(seg[1], 0), seg[7]);
                // FIXME: the following gives false positives, resulting in larger boxes
                if (inInterval(-Math.PI, theta1, theta2) ||
                    inInterval(Math.PI, theta1, theta2)) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0] - rx,
                        center[1],
                    ]);
                }
                if (inInterval(-Math.PI / 2, theta1, theta2) ||
                    inInterval((3 * Math.PI) / 2, theta1, theta2)) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0],
                        center[1] - ry,
                    ]);
                }
                if (inInterval(0, theta1, theta2) ||
                    inInterval(2 * Math.PI, theta1, theta2)) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0] + rx,
                        center[1],
                    ]);
                }
                if (inInterval(Math.PI / 2, theta1, theta2) ||
                    inInterval((5 * Math.PI) / 2, theta1, theta2)) {
                    boundingBox = extendBoundingBox(boundingBox, [
                        center[0],
                        center[1] + ry,
                    ]);
                }
                return expandBoundingBox(boundingBox, 1e-11); // TODO: get rid of expansion
            }
            // TODO: don't convert to cubics
            const cubics = arcSegmentToCubics(seg, Math.PI / 16);
            let boundingBox = null;
            for (const seg of cubics) {
                boundingBox = mergeBoundingBoxes(boundingBox, pathSegmentBoundingBox(seg));
            }
            if (!boundingBox) {
                return boundingBoxAroundPoint(seg[1], 0); //  TODO: what to do here?
            }
            return boundingBox;
        }
    }
}
function splitLinearSegmentAt(seg, t) {
    const a = seg[1];
    const b = seg[2];
    const p = lerp$1(createVector(), a, b, t);
    return [
        ["L", a, p],
        ["L", p, b],
    ];
}
function splitCubicSegmentAt(seg, t) {
    // https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm
    const p0 = seg[1];
    const p1 = seg[2];
    const p2 = seg[3];
    const p3 = seg[4];
    const p01 = lerp$1(createVector(), p0, p1, t);
    const p12 = lerp$1(createVector(), p1, p2, t);
    const p23 = lerp$1(createVector(), p2, p3, t);
    const p012 = lerp$1(createVector(), p01, p12, t);
    const p123 = lerp$1(createVector(), p12, p23, t);
    const p = lerp$1(createVector(), p012, p123, t);
    return [
        ["C", p0, p01, p012, p],
        ["C", p, p123, p23, p3],
    ];
}
function splitQuadraticSegmentAt(seg, t) {
    // https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm
    const p0 = seg[1];
    const p1 = seg[2];
    const p2 = seg[3];
    const p01 = lerp$1(createVector(), p0, p1, t);
    const p12 = lerp$1(createVector(), p1, p2, t);
    const p = lerp$1(createVector(), p01, p12, t);
    return [
        ["Q", p0, p01, p],
        ["Q", p, p12, p2],
    ];
}
function splitArcSegmentAt(seg, t) {
    const centerParametrization = arcSegmentToCenter(seg);
    if (!centerParametrization) {
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        return splitLinearSegmentAt(["L", seg[1], seg[7]], t);
    }
    const midDeltaTheta = centerParametrization.deltaTheta * t;
    return [
        arcSegmentFromCenter({
            ...centerParametrization,
            deltaTheta: midDeltaTheta,
        }),
        arcSegmentFromCenter({
            ...centerParametrization,
            theta1: centerParametrization.theta1 + midDeltaTheta,
            deltaTheta: centerParametrization.deltaTheta - midDeltaTheta,
        }),
    ];
}
function splitSegmentAt(seg, t) {
    switch (seg[0]) {
        case "L":
            return splitLinearSegmentAt(seg, t);
        case "C":
            return splitCubicSegmentAt(seg, t);
        case "Q":
            return splitQuadraticSegmentAt(seg, t);
        case "A":
            return splitArcSegmentAt(seg, t);
    }
}

const COLLINEAR_EPS = Number.MIN_VALUE * 64;
function lineSegmentIntersection([[x1, y1], [x2, y2]], [[x3, y3], [x4, y4]], eps) {
    // https://en.wikipedia.org/wiki/Intersection_(geometry)#Two_line_segments
    const a1 = x2 - x1;
    const b1 = x3 - x4;
    const c1 = x3 - x1;
    const a2 = y2 - y1;
    const b2 = y3 - y4;
    const c2 = y3 - y1;
    const denom = a1 * b2 - a2 * b1;
    if (Math.abs(denom) < COLLINEAR_EPS)
        return null;
    const s = (c1 * b2 - c2 * b1) / denom;
    const t = (a1 * c2 - a2 * c1) / denom;
    if (-eps <= s && s <= 1 + eps && -eps <= t && t <= 1 + eps) {
        return [s, t];
    }
    return null;
}
function lineSegmentsIntersect(seg1, seg2, eps) {
    return !!lineSegmentIntersection(seg1, seg2, eps);
}

function subdivideIntersectionSegment(intSeg) {
    const [seg0, seg1] = splitSegmentAt(intSeg.seg, 0.5);
    const midParam = (intSeg.startParam + intSeg.endParam) / 2;
    return [
        {
            seg: seg0,
            startParam: intSeg.startParam,
            endParam: midParam,
            boundingBox: pathSegmentBoundingBox(seg0),
        },
        {
            seg: seg1,
            startParam: midParam,
            endParam: intSeg.endParam,
            boundingBox: pathSegmentBoundingBox(seg1),
        },
    ];
}
function pathSegmentToLineSegment(seg) {
    switch (seg[0]) {
        case "L":
            return [seg[1], seg[2]];
        case "C":
            return [seg[1], seg[4]];
        case "Q":
            return [seg[1], seg[3]];
        case "A":
            return [seg[1], seg[7]];
    }
}
function intersectionSegmentsOverlap({ seg: seg0, boundingBox: boundingBox0 }, { seg: seg1, boundingBox: boundingBox1 }) {
    if (seg0[0] === "L") {
        if (seg1[0] === "L") {
            return lineSegmentsIntersect([seg0[1], seg0[2]], [seg1[1], seg1[2]], 1e-6);
        }
        else {
            return lineSegmentAABBIntersect([seg0[1], seg0[2]], boundingBox1);
        }
    }
    else {
        if (seg1[0] === "L") {
            return lineSegmentAABBIntersect([seg1[1], seg1[2]], boundingBox0);
        }
        else {
            return boundingBoxesOverlap(boundingBox0, boundingBox1);
        }
    }
}
function segmentsEqual(seg0, seg1, pointEpsilon) {
    const type = seg0[0];
    if (seg1[0] !== type)
        return false;
    switch (type) {
        case "L":
            return (vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                vectorsEqual(seg0[2], seg1[2], pointEpsilon));
        case "C":
            return (vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                vectorsEqual(seg0[2], seg1[2], pointEpsilon) &&
                vectorsEqual(seg0[3], seg1[3], pointEpsilon) &&
                vectorsEqual(seg0[4], seg1[4], pointEpsilon));
        case "Q":
            return (vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                vectorsEqual(seg0[2], seg1[2], pointEpsilon) &&
                vectorsEqual(seg0[3], seg1[3], pointEpsilon));
        case "A":
            return (vectorsEqual(seg0[1], seg1[1], pointEpsilon) &&
                Math.abs(seg0[2] - seg1[2]) < pointEpsilon &&
                Math.abs(seg0[3] - seg1[3]) < pointEpsilon &&
                Math.abs(seg0[4] - seg1[4]) < pointEpsilon && // TODO: Phi can be anything if rx = ry. Also, handle rotations by Pi/2.
                seg0[5] === seg1[5] &&
                seg0[6] === seg1[6] &&
                vectorsEqual(seg0[7], seg1[7], pointEpsilon));
    }
}
function pathSegmentIntersection(seg0, seg1, endpoints, eps) {
    if (seg0[0] === "L" && seg1[0] === "L") {
        const st = lineSegmentIntersection([seg0[1], seg0[2]], [seg1[1], seg1[2]], eps.param);
        if (st) {
            if (!endpoints &&
                (st[0] < eps.param || st[0] > 1 - eps.param) &&
                (st[1] < eps.param || st[1] > 1 - eps.param)) {
                return [];
            }
            return [st];
        }
    }
    // https://math.stackexchange.com/questions/20321/how-can-i-tell-when-two-cubic-b%C3%A9zier-curves-intersect
    let pairs = [
        [
            {
                seg: seg0,
                startParam: 0,
                endParam: 1,
                boundingBox: pathSegmentBoundingBox(seg0),
            },
            {
                seg: seg1,
                startParam: 0,
                endParam: 1,
                boundingBox: pathSegmentBoundingBox(seg1),
            },
        ],
    ];
    const params = [];
    while (pairs.length) {
        const nextPairs = [];
        for (const [seg0, seg1] of pairs) {
            if (segmentsEqual(seg0.seg, seg1.seg, eps.point)) {
                // TODO: move this outside of this loop?
                continue; // TODO: what to do?
            }
            const isLinear0 = boundingBoxMaxExtent(seg0.boundingBox) <= eps.linear;
            const isLinear1 = boundingBoxMaxExtent(seg1.boundingBox) <= eps.linear;
            if (isLinear0 && isLinear1) {
                const lineSegment0 = pathSegmentToLineSegment(seg0.seg);
                const lineSegment1 = pathSegmentToLineSegment(seg1.seg);
                const st = lineSegmentIntersection(lineSegment0, lineSegment1, eps.param);
                if (st) {
                    params.push([
                        lerp(seg0.startParam, seg0.endParam, st[0]),
                        lerp(seg1.startParam, seg1.endParam, st[1]),
                    ]);
                }
            }
            else {
                const subdivided0 = isLinear0
                    ? [seg0]
                    : subdivideIntersectionSegment(seg0);
                const subdivided1 = isLinear1
                    ? [seg1]
                    : subdivideIntersectionSegment(seg1);
                for (const seg0 of subdivided0) {
                    for (const seg1 of subdivided1) {
                        if (intersectionSegmentsOverlap(seg0, seg1)) {
                            nextPairs.push([seg0, seg1]);
                        }
                    }
                }
            }
        }
        pairs = nextPairs;
    }
    if (!endpoints) {
        return params.filter(([s, t]) => (s > eps.param && s < 1 - eps.param) ||
            (t > eps.param && t < 1 - eps.param));
    }
    return params;
}

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
const hasOwn = Object.hasOwn;
function memoizeWeak(fn) {
    const cache = new WeakMap();
    return (obj, ...args) => {
        if (cache.has(obj)) {
            return cache.get(obj);
        }
        else {
            const val = fn(obj, ...args);
            cache.set(obj, val);
            return val;
        }
    };
}

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
function* map(iter, fn) {
    let i = 0;
    for (const val of iter) {
        yield fn(val, i++);
    }
}

const INTERSECTION_TREE_DEPTH = 8;
const POINT_TREE_DEPTH = 8;
const EPS = {
    point: 1e-6,
    linear: 1e-4,
    param: 1e-8,
};
var PathBooleanOperation;
(function (PathBooleanOperation) {
    PathBooleanOperation[PathBooleanOperation["Union"] = 0] = "Union";
    PathBooleanOperation[PathBooleanOperation["Difference"] = 1] = "Difference";
    PathBooleanOperation[PathBooleanOperation["Intersection"] = 2] = "Intersection";
    PathBooleanOperation[PathBooleanOperation["Exclusion"] = 3] = "Exclusion";
    PathBooleanOperation[PathBooleanOperation["Division"] = 4] = "Division";
    PathBooleanOperation[PathBooleanOperation["Fracture"] = 5] = "Fracture";
})(PathBooleanOperation || (PathBooleanOperation = {}));
var FillRule;
(function (FillRule) {
    FillRule[FillRule["NonZero"] = 0] = "NonZero";
    FillRule[FillRule["EvenOdd"] = 1] = "EvenOdd";
})(FillRule || (FillRule = {}));
function firstElementOfSet(set) {
    return set.values().next().value;
}
function createObjectCounter() {
    let i = 0;
    return memoizeWeak(() => i++);
}
function segmentToEdge(parent) {
    return (seg) => ({ seg, parent });
}
function splitAtSelfIntersections(edges) {
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (edge.seg[0] !== "C")
            continue;
        const intersection = pathCubicSegmentSelfIntersection(edge.seg);
        if (!intersection)
            continue;
        if (intersection[0] > intersection[1]) {
            intersection.reverse();
        }
        const [t1, t2] = intersection;
        if (Math.abs(t1 - t2) < EPS.param) {
            const [seg1, seg2] = splitCubicSegmentAt(edge.seg, t1);
            edges[i] = {
                seg: seg1,
                parent: edge.parent,
            };
            edges.push({
                seg: seg2,
                parent: edge.parent,
            });
        }
        else {
            const [seg1, tmpSeg] = splitCubicSegmentAt(edge.seg, t1);
            const [seg2, seg3] = splitCubicSegmentAt(tmpSeg, (t2 - t1) / (1 - t1));
            edges[i] = {
                seg: seg1,
                parent: edge.parent,
            };
            edges.push({
                seg: seg2,
                parent: edge.parent,
            }, {
                seg: seg3,
                parent: edge.parent,
            });
        }
    }
}
function splitAtIntersections(edges) {
    const withBoundingBox = edges.map((edge) => ({
        ...edge,
        boundingBox: pathSegmentBoundingBox(edge.seg),
    }));
    const totalBoundingBox = withBoundingBox.reduce((acc, { boundingBox }) => mergeBoundingBoxes(acc, boundingBox), null);
    if (!totalBoundingBox) {
        return { edges: [], totalBoundingBox: null };
    }
    const edgeTree = new QuadTree(totalBoundingBox, INTERSECTION_TREE_DEPTH);
    const splitsPerEdge = {};
    function addSplit(i, t) {
        if (!hasOwn(splitsPerEdge, i))
            splitsPerEdge[i] = [];
        splitsPerEdge[i].push(t);
    }
    for (let i = 0; i < withBoundingBox.length; i++) {
        const edge = withBoundingBox[i];
        const candidates = edgeTree.find(edge.boundingBox);
        for (const j of candidates) {
            const candidate = edges[j];
            const includeEndpoints = edge.parent !== candidate.parent ||
                !(
                // TODO: this is not correct
                (vectorsEqual(getEndPoint(candidate.seg), getStartPoint(edge.seg), EPS.point) ||
                    vectorsEqual(getStartPoint(candidate.seg), getEndPoint(edge.seg), EPS.point)));
            const intersection = pathSegmentIntersection(edge.seg, candidate.seg, includeEndpoints, EPS);
            for (const [t0, t1] of intersection) {
                addSplit(i, t0);
                addSplit(j, t1);
            }
        }
        /*
         Insert the edge to the tree here, after checking intersections.
         That way, each pair is only tested once.
        */
        edgeTree.insert(edge.boundingBox, i);
    }
    const newEdges = [];
    for (let i = 0; i < withBoundingBox.length; i++) {
        const edge = withBoundingBox[i];
        if (!hasOwn(splitsPerEdge, i)) {
            newEdges.push(edge);
            continue;
        }
        const splits = splitsPerEdge[i];
        splits.sort();
        let tmpSeg = edge.seg;
        let prevT = 0;
        for (let j = 0; j < splits.length; j++) {
            const t = splits[j];
            if (t > 1 - EPS.param)
                break; // skip splits near end
            const tt = (t - prevT) / (1 - prevT);
            prevT = t;
            if (tt < EPS.param)
                continue; // skip splits near start
            if (tt > 1 - EPS.param)
                continue; // skip splits near end
            const [seg1, seg2] = splitSegmentAt(tmpSeg, tt);
            newEdges.push({
                seg: seg1,
                boundingBox: pathSegmentBoundingBox(seg1),
                parent: edge.parent,
            });
            tmpSeg = seg2;
        }
        newEdges.push({
            seg: tmpSeg,
            boundingBox: pathSegmentBoundingBox(tmpSeg),
            parent: edge.parent,
        });
    }
    return { edges: newEdges, totalBoundingBox };
}
function findVertices(edges, boundingBox) {
    const vertexTree = new QuadTree(boundingBox, POINT_TREE_DEPTH);
    const newVertices = [];
    function getVertex(point) {
        const box = boundingBoxAroundPoint(point, EPS.point);
        const existingVertices = vertexTree.find(box);
        if (existingVertices.size) {
            return firstElementOfSet(existingVertices);
        }
        else {
            const vertex = {
                point,
                outgoingEdges: [],
            };
            vertexTree.insert(box, vertex);
            newVertices.push(vertex);
            return vertex;
        }
    }
    const getVertexId = createObjectCounter();
    const vertexPairIdToEdges = {};
    const newEdges = edges.flatMap((edge) => {
        const startVertex = getVertex(getStartPoint(edge.seg));
        const endVertex = getVertex(getEndPoint(edge.seg));
        // discard zero-length segments
        if (startVertex === endVertex) {
            switch (edge.seg[0]) {
                case "L":
                    return [];
                case "C":
                    if (vectorsEqual(edge.seg[1], edge.seg[2], EPS.point) &&
                        vectorsEqual(edge.seg[3], edge.seg[4], EPS.point)) {
                        return [];
                    }
                    break;
                case "Q":
                    if (vectorsEqual(edge.seg[1], edge.seg[2], EPS.point)) {
                        return [];
                    }
                    break;
                case "A":
                    if (edge.seg[5] === false) {
                        return [];
                    }
                    break;
            }
        }
        const vertexPairId = `${getVertexId(startVertex)}:${getVertexId(endVertex)}`;
        // TODO: check other direction
        if (hasOwn(vertexPairIdToEdges, vertexPairId)) {
            const existingEdge = vertexPairIdToEdges[vertexPairId].find((other) => segmentsEqual(other[0].seg, edge.seg, EPS.point));
            if (existingEdge) {
                existingEdge[1].parent |= edge.parent;
                existingEdge[2].parent |= edge.parent;
                return [];
            }
        }
        const fwdEdge = {
            ...edge,
            incidentVertices: [startVertex, endVertex],
            directionFlag: false,
            twin: null,
        };
        const bwdEdge = {
            ...edge,
            incidentVertices: [endVertex, startVertex],
            directionFlag: true,
            twin: fwdEdge,
        };
        fwdEdge.twin = bwdEdge;
        startVertex.outgoingEdges.push(fwdEdge);
        endVertex.outgoingEdges.push(bwdEdge);
        if (hasOwn(vertexPairIdToEdges, vertexPairId)) {
            vertexPairIdToEdges[vertexPairId].push([edge, fwdEdge, bwdEdge]);
        }
        else {
            vertexPairIdToEdges[vertexPairId] = [[edge, fwdEdge, bwdEdge]];
        }
        return [fwdEdge, bwdEdge];
    });
    return {
        edges: newEdges,
        vertices: newVertices,
    };
}
function getOrder(vertex) {
    return vertex.outgoingEdges.length;
}
function computeMinor({ vertices }) {
    const newEdges = [];
    const newVertices = [];
    const toMinorVertex = memoizeWeak((_majorVertex) => {
        const minorVertex = { outgoingEdges: [] };
        newVertices.push(minorVertex);
        return minorVertex;
    });
    const getEdgeId = createObjectCounter();
    const idToEdge = {};
    const visited = new WeakSet();
    // first handle components that are not cycles
    for (const vertex of vertices) {
        if (getOrder(vertex) === 2)
            continue;
        const startVertex = toMinorVertex(vertex);
        for (const startEdge of vertex.outgoingEdges) {
            const segments = [];
            let edge = startEdge;
            while (edge.parent === startEdge.parent &&
                edge.directionFlag === startEdge.directionFlag &&
                getOrder(edge.incidentVertices[1]) === 2) {
                segments.push(edge.seg);
                visited.add(edge.incidentVertices[1]);
                const [edge1, edge2] = edge.incidentVertices[1].outgoingEdges;
                edge = edge1.twin === edge ? edge2 : edge1; // choose the one we didn't use to come here
            }
            segments.push(edge.seg);
            const endVertex = toMinorVertex(edge.incidentVertices[1]);
            const edgeId = `${getEdgeId(startEdge)}-${getEdgeId(edge)}`;
            const twinId = `${getEdgeId(edge.twin)}-${getEdgeId(startEdge.twin)}`;
            const twin = idToEdge[twinId] ?? null;
            const newEdge = {
                segments,
                parent: startEdge.parent,
                incidentVertices: [startVertex, endVertex],
                directionFlag: startEdge.directionFlag,
                twin: twin,
            };
            if (twin) {
                twin.twin = newEdge;
            }
            idToEdge[edgeId] = newEdge;
            startVertex.outgoingEdges.push(newEdge);
            newEdges.push(newEdge);
        }
    }
    // handle cyclic components
    const cycles = [];
    for (const vertex of vertices) {
        if (getOrder(vertex) !== 2 || visited.has(vertex))
            continue;
        let edge = vertex.outgoingEdges[0];
        const cycle = {
            segments: [],
            parent: edge.parent,
            directionFlag: edge.directionFlag,
        };
        do {
            cycle.segments.push(edge.seg);
            visited.add(edge.incidentVertices[0]);
            const [edge1, edge2] = edge.incidentVertices[1].outgoingEdges;
            edge = edge1.twin === edge ? edge2 : edge1;
        } while (edge.incidentVertices[0] !== vertex);
        cycles.push(cycle);
    }
    return {
        edges: newEdges,
        vertices: newVertices,
        cycles,
    };
}
function removeDanglingEdges(graph) {
    function walk(parent) {
        const keptVertices = new WeakSet();
        const vertexToLevel = new WeakMap();
        function visit(vertex, incomingEdge, level) {
            if (vertexToLevel.has(vertex)) {
                return vertexToLevel.get(vertex);
            }
            vertexToLevel.set(vertex, level);
            let minLevel = Infinity;
            for (const edge of vertex.outgoingEdges) {
                if (edge.parent & parent && edge !== incomingEdge) {
                    minLevel = Math.min(minLevel, visit(edge.incidentVertices[1], edge.twin, level + 1));
                }
            }
            if (minLevel <= level) {
                keptVertices.add(vertex);
            }
            return minLevel;
        }
        for (const edge of graph.edges) {
            if (edge.parent & parent) {
                visit(edge.incidentVertices[0], null, 0);
            }
        }
        return keptVertices;
    }
    const keptVerticesA = walk(1);
    const keptVerticesB = walk(2);
    function keepVertex(vertex) {
        return keptVerticesA.has(vertex) || keptVerticesB.has(vertex);
    }
    function keepEdge(edge) {
        return (((edge.parent & 1) === 1 &&
            keptVerticesA.has(edge.incidentVertices[0]) &&
            keptVerticesA.has(edge.incidentVertices[1])) ||
            ((edge.parent & 2) === 2 &&
                keptVerticesB.has(edge.incidentVertices[0]) &&
                keptVerticesB.has(edge.incidentVertices[1])));
    }
    graph.vertices = graph.vertices.filter(keepVertex);
    for (const vertex of graph.vertices) {
        vertex.outgoingEdges = vertex.outgoingEdges.filter(keepEdge);
    }
    graph.edges = graph.edges.filter(keepEdge);
}
function getIncidenceAngle({ directionFlag, segments }) {
    let p0;
    let p1;
    const seg = segments[0]; // TODO: explain in comment why this is always the incident one in both fwd and bwd
    if (!directionFlag) {
        p0 = samplePathSegmentAt(seg, 0);
        p1 = samplePathSegmentAt(seg, EPS.param);
    }
    else {
        p0 = samplePathSegmentAt(seg, 1);
        p1 = samplePathSegmentAt(seg, 1 - EPS.param);
    }
    return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
}
function sortOutgoingEdgesByAngle({ vertices }) {
    // TODO: this will hardly be a bottleneck, but profile whether memoization
    //  actually helps and maybe use a simpler function that's monotonic
    //  in angle.
    const getAngle = memoizeWeak(getIncidenceAngle);
    for (const vertex of vertices) {
        if (getOrder(vertex) > 2) {
            vertex.outgoingEdges.sort((a, b) => getAngle(a) - getAngle(b));
        }
    }
}
function getNextEdge(edge) {
    const { outgoingEdges } = edge.incidentVertices[1];
    const index = outgoingEdges.findIndex((other) => other.twin === edge);
    return outgoingEdges[(index + 1) % outgoingEdges.length];
}
const faceToPolygon = memoizeWeak((face) => face.incidentEdges.flatMap((edge) => {
    const CNT = 64;
    const points = [];
    for (const seg of edge.segments) {
        for (let i = 0; i < CNT; i++) {
            const t0 = i / CNT;
            const t = edge.directionFlag ? 1 - t0 : t0;
            points.push(samplePathSegmentAt(seg, t));
        }
    }
    return points;
}));
function intervalCrossesPoint(a, b, p) {
    /*
     This deserves its own routine because of the following trick.
     We use different inequalities here to make sure we only count one of
     two intervals that meet precisely at p.
    */
    const dy1 = a >= p;
    const dy2 = b < p;
    return dy1 === dy2;
}
function lineSegmentIntersectsHorizontalRay(a, b, point) {
    if (!intervalCrossesPoint(a[1], b[1], point[1]))
        return false;
    const x = linMap(point[1], a[1], b[1], a[0], b[0]);
    return x >= point[0];
}
function computePointWinding(polygon, testedPoint) {
    if (polygon.length <= 2)
        return 0;
    let prevPoint = polygon[polygon.length - 1];
    let winding = 0;
    for (const point of polygon) {
        if (lineSegmentIntersectsHorizontalRay(prevPoint, point, testedPoint)) {
            winding += point[1] > prevPoint[1] ? -1 : 1;
        }
        prevPoint = point;
    }
    return winding;
}
function computeWinding(face) {
    const polygon = faceToPolygon(face);
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const c = polygon[(i + 2) % polygon.length];
        const testedPoint = [
            (a[0] + b[0] + c[0]) / 3,
            (a[1] + b[1] + c[1]) / 3,
        ];
        const winding = computePointWinding(polygon, testedPoint);
        if (winding !== 0) {
            return {
                winding,
                point: testedPoint,
            };
        }
    }
}
function computeDual({ edges, cycles }) {
    const newVertices = [];
    const minorToDualEdge = new WeakMap();
    for (const startEdge of edges) {
        if (minorToDualEdge.has(startEdge))
            continue;
        const face = {
            incidentEdges: [],
            flag: 0,
        };
        let edge = startEdge;
        do {
            const twin = minorToDualEdge.get(edge.twin) ?? null;
            const newEdge = {
                segments: edge.segments,
                parent: edge.parent,
                incidentVertex: face,
                directionFlag: edge.directionFlag,
                twin,
            };
            if (twin) {
                twin.twin = newEdge;
            }
            minorToDualEdge.set(edge, newEdge);
            face.incidentEdges.push(newEdge);
            edge = getNextEdge(edge);
        } while (edge.incidentVertices[0] !== startEdge.incidentVertices[0]);
        newVertices.push(face);
    }
    for (const cycle of cycles) {
        const innerFace = {
            incidentEdges: [],
            flag: 0,
        };
        const innerHalfEdge = {
            segments: cycle.segments,
            parent: cycle.parent,
            incidentVertex: innerFace,
            directionFlag: cycle.directionFlag,
            twin: null,
        };
        const outerFace = {
            incidentEdges: [],
            flag: 0,
        };
        const outerHalfEdge = {
            segments: [...cycle.segments].reverse(),
            parent: cycle.parent,
            incidentVertex: outerFace,
            directionFlag: !cycle.directionFlag,
            twin: innerHalfEdge,
        };
        innerHalfEdge.twin = outerHalfEdge;
        innerFace.incidentEdges.push(innerHalfEdge);
        outerFace.incidentEdges.push(outerHalfEdge);
        newVertices.push(innerFace, outerFace);
    }
    const components = [];
    const visitedVertices = new WeakSet();
    const visitedEdges = new WeakSet();
    for (const vertex of newVertices) {
        if (visitedVertices.has(vertex))
            continue;
        const componentVertices = [];
        const componentEdges = [];
        const visit = (vertex) => {
            if (!visitedVertices.has(vertex)) {
                componentVertices.push(vertex);
            }
            visitedVertices.add(vertex);
            for (const edge of vertex.incidentEdges) {
                if (visitedEdges.has(edge)) {
                    continue;
                }
                const { twin } = edge;
                componentEdges.push(edge, twin);
                visitedEdges.add(edge);
                visitedEdges.add(twin);
                visit(twin.incidentVertex);
            }
        };
        visit(vertex);
        const outerFace = componentVertices.find((face) => computeWinding(face).winding < 0);
        components.push({
            vertices: componentVertices,
            edges: componentEdges,
            outerFace,
        });
    }
    return components;
}
function boundingBoxIntersectsHorizontalRay(boundingBox, point) {
    return (intervalCrossesPoint(boundingBox.top, boundingBox.bottom, point[1]) &&
        boundingBox.right >= point[0]);
}
function pathSegmentHorizontalRayIntersectionCount(origSeg, point) {
    const totalBoundingBox = pathSegmentBoundingBox(origSeg);
    if (!boundingBoxIntersectsHorizontalRay(totalBoundingBox, point))
        return 0;
    let segments = [
        { boundingBox: totalBoundingBox, seg: origSeg },
    ];
    let count = 0;
    while (segments.length > 0) {
        const nextSegments = [];
        for (const { boundingBox, seg } of segments) {
            if (boundingBoxMaxExtent(boundingBox) < EPS.linear) {
                if (lineSegmentIntersectsHorizontalRay(getStartPoint(seg), getEndPoint(seg), point)) {
                    count++;
                }
            }
            else {
                const split = splitSegmentAt(seg, 0.5);
                const boundingBox0 = pathSegmentBoundingBox(split[0]);
                if (boundingBoxIntersectsHorizontalRay(boundingBox0, point)) {
                    nextSegments.push({
                        boundingBox: boundingBox0,
                        seg: split[0],
                    });
                }
                const boundingBox1 = pathSegmentBoundingBox(split[1]);
                if (boundingBoxIntersectsHorizontalRay(boundingBox1, point)) {
                    nextSegments.push({
                        boundingBox: boundingBox1,
                        seg: split[1],
                    });
                }
            }
        }
        segments = nextSegments;
    }
    return count;
}
function testInclusion(a, b) {
    // TODO: Intersection counting will fail if a curve touches the horizontal line but doesn't go through.
    const testedPoint = getStartPoint(a.edges[0].segments[0]);
    for (const face of b.vertices) {
        if (face === b.outerFace)
            continue;
        let count = 0;
        for (const edge of face.incidentEdges) {
            for (const seg of edge.segments) {
                count += pathSegmentHorizontalRayIntersectionCount(seg, testedPoint);
            }
        }
        if (count % 2 === 1)
            return face;
    }
    return null;
}
function computeNestingTree(components) {
    let nestingTrees = [];
    function insert(trees, component) {
        let found = false;
        for (const tree of trees) {
            const face = testInclusion(component, tree.component);
            if (face) {
                if (tree.outgoingEdges.has(face)) {
                    const children = tree.outgoingEdges.get(face);
                    tree.outgoingEdges.set(face, insert(children, component));
                }
                else {
                    tree.outgoingEdges.set(face, [
                        { component, outgoingEdges: new Map() },
                    ]);
                }
                found = true;
                break;
            }
        }
        if (found) {
            return trees;
        }
        else {
            const newTree = {
                component,
                outgoingEdges: new Map(),
            };
            const newTrees = [newTree];
            for (const tree of trees) {
                const face = testInclusion(tree.component, component);
                if (face) {
                    if (newTree.outgoingEdges.has(face)) {
                        newTree.outgoingEdges.get(face).push(tree);
                    }
                    else {
                        newTree.outgoingEdges.set(face, [tree]);
                    }
                }
                else {
                    newTrees.push(tree);
                }
            }
            return newTrees;
        }
    }
    for (const component of components) {
        nestingTrees = insert(nestingTrees, component);
    }
    return nestingTrees;
}
function getFlag(count, fillRule) {
    switch (fillRule) {
        case FillRule.NonZero:
            return count === 0 ? 0 : 1;
        case FillRule.EvenOdd:
            return count % 2 === 0 ? 0 : 1;
    }
}
function flagFaces(nestingTrees, aFillRule, bFillRule) {
    function visitTree(tree, aRunningCount, bRunningCount) {
        const visitedFaces = new WeakSet();
        function visitFace(face, aRunningCount, bRunningCount) {
            if (visitedFaces.has(face))
                return;
            visitedFaces.add(face);
            const aFlag = getFlag(aRunningCount, aFillRule);
            const bFlag = getFlag(bRunningCount, bFillRule);
            face.flag = aFlag | (bFlag << 1);
            for (const edge of face.incidentEdges) {
                const twin = edge.twin;
                let nextACount = aRunningCount;
                if (edge.parent & 1) {
                    nextACount += edge.directionFlag ? -1 : 1;
                }
                let nextBCount = bRunningCount;
                if (edge.parent & 2) {
                    nextBCount += edge.directionFlag ? -1 : 1;
                }
                visitFace(twin.incidentVertex, nextACount, nextBCount);
            }
            if (tree.outgoingEdges.has(face)) {
                const subtrees = tree.outgoingEdges.get(face);
                for (const subtree of subtrees) {
                    visitTree(subtree, aRunningCount, bRunningCount);
                }
            }
        }
        visitFace(tree.component.outerFace, aRunningCount, bRunningCount);
    }
    for (const tree of nestingTrees) {
        visitTree(tree, 0, 0);
    }
}
function* getSelectedFaces(nestingTrees, predicate) {
    function* visit(tree) {
        for (const face of tree.component.vertices) {
            if (predicate(face)) {
                yield face;
            }
        }
        for (const subtrees of tree.outgoingEdges.values()) {
            for (const subtree of subtrees) {
                yield* visit(subtree);
            }
        }
    }
    for (const tree of nestingTrees) {
        yield* visit(tree);
    }
}
function* walkFaces(faces) {
    function isRemovedEdge(edge) {
        return (faces.has(edge.incidentVertex) ===
            faces.has(edge.twin.incidentVertex));
    }
    const edgeToNext = new WeakMap();
    for (const face of faces) {
        let prevEdge = face.incidentEdges[face.incidentEdges.length - 1];
        for (const edge of face.incidentEdges) {
            edgeToNext.set(prevEdge, edge);
            prevEdge = edge;
        }
    }
    const visitedEdges = new WeakSet();
    for (const face of faces) {
        for (const startEdge of face.incidentEdges) {
            if (isRemovedEdge(startEdge) || visitedEdges.has(startEdge)) {
                continue;
            }
            let edge = startEdge;
            do {
                if (edge.directionFlag) {
                    yield* map(edge.segments, reversePathSegment);
                }
                else {
                    yield* edge.segments;
                }
                visitedEdges.add(edge);
                edge = edgeToNext.get(edge);
                while (isRemovedEdge(edge)) {
                    edge = edgeToNext.get(edge.twin);
                }
            } while (edge !== startEdge);
        }
    }
}
function dumpFaces(nestingTrees, predicate) {
    const paths = [];
    function visit(tree) {
        for (const face of tree.component.vertices) {
            if (!predicate(face) || face === tree.component.outerFace) {
                continue;
            }
            const path = [];
            for (const edge of face.incidentEdges) {
                if (edge.directionFlag) {
                    path.push(...edge.segments.map(reversePathSegment));
                }
                else {
                    path.push(...edge.segments);
                }
            }
            // poke holes in the face
            if (tree.outgoingEdges.has(face)) {
                for (const subtree of tree.outgoingEdges.get(face)) {
                    const { outerFace } = subtree.component;
                    for (const edge of outerFace.incidentEdges) {
                        if (edge.directionFlag) {
                            path.push(...edge.segments.map(reversePathSegment));
                        }
                        else {
                            path.push(...edge.segments);
                        }
                    }
                }
            }
            paths.push(path);
        }
        for (const subtrees of tree.outgoingEdges.values()) {
            for (const subtree of subtrees) {
                visit(subtree);
            }
        }
    }
    for (const tree of nestingTrees) {
        visit(tree);
    }
    return paths;
}
const operationPredicates = {
    [PathBooleanOperation.Union]: ({ flag }) => flag > 0,
    [PathBooleanOperation.Difference]: ({ flag }) => flag === 1,
    [PathBooleanOperation.Intersection]: ({ flag }) => flag === 3,
    [PathBooleanOperation.Exclusion]: ({ flag }) => flag === 1 || flag === 2,
    [PathBooleanOperation.Division]: ({ flag }) => (flag & 1) === 1,
    [PathBooleanOperation.Fracture]: ({ flag }) => flag > 0,
};
function pathBoolean(a, aFillRule, b, bFillRule, op) {
    const unsplitEdges = [
        ...map(a, segmentToEdge(1)),
        ...map(b, segmentToEdge(2)),
    ];
    splitAtSelfIntersections(unsplitEdges);
    const { edges: splitEdges, totalBoundingBox } = splitAtIntersections(unsplitEdges);
    if (!totalBoundingBox) {
        // input geometry is empty
        return [];
    }
    const majorGraph = findVertices(splitEdges, totalBoundingBox);
    // console.log(majorGraphToDot(majorGraph));
    const minorGraph = computeMinor(majorGraph);
    // console.log(minorGraphToDot(minorGraph.edges));
    // console.dir(minorGraph.cycles, { depth: 4 });
    removeDanglingEdges(minorGraph);
    // console.log(minorGraphToDot(minorGraph.edges));
    sortOutgoingEdgesByAngle(minorGraph);
    const dualGraphComponents = computeDual(minorGraph);
    // console.log(dualGraphToDot(dualGraphComponents));
    const nestingTrees = computeNestingTree(dualGraphComponents);
    // console.log(nestingTrees.length, nestingTreesToDot(nestingTrees));
    flagFaces(nestingTrees, aFillRule, bFillRule);
    const predicate = operationPredicates[op];
    switch (op) {
        case PathBooleanOperation.Division:
        case PathBooleanOperation.Fracture:
            return dumpFaces(nestingTrees, predicate);
        default: {
            const selectedFaces = new Set(getSelectedFaces(nestingTrees, predicate));
            return [[...walkFaces(selectedFaces)]];
        }
    }
}

function* toAbsoluteCommands(commands) {
    let lastPoint = [0, 0];
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

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
function reflectControlPoint(point, controlPoint) {
    return [2 * point[0] - controlPoint[0], 2 * point[1] - controlPoint[1]];
}
function* pathFromCommands(commands) {
    let firstPoint = null;
    let lastPoint = null;
    let lastControlPoint = null;
    function badSequence() {
        throw new Error("Bad SVG path data sequence.");
    }
    for (const cmd of toAbsoluteCommands(commands)) {
        switch (cmd[0]) {
            case "M":
                lastPoint = firstPoint = cmd[1];
                lastControlPoint = null;
                break;
            case "L":
                if (!lastPoint)
                    badSequence();
                yield ["L", lastPoint, cmd[1]];
                lastPoint = cmd[1];
                lastControlPoint = null;
                break;
            case "C":
                if (!lastPoint)
                    badSequence();
                yield ["C", lastPoint, cmd[1], cmd[2], cmd[3]];
                lastPoint = cmd[3];
                lastControlPoint = cmd[2];
                break;
            case "S":
                if (!lastPoint)
                    badSequence();
                if (!lastControlPoint)
                    badSequence(); // TODO: really?
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
                if (!lastPoint)
                    badSequence();
                yield ["Q", lastPoint, cmd[1], cmd[2]];
                lastPoint = cmd[2];
                lastControlPoint = cmd[1];
                break;
            case "T":
                if (!lastPoint)
                    badSequence();
                if (!lastControlPoint)
                    badSequence(); // TODO: really?
                lastControlPoint = reflectControlPoint(lastPoint, lastControlPoint);
                yield ["Q", lastPoint, lastControlPoint, cmd[1]];
                lastPoint = cmd[1];
                break;
            case "A":
                if (!lastPoint)
                    badSequence();
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
                if (!lastPoint)
                    badSequence();
                if (!firstPoint)
                    badSequence(); // TODO: really?
                yield ["L", lastPoint, firstPoint];
                lastPoint = firstPoint;
                lastControlPoint = null;
                break;
        }
    }
}
function* pathToCommands(segments, eps = 1e-4) {
    let lastPoint = null;
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

export { FillRule, PathBooleanOperation, pathBoolean, pathFromCommands, pathToCommands };
//# sourceMappingURL=path-bool.core.js.map
