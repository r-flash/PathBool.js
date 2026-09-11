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
        if (this.subtrees) {
            for (let i = 0; i < this.subtrees.length; i++) {
                const tree = this.subtrees[i];
                tree.insert(boundingBox, value);
            }
            return true;
        }
        if (this.depth > 0 && this.pairs.length >= this.innerNodeCapacity) {
            this.ensureSubtrees();
            for (let i = 0; i < this.pairs.length; i++) {
                const [pairBox, pairValue] = this.pairs[i];
                for (let j = 0; j < this.subtrees.length; j++) {
                    this.subtrees[j].insert(pairBox, pairValue);
                }
            }
            this.pairs.length = 0;
            for (let i = 0; i < this.subtrees.length; i++) {
                const tree = this.subtrees[i];
                tree.insert(boundingBox, value);
            }
            return true;
        }
        this.pairs.push([boundingBox, value]);
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

/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
const DEV_ASSERTS_ENV = typeof process !== "undefined" && process.env.PATH_BOOL_DEV_ASSERTS;
const DEV_ASSERTS = DEV_ASSERTS_ENV === "1"
    ? true
    : DEV_ASSERTS_ENV === "0"
        ? false
        : typeof process !== "undefined" &&
            process.env.NODE_ENV !== "production";
// Numerical precision
const NEARLY_LINEAR_EPS = 1e-10;
/*
 Below this, two incidence angles at a vertex count as equal and the edges are
 ordered by their angle a little way along the curve instead.

 It has to stay well clear of floating-point noise. Angles come out of `atan2`
 on computed tangents and are bounded by pi, so one ulp is already 2.2e-16:
 at 1e-16 the tie never fired for two curves that genuinely meet at the same
 angle, and the sort ordered them on rounding error. That is what made two
 tangent circles trace a face that doubled back on itself, leaving it with zero
 winding everywhere and no ear to find.

 The signal it falls through to is far larger than this bound — offsetting by
 EPS.param along a quarter-circle arc turns the tangent by about 1.6e-8 — so
 there is room for several orders of magnitude of margin on both sides.
*/
const ANGLE_MIN_DIFF = 1e-12;
const EPS = {
    point: 1e-6,
    linear: 1e-4,
    param: 1e-8,
    collinear: 0,
};
/*
 `point` and `linear` are lengths, so they only mean anything relative to the
 size of the geometry. The values above are not scale-free constants; they are
 the right values for a scene about fifty units across, which is what the hand
 fixtures happen to be. Shrink the same drawing and they stop working: at a
 scene 2.2e-3 across, subdivision stopped while a chord still spanned a large
 fraction of its arc, so intersection points landed about 1e-6 out — further
 apart than `point`, so the vertices that should have merged did not, and the
 output was left open by most of the width of the scene.

 The two have to move together. Scaling one and not the other pulled two
 overlapping circles into a single circle: `point` decides which endpoints are
 the same vertex, `linear` decides how finely a curve is chopped before those
 endpoints are computed, and the second has to stay well clear of the first.
*/
const REFERENCE_EXTENT = 50;
/*
 Derived from the extent of the geometry, not from how far it sits from the
 origin. The arrangement constructor separately translates distant geometry
 toward the origin to preserve arithmetic precision; increasing tolerances
 would merge details instead of restoring that precision.

 Only ever downwards. How fine the detail in a drawing is does not follow how
 big the drawing is: a 900-unit logo is drawn with much the same absolute
 precision as a 48-unit icon, so the values above are about right for both,
 and scaling them up by eighteen swallowed the detail in the 900-unit one
 whole. Scaling down has no such hazard — a tighter tolerance merges less —
 and it is the only direction the failure was ever in.
*/
function epsilonsForExtent(extent) {
    const scale = Number.isFinite(extent) && extent > 0
        ? Math.min(1, extent / REFERENCE_EXTENT)
        : 1;
    return {
        point: EPS.point * scale,
        linear: EPS.linear * scale,
        // Parameter tolerance is dimensionless; the default determinant threshold is exactly zero.
        param: EPS.param,
        collinear: EPS.collinear,
    };
}

/**
 * Common utilities
 * @module glMatrix
 */

var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;

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
    cosC = Math.cos(rad);

  //perform rotation and translate to correct position
  out[0] = p0 * cosC - p1 * sinC + b[0];
  out[1] = p0 * sinC + p1 * cosC + b[1];
  return out;
}

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
/*
 Signed angle from `u` to `v`, in (-pi, pi].

 By atan2 of the cross and dot products rather than acos of the normalized
 dot, which matters more than it looks. acos is ill-conditioned at both ends
 of its range: for a small angle theta its absolute error is about eps/theta,
 so the *relative* error is about eps/theta^2. Arc subdivision re-derives a
 sub-arc's centre parametrization from its endpoints at every level, so that
 error compounds — halving a quarter circle, the recovered deltaTheta was off
 by 1.4e-8 relative at depth 15 and 1.9e-2 at depth 25, and by depth 29 the
 recovery failed outright.

 That is not only an accuracy problem. Bounding boxes that stop shrinking stop
 the intersection finder pruning, so it would grind through thousands of pairs
 per level; fixing this cut the test suite from 205s to 87s.

 atan2 also removes a cliff. The old sign came from Math.sign of the cross
 product, which for nearly parallel vectors could round to zero or to the
 wrong sign; a flipped sign then met `if (fS && deltaTheta < 0) deltaTheta +=
 TAU` in arcSegmentToCenter and turned a hair-thin arc into a nearly complete
 one. atan2 carries the sign itself, and returns pi for antiparallel vectors
 without needing the special case that used to be here.
*/
function vectorAngle(u, v) {
    return Math.atan2(u[0] * v[1] - u[1] * v[0], dot(u, v));
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
/*
 gl-matrix allocates its matrices as Float32Array unless the host application
 changes ARRAY_TYPE globally, which a library has no business doing — a
 consumer may be feeding the same gl-matrix straight into WebGL buffers and
 want float32.

 Float32 costs about nine digits, and everything here flows through these
 matrices. An arc's rotation matrix rounded to float32 shifts the recovered
 centre parametrization by ~1e-8, which is enormous next to EPS.param: the arc
 then no longer passes through its own stated endpoint, and its tangent at
 that endpoint is wrong by the same order. That is far bigger than the
 differences the incidence-angle sort has to resolve, so tangent curves ended
 up ordered wrongly around a vertex.

 The identity initializers match what mat2.create()/mat2d.create() return.
*/
function createMat2() {
    return new Float64Array([1, 0, 0, 1]);
}
function createMat2d() {
    return new Float64Array([1, 0, 0, 1, 0, 0]);
}
function isFiniteNumber(value) {
    return Number.isFinite(value);
}
function isFiniteVector([x, y]) {
    return Number.isFinite(x) && Number.isFinite(y);
}
function normalizeArcRotationDegrees(phi) {
    if (!Number.isFinite(phi))
        return 0;
    let normalized = ((phi % 360) + 360) % 360;
    if (normalized > 180)
        normalized -= 360;
    return normalized;
}
function pointLineDistance(p, a, b, eps) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= eps * eps) {
        const px = p[0] - a[0];
        const py = p[1] - a[1];
        return Math.hypot(px, py);
    }
    const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx);
    return cross / Math.sqrt(lenSq);
}
function isNearlyLinearSegment(seg, eps = NEARLY_LINEAR_EPS) {
    const a = seg[1];
    const b = getEndPoint(seg);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    /*
     Coincident endpoints do not make a curve degenerate. A cubic that closes
     on itself is a loop -- exactly what splitting at a self-intersection
     produces -- and it can enclose as much area as it likes. Treating one as
     linear collapsed it to a point everywhere: its bounding box, every sample
     of it, its tangent, and its halves when split.

     For a line and for an arc it really is degenerate, though; SVG omits an
     arc whose endpoints coincide. The Q and C cases below need no separate
     test, because pointLineDistance measures from the start point when the
     chord has no length, so a curve whose control points sit on top of its
     endpoints is still reported as linear.
    */
    const chordIsDegenerate = dx * dx + dy * dy <= eps * eps;
    switch (seg[0]) {
        case "L":
            return true;
        case "Q":
            return pointLineDistance(seg[2], a, b, eps) <= eps;
        case "C":
            return (pointLineDistance(seg[2], a, b, eps) <= eps &&
                pointLineDistance(seg[3], a, b, eps) <= eps);
        case "A":
            return (chordIsDegenerate ||
                !Number.isFinite(seg[2]) ||
                !Number.isFinite(seg[3]) ||
                seg[2] === 0 ||
                seg[3] === 0);
    }
}
/*
 Rewrites a segment that draws a straight line as one, and collapses closed
 Beziers that only retrace a line to a point for boolean operations.

 An arc with a zero radius is a line by SVG F.6.2, and a cubic or quadratic
 whose control points sit on its chord draws one too. Leaving such a segment in
 the spelling it arrived in costs twice over. `segmentsEqual` compares
 representations, so it never merges with the plain line it lies exactly on top
 of, and two paths that draw the same outline in different spellings are left
 as two boundaries with nothing between them. And a zero-radius arc that
 survives to the output hands the caller back a segment the SVG spec says is a
 line.

 The control points have to run *along* the chord, not out past an end and
 back: collinear controls outside the endpoints draw a zero-area spike, and
 flattening one to a line would throw geometry away rather than restate it.
 Written as the Bezier derivative staying single-signed, which is the same
 condition and needs no case analysis.

 Radii are tested rather than the chord. An arc whose endpoints coincide is
 omitted by SVG regardless of its flags, and `findVertices` drops it; an arc
 whose radii are merely too small for its chord is instead grown to fit by
 F.6.6 and is not degenerate at all.
*/
function lineariseDegenerateSegment(seg, eps) {
    const a = seg[1];
    const b = getEndPoint(seg);
    if (seg[0] === "A") {
        const degenerateRadii = !isFiniteNumber(seg[2]) ||
            !isFiniteNumber(seg[3]) ||
            seg[2] === 0 ||
            seg[3] === 0;
        return degenerateRadii ? ["L", a, b] : normalizeArcSegment(seg);
    }
    if (seg[0] !== "C" && seg[0] !== "Q")
        return seg;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const chordSq = dx * dx + dy * dy;
    if (dx === 0 && dy === 0) {
        // A closed quadratic always retraces a line. A closed cubic does too
        // when both controls lie on the same line through its start. Such a
        // segment contributes no winding, but leaving it as a curve can create
        // a face with no interior. Use the farther control to define the line:
        // the endpoint chord has no direction, and either control may equal a.
        if (seg[0] === "Q")
            return ["L", a, b];
        const distSq = (p) => (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
        const [far, near] = distSq(seg[2]) >= distSq(seg[3])
            ? [seg[2], seg[3]]
            : [seg[3], seg[2]];
        if (pointLineDistance(near, a, far, NEARLY_LINEAR_EPS) <=
            NEARLY_LINEAR_EPS) {
            return ["L", a, b];
        }
        return seg;
    }
    // A short chord alone says nothing about the area enclosed by a curve.
    if (chordSq <= eps * eps)
        return seg;
    const along = (p) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / chordSq;
    const slack = eps / Math.sqrt(chordSq);
    if (seg[0] === "Q") {
        if (pointLineDistance(seg[2], a, b, eps) > eps)
            return seg;
        const t = along(seg[2]);
        if (t < -slack || t > 1 + slack)
            return seg;
        return ["L", a, b];
    }
    if (pointLineDistance(seg[2], a, b, eps) > eps ||
        pointLineDistance(seg[3], a, b, eps) > eps) {
        return seg;
    }
    const t1 = along(seg[2]);
    const t2 = along(seg[3]);
    if (t1 < -slack || t2 - t1 < -slack || t2 > 1 + slack)
        return seg;
    return ["L", a, b];
}
function normalizeArcSegment(seg) {
    let rx = Math.abs(seg[2]);
    let ry = Math.abs(seg[3]);
    let phi = seg[4];
    /*
     The same ellipse can be written with its radii exchanged and its frame
     turned by a quarter turn. Pick one spelling before segments are compared:
     otherwise the intersection solver can prove that two arcs share a rim,
     only for the graph builder to reject the resulting pieces as different
     edges. A half turn is another symmetry, and a circle has no meaningful
     frame at all.
    */
    if (rx < ry) {
        [rx, ry] = [ry, rx];
        phi += 90;
    }
    if (rx === ry) {
        phi = 0;
    }
    else {
        phi = ((normalizeArcRotationDegrees(phi) % 180) + 180) % 180;
    }
    return ["A", seg[1], rx, ry, phi, seg[5], seg[6], seg[7]];
}
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
    const rotationMatrix = createMat2();
    const addend = createVector();
    const cxy = createVector();
    return function arcSegmentToCenter([_A, xy1, rx, ry, phi, fA, fS, xy2,]) {
        if (!isFiniteVector(xy1) || !isFiniteVector(xy2)) {
            return null;
        }
        phi = normalizeArcRotationDegrees(phi);
        // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
        if (!isFiniteNumber(rx) ||
            !isFiniteNumber(ry) ||
            rx === 0 ||
            ry === 0) {
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
        /*
         No epsilon is added to lambda, deliberately. The rounding it might
         seem to call for is lambda landing a hair below 1 when the radii
         exactly span the chord, and the `Math.max(0, ...)` on the ratio below
         already absorbs that. Slack here instead inflates the radii of every
         arc that genuinely needs the F.6.6 correction, and the centre solve
         takes a square root of it, so it comes back out magnified: 1e-12 of
         slack displaces the centre by 5e-7, far enough that a corrected arc no
         longer lies on the circle it was corrected onto and no longer counts
         as coincident with it.
        */
        const lambda = x1Prime2 / rx2 + y1Prime2 / ry2;
        if (lambda > 1) {
            const lambdaSqrt = Math.sqrt(lambda);
            rx *= lambdaSqrt;
            ry *= lambdaSqrt;
            const lambdaAbs = Math.abs(lambda);
            rx2 *= lambdaAbs;
            ry2 *= lambdaAbs;
        }
        const sign = fA === fS ? -1 : 1;
        const denom = rx2 * y1Prime2 + ry2 * x1Prime2;
        if (denom === 0)
            return null;
        const numer = rx2 * ry2 - rx2 * y1Prime2 - ry2 * x1Prime2;
        const ratio = Math.max(0, numer / denom);
        const multiplier = Math.sqrt(ratio);
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
    const rotationMatrix = createMat2();
    return function arcSegmentFromCenter({ center, theta1, deltaTheta, rx, ry, phi, }) {
        // https://svgwg.org/svg2-draft/implnote.html#ArcConversionCenterToEndpoint
        // `phi` is in degrees, as everywhere else in a PathArcSegment, while
        // fromRotation takes radians. Rotating by phi directly puts the arc
        // somewhere else entirely — invisibly so at phi = 0, which is why only
        // rotated arcs were affected.
        fromRotation$1(rotationMatrix, deg2rad(phi));
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
const samplePathSegmentAtInto = (() => {
    const p01 = createVector();
    const p12 = createVector();
    const p23 = createVector();
    const p012 = createVector();
    const p123 = createVector();
    const p = createVector();
    return function samplePathSegmentAtInto(seg, t, out) {
        if (isNearlyLinearSegment(seg, 0)) {
            lerp$1(p, seg[1], getEndPoint(seg), t);
            out[0] = p[0];
            out[1] = p[1];
            return out;
        }
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
                // Degrees to radians, as in arcSegmentFromCenter above.
                rotate(p, p, [0, 0], deg2rad(phi));
                add(p, p, center);
                break;
            }
        }
        out[0] = p[0];
        out[1] = p[1];
        return out;
    };
})();
const samplePathSegmentAt = (() => {
    const out = createVector();
    return function samplePathSegmentAt(seg, t) {
        samplePathSegmentAtInto(seg, t, out);
        return [out[0], out[1]];
    };
})();
const pathSegmentTangentAtInto = (() => {
    const tmp = createVector();
    return function pathSegmentTangentAtInto(seg, t, out) {
        if (isNearlyLinearSegment(seg, 0)) {
            const start = seg[1];
            const end = getEndPoint(seg);
            out[0] = end[0] - start[0];
            out[1] = end[1] - start[1];
            return out;
        }
        switch (seg[0]) {
            case "Q": {
                const p0 = seg[1];
                const p1 = seg[2];
                const p2 = seg[3];
                const ax = p1[0] - p0[0];
                const ay = p1[1] - p0[1];
                const bx = p2[0] - p1[0];
                const by = p2[1] - p1[1];
                out[0] = 2 * ((1 - t) * ax + t * bx);
                out[1] = 2 * ((1 - t) * ay + t * by);
                return out;
            }
            case "C": {
                const p0 = seg[1];
                const p1 = seg[2];
                const p2 = seg[3];
                const p3 = seg[4];
                const ax = p1[0] - p0[0];
                const ay = p1[1] - p0[1];
                const bx = p2[0] - p1[0];
                const by = p2[1] - p1[1];
                const cx = p3[0] - p2[0];
                const cy = p3[1] - p2[1];
                const u = 1 - t;
                out[0] = 3 * (u * u * ax + 2 * u * t * bx + t * t * cx);
                out[1] = 3 * (u * u * ay + 2 * u * t * by + t * t * cy);
                return out;
            }
            case "A": {
                const centerParametrization = arcSegmentToCenter(normalizeArcSegment(seg));
                if (!centerParametrization) {
                    out[0] = seg[7][0] - seg[1][0];
                    out[1] = seg[7][1] - seg[1][1];
                    return out;
                }
                const { deltaTheta, phi, theta1, rx, ry } = centerParametrization;
                const theta = theta1 + t * deltaTheta;
                const cosPhi = Math.cos(deg2rad(phi));
                const sinPhi = Math.sin(deg2rad(phi));
                const dx = -rx * Math.sin(theta) * deltaTheta;
                const dy = ry * Math.cos(theta) * deltaTheta;
                tmp[0] = cosPhi * dx - sinPhi * dy;
                tmp[1] = sinPhi * dx + cosPhi * dy;
                out[0] = tmp[0];
                out[1] = tmp[1];
                return out;
            }
        }
    };
})();
const arcSegmentToCubics = (() => {
    const fromUnit = createMat2d();
    const matrix = createMat2d();
    return function arcSegmentToCubics(arc, maxDeltaTheta = Math.PI / 2) {
        const centerParametrization = arcSegmentToCenter(normalizeArcSegment(arc));
        if (!centerParametrization) {
            // https://svgwg.org/svg2-draft/implnote.html#ArcCorrectionOutOfRangeRadii
            // "If rx = 0 or ry = 0, then treat this as a straight line from (x1, y1) to (x2, y2) and stop."
            return [["L", arc[1], arc[7]]];
        }
        const { center, theta1, deltaTheta, rx, ry, phi } = centerParametrization;
        const count = Math.ceil(Math.abs(deltaTheta) / maxDeltaTheta);
        fromTranslation(fromUnit, center);
        rotate$1(fromUnit, fromUnit, deg2rad(phi));
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
    function consider(t) {
        if (!(0 < t && t < 1))
            return;
        const x = evalCubic1d(p0, p1, p2, p3, t);
        min = Math.min(min, x);
        max = Math.max(max, x);
    }
    // The derivative, a*t^2 + b*t + c, whose roots are the interior extremes.
    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const b = 6 * (p0 - 2 * p1 + p2);
    const c = 3 * (p1 - p0);
    /*
     `a` vanishes whenever 3*(p1 - p2) === p0 - p3, which every cubic that is
     symmetric in this coordinate satisfies — p1 === p2 with p0 === p3. That is
     an ordinary shape, not a corner case: any symmetric arch or loop.

     Rounding leaves `a` at about 1e-16 rather than exactly zero, so the old
     `a === 0` test never fired and the quadratic formula went ahead and
     divided by the noise. For the control values -0.6, 1.4, 1.4, -0.6 it
     returned t = 0.889 where the extreme is at 0.5, and the interval came back
     as -0.6 .. -0.0074 for a curve reaching 0.9. Comparing `a` against the
     other coefficients instead of against zero is what makes the test mean
     anything; below that the derivative is linear and has one root.
    */
    if (Math.abs(a) <= 1e-12 * Math.max(Math.abs(b), Math.abs(c))) {
        if (b !== 0)
            consider(-c / b);
        return [min, max];
    }
    const D = b * b - 4 * a * c;
    if (D < 0)
        return [min, max];
    /*
     Solved through `q` rather than by the schoolbook formula twice: taking
     both roots as (-b +- sqrt(D)) / 2a subtracts two nearly equal numbers for
     whichever sign opposes b, and loses most of that root's precision.
    */
    const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(D));
    consider(q / a);
    if (q !== 0)
        consider(c / q);
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
/*
 Whether an arc sweeping from `theta1` to `theta2` passes through `target`,
 which is an angle in the same measure, up to whole turns.

 A sweep is at most one full turn, so at most one representative of `target`
 can fall inside it: lift `target` to the first one at or above the low end
 and ask whether it is still below the high end. That replaces testing a
 couple of hand-picked representatives, which could not cover every way a
 sweep straddles the branch cut.
*/
function sweepContainsAngle(target, theta1, theta2) {
    const lo = Math.min(theta1, theta2);
    const hi = Math.max(theta1, theta2);
    return target + TAU * Math.ceil((lo - target) / TAU) <= hi;
}
function pathSegmentBoundingBox(seg) {
    if (isNearlyLinearSegment(seg, 0)) {
        const start = seg[1];
        const end = getEndPoint(seg);
        return {
            top: Math.min(start[1], end[1]),
            right: Math.max(start[0], end[0]),
            bottom: Math.max(start[1], end[1]),
            left: Math.min(start[0], end[0]),
        };
    }
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
            const centerParametrization = arcSegmentToCenter(normalizeArcSegment(seg));
            if (!centerParametrization) {
                return extendBoundingBox(boundingBoxAroundPoint(seg[1], 0), seg[7]);
            }
            const { theta1, deltaTheta, phi, center, rx, ry } = centerParametrization;
            if (phi === 0 || rx === ry) {
                const theta2 = theta1 + deltaTheta;
                let boundingBox = extendBoundingBox(boundingBoxAroundPoint(seg[1], 0), seg[7]);
                /*
                 The four axis extremes, as angles in the parametrization's
                 own frame.

                 With rx === ry the parametrization angle is measured in the
                 ellipse's frame and only then turned by phi, so the extreme
                 the world sees at angle a is reached at a - phi. Testing the
                 unturned angles let a small arc claim an extreme it never
                 goes near: written with phi = 45 a circle's arc came out with
                 a box 8.8 times its own chord, and 20 times at phi = 135.
                 Boxes that big are still correct, but they stop the
                 intersection finder pruning anything.

                 phi is 0 in the other case this branch handles, so the offset
                 simply vanishes there.
                */
                const offset = deg2rad(phi);
                const extremes = [
                    [Math.PI - offset, [center[0] - rx, center[1]]],
                    [-Math.PI / 2 - offset, [center[0], center[1] - ry]],
                    [-offset, [center[0] + rx, center[1]]],
                    [Math.PI / 2 - offset, [center[0], center[1] + ry]],
                ];
                for (const [angle, point] of extremes) {
                    if (sweepContainsAngle(angle, theta1, theta2)) {
                        boundingBox = extendBoundingBox(boundingBox, point);
                    }
                }
                // Bound rounding in centre +/- radius and rotated samples. A
                // fixed padding can exceed a tiny arc's entire subdivision
                // tolerance, making unrelated leaves overlap at every depth.
                return expandBoundingBox(boundingBox, 4 *
                    Number.EPSILON *
                    Math.max(Math.abs(boundingBox.left), Math.abs(boundingBox.right), Math.abs(boundingBox.top), Math.abs(boundingBox.bottom), rx, ry));
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
    const centerParametrization = arcSegmentToCenter(normalizeArcSegment(seg));
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
    if (isNearlyLinearSegment(seg, 0)) {
        return splitLinearSegmentAt(["L", seg[1], getEndPoint(seg)], t);
    }
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

// A dimensionless parameter interval is not a geometric distance. Bound
// |P'| so discarding this much parameter cannot discard more than eps.point
// of curve. Bezier derivatives lie in the hull of their derivative controls;
// an ellipse's angular speed is bounded by its larger corrected radius.
function parameterTolerance(seg, eps) {
    let speed;
    if (seg[0] === "A") {
        const arc = arcSegmentToCenter(seg);
        speed = arc
            ? Math.abs(arc.deltaTheta) * Math.max(arc.rx, arc.ry)
            : Math.hypot(seg[7][0] - seg[1][0], seg[7][1] - seg[1][1]);
    }
    else {
        const points = seg.slice(1);
        speed =
            (points.length - 1) *
                Math.max(...points
                    .slice(1)
                    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1])));
    }
    return Math.min(eps.param, eps.point / speed);
}

function pathCubicSegmentSelfIntersection(seg) {
    // P(t) = a*t^3 + b*t^2 + c*t + d. For distinct parameters t,u,
    // P(t)=P(u) gives a*((t+u)^2-tu) + b*(t+u) + c = 0.
    // Form coefficients from successive differences: translating the curve
    // must not turn endpoint closure into a tiny interior loop.
    const d0 = [seg[2][0] - seg[1][0], seg[2][1] - seg[1][1]];
    const d1 = [seg[3][0] - seg[2][0], seg[3][1] - seg[2][1]];
    const d2 = [seg[4][0] - seg[3][0], seg[4][1] - seg[3][1]];
    const a = [d2[0] - 2 * d1[0] + d0[0], d2[1] - 2 * d1[1] + d0[1]];
    const b = [3 * (d1[0] - d0[0]), 3 * (d1[1] - d0[1])];
    const c = [3 * d0[0], 3 * d0[1]];
    const cross = (v, w) => v[0] * w[1] - v[1] * w[0];
    const denominator = cross(b, a);
    if (denominator === 0)
        return null;
    const sum = cross(a, c) / denominator;
    const discriminant = -3 * sum * sum - (4 * cross(b, c)) / denominator;
    if (!(discriminant >= 0))
        return null;
    const difference = Math.sqrt(discriminant);
    const t = (sum - difference) / 2, u = (sum + difference) / 2;
    return Number.isFinite(t) && Number.isFinite(u) && t >= 0 && u <= 1
        ? [t, u]
        : null;
}

function circularArcIntersection(a, b, eps) {
    if (a[0] !== "A" ||
        b[0] !== "A" ||
        Math.abs(a[2]) !== Math.abs(a[3]) ||
        Math.abs(b[2]) !== Math.abs(b[3]))
        return null;
    const ca = arcSegmentToCenter(a), cb = arcSegmentToCenter(b);
    if (!ca || !cb)
        return null;
    const dx = cb.center[0] - ca.center[0], dy = cb.center[1] - ca.center[1];
    const d = Math.hypot(dx, dy);
    if (d === 0)
        return null;
    const ux = dx / d, uy = dy / d;
    let points;
    const shared = [a[1], a[7]].find((p) => [b[1], b[7]].some((q) => p[0] === q[0] && p[1] === q[1]));
    if (shared) {
        // One root is known exactly from the SVG endpoints. Factor it out
        // rather than subtracting nearly equal squared radii at tangency.
        const step = -2 *
            ((shared[0] - ca.center[0]) * -uy +
                (shared[1] - ca.center[1]) * ux);
        points = [shared, [shared[0] - uy * step, shared[1] + ux * step]];
    }
    else {
        const sum = ca.rx + cb.rx, difference = ca.rx - cb.rx;
        if (d > sum || d < Math.abs(difference))
            return [];
        const along = (d + (difference * sum) / d) / 2;
        const h = Math.sqrt(Math.max(0, (sum - d) * (sum + d) * (d - difference) * (d + difference))) /
            (2 * d);
        const x = ca.center[0] + ux * along, y = ca.center[1] + uy * along;
        points = [
            [x - uy * h, y + ux * h],
            [x + uy * h, y - ux * h],
        ];
    }
    const parameter = (seg, c, p) => {
        if (p[0] === seg[1][0] && p[1] === seg[1][1])
            return 0;
        if (p[0] === seg[7][0] && p[1] === seg[7][1])
            return 1;
        const x = seg[1][0] - c.center[0], y = seg[1][1] - c.center[1];
        const px = p[0] - c.center[0], py = p[1] - c.center[1];
        let angle = Math.atan2(x * py - y * px, x * px + y * py);
        const tau = 2 * Math.PI;
        if (c.deltaTheta > 0 && angle < -eps.param * Math.abs(c.deltaTheta))
            angle += tau;
        if (c.deltaTheta < 0 && angle > eps.param * Math.abs(c.deltaTheta))
            angle -= tau;
        const t = angle / c.deltaTheta;
        return t >= -eps.param && t <= 1 + eps.param
            ? Math.max(0, Math.min(1, t))
            : null;
    };
    const out = [];
    for (const p of points) {
        const s = parameter(a, ca, p), t = parameter(b, cb, p);
        if (s !== null &&
            t !== null &&
            !out.some(([u, v]) => u === s && v === t))
            out.push([s, t]);
    }
    return out;
}

function quadraticRoots(a, b, c) {
    if (a === 0)
        return b === 0 ? [] : [-c / b];
    const d = b * b - 4 * a * c;
    if (d < 0)
        return [];
    const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(d)) / 2;
    return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}
/** Isolate roots between derivative extrema; no subdivision contact grouping. */
function lineBezierIntersection(line, curve, eps) {
    if (line[0] !== "L" || (curve[0] !== "C" && curve[0] !== "Q"))
        return null;
    const dx = line[2][0] - line[1][0], dy = line[2][1] - line[1][1];
    const length = Math.hypot(dx, dy);
    if (length === 0)
        return [];
    const ux = dx / length, uy = dy / length;
    const values = curve.slice(1).map((p) => ux * (p[1] - line[1][1]) - uy * (p[0] - line[1][0]));
    // A curve lying on the line needs overlap handling, not isolated roots.
    if (values.every((v) => v === 0))
        return null;
    const at = (t) => {
        const v = values.slice();
        for (let n = v.length - 1; n > 0; n--)
            for (let i = 0; i < n; i++)
                v[i] = (1 - t) * v[i] + t * v[i + 1];
        return v[0];
    };
    const [a, b, c, d] = values;
    const extrema = curve[0] === "Q"
        ? quadraticRoots(0, a - 2 * b + c, b - a)
        : quadraticRoots(-a + 3 * b - 3 * c + d, 2 * (a - 2 * b + c), b - a);
    const cuts = [
        0,
        ...extrema.filter((t) => t > 0 && t < 1).sort((a, b) => a - b),
        1,
    ];
    const roots = new Set();
    // The distance controls and degree-three De Casteljau evaluation use
    // fewer than 32 rounded operations along any dependency chain. Retain a
    // stationary contact whose residual cannot be distinguished from that
    // arithmetic error; a geometry-length tolerance would merge real roots.
    const roundoff = 32 * Number.EPSILON * Math.max(...values.map(Math.abs));
    for (let i = 0; i < cuts.length; i++) {
        const t = cuts[i], f = at(t);
        if (f === 0 ||
            (i > 0 &&
                i < cuts.length - 1 &&
                Math.abs(f) <= roundoff &&
                at(cuts[i - 1]) < 0 === f < 0 &&
                at(cuts[i + 1]) < 0 === f < 0))
            roots.add(t);
    }
    for (let i = 1; i < cuts.length; i++) {
        let lo = cuts[i - 1], hi = cuts[i], flo = at(lo), fhi = at(hi);
        if (flo === 0 || fhi === 0 || flo < 0 === fhi < 0)
            continue;
        for (;;) {
            const mid = (lo + hi) / 2;
            if (mid === lo || mid === hi)
                break;
            const f = at(mid);
            if (f === 0) {
                lo = hi = mid;
                break;
            }
            if (f < 0 === flo < 0) {
                lo = mid;
                flo = f;
            }
            else {
                hi = mid;
                fhi = f;
            }
        }
        roots.add(Math.abs(flo) <= Math.abs(fhi) ? lo : hi);
    }
    return [...roots]
        .sort((a, b) => a - b)
        .flatMap((t) => {
        const p = samplePathSegmentAt(curve, t);
        const s = (ux * (p[0] - line[1][0]) + uy * (p[1] - line[1][1])) / length;
        return s >= -eps.param && s <= 1 + eps.param
            ? [[Math.max(0, Math.min(1, s)), t]]
            : [];
    });
}

function lineSegmentIntersection([[x1, y1], [x2, y2]], [[x3, y3], [x4, y4]], eps) {
    // https://en.wikipedia.org/wiki/Intersection_(geometry)#Two_line_segments
    const a1 = x2 - x1;
    const b1 = x3 - x4;
    const c1 = x3 - x1;
    const a2 = y2 - y1;
    const b2 = y3 - y4;
    const c2 = y3 - y1;
    const denom = a1 * b2 - a2 * b1;
    if (Math.abs(denom) <= eps.collinear)
        return null;
    const s = (c1 * b2 - c2 * b1) / denom;
    const t = (a1 * c2 - a2 * c1) / denom;
    if (-eps.param <= s &&
        s <= 1 + eps.param &&
        -eps.param <= t &&
        t <= 1 + eps.param) {
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
    if (!(intSeg.startParam < midParam && midParam < intSeg.endParam))
        throw new Error("Intersection subdivision cannot advance its parameter interval");
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
function intersectionSegmentsOverlap({ seg: seg0, boundingBox: boundingBox0 }, { seg: seg1, boundingBox: boundingBox1 }, eps) {
    if (seg0[0] === "L") {
        if (seg1[0] === "L") {
            return lineSegmentsIntersect([seg0[1], seg0[2]], [seg1[1], seg1[2]], eps);
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
function segmentsEqual(seg0, seg1, eps) {
    const type = seg0[0];
    if (seg1[0] !== type)
        return false;
    switch (type) {
        case "L":
            return (vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2], eps));
        case "C":
            return (vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2], eps) &&
                vectorsEqual(seg0[3], seg1[3], eps) &&
                vectorsEqual(seg0[4], seg1[4], eps));
        case "Q":
            return (vectorsEqual(seg0[1], seg1[1], eps) &&
                vectorsEqual(seg0[2], seg1[2], eps) &&
                vectorsEqual(seg0[3], seg1[3], eps));
        case "A": {
            return (vectorsEqual(seg0[1], seg1[1], eps) &&
                Math.abs(seg0[2] - seg1[2]) < eps &&
                Math.abs(seg0[3] - seg1[3]) < eps &&
                (Math.abs(seg0[2] - seg0[3]) < eps ||
                    Math.abs(seg0[4] - seg1[4]) < eps) && // TODO: Handle rotations by Pi/2.
                seg0[5] === seg1[5] &&
                seg0[6] === seg1[6] &&
                vectorsEqual(seg0[7], seg1[7], eps));
        }
    }
}
function lineSegmentsCollinear(a, b, eps) {
    // Parallel directions alone do not establish collinearity; nor is a
    // normalized dot product exactly one for every truly parallel pair.
    // Bound the perpendicular displacement of both endpoints, symmetrically.
    const onLine = (line, points) => {
        const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1];
        const length = Math.hypot(dx, dy);
        if (length === 0)
            return false;
        return points.every((p) => Math.abs(dx * (p[1] - line[0][1]) - dy * (p[0] - line[0][0])) <=
            eps * length);
    };
    return onLine(a, b) && onLine(b, a);
}
function collinearLineSegmentIntersection(a, b) {
    // Project onto A's dominant coordinate, then intersect parameter intervals.
    // Reporting their endpoints once avoids duplicate rounded endpoint splits.
    const axis = Math.abs(a[1][0] - a[0][0]) >= Math.abs(a[1][1] - a[0][1]) ? 0 : 1;
    const delta = a[1][axis] - a[0][axis];
    if (delta === 0)
        return [];
    const s0 = (b[0][axis] - a[0][axis]) / delta;
    const s1 = (b[1][axis] - a[0][axis]) / delta;
    if (s0 === s1)
        return [];
    const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(1, Math.max(s0, s1));
    if (lo > hi)
        return [];
    const pair = (s) => [
        s,
        Math.max(0, Math.min(1, (s - s0) / (s1 - s0))),
    ];
    return lo === hi ? [pair(lo)] : [pair(lo), pair(hi)];
}
/*
 Collapses the many reports a single crossing can generate back into one.

 Where two curves meet at a shallow angle, subdivision cannot separate the
 crossing from its surroundings: it keeps bisecting until the leaves are
 straight enough to intersect as lines, and then a whole run of neighbouring
 leaf pairs each report a hit. A circle against the cubic that approximates it
 produced 146 points across the two paths where 8 are geometrically possible,
 and every spurious one becomes a vertex, an edge, and eventually a sliver
 face — that case ended up with 103 faces claiming to be the outer one.

 Two reports are the same crossing when the curves stay within eps.point of
 each other all the way between them. That asks the question directly, in the
 terms the rest of the library already uses for whether two places are the
 same place, and it distinguishes the two situations that matter: curves that
 osculate stay together across the whole run of spurious reports, while curves
 that cross transversally have pulled well apart before the next genuine
 crossing.

 Earlier attempts keyed on the subdivision's own leaves instead — their
 adjacency, then their size as a measure of how well a report is placed. Both
 failed, and in opposite directions. Leaves are far finer than the spread of
 reports around an osculating contact, so grouping by them left it in pieces;
 and they are far coarser than the true accuracy of a transversal crossing,
 where the line-line solve inside the leaf is good to the leaf's sagitta
 rather than its width, so grouping by them merged genuinely distinct
 crossings in real-02 and lost five faces.

 The representative is the report whose parameters put the two curves closest
 together, not an average of the group. The split points these produce have to
 land within eps.point of each other or the graph will not merge them into a
 single vertex, and averaging across a group spanning 2.7e-4 breaks exactly
 that.
*/
const SEPARATION_SAMPLES = 8;
// Refine both curve parameters together. A correspondence constrained to a
// straight line in parameter space can miss a second, shallow crossing.
function refineRoot(seg0, seg1, initial) {
    if (seg0[0] === "A" || seg1[0] === "A")
        return initial;
    let best = initial;
    const roundoff = 32 *
        Number.EPSILON *
        (segmentCoordinateScale(seg0) + segmentCoordinateScale(seg1));
    const a = createVector(), b = createVector();
    for (;;) {
        const p = samplePathSegmentAt(seg0, best.t0), q = samplePathSegmentAt(seg1, best.t1);
        pathSegmentTangentAtInto(seg0, best.t0, a);
        pathSegmentTangentAtInto(seg1, best.t1, b);
        const det = a[0] * b[1] - a[1] * b[0];
        if (det === 0 || best.gap <= roundoff)
            return best;
        const fx = p[0] - q[0], fy = p[1] - q[1];
        const dt0 = -(fx * b[1] - fy * b[0]) / det, dt1 = -(fx * a[1] - fy * a[0]) / det;
        if (!Number.isFinite(dt0) || !Number.isFinite(dt1))
            return best;
        let step = 1;
        for (;;) {
            const t0 = Math.max(0, Math.min(1, best.t0 + step * dt0));
            const t1 = Math.max(0, Math.min(1, best.t1 + step * dt1));
            if (t0 === best.t0 && t1 === best.t1)
                return best;
            const p = samplePathSegmentAt(seg0, t0), q = samplePathSegmentAt(seg1, t1);
            const gap = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (gap < best.gap) {
                const improvement = best.gap - gap;
                best = { t0, t1, gap };
                if (improvement <= roundoff)
                    return best;
                break;
            }
            step /= 2;
        }
    }
}
function segmentCoordinateScale(seg) {
    return Math.max(...seg.flatMap((value) => Array.isArray(value) ? value.map(Math.abs) : []), ...(seg[0] === "A" ? [Math.abs(seg[2]), Math.abs(seg[3])] : []));
}
function rootUncertainty(seg0, seg1, candidate) {
    // This arithmetic envelope covers polynomial evaluation. Arc sampling
    // also reconstructs an ellipse and uses transcendental functions, so its
    // contacts retain the geometric grouping check below.
    if (seg0[0] === "A" || seg1[0] === "A")
        return [Infinity, Infinity];
    const a = createVector(), b = createVector();
    pathSegmentTangentAtInto(seg0, candidate.t0, a);
    pathSegmentTangentAtInto(seg1, candidate.t1, b);
    const determinant = Math.abs(a[0] * b[1] - a[1] * b[0]);
    if (determinant === 0)
        return [Infinity, Infinity];
    // Sampling and tangent evaluation each have a short arithmetic dependency
    // chain. Propagate their rounding envelope through the inverse Jacobian;
    // unlike a fixed angular threshold, this scales with the actual geometry.
    const error = candidate.gap +
        32 *
            Number.EPSILON *
            (segmentCoordinateScale(seg0) + segmentCoordinateScale(seg1));
    // Near a multiple root, the Newton correction underestimates parameter
    // error by its multiplicity. Bezout bounds that multiplicity by the
    // product of degrees (a conic for an ellipse, at most cubic for Beziers).
    const degree = (seg) => seg[0] === "C" ? 3 : seg[0] === "L" ? 1 : 2;
    const multiplicity = degree(seg0) * degree(seg1);
    return [
        (multiplicity * error * Math.hypot(...b)) / determinant,
        (multiplicity * error * Math.hypot(...a)) / determinant,
    ];
}
function staysTogether(seg0, seg1, a, b, eps) {
    const ua = rootUncertainty(seg0, seg1, a), ub = rootUncertainty(seg0, seg1, b);
    if (Math.abs(a.t0 - b.t0) > ua[0] + ub[0] + eps.param ||
        Math.abs(a.t1 - b.t1) > ua[1] + ub[1] + eps.param)
        return false;
    for (let k = 1; k < SEPARATION_SAMPLES; k++) {
        const s = k / SEPARATION_SAMPLES;
        const p = samplePathSegmentAt(seg0, lerp(a.t0, b.t0, s));
        const q = samplePathSegmentAt(seg1, lerp(a.t1, b.t1, s));
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > eps.point)
            return false;
    }
    return true;
}
/*
 Two arcs of one ellipse, solved rather than subdivided.

 Bisection cannot resolve a shared arc: the two curves never separate, so it
 recurses to the leaf size the whole way along the overlap and reports a hit
 from every leaf pair that reaches the bottom. The leaf-level short-circuits
 further down only rescue the case where both sides cover the same extent and
 so halve into matching pieces — a quarter arc against that same quarter arc,
 forwards or reversed. A quarter arc against the 60 degrees of it a neighbour
 shares, or against the semicircle that contains it, never lines up however far
 down the recursion goes, and the entire run is bisected.

 The centre parametrization answers it outright. Two arcs lying on one ellipse
 overlap over an interval of angle, which intersects in closed form, and the
 ends of that interval convert straight back to a parameter on each arc. It is
 the curved counterpart of what `lineSegmentsCollinear` does for a pair of
 lines, and the reason sharing a straight edge is cheap where sharing a curved
 one is not.

 Returning null means "not a common ellipse, subdivide as usual". An empty
 array is an answer — two arcs of one ellipse whose angles do not meet — and
 not an abstention.
*/
const TAU_ARC = 2 * Math.PI;
function coincidentArcIntersection(seg0, seg1, eps) {
    if (seg0[0] !== "A" || seg1[0] !== "A")
        return null;
    const c0 = arcSegmentToCenter(normalizeArcSegment(seg0));
    const c1 = arcSegmentToCenter(normalizeArcSegment(seg1));
    if (!c0 || !c1)
        return null;
    if (Math.abs(c0.center[0] - c1.center[0]) > eps.point ||
        Math.abs(c0.center[1] - c1.center[1]) > eps.point ||
        Math.abs(c0.rx - c1.rx) > eps.point ||
        Math.abs(c0.ry - c1.ry) > eps.point) {
        return null;
    }
    const biggest = Math.max(c0.rx, c0.ry);
    if (!(biggest > 0))
        return null;
    // How far round the rim `eps.point` reaches. Everything angular below is
    // measured against this so the test means the same thing at any size.
    const angleEps = eps.point / biggest;
    /*
     A circle looks the same however it is turned, an ellipse only after half a
     turn. The remaining way to spell one ellipse — radii swapped and a quarter
     turn applied — is left to the subdivision rather than guessed at.
    */
    if (Math.abs(c0.rx - c0.ry) > eps.point) {
        const turned = Math.abs((((c0.phi - c1.phi) % 180) + 180) % 180);
        if (Math.min(turned, 180 - turned) > (angleEps * 180) / Math.PI) {
            return null;
        }
    }
    if (Math.abs(c0.deltaTheta) < angleEps ||
        Math.abs(c1.deltaTheta) < angleEps) {
        return null;
    }
    /*
     `theta` is measured in the ellipse's own frame, the one `phi` turns it
     into, so two arcs of the same circle written with different `phi` have
     ranges that cannot be compared until both are brought into the world
     frame. Adding `phi` does exactly that for a circle, where the frame is a
     symmetry and the world angle is `theta + phi`; and it stays consistent for
     an ellipse written half a turn around, where `phi + 180` and `theta + pi`
     name the same point. Those are the only two spellings accepted above.

     Comparing the two ranges without this makes two drawings of one circle
     look as though their angles never meet. There is no safety net for that:
     this function is authoritative when it returns an array, so the pair would
     be reported as not intersecting at all.
    */
    const off0 = deg2rad(c0.phi);
    const off1 = deg2rad(c1.phi);
    // Each arc as an increasing interval of angle; direction is carried by
    // `deltaTheta` and put back when converting to a parameter.
    const span = (c, off) => {
        const a = c.theta1 + off;
        const b = c.theta1 + c.deltaTheta + off;
        return a <= b ? [a, b] : [b, a];
    };
    const [lo0, hi0] = span(c0, off0);
    const [lo1, hi1] = span(c1, off1);
    const paramAt = (c, off, theta) => {
        const t = (theta - off - c.theta1) / c.deltaTheta;
        return t < 0 ? 0 : t > 1 ? 1 : t;
    };
    /*
     Neither arc spans more than a full turn, so at most two whole-turn shifts
     of the second can meet the first, and the overlap is at most two intervals.
    */
    const out = [];
    const kFrom = Math.floor((lo0 - hi1) / TAU_ARC);
    const kTo = Math.ceil((hi0 - lo1) / TAU_ARC);
    for (let k = kFrom; k <= kTo; k++) {
        const shift = k * TAU_ARC;
        const from = Math.max(lo0, lo1 + shift);
        const to = Math.min(hi0, hi1 + shift);
        if (to < from - angleEps)
            continue;
        if (to - from <= angleEps) {
            // Meeting at a single angle: a contact, not an overlap.
            const mid = (from + to) / 2;
            out.push([paramAt(c0, off0, mid), paramAt(c1, off1, mid - shift)]);
            continue;
        }
        out.push([paramAt(c0, off0, from), paramAt(c1, off1, from - shift)]);
        out.push([paramAt(c0, off0, to), paramAt(c1, off1, to - shift)]);
    }
    return out;
}
/*
 Whether two pieces of curve are the same piece traversed opposite ways.

 Reversing allocates, and this sits in the subdivision's innermost loop, so the
 endpoints are checked first: they have to cross-match before it is worth
 building the reversed segment at all.
*/
function segmentEndPoint(seg) {
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
function leavesCoincideReversed(seg0, seg1, eps) {
    if (seg0[0] !== seg1[0])
        return false;
    // `seg[1]` is the start point whatever the type. Read the endpoints in
    // place rather than through `pathSegmentToLineSegment`, which builds a
    // pair: this runs on every surviving leaf pair of every subdivision.
    if (!vectorsEqual(seg0[1], segmentEndPoint(seg1), eps.point) ||
        !vectorsEqual(segmentEndPoint(seg0), seg1[1], eps.point)) {
        return false;
    }
    return segmentsEqual(seg0, reversePathSegment(seg1), eps.point);
}
/*
 Recovers the stretch a group of reports covers, when it covers one at all.

 A group whose members stay together over a run is not one crossing seen many
 times over; it is an overlap, and collapsing it to a point dissolves a shared
 boundary. How many reports the group holds says nothing about which of the two
 it is: a coincident pair can come out of grouping as a single report, while
 two curves that merely run close together and cross repeatedly leave several.
 The run's *extent* is the signal, and it is what this reads.

 Two segments of the same type that coincide do so under a linear
 correspondence between their parameters: the same arc of the same circle, the
 same stretch of the same line. So the ends of the run are wherever that
 correspondence first leaves either segment's [0, 1] range, and can be solved
 for rather than searched. The outermost reports are no use on their own —
 each sits somewhere inside the last leaf that still overlapped, which is
 `eps.linear` across, where the split has to land within `eps.point` of its
 partner or `findVertices` will not merge the two into one vertex.

 Returns null when the group turns out not to describe an overlap, and the
 caller falls back to treating it as a single contact. Every reason to bail is
 checked against the geometry rather than assumed: the correspondence has to be
 well conditioned, the run has to be longer than `eps.point` — otherwise it is
 a point contact wearing a group's clothes — and the two curves have to stay
 within `eps.point` of each other all along the stretch that comes back. The
 correspondence is fitted from two reports, so that last check is what stops a
 bad fit from splitting where there is nothing to split.
*/
const OVERLAP_VERIFY_SAMPLES = 16;
function overlapEnds(seg0, seg1, group, eps) {
    if (group.length < 2)
        return null;
    const first = group[0];
    const last = group[group.length - 1];
    const dt0 = last.t0 - first.t0;
    const dt1 = last.t1 - first.t1;
    if (Math.abs(dt0) < eps.param || Math.abs(dt1) < eps.param)
        return null;
    const slope = dt1 / dt0;
    if (!Number.isFinite(slope))
        return null;
    const t1At = (t0) => first.t1 + (t0 - first.t0) * slope;
    const t0At = (t1) => first.t0 + (t1 - first.t1) / slope;
    // Where the correspondence keeps both parameters inside their own segment.
    const bound0 = t0At(0);
    const bound1 = t0At(1);
    let lo = Math.max(0, Math.min(bound0, bound1));
    let hi = Math.min(1, Math.max(bound0, bound1));
    if (!(hi > lo))
        return null;
    const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
    // Land exactly on the ends rather than a hair inside them, so that
    // `splitAtIntersections` recognizes and drops a split it should not make.
    const snap = (t) => (t < eps.param ? 0 : t > 1 - eps.param ? 1 : t);
    lo = snap(lo);
    hi = snap(hi);
    const ends = [
        [lo, snap(clamp01(t1At(lo)))],
        [hi, snap(clamp01(t1At(hi)))],
    ];
    const a = samplePathSegmentAt(seg0, ends[0][0]);
    const b = samplePathSegmentAt(seg0, ends[1][0]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps.point)
        return null;
    for (let k = 0; k <= OVERLAP_VERIFY_SAMPLES; k++) {
        const s = k / OVERLAP_VERIFY_SAMPLES;
        const p = samplePathSegmentAt(seg0, lerp(ends[0][0], ends[1][0], s));
        const q = samplePathSegmentAt(seg1, lerp(ends[0][1], ends[1][1], s));
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > eps.point)
            return null;
    }
    return ends;
}
function groupCandidates(seg0, seg1, candidates, eps) {
    if (candidates.length <= 1) {
        return candidates.map((c) => [c.t0, c.t1]);
    }
    const sorted = [...candidates].sort((a, b) => a.t0 - b.t0);
    const groups = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const group = groups[groups.length - 1];
        const previous = group[group.length - 1];
        if (staysTogether(seg0, seg1, previous, sorted[i], eps)) {
            group.push(sorted[i]);
        }
        else {
            groups.push([sorted[i]]);
        }
    }
    /*
     Only same-type pairs are considered for overlap. `findVertices` merges
     coincident edges with `segmentsEqual`, which compares representations and
     rejects two spellings of the same curve out of hand — a line against a
     zero-radius arc, or against a cubic whose controls are collinear, are
     identical to the last bit and still report as different. Splitting a pair
     the merge will then refuse to join would leave two edges lying on top of
     each other bounding nothing between them, which is worse than reporting a
     single contact where an overlap exists. `lineariseDegenerateSegment` is
     what brings such pairs to a common spelling early enough for this test to
     accept them.
    */
    const sameType = seg0[0] === seg1[0];
    return groups.flatMap((group) => {
        const ends = sameType ? overlapEnds(seg0, seg1, group, eps) : null;
        if (ends)
            return ends;
        return [refineContact(seg0, seg1, group)];
    });
}
/*
 Pins a grouped contact down to where the curves actually meet.

 The reports in a group are scattered along the run the subdivision could not
 resolve, and the nearest of them can still sit well off the true contact: on
 the circle-against-its-own-cubic case the best report of one group was 2.4e-5
 away from the tangency. That is small, but splitting both curves there rather
 than at the contact leaves them crossing at a shallow angle instead of
 touching, and the incidence angles at the resulting vertex then differ by
 1.4e-7 — far too much for the sort to recognize as a tie, so it orders them on
 that instead of on curvature and traces the faces wrongly.

 The group brackets the contact, so a golden-section search along the straight
 correspondence between its outermost reports finds it. Only groups with
 something to refine are touched: a single report comes from a leaf pair that
 crossed squarely, where the line-line solve inside the leaf is already as good
 as this could be.
*/
const INV_GOLDEN = (Math.sqrt(5) - 1) / 2;
function refineContact(seg0, seg1, group) {
    let best = group[0];
    for (const c of group)
        if (c.gap < best.gap)
            best = c;
    if (group.length < 2)
        return [best.t0, best.t1];
    // The group is in order of t0, so its ends bracket the contact.
    const first = group[0];
    const last = group[group.length - 1];
    const at = (s) => {
        const t0 = lerp(first.t0, last.t0, s);
        const t1 = lerp(first.t1, last.t1, s);
        const p = samplePathSegmentAt(seg0, t0);
        const q = samplePathSegmentAt(seg1, t1);
        return { t0, t1, gap: Math.hypot(p[0] - q[0], p[1] - q[1]) };
    };
    let lo = 0;
    let hi = 1;
    let c = hi - INV_GOLDEN * (hi - lo);
    let d = lo + INV_GOLDEN * (hi - lo);
    let fc = at(c);
    let fd = at(d);
    while (lo < c && c < d && d < hi) {
        if (fc.gap < fd.gap) {
            hi = d;
            d = c;
            fd = fc;
            c = hi - INV_GOLDEN * (hi - lo);
            fc = at(c);
        }
        else {
            lo = c;
            c = d;
            fc = fd;
            d = lo + INV_GOLDEN * (hi - lo);
            fd = at(d);
        }
    }
    const refined = fc.gap < fd.gap ? fc : fd;
    return refined.gap < best.gap
        ? [refined.t0, refined.t1]
        : [best.t0, best.t1];
}
function polynomialHullsOverlap(a, b) {
    const pa = a.slice(1), pb = b.slice(1);
    const origin = pa[0];
    const roundoff = 32 *
        Number.EPSILON *
        (segmentCoordinateScale(a) + segmentCoordinateScale(b));
    // Any separating axis proves the convex control hulls disjoint. Testing
    // every control-polygon pair includes every hull edge without constructing
    // either hull; projection is relative to one point to avoid cancellation.
    for (const polygon of [pa, pb])
        for (let i = 0; i < polygon.length; i++)
            for (let j = i + 1; j < polygon.length; j++) {
                const dx = polygon[j][0] - polygon[i][0], dy = polygon[j][1] - polygon[i][1];
                if (dx === 0 && dy === 0)
                    continue;
                const project = (p) => dx * (p[1] - origin[1]) - dy * (p[0] - origin[0]);
                const va = pa.map(project), vb = pb.map(project), error = roundoff * Math.hypot(dx, dy);
                if (Math.max(...va) < Math.min(...vb) - error ||
                    Math.max(...vb) < Math.min(...va) - error)
                    return false;
            }
    return true;
}
function pathSegmentIntersection(a, b, eps) {
    eps = {
        ...eps,
        param: Math.min(parameterTolerance(a, eps), parameterTolerance(b, eps)),
    };
    // Give each unordered pair the same numerical solve regardless of which
    // operand the broad-phase traversal encounters first. This does not decide
    // correctness: the resulting arrangement still faces independent coverage
    // and area checks, but avoids two answers from rounding-dependent seeds.
    if (JSON.stringify(a) > JSON.stringify(b))
        return intersectOrdered(b, a, eps).map(([s, t]) => [t, s]);
    return intersectOrdered(a, b, eps);
}
function intersectOrdered(origSeg0, origSeg1, eps) {
    const seg0 = origSeg0;
    const seg1 = origSeg1;
    if (seg0[0] === "L" && seg1[0] === "L") {
        const segLine0 = [seg0[1], seg0[2]];
        const segLine1 = [seg1[1], seg1[2]];
        if (lineSegmentsCollinear(segLine0, segLine1, eps.point)) {
            return collinearLineSegmentIntersection(segLine0, segLine1);
        }
        const st = lineSegmentIntersection(segLine0, segLine1, eps);
        return st ? [st] : [];
    }
    const lineBezier = lineBezierIntersection(seg0, seg1, eps);
    if (lineBezier)
        return lineBezier;
    const reversedLineBezier = lineBezierIntersection(seg1, seg0, eps);
    if (reversedLineBezier)
        return reversedLineBezier.map(([a, b]) => [b, a]);
    const coincidentArcs = coincidentArcIntersection(seg0, seg1, eps);
    if (coincidentArcs)
        return coincidentArcs;
    const circularArcs = circularArcIntersection(seg0, seg1, eps);
    if (circularArcs)
        return circularArcs;
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
    const polynomialPair = seg0[0] !== "A" && seg1[0] !== "A";
    const coincidenceTolerance = eps.point;
    const candidates = [];
    function pushCandidate(t0, t1) {
        const p = samplePathSegmentAt(origSeg0, t0);
        const q = samplePathSegmentAt(origSeg1, t1);
        candidates.push({
            t0,
            t1,
            gap: Math.hypot(p[0] - q[0], p[1] - q[1]),
        });
    }
    function pushLineSegmentIntersection(seg0, seg1) {
        const lineSegment0 = pathSegmentToLineSegment(seg0.seg);
        const lineSegment1 = pathSegmentToLineSegment(seg1.seg);
        const st = lineSegmentIntersection(lineSegment0, lineSegment1, eps);
        if (st) {
            pushCandidate(lerp(seg0.startParam, seg0.endParam, st[0]), lerp(seg1.startParam, seg1.endParam, st[1]));
        }
    }
    function isLinear(seg) {
        return (isNearlyLinearSegment(seg.seg, Math.min(NEARLY_LINEAR_EPS, eps.point / 4)) ||
            boundingBoxMaxExtent(seg.boundingBox) <= eps.linear ||
            seg.endParam - seg.startParam < eps.param);
    }
    // Depth first traversal keeps pending work proportional to subdivision
    // depth rather than the breadth of a coincident run. No pair is discarded.
    while (pairs.length) {
        const [seg0, seg1] = pairs.pop();
        if (segmentsEqual(seg0.seg, seg1.seg, coincidenceTolerance)) {
            /*
                 The two leaves are the same piece of curve. Record how far the
                 run reaches rather than dropping the pair: `groupCandidates`
                 recovers the shared stretch from the ends of the reports, so
                 with nothing recorded here a boundary shared exactly — one
                 whose parametrizations line up leaf for leaf — yields no
                 reports along its whole length. Subdividing further is
                 pointless either way, so the pair stops here.
                */
            pushCandidate(seg0.startParam, seg1.startParam);
            pushCandidate(seg0.endParam, seg1.endParam);
            continue;
        }
        if (leavesCoincideReversed(seg0.seg, seg1.seg, {
            ...eps,
            point: coincidenceTolerance,
        })) {
            /*
                 The same, for a leaf traversed the other way round. It needs a
                 test of its own because `segmentsEqual` compares endpoints in
                 order and so never fires on a reversed pair; without it the
                 subdivision grinds the whole coincident run down to
                 `eps.linear`, which for a pair sharing a long stretch is
                 thousands of leaf pairs and seconds of work. The
                 correspondence crosses over: the start of one leaf is the end
                 of the other.
                */
            pushCandidate(seg0.startParam, seg1.endParam);
            pushCandidate(seg0.endParam, seg1.startParam);
            continue;
        }
        if (polynomialPair && !polynomialHullsOverlap(seg0.seg, seg1.seg))
            continue;
        const isLinear0 = isLinear(seg0);
        const isLinear1 = isLinear(seg1);
        if (isLinear0 && isLinear1) {
            pushLineSegmentIntersection(seg0, seg1);
        }
        else {
            let subdivided0;
            let subdivided1;
            if (!isLinear0 && !isLinear1) {
                /*
                     Split only the larger piece when their boxes differ. In
                     addition to avoiding an unnecessary four-way product,
                     this lets an exact De Casteljau child meet the unsplit
                     copy of that child on the next iteration, where
                     `segmentsEqual` recognizes the coincident run outright.
                     Splitting both sides forever preserves their 2:1
                     parameter-size ratio and reduces an identical curve to
                     thousands of leaves before discovering the same fact.
                    */
                const extent0 = boundingBoxMaxExtent(seg0.boundingBox);
                const extent1 = boundingBoxMaxExtent(seg1.boundingBox);
                if (extent0 > extent1) {
                    subdivided0 = subdivideIntersectionSegment(seg0);
                    subdivided1 = [seg1];
                }
                else if (extent1 > extent0) {
                    subdivided0 = [seg0];
                    subdivided1 = subdivideIntersectionSegment(seg1);
                }
                else {
                    subdivided0 = subdivideIntersectionSegment(seg0);
                    subdivided1 = subdivideIntersectionSegment(seg1);
                }
            }
            else {
                subdivided0 = isLinear0
                    ? [seg0]
                    : subdivideIntersectionSegment(seg0);
                subdivided1 = isLinear1
                    ? [seg1]
                    : subdivideIntersectionSegment(seg1);
            }
            for (const seg0 of subdivided0) {
                for (const seg1 of subdivided1) {
                    if (intersectionSegmentsOverlap(seg0, seg1, eps)) {
                        pairs.push([seg0, seg1]);
                    }
                }
            }
        }
    }
    return groupCandidates(origSeg0, origSeg1, candidates.map((c) => refineRoot(origSeg0, origSeg1, c)), eps);
}

const binomial = [
    [1],
    [1, 1],
    [1, 2, 1],
    [1, 3, 3, 1],
    [1, 4, 6, 4, 1],
    [1, 5, 10, 10, 5, 1],
];
/** Contribution to the signed area integral, relative to a nearby origin. */
function segmentArea(segment, origin) {
    const seg = segment.map((value) => Array.isArray(value)
        ? [value[0] - origin[0], value[1] - origin[1]]
        : value);
    if (seg[0] === "A") {
        const start = seg[1], end = seg[7], arc = arcSegmentToCenter(seg);
        if (!arc)
            return (start[0] * end[1] - start[1] * end[0]) / 2;
        const theta = arc.deltaTheta;
        let excess;
        if (Math.abs(theta) >= 1)
            excess = theta - Math.sin(theta);
        else {
            // theta - sin(theta) loses all digits for a very short arc.
            let term = (theta * theta * theta) / 6;
            excess = term;
            for (let degree = 5;; degree += 2) {
                term *= (-theta * theta) / ((degree - 1) * degree);
                const next = excess + term;
                if (next === excess)
                    break;
                excess = next;
            }
        }
        return ((start[0] * end[1] - start[1] * end[0] + arc.rx * arc.ry * excess) /
            2);
    }
    // Integrate Bernstein products directly. For degree n, P' has degree
    // n-1 and integral(B_i^n B_j^(n-1)) = C(n,i) C(n-1,j) /
    // (2n C(2n-1,i+j)). P' contributes n and area contributes another 1/2.
    const points = seg.slice(1);
    const n = points.length - 1;
    let total = 0, correction = 0;
    for (let i = 0; i <= n; i++)
        for (let j = 0; j < n; j++) {
            const dx = points[j + 1][0] - points[j][0];
            const dy = points[j + 1][1] - points[j][1];
            const term = ((points[i][0] * dy - points[i][1] * dx) *
                binomial[n][i] *
                binomial[n - 1][j]) /
                binomial[2 * n - 1][i + j] /
                4;
            const adjusted = term - correction, next = total + adjusted;
            correction = next - total - adjusted;
            total = next;
        }
    return total;
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

/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
const TAU_ANGLE = 2 * Math.PI;
const INTERSECTION_TREE_DEPTH = 8;
const POINT_TREE_DEPTH = 8;
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
function makeParents(count, index) {
    const parents = new Array(count).fill(false);
    parents[index] = true;
    return parents;
}
function numberArraysEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
function orBooleansInto(target, source) {
    for (let i = 0; i < source.length; i++) {
        if (source[i])
            target[i] = true;
    }
}
/*
 Records a path joining an already-created edge, and which way round it runs.

 `windings[i]` is the signed number of times path i traverses this half-edge in
 the half-edge's own direction, so the two half-edges always hold opposite
 values and crossing one moves path i's winding number by exactly that much.
 `againstForward` says which way round the joining path goes.

 It accumulates rather than assigns, for two reasons. Only the joining path's
 own slots are touched, so the orientations of the paths already sharing the
 edge survive; assigning the whole array would wipe them, and Intersection and
 Exclusion would then depend on the order of the inputs wherever two paths
 share a collinear edge. And a path is free to run along the same edge more
 than once — a subpath that goes round twice covers its interior with a winding
 number of two, which non-zero and even-odd disagree about — so a count is
 needed where a flag would report both traversals as one.
*/
function addWinding(existingEdge, parents, againstForward) {
    const [, forward, backward] = existingEdge;
    const step = againstForward ? -1 : 1;
    for (let i = 0; i < parents.length; i++) {
        if (!parents[i])
            continue;
        forward.windings[i] += step;
        backward.windings[i] -= step;
    }
}
function createObjectCounter() {
    let i = 0;
    return memoizeWeak(() => i++);
}
function segmentToEdge(pathCount, index) {
    return (seg) => ({ seg, parents: makeParents(pathCount, index) });
}
function splitAtSelfIntersections(edges, eps) {
    // A non-collinear cubic has at most one isolated self-intersection.
    // Its children cannot introduce another one. Rechecking appended children
    // rediscovered rounded endpoint contacts and grew the edge array forever.
    const originalCount = edges.length;
    for (let i = 0; i < originalCount; i++) {
        const edge = edges[i];
        if (edge.seg[0] !== "C")
            continue;
        const intersection = pathCubicSegmentSelfIntersection(edge.seg);
        if (!intersection)
            continue;
        let segment = edge.seg;
        const param = parameterTolerance(segment, eps);
        let previous = 0;
        const children = [];
        for (const t of intersection) {
            if (t <= previous + param || t >= 1 - param)
                continue;
            const [first, rest] = splitCubicSegmentAt(segment, (t - previous) / (1 - previous));
            children.push({ seg: first, parents: edge.parents });
            segment = rest;
            previous = t;
        }
        if (!children.length)
            continue;
        children.push({ seg: segment, parents: edge.parents });
        edges[i] = children[0];
        edges.push(...children.slice(1));
    }
}
function splitAtIntersections(edges, eps) {
    const withBoundingBox = edges.map((edge) => ({
        ...edge,
        boundingBox: (() => {
            const box = pathSegmentBoundingBox(edge.seg);
            // The narrow-phase solve admits endpoint parameters just outside
            // [0,1]. Candidate selection must cover that same neighbourhood.
            return expandBoundingBox(box, eps.point + eps.param * boundingBoxMaxExtent(box));
        })(),
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
            const intersection = pathSegmentIntersection(edge.seg, candidate.seg, eps);
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
        // Numeric, not the default lexicographic sort: a parameter small
        // enough to stringify in exponential form ("1e-7") would otherwise
        // sort after "0.9" and the segment would be cut in the wrong order.
        splits.sort((a, b) => a - b);
        let tmpSeg = edge.seg;
        const param = parameterTolerance(edge.seg, eps);
        let prevT = 0;
        for (let j = 0; j < splits.length; j++) {
            const t = splits[j];
            if (t >= 1 - param)
                break;
            if (t <= prevT + param)
                continue;
            const tt = (t - prevT) / (1 - prevT);
            if (tt <= 0 || tt >= 1)
                continue;
            prevT = t;
            const [seg1, seg2] = splitSegmentAt(tmpSeg, tt);
            newEdges.push({
                seg: seg1,
                boundingBox: pathSegmentBoundingBox(seg1),
                parents: edge.parents,
            });
            tmpSeg = seg2;
        }
        newEdges.push({
            seg: tmpSeg,
            boundingBox: pathSegmentBoundingBox(tmpSeg),
            parents: edge.parents,
        });
    }
    return { edges: newEdges, totalBoundingBox };
}
function findVertices(edges, boundingBox, eps, inputPoints) {
    // Approximate coincidence must choose one geometric representative in a
    // stable order. Operand visitation order otherwise changes which curve's
    // controls survive a merge and, with them, the incident tangent ordering.
    edges = edges
        .map((edge) => ({ edge, key: JSON.stringify(edge.seg) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map(({ edge }) => edge);
    const vertexTree = new QuadTree(boundingBox, POINT_TREE_DEPTH);
    const newVertices = [];
    function getVertex(point) {
        const box = boundingBoxAroundPoint(point, eps.point);
        const existingVertices = vertexTree.find(box);
        let closest;
        let distance = eps.point;
        for (const vertex of existingVertices) {
            const d = Math.hypot(vertex.point[0] - point[0], vertex.point[1] - point[1]);
            if (d <= distance) {
                closest = vertex;
                distance = d;
            }
        }
        if (closest)
            return closest;
        const vertex = { point, outgoingEdges: [] };
        // Store a point, not another tolerance box (which doubled the radius).
        vertexTree.insert(boundingBoxAroundPoint(point, 0), vertex);
        newVertices.push(vertex);
        return vertex;
    }
    // Stable representatives, independent of operand and edge visitation order.
    for (const point of inputPoints
        .slice()
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]))
        getVertex(point);
    const vertexForPoint = new WeakMap();
    const points = edges
        .flatMap(({ seg }) => [getStartPoint(seg), getEndPoint(seg)])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const point of points)
        vertexForPoint.set(point, getVertex(point));
    const getVertexId = createObjectCounter();
    const vertexPairIdToEdges = new Map();
    function getVertexPairEdges(startId, endId) {
        return vertexPairIdToEdges.get(startId)?.get(endId);
    }
    function ensureVertexPairEdges(startId, endId) {
        let inner = vertexPairIdToEdges.get(startId);
        if (!inner) {
            inner = new Map();
            vertexPairIdToEdges.set(startId, inner);
        }
        let edges = inner.get(endId);
        if (!edges) {
            edges = [];
            inner.set(endId, edges);
        }
        return edges;
    }
    const newEdges = edges.flatMap((edge) => {
        const startPoint = getStartPoint(edge.seg);
        const endPoint = getEndPoint(edge.seg);
        // discard zero-length segments before creating vertices
        if (vectorsEqual(startPoint, endPoint, eps.point)) {
            switch (edge.seg[0]) {
                case "L":
                    return [];
                case "C":
                    if (vectorsEqual(edge.seg[1], edge.seg[2], eps.point) &&
                        vectorsEqual(edge.seg[3], edge.seg[4], eps.point)) {
                        return [];
                    }
                    break;
                case "Q":
                    if (vectorsEqual(edge.seg[1], edge.seg[2], eps.point)) {
                        return [];
                    }
                    break;
                case "A":
                    // SVG omits an arc whose endpoints coincide, regardless
                    // of the large-arc and sweep flags.
                    return [];
            }
        }
        const startVertex = vertexForPoint.get(startPoint);
        const endVertex = vertexForPoint.get(endPoint);
        // SVG output joins segments at a single vertex. Prefer the original
        // incoming endpoint, then share that point with every incident edge.
        // This also makes signed area translation invariant for tiny faces.
        const seg = edge.seg.slice();
        seg[1] = startVertex.point;
        seg[seg.length - 1] = endVertex.point;
        edge = { ...edge, seg, boundingBox: pathSegmentBoundingBox(seg) };
        const startId = getVertexId(startVertex);
        const endId = getVertexId(endVertex);
        const existingEdges = getVertexPairEdges(startId, endId);
        if (existingEdges) {
            const existingEdge = existingEdges.find((other) => segmentsEqual(other[0].seg, edge.seg, eps.point));
            if (existingEdge) {
                // A shared edge traversed the same way round. The joining path
                // runs along the forward half-edge and against the backward
                // one, matching how a fresh edge pair is built below. Only the
                // joining path's own slots are touched; the slots belonging to
                // paths already on this edge keep their own orientation.
                addWinding(existingEdge, edge.parents, false);
                orBooleansInto(existingEdge[1].parents, edge.parents);
                orBooleansInto(existingEdge[2].parents, edge.parents);
                return [];
            }
        }
        const existingEdgesInv = getVertexPairEdges(endId, startId);
        if (existingEdgesInv) {
            const reversedSeg = reversePathSegment(edge.seg);
            const existingEdge = existingEdgesInv.find((other) => segmentsEqual(other[0].seg, reversedSeg, eps.point));
            if (existingEdge) {
                // A shared edge traversed the opposite way round: the joining
                // path runs along the backward half-edge and against the
                // forward one.
                addWinding(existingEdge, edge.parents, true);
                orBooleansInto(existingEdge[1].parents, edge.parents);
                orBooleansInto(existingEdge[2].parents, edge.parents);
                return [];
            }
        }
        const fwdEdge = {
            ...edge,
            parents: edge.parents.slice(),
            incidentVertices: [startVertex, endVertex],
            directionFlag: false,
            windings: edge.parents.map((p) => (p ? 1 : 0)),
            twin: null,
        };
        const bwdEdge = {
            ...edge,
            parents: edge.parents.slice(),
            incidentVertices: [endVertex, startVertex],
            directionFlag: true,
            // Negated: on the backward half-edge the originating path runs
            // against its own orientation.
            windings: edge.parents.map((p) => (p ? -1 : 0)),
            twin: fwdEdge,
        };
        fwdEdge.twin = bwdEdge;
        startVertex.outgoingEdges.push(fwdEdge);
        endVertex.outgoingEdges.push(bwdEdge);
        ensureVertexPairEdges(startId, endId).push([edge, fwdEdge, bwdEdge]);
        return [fwdEdge, bwdEdge];
    });
    /*
     Opposite traversals by one input cancel rather than making the second
     traversal disappear while the first remains. Keep parent membership in
     step with the accumulated signed winding, then remove edges which no
     input contributes to at all before they can create zero-winding faces.
    */
    for (const edge of newEdges) {
        for (let i = 0; i < edge.parents.length; i++) {
            edge.parents[i] = edge.windings[i] !== 0;
        }
    }
    const contributesToBoundary = (edge) => edge.windings.some((winding) => winding !== 0);
    const keptEdges = newEdges.filter(contributesToBoundary);
    for (const vertex of newVertices) {
        vertex.outgoingEdges = vertex.outgoingEdges.filter(contributesToBoundary);
    }
    return {
        edges: keptEdges,
        vertices: newVertices.filter((vertex) => vertex.outgoingEdges.length),
    };
}
function getOrder(vertex) {
    return vertex.outgoingEdges.length;
}
function computeMinor({ vertices }) {
    const newEdges = [];
    const newVertices = [];
    let nextEdgeId = 0;
    const toMinorVertex = memoizeWeak((_majorVertex) => {
        const minorVertex = { outgoingEdges: [] };
        newVertices.push(minorVertex);
        return minorVertex;
    });
    const getEdgeId = createObjectCounter();
    const idToEdge = new Map();
    function getEdgeById(startId, endId) {
        return idToEdge.get(startId)?.get(endId);
    }
    function setEdgeById(startId, endId, edge) {
        let inner = idToEdge.get(startId);
        if (!inner) {
            inner = new Map();
            idToEdge.set(startId, inner);
        }
        inner.set(endId, edge);
    }
    const visited = new WeakSet();
    // A degree-two vertex can disappear only when traversal across it keeps
    // the same signed winding for every input. Segment storage direction is
    // independent: store every minor segment in its actual traversal direction.
    const isChainVertex = (vertex) => {
        if (getOrder(vertex) !== 2)
            return false;
        const [a, b] = vertex.outgoingEdges;
        return numberArraysEqual(a.windings, b.windings.map((w) => -w));
    };
    const orientedSegment = (edge) => edge.directionFlag ? reversePathSegment(edge.seg) : edge.seg;
    const nextEdge = (edge) => {
        const [a, b] = edge.incidentVertices[1].outgoingEdges;
        return a.twin === edge ? b : a;
    };
    for (const vertex of vertices) {
        if (isChainVertex(vertex))
            continue;
        const startVertex = toMinorVertex(vertex);
        for (const startEdge of vertex.outgoingEdges) {
            const segments = [];
            let edge = startEdge;
            for (;;) {
                segments.push(orientedSegment(edge));
                const end = edge.incidentVertices[1];
                if (!isChainVertex(end))
                    break;
                visited.add(end);
                edge = nextEdge(edge);
            }
            const endVertex = toMinorVertex(edge.incidentVertices[1]);
            const twin = getEdgeById(getEdgeId(edge.twin), getEdgeId(startEdge.twin)) ??
                null;
            const newEdge = {
                segments,
                parents: startEdge.parents,
                incidentVertices: [startVertex, endVertex],
                directionFlag: false,
                windings: startEdge.windings,
                twin,
                id: nextEdgeId++,
            };
            if (twin)
                twin.twin = newEdge;
            setEdgeById(getEdgeId(startEdge), getEdgeId(edge), newEdge);
            startVertex.outgoingEdges.push(newEdge);
            newEdges.push(newEdge);
        }
    }
    const cycles = [];
    for (const vertex of vertices) {
        if (!isChainVertex(vertex) || visited.has(vertex))
            continue;
        let edge = vertex.outgoingEdges[0];
        const cycle = {
            segments: [],
            parents: edge.parents,
            directionFlag: false,
            windings: edge.windings,
        };
        do {
            cycle.segments.push(orientedSegment(edge));
            visited.add(edge.incidentVertices[0]);
            edge = nextEdge(edge);
        } while (edge.incidentVertices[0] !== vertex);
        cycles.push(cycle);
    }
    return {
        edges: newEdges,
        vertices: newVertices,
        cycles,
    };
}
function removeDanglingEdges(graph, pathCount) {
    function walk(parentIndex) {
        const keptVertices = new WeakSet();
        const vertexToLevel = new WeakMap();
        function visit(vertex, incomingEdge, level) {
            if (vertexToLevel.has(vertex)) {
                return vertexToLevel.get(vertex);
            }
            vertexToLevel.set(vertex, level);
            let minLevel = Infinity;
            for (const edge of vertex.outgoingEdges) {
                if (edge.parents[parentIndex] && edge !== incomingEdge) {
                    minLevel = Math.min(minLevel, visit(edge.incidentVertices[1], edge.twin, level + 1));
                }
            }
            if (minLevel <= level) {
                keptVertices.add(vertex);
            }
            return minLevel;
        }
        for (const edge of graph.edges) {
            if (edge.parents[parentIndex]) {
                visit(edge.incidentVertices[0], null, 0);
            }
        }
        return keptVertices;
    }
    const keptVerticesPerPath = [];
    for (let i = 0; i < pathCount; i++) {
        keptVerticesPerPath.push(walk(i));
    }
    function keepVertex(vertex) {
        return keptVerticesPerPath.some((kept) => kept.has(vertex));
    }
    function keepEdge(edge) {
        for (let i = 0; i < pathCount; i++) {
            if (edge.parents[i] &&
                keptVerticesPerPath[i].has(edge.incidentVertices[0]) &&
                keptVerticesPerPath[i].has(edge.incidentVertices[1])) {
                return true;
            }
        }
        return false;
    }
    graph.vertices = graph.vertices.filter(keepVertex);
    for (const vertex of graph.vertices) {
        vertex.outgoingEdges = vertex.outgoingEdges.filter(keepEdge);
    }
    graph.edges = graph.edges.filter(keepEdge);
}
/*
 Parametric speed |P'| where an edge meets its vertex. Used to convert a
 distance along the curve into a step in parameter space, so that edges whose
 segments are parametrized at different rates can be stepped by the same arc
 length.
*/
const getIncidenceSpeed = (() => {
    const tangent = createVector();
    return function getIncidenceSpeed({ directionFlag, segments, }) {
        pathSegmentTangentAtInto(segments[0], directionFlag ? 1 : 0, tangent);
        return Math.hypot(tangent[0], tangent[1]);
    };
})();
const getIncidenceAngle = (() => {
    const p0 = createVector();
    const pNext = createVector();
    const tangent = createVector();
    /*
     `offsetDistance` breaks ties between edges that leave the vertex at the
     same angle, by measuring the tangent a little way along the curve instead
     of exactly at the vertex.

     It is a distance, not a parameter step, and every edge at a vertex is
     given the same one. Stepping by a fixed *parameter* cannot separate two
     curves that are parametrized over the same angular span: two circles
     meeting at an internal tangency are both drawn as quarter arcs, so a step
     of EPS.param turns both tangents by exactly pi/2 * EPS.param no matter how
     large the circles are, and the tie survives. Stepping by a fixed arc
     length instead turns each by that length over its own radius, which is
     precisely the curvature difference that distinguishes them.
    */
    return function getIncidenceAngle(edge, offsetDistance = 0) {
        const { directionFlag, segments } = edge;
        const seg = segments[0]; // TODO: explain in comment why this is always the incident one in both fwd and bwd
        const tEnd = directionFlag ? 1 : 0;
        let t0 = tEnd;
        if (offsetDistance > 0) {
            const speed = getIncidenceSpeed(edge);
            // Cap the step so a slow parametrization cannot walk out of the
            // segment and pick up an angle from somewhere else entirely.
            const dt = speed > 0 ? Math.min(1, offsetDistance / speed) : EPS.param;
            t0 = directionFlag ? 1 - dt : dt;
        }
        // First attempt: analytical tangent
        pathSegmentTangentAtInto(seg, t0, tangent);
        if (directionFlag) {
            tangent[0] = -tangent[0];
            tangent[1] = -tangent[1];
        }
        if (tangent[0] !== 0 || tangent[1] !== 0) {
            return Math.atan2(tangent[1], tangent[0]);
        }
        // At a stationary Bezier endpoint, the first distinct control point
        // gives the first nonzero derivative's direction. A chord fallback
        // loses this direction entirely for a closed cubic.
        if (t0 === tEnd && (seg[0] === "C" || seg[0] === "Q")) {
            const points = seg.slice(1);
            if (directionFlag)
                points.reverse();
            for (const point of points.slice(1)) {
                const dx = point[0] - points[0][0], dy = point[1] - points[0][1];
                if (dx !== 0 || dy !== 0)
                    return Math.atan2(dy, dx);
            }
        }
        samplePathSegmentAtInto(seg, t0, p0);
        let dt = EPS.param;
        for (;;) {
            const tNext = directionFlag
                ? Math.max(0, t0 - dt)
                : Math.min(1, t0 + dt);
            samplePathSegmentAtInto(seg, tNext, pNext);
            const dx = pNext[0] - p0[0], dy = pNext[1] - p0[1];
            if (dx !== 0 || dy !== 0)
                return Math.atan2(dy, dx);
            if (tNext === (directionFlag ? 0 : 1))
                return 0;
            dt *= 2;
        }
    };
})();
// Equal leading Bezier control points imply equal leading power coefficients.
// The first differing control point then determines which curve departs to
// the left. This also resolves third-order contacts that tangent sampling
// rounds to a tie. A purely tangential difference needs reparametrization;
// leave that case to the general tangent/curvature comparison below.
function compareBezierDeparture(a, b) {
    const sa = a.segments[0], sb = b.segments[0];
    if (sa[0] === "A" || sa[0] !== sb[0])
        return 0;
    const pa = sa.slice(1), pb = sb.slice(1);
    if (a.directionFlag)
        pa.reverse();
    if (b.directionFlag)
        pb.reverse();
    if (pa[0][0] !== pb[0][0] || pa[0][1] !== pb[0][1])
        return 0;
    let tangent;
    for (let i = 1; i < pa.length; i++) {
        if (pa[i][0] !== pb[i][0] || pa[i][1] !== pb[i][1]) {
            if (!tangent)
                return 0;
            return (tangent[0] * (pa[i][1] - pb[i][1]) -
                tangent[1] * (pa[i][0] - pb[i][0]));
        }
        const dx = pa[i][0] - pa[0][0], dy = pa[i][1] - pa[0][1];
        if (!tangent && (dx !== 0 || dy !== 0))
            tangent = [dx, dy];
    }
    return 0;
}
function bezierCurvature(edge) {
    const seg = edge.segments[0];
    if (seg[0] !== "C" && seg[0] !== "Q")
        return undefined;
    const p = seg.slice(1);
    if (edge.directionFlag)
        p.reverse();
    const n = p.length - 1;
    const d = p
        .slice(1)
        .map((q, i) => [q[0] - p[i][0], q[1] - p[i][1]]);
    const v = d[0].map((x) => n * x);
    const a = [
        n * (n - 1) * (d[1][0] - d[0][0]),
        n * (n - 1) * (d[1][1] - d[0][1]),
    ];
    const j = n === 3
        ? [
            6 * (d[2][0] - 2 * d[1][0] + d[0][0]),
            6 * (d[2][1] - 2 * d[1][1] + d[0][1]),
        ]
        : [0, 0];
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    const speed = Math.hypot(...v), speed2 = speed * speed;
    if (speed === 0)
        return undefined;
    const va = cross(v, a), dot = v[0] * a[0] + v[1] * a[1];
    const curvature = va / (speed2 * speed);
    const derivative = (cross(v, j) * speed2 - 3 * va * dot) / (speed2 * speed2 * speed2);
    // Propagate coordinate roundoff through the endpoint derivatives. This
    // separates equal curvature with unequal curvature derivative without
    // letting the last bits of a subdivided control point decide the order.
    const error = 64 * Number.EPSILON * Math.max(...p.flat().map(Math.abs));
    const acceleration = Math.hypot(...a), jerk = Math.hypot(...j);
    const curvatureError = (error * (1 + acceleration / speed)) / speed2;
    const derivativeError = (error *
        (1 +
            (acceleration + jerk) / speed +
            (acceleration * acceleration) / speed2)) /
        (speed2 * speed);
    return { curvature, derivative, curvatureError, derivativeError };
}
function sortOutgoingEdgesByAngle({ vertices }) {
    // TODO: this will hardly be a bottleneck, but profile whether memoization
    //  actually helps and maybe use a simpler function that's monotonic
    //  in angle.
    for (const vertex of vertices) {
        if (getOrder(vertex) > 2) {
            const angleCache = new WeakMap();
            /*
             The tie-break step has to be one distance shared by every edge at
             this vertex, otherwise each edge would be sampled somewhere
             different along its own curve and the comparison would be
             meaningless. Deriving it from the slowest parametrization keeps
             the step at EPS.param for that edge — the size the tie-break has
             always used — and shrinks it proportionally for the rest.
            */
            let minSpeed = Infinity;
            for (const edge of vertex.outgoingEdges) {
                const speed = getIncidenceSpeed(edge);
                if (speed > 0)
                    minSpeed = Math.min(minSpeed, speed);
            }
            const tieBreakDistance = Number.isFinite(minSpeed)
                ? EPS.param * minSpeed
                : EPS.param;
            /*
             Two keys per edge: the direction it leaves in, and how far it has
             turned by the time it has gone `tieBreakDistance` along itself.
             The turn is the curvature, and it is what orders edges that leave
             in the same direction.

             The turn is compared on its own rather than as part of the
             offset angle, because the two share whatever error the direction
             carries and subtracting cancels it. Where a tangency cannot be
             located exactly — the contact between a circle and the cubic that
             approximates it can only be pinned to about 1e-7 along the curve —
             the directions of the two curves at the vertex differ by around
             6e-10 while their curvatures differ by only 5e-11. Comparing
             offset angles lets that 6e-10 decide, and it has no geometric
             meaning: it orders the pair backwards, and the faces traced from
             it come out wrong.
            */
            const turnCache = new WeakMap();
            const curvatureCache = new WeakMap();
            for (const edge of vertex.outgoingEdges) {
                curvatureCache.set(edge, bezierCurvature(edge));
                const primary = getIncidenceAngle(edge);
                angleCache.set(edge, primary);
                turnCache.set(edge, normalizeAngle(getIncidenceAngle(edge, tieBreakDistance) - primary));
            }
            // Put the angular branch cut in the largest empty sector. atan2
            // spells the same leftward tangent as both -pi and +pi; leaving
            // that seam through a tangent group reverses the cyclic order.
            const angles = vertex.outgoingEdges
                .map((edge) => angleCache.get(edge))
                .sort((a, b) => a - b);
            let largestGap = -1, cut = 0;
            for (let i = 0; i < angles.length; i++) {
                const next = i + 1 < angles.length
                    ? angles[i + 1]
                    : angles[0] + TAU_ANGLE;
                if (next - angles[i] > largestGap) {
                    largestGap = next - angles[i];
                    cut = (angles[i] + next) / 2;
                }
            }
            for (const edge of vertex.outgoingEdges) {
                angleCache.set(edge, (((angleCache.get(edge) - cut) % TAU_ANGLE) + TAU_ANGLE) %
                    TAU_ANGLE);
            }
            vertex.outgoingEdges.sort((a, b) => {
                const turnA = turnCache.get(a);
                const turnB = turnCache.get(b);
                /*
                 Directions count as the same when they differ by less than
                 either edge turns over that step: below that the measurement
                 cannot tell a genuine corner from the error in placing the
                 vertex, and curvature is the better discriminator. Straight
                 edges turn by nothing, so ANGLE_MIN_DIFF floors it and they
                 are ordered by direction as before.
                */
                const tolerance = Math.max(ANGLE_MIN_DIFF, Math.abs(turnA), Math.abs(turnB));
                const diff = angleCache.get(a) - angleCache.get(b);
                if (Math.abs(diff) > tolerance)
                    return diff;
                const exact = compareBezierDeparture(a, b);
                if (exact)
                    return exact;
                const ca = curvatureCache.get(a), cb = curvatureCache.get(b);
                if (ca && cb) {
                    const curvature = ca.curvature - cb.curvature;
                    if (Math.abs(curvature) >
                        ca.curvatureError + cb.curvatureError)
                        return curvature;
                    const derivative = ca.derivative - cb.derivative;
                    if (Math.abs(derivative) >
                        ca.derivativeError + cb.derivativeError)
                        return derivative;
                }
                return turnA - turnB;
            });
        }
        for (let i = 0; i < vertex.outgoingEdges.length; i++) {
            vertex.outgoingEdges[i].indexInVertex = i;
        }
    }
}
function normalizeAngle(angle) {
    const wrapped = (((angle + Math.PI) % TAU_ANGLE) + TAU_ANGLE) % TAU_ANGLE;
    return wrapped - Math.PI;
}
function getNextEdge(edge) {
    const { outgoingEdges } = edge.incidentVertices[1];
    const index = edge.twin?.indexInVertex;
    return outgoingEdges[(index + 1) % outgoingEdges.length];
}
const faceToPolygon = memoizeWeak((face) => face.incidentEdges.flatMap((edge) => {
    const points = [];
    const p = createVector();
    for (const seg of edge.segments) {
        const CNT = seg[0] === "L" ? 1 : 64;
        for (let i = 0; i < CNT; i++) {
            const t0 = i / CNT;
            const t = edge.directionFlag ? 1 - t0 : t0;
            samplePathSegmentAtInto(seg, t, p);
            points.push([p[0], p[1]]);
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
// Face orientation must describe the curves, not the polygon used to find an
// interior point. Integrate about a local origin to avoid cancellation from a
// large coordinate offset, and compensate the sum across segment boundaries.
const faceSignedArea = memoizeWeak((face) => {
    const origin = getStartPoint(face.incidentEdges[0].segments[0]);
    let total = 0, correction = 0;
    for (const edge of face.incidentEdges)
        for (const seg of edge.segments) {
            const term = segmentArea(seg, origin) * (edge.directionFlag ? -1 : 1);
            const adjusted = term - correction, next = total + adjusted;
            correction = next - total - adjusted;
            total = next;
        }
    return total;
});
const computeWinding = memoizeWeak((face) => {
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
});
function computeDual({ edges, cycles }) {
    const newVertices = [];
    const minorToDualEdge = new WeakMap();
    for (const startEdge of edges) {
        if (minorToDualEdge.has(startEdge))
            continue;
        const face = {
            incidentEdges: [],
            flags: [],
        };
        let edge = startEdge;
        do {
            const twin = minorToDualEdge.get(edge.twin) ?? null;
            const newEdge = {
                segments: edge.segments,
                parents: edge.parents,
                incidentVertex: face,
                directionFlag: edge.directionFlag,
                windings: edge.windings,
                twin,
            };
            if (twin) {
                twin.twin = newEdge;
            }
            minorToDualEdge.set(edge, newEdge);
            face.incidentEdges.push(newEdge);
            edge = getNextEdge(edge);
        } while (edge !== startEdge);
        newVertices.push(face);
    }
    for (const cycle of cycles) {
        const innerFace = {
            incidentEdges: [],
            flags: [],
        };
        const innerHalfEdge = {
            segments: cycle.segments,
            parents: cycle.parents,
            incidentVertex: innerFace,
            directionFlag: cycle.directionFlag,
            windings: cycle.windings,
            twin: null,
        };
        const outerFace = {
            incidentEdges: [],
            flags: [],
        };
        const outerHalfEdge = {
            segments: [...cycle.segments].reverse(),
            parents: cycle.parents,
            incidentVertex: outerFace,
            directionFlag: !cycle.directionFlag,
            windings: cycle.windings.map((w) => -w),
            twin: innerHalfEdge,
        };
        innerHalfEdge.twin = outerHalfEdge;
        innerFace.incidentEdges.push(innerHalfEdge);
        outerFace.incidentEdges.push(outerHalfEdge);
        newVertices.push(innerFace, outerFace);
    }
    // Inner faces come out negative under this tracing, the outer one positive.
    const isOuterFace = (face) => faceSignedArea(face) > 0;
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
        if (DEV_ASSERTS) {
            // A connected planar arrangement has V - E + F = 2, including
            // its outer face. A wrong rotation at a tangency can keep one
            // positive-area face while joining unrelated regions together.
            const primalVertices = new Set();
            for (const edge of componentEdges) {
                const first = edge.segments[0];
                primalVertices.add(edge.directionFlag
                    ? getEndPoint(first)
                    : getStartPoint(first));
            }
        }
        const outerFace = componentVertices.find(isOuterFace);
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
function pathSegmentHorizontalRayIntersectionCount(origSeg, point, eps, totalBoundingBox = pathSegmentBoundingBox(origSeg)) {
    if (!boundingBoxIntersectsHorizontalRay(totalBoundingBox, point))
        return 0;
    const param = parameterTolerance(origSeg, eps);
    const segments = [
        { boundingBox: totalBoundingBox, seg: origSeg, lo: 0, hi: 1 },
    ];
    let count = 0;
    while (segments.length) {
        const { boundingBox, seg, lo, hi } = segments.pop();
        if (isNearlyLinearSegment(seg) ||
            boundingBoxMaxExtent(boundingBox) < eps.linear ||
            hi - lo <= param) {
            if (lineSegmentIntersectsHorizontalRay(getStartPoint(seg), getEndPoint(seg), point))
                count++;
            continue;
        }
        const mid = (lo + hi) / 2;
        if (!(lo < mid && mid < hi))
            throw new Error("Ray subdivision cannot advance its parameter interval");
        const split = splitSegmentAt(seg, 0.5);
        for (let i = 0; i < 2; i++) {
            const box = pathSegmentBoundingBox(split[i]);
            if (boundingBoxIntersectsHorizontalRay(box, point)) {
                segments.push({
                    boundingBox: box,
                    seg: split[i],
                    lo: i ? mid : lo,
                    hi: i ? hi : mid,
                });
            }
        }
    }
    return count;
}
const getComponentInteriorPoint = memoizeWeak((component) => {
    for (const face of component.vertices) {
        if (face === component.outerFace)
            continue;
        return computeWinding(face).point;
    }
});
const getFaceIntersectionSegments = memoizeWeak((face) => face.incidentEdges.flatMap((edge) => edge.segments.map((seg) => ({
    seg,
    boundingBox: pathSegmentBoundingBox(seg),
}))));
const getFaceBoundingBox = memoizeWeak((face) => {
    let boundingBox = null;
    for (const { boundingBox: segBoundingBox } of getFaceIntersectionSegments(face)) {
        boundingBox = mergeBoundingBoxes(boundingBox, segBoundingBox);
    }
    return boundingBox;
});
const getComponentBoundingBox = memoizeWeak((component) => {
    let boundingBox = null;
    for (const face of component.vertices) {
        if (face === component.outerFace)
            continue;
        boundingBox = mergeBoundingBoxes(boundingBox, getFaceBoundingBox(face));
    }
    return boundingBox;
});
function boundingBoxContainsPoint(boundingBox, point, eps) {
    return (point[0] >= boundingBox.left - eps.point &&
        point[0] <= boundingBox.right + eps.point &&
        point[1] >= boundingBox.top - eps.point &&
        point[1] <= boundingBox.bottom + eps.point);
}
function boundingBoxArea({ top, right, bottom, left }) {
    return (right - left) * (bottom - top);
}
function findContainingFace(component, testedPoint, eps) {
    // TODO: Intersection counting will fail if a curve touches the horizontal line but doesn't go through.
    for (const face of component.vertices) {
        if (face === component.outerFace)
            continue;
        if (!boundingBoxContainsPoint(getFaceBoundingBox(face), testedPoint, eps)) {
            continue;
        }
        let count = 0;
        for (const { seg, boundingBox } of getFaceIntersectionSegments(face)) {
            if (!boundingBoxIntersectsHorizontalRay(boundingBox, testedPoint)) {
                continue;
            }
            count += pathSegmentHorizontalRayIntersectionCount(seg, testedPoint, eps, boundingBox);
        }
        if (count % 2 === 1)
            return face;
    }
    return null;
}
function computeNestingTree(components, eps) {
    if (components.length === 0) {
        return [];
    }
    let totalBoundingBox = null;
    const info = components.map((component, index) => {
        const interiorPoint = getComponentInteriorPoint(component);
        const boundingBox = getComponentBoundingBox(component);
        totalBoundingBox = mergeBoundingBoxes(totalBoundingBox, boundingBox);
        return {
            index,
            component,
            interiorPoint,
            boundingBox,
            area: boundingBoxArea(boundingBox),
        };
    });
    const treeByComponent = new WeakMap();
    for (const component of components) {
        treeByComponent.set(component, { component, outgoingEdges: new Map() });
    }
    const componentTree = new QuadTree(totalBoundingBox, POINT_TREE_DEPTH);
    for (const entry of info) {
        componentTree.insert(entry.boundingBox, entry.index);
    }
    const roots = [];
    for (const entry of info) {
        const point = entry.interiorPoint;
        const queryBox = boundingBoxAroundPoint(point, eps.point);
        const candidateIds = componentTree.find(queryBox);
        let bestParent = null;
        let bestFace = null;
        for (const candidateId of candidateIds) {
            if (candidateId === entry.index)
                continue;
            const candidate = info[candidateId];
            if (!boundingBoxContainsPoint(candidate.boundingBox, point, eps)) {
                continue;
            }
            // One interior sample can lie inside a smaller component (for
            // example inside a hole). A parent must enclose the child's whole
            // bounds, not merely that sample, or nesting can become cyclic.
            const a = candidate.boundingBox, b = entry.boundingBox;
            if (a.left > b.left + eps.point ||
                a.right < b.right - eps.point ||
                a.top > b.top + eps.point ||
                a.bottom < b.bottom - eps.point)
                continue;
            const face = findContainingFace(candidate.component, point, eps);
            if (!face)
                continue;
            if (!bestParent || candidate.area < bestParent.area) {
                bestParent = candidate;
                bestFace = face;
            }
        }
        const tree = treeByComponent.get(entry.component);
        if (!bestParent || !bestFace) {
            roots.push(tree);
            continue;
        }
        const parentTree = treeByComponent.get(bestParent.component);
        if (parentTree.outgoingEdges.has(bestFace)) {
            parentTree.outgoingEdges.get(bestFace).push(tree);
        }
        else {
            parentTree.outgoingEdges.set(bestFace, [tree]);
        }
    }
    return roots;
}
function getFlag(count, fillRule) {
    switch (fillRule) {
        case FillRule.NonZero:
            return count !== 0;
        case FillRule.EvenOdd:
            return count % 2 !== 0;
    }
}
function flagFaces(nestingTrees, fillRules) {
    const pathCount = fillRules.length;
    function visitTree(tree, runningCounts) {
        const visitedFaces = new WeakSet();
        function visitFace(face, runningCounts) {
            if (visitedFaces.has(face))
                return;
            visitedFaces.add(face);
            face.flags = runningCounts.map((count, i) => getFlag(count, fillRules[i]));
            for (const edge of face.incidentEdges) {
                const twin = edge.twin;
                const nextCounts = runningCounts.slice();
                for (let i = 0; i < pathCount; i++) {
                    nextCounts[i] += edge.windings[i];
                }
                visitFace(twin.incidentVertex, nextCounts);
            }
            if (tree.outgoingEdges.has(face)) {
                const subtrees = tree.outgoingEdges.get(face);
                for (const subtree of subtrees) {
                    visitTree(subtree, runningCounts);
                }
            }
        }
        visitFace(tree.component.outerFace, runningCounts);
    }
    for (const tree of nestingTrees) {
        visitTree(tree, new Array(pathCount).fill(0));
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
/*
 Enumerates the selected inner faces (the atomic regions of the arrangement) in a
 stable order, returning each face's dual-graph vertex alongside its rendered
 `Path` (with holes poked from nested child components). `dumpFaces` and the
 Shape Builder API (`getFaces`/`buildShape`) share this enumeration so a region's
 index reliably maps back to its face vertex.
*/
function enumerateFaces(nestingTrees, predicate) {
    const faces = [];
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
            faces.push(face);
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
    return { faces, paths };
}
function dumpFaces(nestingTrees, predicate) {
    return enumerateFaces(nestingTrees, predicate).paths;
}
/*
 Adds the outer face of each nested child component whose parent face is already
 selected. `walkFaces` then traces those outer faces as holes, mirroring the
 hole-poking `enumerateFaces`/`dumpFaces` perform per face — except here the
 selected regions are unioned, so a child whose own region is also selected has
 its boundary removed as an internal edge instead of becoming a hole.
*/
function addNestedOuterFaces(nestingTrees, selected) {
    function visit(tree) {
        for (const [parentFace, subtrees] of tree.outgoingEdges) {
            if (selected.has(parentFace)) {
                for (const subtree of subtrees) {
                    const { outerFace } = subtree.component;
                    selected.add(outerFace);
                }
            }
            for (const subtree of subtrees) {
                visit(subtree);
            }
        }
    }
    for (const tree of nestingTrees) {
        visit(tree);
    }
}
/*
 Operation predicates over the per-path inside/outside flags. The binary
 operations generalize to N paths by a left-fold ("first vs the rest"):
 Difference is the first path minus the union of the others, Exclusion is the
 XOR (odd number of paths), and Division dumps the faces of the first path.
*/
const operationPredicates = {
    [PathBooleanOperation.Union]: (flags) => flags.some(Boolean),
    [PathBooleanOperation.Difference]: (flags) => flags[0] && !flags.slice(1).some(Boolean),
    [PathBooleanOperation.Intersection]: (flags) => flags.every(Boolean),
    [PathBooleanOperation.Exclusion]: (flags) => flags.reduce((count, f) => count + (f ? 1 : 0), 0) % 2 === 1,
    [PathBooleanOperation.Division]: (flags) => flags[0],
    [PathBooleanOperation.Fracture]: (flags) => flags.some(Boolean),
};
function translateSegment(seg, dx, dy) {
    return seg.map((value) => Array.isArray(value) ? [value[0] + dx, value[1] + dy] : value);
}
/*
 Runs the boolean-operation pipeline up to and including face flagging for a set
 of N input paths in the constructor, then selects faces per operation in `get`.
 The expensive geometric work happens once; multiple `get` calls reuse it.
*/
class PathBoolean {
    restore(path) {
        return path.map((seg) => translateSegment(seg, this.origin[0], this.origin[1]));
    }
    constructor(inputs) {
        this.origin = [0, 0];
        const pathCount = inputs.length;
        const unsplitEdges = inputs.flatMap(({ path }, i) => path.map(segmentToEdge(pathCount, i)));
        /*
         Length-valued tolerances scale with how big the geometry is; see
         epsilonsForExtent. Measured before anything is split, so that every
         stage of a run shares one set of values.
        */
        let inputBoundingBox = null;
        for (const { seg } of unsplitEdges) {
            inputBoundingBox = mergeBoundingBoxes(inputBoundingBox, pathSegmentBoundingBox(seg));
        }
        // Keep arithmetic near the drawing. Choose the point of the bounding
        // box nearest the origin: an axis already spanning zero stays put.
        // This avoids subtracting large almost-equal area and curve terms for
        // tiny drawings located far away, without moving near-zero detail far.
        if (inputBoundingBox) {
            const nearest = (lo, hi) => lo > 0 ? lo : hi < 0 ? hi : 0;
            this.origin = [
                nearest(inputBoundingBox.left, inputBoundingBox.right),
                nearest(inputBoundingBox.top, inputBoundingBox.bottom),
            ];
            for (const edge of unsplitEdges)
                edge.seg = translateSegment(edge.seg, -this.origin[0], -this.origin[1]);
        }
        const eps = epsilonsForExtent(inputBoundingBox ? boundingBoxMaxExtent(inputBoundingBox) : 0);
        /*
         Rewrite curves that draw a straight line as lines, before anything is
         measured against anything else, so that from here on a line and a
         curve drawing the same line are one segment rather than two spellings
         that never compare equal. It runs after the epsilons because it needs
         `eps.point`, and safely so: replacing a segment by its chord only ever
         shrinks the geometry, so the bounding box measured above still bounds
         it.
        */
        for (const edge of unsplitEdges) {
            edge.seg = lineariseDegenerateSegment(edge.seg, eps.point);
        }
        const inputPoints = unsplitEdges.flatMap(({ seg }) => [
            getEndPoint(seg),
        ]);
        splitAtSelfIntersections(unsplitEdges, eps);
        const { edges: splitEdges, totalBoundingBox } = splitAtIntersections(unsplitEdges, eps);
        if (!totalBoundingBox) {
            // input geometry is empty
            this.nestingTrees = [];
            return;
        }
        const majorGraph = findVertices(splitEdges, totalBoundingBox, eps, inputPoints);
        // console.log(majorGraphToDot(majorGraph));
        const minorGraph = computeMinor(majorGraph);
        // console.log(minorGraphToDot(minorGraph.edges));
        // console.dir(minorGraph.cycles, { depth: 4 });
        removeDanglingEdges(minorGraph, pathCount);
        // console.log(minorGraphToDot(minorGraph.edges));
        sortOutgoingEdgesByAngle(minorGraph);
        const dualGraphComponents = computeDual(minorGraph);
        // console.log(dualGraphToDot(dualGraphComponents));
        const nestingTrees = computeNestingTree(dualGraphComponents, eps);
        // console.log(nestingTrees.length, nestingTreesToDot(nestingTrees));
        flagFaces(nestingTrees, inputs.map(({ fillRule }) => fillRule));
        this.nestingTrees = nestingTrees;
    }
    get(op) {
        const predicate = (face) => operationPredicates[op](face.flags);
        switch (op) {
            case PathBooleanOperation.Division:
            case PathBooleanOperation.Fracture:
                return dumpFaces(this.nestingTrees, predicate).map((path) => this.restore(path));
            default: {
                const selectedFaces = new Set(getSelectedFaces(this.nestingTrees, predicate));
                return [this.restore([...walkFaces(selectedFaces)])];
            }
        }
    }
    /*
     The atomic regions of the arrangement — one `Path` per face covered by at
     least one input path (each path under its own fill rule), in the same order
     as the `Fracture` operation. The index of a region in this array is the
     handle passed to `buildShape`. Drives the Shape Builder use case: render
     these as selectable regions, then merge a chosen subset with `buildShape`.
    */
    getFaces() {
        return this.getRegions().paths;
    }
    /*
     Merges the regions at the given `getFaces` indices into a single shape,
     tracing the outline of their union (with holes where appropriate). Indices
     out of range are ignored. This is the Shape Builder "combine selection"
     operation.
    */
    buildShape(indices) {
        const { faces } = this.getRegions();
        const selected = new Set();
        for (const i of indices) {
            const face = faces[i];
            if (face)
                selected.add(face);
        }
        addNestedOuterFaces(this.nestingTrees, selected);
        return this.restore([...walkFaces(selected)]);
    }
    getRegions() {
        if (!this.regions) {
            const regions = enumerateFaces(this.nestingTrees, (face) => face.flags.some(Boolean));
            this.regions = {
                faces: regions.faces,
                paths: regions.paths.map((path) => this.restore(path)),
            };
        }
        return this.regions;
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
    let previousCommand = "";
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
                yield [
                    "C",
                    lastPoint,
                    previousCommand === "C" || previousCommand === "S"
                        ? reflectControlPoint(lastPoint, lastControlPoint)
                        : lastPoint,
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
                lastControlPoint =
                    previousCommand === "Q" || previousCommand === "T"
                        ? reflectControlPoint(lastPoint, lastControlPoint)
                        : lastPoint;
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
        previousCommand = cmd[0];
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

export { FillRule, PathBoolean, PathBooleanOperation, pathFromCommands, pathToCommands };
//# sourceMappingURL=path-bool.core.js.map
