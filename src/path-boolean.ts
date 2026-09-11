/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { QuadTree } from "./QuadTree";
import {
    assertCondition,
    assertDefined,
    assertEqual,
    assertUnreachable,
} from "./assert";
import {
    ANGLE_MIN_DIFF,
    DEV_ASSERTS,
    EPS,
    Epsilons,
    epsilonsForExtent,
} from "./config";
import { pathCubicSegmentSelfIntersection } from "./intersections/path-cubic-segment-self-intersection";
import {
    pathSegmentIntersection,
    segmentsEqual,
} from "./intersections/path-segment";
import {
    AABB,
    boundingBoxAroundPoint,
    boundingBoxMaxExtent,
    expandBoundingBox,
    mergeBoundingBoxes,
} from "./primitives/AABB";
import { Path } from "./primitives/Path";
import {
    getEndPoint,
    getStartPoint,
    PathSegment,
    isNearlyLinearSegment,
    lineariseDegenerateSegment,
    pathSegmentBoundingBox,
    pathSegmentTangentAtInto,
    reversePathSegment,
    samplePathSegmentAtInto,
    splitCubicSegmentAt,
    splitSegmentAt,
} from "./primitives/PathSegment";
import { createVector, Vector, vectorsEqual } from "./primitives/Vector";
import { segmentArea } from "./primitives/segment-area";
import { countIf, hasOwn, memoizeWeak } from "./util/generic";
import { map } from "./util/iterators";
import { linMap } from "./util/math";

const TAU_ANGLE = 2 * Math.PI;

const INTERSECTION_TREE_DEPTH = 8;
const POINT_TREE_DEPTH = 8;

export enum PathBooleanOperation {
    Union,
    Difference,
    Intersection,
    Exclusion,
    Division,
    Fracture,
}

export enum FillRule {
    NonZero,
    EvenOdd,
}

type MajorGraphEdgeStage1 = {
    seg: PathSegment;
    parents: boolean[];
};

type MajorGraphEdgeStage2 = MajorGraphEdgeStage1 & {
    boundingBox: AABB;
};

type MajorGraphEdge = MajorGraphEdgeStage2 & {
    incidentVertices: [MajorGraphVertex, MajorGraphVertex];
    directionFlag: boolean;
    windings: number[];
    twin: MajorGraphEdge | null;
};

type MajorGraphVertex = {
    point: Vector;
    outgoingEdges: MajorGraphEdge[];
};

type MajorGraph = {
    edges: MajorGraphEdge[];
    vertices: MajorGraphVertex[];
};

type MinorGraphEdge = {
    segments: PathSegment[];
    parents: boolean[];
    incidentVertices: [MinorGraphVertex, MinorGraphVertex];
    directionFlag: boolean;
    windings: number[];
    twin: MinorGraphEdge | null;
    id: number;
    indexInVertex?: number;
};

type MinorGraphVertex = {
    outgoingEdges: MinorGraphEdge[];
};

type MinorGraphCycle = {
    segments: PathSegment[];
    parents: boolean[];
    directionFlag: boolean;
    windings: number[];
};

type MinorGraph = {
    edges: MinorGraphEdge[];
    vertices: MinorGraphVertex[];
    cycles: MinorGraphCycle[];
};

type DualGraphHalfEdge = {
    segments: PathSegment[];
    parents: boolean[];
    incidentVertex: DualGraphVertex;
    directionFlag: boolean;
    windings: number[];
    twin: DualGraphHalfEdge | null;
};

type DualGraphVertex = {
    incidentEdges: DualGraphHalfEdge[];
    flags: boolean[];
};

type DualGraphComponent = {
    edges: DualGraphHalfEdge[];
    vertices: DualGraphVertex[];
    outerFace: DualGraphVertex | null;
};

type NestingTree = {
    component: DualGraphComponent;
    outgoingEdges: Map<DualGraphVertex, NestingTree[]>;
};

function assertMajorGraphInvariants(graph: MajorGraph) {
    if (!DEV_ASSERTS) return;
    for (const vertex of graph.vertices) {
        assertCondition(
            vertex.outgoingEdges.length > 0,
            "Vertex has no outgoing edges.",
        );
    }
    for (const edge of graph.edges) {
        assertDefined(edge.twin, "Edge doesn't have a twin.");
        assertCondition(
            edge.twin.twin === edge,
            "Edge twin relationship is broken.",
        );
        const [v0, v1] = edge.incidentVertices;
        assertCondition(
            v0.outgoingEdges.includes(edge),
            "Edge missing from incident vertex outgoing edges.",
        );
        assertCondition(
            v1.outgoingEdges.includes(edge.twin),
            "Twin edge missing from incident vertex outgoing edges.",
        );
    }
}

function assertMinorGraphInvariants(graph: MinorGraph) {
    if (!DEV_ASSERTS) return;
    for (const vertex of graph.vertices) {
        assertCondition(
            vertex.outgoingEdges.length > 0,
            "Minor vertex has no outgoing edges.",
        );
    }
    for (const edge of graph.edges) {
        assertDefined(edge.twin, "Minor edge doesn't have a twin.");
        assertCondition(
            edge.twin.twin === edge,
            "Minor edge twin relationship is broken.",
        );
        const [v0, v1] = edge.incidentVertices;
        assertCondition(
            v0.outgoingEdges.includes(edge),
            "Minor edge missing from incident vertex outgoing edges.",
        );
        assertCondition(
            v1.outgoingEdges.includes(edge.twin),
            "Minor twin edge missing from incident vertex outgoing edges.",
        );
    }
}

function assertDualGraphInvariants(components: DualGraphComponent[]) {
    if (!DEV_ASSERTS) return;
    for (const component of components) {
        for (const vertex of component.vertices) {
            assertCondition(
                vertex.incidentEdges.length > 0,
                "Dual graph vertex has no incident edges.",
            );
        }
        for (const edge of component.edges) {
            assertDefined(edge.twin, "Dual edge doesn't have a twin.");
            assertCondition(
                edge.twin.twin === edge,
                "Dual edge twin relationship is broken.",
            );
            assertCondition(
                edge.incidentVertex.incidentEdges.includes(edge),
                "Dual edge missing from incident vertex edges.",
            );
        }
    }
}

function firstElementOfSet<T>(set: Set<T>): T | undefined {
    return set.values().next().value;
}

function makeParents(count: number, index: number): boolean[] {
    const parents = new Array<boolean>(count).fill(false);
    parents[index] = true;
    return parents;
}

function booleanArraysEqual(a: boolean[], b: boolean[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function numberArraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function orBooleansInto(target: boolean[], source: boolean[]) {
    for (let i = 0; i < source.length; i++) {
        if (source[i]) target[i] = true;
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
function addWinding(
    existingEdge: [MajorGraphEdgeStage2, MajorGraphEdge, MajorGraphEdge],
    parents: boolean[],
    againstForward: boolean,
) {
    const [, forward, backward] = existingEdge;
    const step = againstForward ? -1 : 1;
    for (let i = 0; i < parents.length; i++) {
        if (!parents[i]) continue;
        forward.windings[i] += step;
        backward.windings[i] -= step;
    }
}

function createObjectCounter(): (obj: Object) => number {
    let i = 0;
    return memoizeWeak(() => i++);
}

function segmentToEdge(
    pathCount: number,
    index: number,
): (seg: PathSegment) => MajorGraphEdgeStage1 {
    return (seg) => ({ seg, parents: makeParents(pathCount, index) });
}

function splitAtSelfIntersections(
    edges: MajorGraphEdgeStage1[],
    eps: Epsilons,
) {
    // A non-collinear cubic has at most one isolated self-intersection.
    // Its children cannot introduce another one. Rechecking appended children
    // rediscovered rounded endpoint contacts and grew the edge array forever.
    const originalCount = edges.length;
    for (let i = 0; i < originalCount; i++) {
        const edge = edges[i];
        if (edge.seg[0] !== "C") continue;
        const intersection = pathCubicSegmentSelfIntersection(edge.seg);
        if (!intersection) continue;
        let segment = edge.seg;
        let previous = 0;
        const children: MajorGraphEdgeStage1[] = [];
        for (const t of intersection) {
            if (t <= previous + eps.param || t >= 1 - eps.param) continue;
            const [first, rest] = splitCubicSegmentAt(
                segment,
                (t - previous) / (1 - previous),
            );
            children.push({ seg: first, parents: edge.parents });
            segment = rest;
            previous = t;
        }
        if (!children.length) continue;
        children.push({ seg: segment, parents: edge.parents });
        edges[i] = children[0];
        edges.push(...children.slice(1));
    }
}

function splitAtIntersections(edges: MajorGraphEdgeStage1[], eps: Epsilons) {
    const withBoundingBox: MajorGraphEdgeStage2[] = edges.map((edge) => ({
        ...edge,
        boundingBox: (() => {
            const box = pathSegmentBoundingBox(edge.seg);
            // The narrow-phase solve admits endpoint parameters just outside
            // [0,1]. Candidate selection must cover that same neighbourhood.
            return expandBoundingBox(
                box,
                eps.point + eps.param * boundingBoxMaxExtent(box),
            );
        })(),
    }));

    const totalBoundingBox = withBoundingBox.reduce(
        (acc, { boundingBox }) => mergeBoundingBoxes(acc, boundingBox),
        null as AABB | null,
    );

    if (!totalBoundingBox) {
        return { edges: [], totalBoundingBox: null };
    }

    const edgeTree = new QuadTree<number>(
        totalBoundingBox,
        INTERSECTION_TREE_DEPTH,
    );

    const splitsPerEdge: Record<number, number[]> = {};

    function addSplit(i: number, t: number) {
        if (!hasOwn(splitsPerEdge, i)) splitsPerEdge[i] = [];
        splitsPerEdge[i].push(t);
    }

    for (let i = 0; i < withBoundingBox.length; i++) {
        const edge = withBoundingBox[i];
        const candidates = edgeTree.find(edge.boundingBox);
        for (const j of candidates) {
            const candidate = edges[j];
            const intersection = pathSegmentIntersection(
                edge.seg,
                candidate.seg,
                eps,
            );
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

    const newEdges: MajorGraphEdgeStage2[] = [];

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
        let prevT = 0;
        for (let j = 0; j < splits.length; j++) {
            const t = splits[j];

            if (t > 1 - eps.param) break; // skip splits near end

            const tt = (t - prevT) / (1 - prevT);
            if (tt < eps.param) continue; // skip splits near start
            if (tt > 1 - eps.param) continue; // skip splits near end

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

function findVertices(
    edges: MajorGraphEdgeStage2[],
    boundingBox: AABB,
    eps: Epsilons,
    inputPoints: Vector[],
): MajorGraph {
    // Approximate coincidence must choose one geometric representative in a
    // stable order. Operand visitation order otherwise changes which curve's
    // controls survive a merge and, with them, the incident tangent ordering.
    edges = edges
        .map((edge) => ({ edge, key: JSON.stringify(edge.seg) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map(({ edge }) => edge);
    const vertexTree = new QuadTree<MajorGraphVertex>(
        boundingBox,
        POINT_TREE_DEPTH,
    );

    const newVertices: MajorGraphVertex[] = [];

    function getVertex(point: Vector): MajorGraphVertex {
        const box = boundingBoxAroundPoint(point, eps.point);
        const existingVertices = vertexTree.find(box);
        let closest: MajorGraphVertex | undefined;
        let distance = eps.point;
        for (const vertex of existingVertices) {
            const d = Math.hypot(
                vertex.point[0] - point[0],
                vertex.point[1] - point[1],
            );
            if (d <= distance) {
                closest = vertex;
                distance = d;
            }
        }
        if (closest) return closest;
        const vertex: MajorGraphVertex = { point, outgoingEdges: [] };
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
    const vertexForPoint = new WeakMap<Vector, MajorGraphVertex>();
    const points = edges
        .flatMap(({ seg }) => [getStartPoint(seg), getEndPoint(seg)])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const point of points) vertexForPoint.set(point, getVertex(point));

    const getVertexId = createObjectCounter();
    const vertexPairIdToEdges = new Map<
        number,
        Map<number, [MajorGraphEdgeStage2, MajorGraphEdge, MajorGraphEdge][]>
    >();

    function getVertexPairEdges(
        startId: number,
        endId: number,
    ): [MajorGraphEdgeStage2, MajorGraphEdge, MajorGraphEdge][] | undefined {
        return vertexPairIdToEdges.get(startId)?.get(endId);
    }

    function ensureVertexPairEdges(
        startId: number,
        endId: number,
    ): [MajorGraphEdgeStage2, MajorGraphEdge, MajorGraphEdge][] {
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
                    if (
                        vectorsEqual(edge.seg[1], edge.seg[2], eps.point) &&
                        vectorsEqual(edge.seg[3], edge.seg[4], eps.point)
                    ) {
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

        const startVertex = vertexForPoint.get(startPoint)!;
        const endVertex = vertexForPoint.get(endPoint)!;

        // SVG output joins segments at a single vertex. Prefer the original
        // incoming endpoint, then share that point with every incident edge.
        // This also makes signed area translation invariant for tiny faces.
        const seg = edge.seg.slice() as PathSegment;
        seg[1] = startVertex.point;
        (seg as any[])[seg.length - 1] = endVertex.point;
        edge = { ...edge, seg, boundingBox: pathSegmentBoundingBox(seg) };

        const startId = getVertexId(startVertex);
        const endId = getVertexId(endVertex);
        const existingEdges = getVertexPairEdges(startId, endId);
        if (existingEdges) {
            const existingEdge = existingEdges.find((other) =>
                segmentsEqual(other[0].seg, edge.seg, eps.point),
            );
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
            const existingEdge = existingEdgesInv.find((other) =>
                segmentsEqual(other[0].seg, reversedSeg, eps.point),
            );
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

        const fwdEdge: MajorGraphEdge = {
            ...edge,
            parents: edge.parents.slice(),
            incidentVertices: [startVertex, endVertex],
            directionFlag: false,
            windings: edge.parents.map((p) => (p ? 1 : 0)),
            twin: null,
        };

        const bwdEdge: MajorGraphEdge = {
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

    const contributesToBoundary = (edge: MajorGraphEdge): boolean =>
        edge.windings.some((winding) => winding !== 0);
    const keptEdges = newEdges.filter(contributesToBoundary);
    for (const vertex of newVertices) {
        vertex.outgoingEdges = vertex.outgoingEdges.filter(
            contributesToBoundary,
        );
    }

    return {
        edges: keptEdges,
        vertices: newVertices.filter((vertex) => vertex.outgoingEdges.length),
    };
}

function getOrder(vertex: MajorGraphVertex | MinorGraphVertex) {
    return vertex.outgoingEdges.length;
}

function computeMinor({ vertices }: MajorGraph): MinorGraph {
    const newEdges: MinorGraphEdge[] = [];
    const newVertices: MinorGraphVertex[] = [];
    let nextEdgeId = 0;

    const toMinorVertex = memoizeWeak((_majorVertex: MajorGraphVertex) => {
        const minorVertex: MinorGraphVertex = { outgoingEdges: [] };
        newVertices.push(minorVertex);
        return minorVertex;
    }) as (majorVertex: MajorGraphVertex) => MinorGraphVertex;

    const getEdgeId = createObjectCounter();
    const idToEdge = new Map<number, Map<number, MinorGraphEdge>>();

    function getEdgeById(
        startId: number,
        endId: number,
    ): MinorGraphEdge | undefined {
        return idToEdge.get(startId)?.get(endId);
    }

    function setEdgeById(startId: number, endId: number, edge: MinorGraphEdge) {
        let inner = idToEdge.get(startId);
        if (!inner) {
            inner = new Map();
            idToEdge.set(startId, inner);
        }
        inner.set(endId, edge);
    }
    const visited = new WeakSet<MajorGraphVertex>();

    // A degree-two vertex can disappear only when traversal across it keeps
    // the same signed winding for every input. Segment storage direction is
    // independent: store every minor segment in its actual traversal direction.
    const isChainVertex = (vertex: MajorGraphVertex) => {
        if (getOrder(vertex) !== 2) return false;
        const [a, b] = vertex.outgoingEdges;
        return numberArraysEqual(
            a.windings,
            b.windings.map((w) => -w),
        );
    };
    const orientedSegment = (edge: MajorGraphEdge) =>
        edge.directionFlag ? reversePathSegment(edge.seg) : edge.seg;
    const nextEdge = (edge: MajorGraphEdge) => {
        const [a, b] = edge.incidentVertices[1].outgoingEdges;
        assertCondition(
            a.twin === edge || b.twin === edge,
            "Wrong twin structure.",
        );
        return a.twin === edge ? b : a;
    };
    for (const vertex of vertices) {
        if (isChainVertex(vertex)) continue;
        const startVertex = toMinorVertex(vertex);
        for (const startEdge of vertex.outgoingEdges) {
            const segments: PathSegment[] = [];
            let edge = startEdge;
            for (;;) {
                segments.push(orientedSegment(edge));
                const end = edge.incidentVertices[1];
                if (!isChainVertex(end)) break;
                visited.add(end);
                edge = nextEdge(edge);
            }
            const endVertex = toMinorVertex(edge.incidentVertices[1]);
            assertDefined(edge.twin, "Edge doesn't have a twin.");
            assertDefined(startEdge.twin, "Edge doesn't have a twin.");
            const twin =
                getEdgeById(getEdgeId(edge.twin), getEdgeId(startEdge.twin)) ??
                null;
            const newEdge: MinorGraphEdge = {
                segments,
                parents: startEdge.parents,
                incidentVertices: [startVertex, endVertex],
                directionFlag: false,
                windings: startEdge.windings,
                twin,
                id: nextEdgeId++,
            };
            if (twin) twin.twin = newEdge;
            setEdgeById(getEdgeId(startEdge), getEdgeId(edge), newEdge);
            startVertex.outgoingEdges.push(newEdge);
            newEdges.push(newEdge);
        }
    }
    const cycles: MinorGraphCycle[] = [];
    for (const vertex of vertices) {
        if (!isChainVertex(vertex) || visited.has(vertex)) continue;
        let edge = vertex.outgoingEdges[0];
        const cycle: MinorGraphCycle = {
            segments: [],
            parents: edge.parents,
            directionFlag: false,
            windings: edge.windings,
        };
        do {
            cycle.segments.push(orientedSegment(edge));
            visited.add(edge.incidentVertices[0]);
            assertCondition(
                isChainVertex(edge.incidentVertices[1]),
                "Unvisited chain boundary.",
            );
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

function removeDanglingEdges(graph: MinorGraph, pathCount: number) {
    function walk(parentIndex: number) {
        const keptVertices = new WeakSet<MinorGraphVertex>();
        const vertexToLevel = new WeakMap<MinorGraphVertex, number>();

        function visit(
            vertex: MinorGraphVertex,
            incomingEdge: MinorGraphEdge | null,
            level: number,
        ): number {
            if (vertexToLevel.has(vertex)) {
                return vertexToLevel.get(vertex)!;
            }
            vertexToLevel.set(vertex, level);

            let minLevel = Infinity;
            for (const edge of vertex.outgoingEdges) {
                if (edge.parents[parentIndex] && edge !== incomingEdge) {
                    minLevel = Math.min(
                        minLevel,
                        visit(edge.incidentVertices[1], edge.twin, level + 1),
                    );
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

    const keptVerticesPerPath: WeakSet<MinorGraphVertex>[] = [];
    for (let i = 0; i < pathCount; i++) {
        keptVerticesPerPath.push(walk(i));
    }

    function keepVertex(vertex: MinorGraphVertex): boolean {
        return keptVerticesPerPath.some((kept) => kept.has(vertex));
    }

    function keepEdge(edge: MinorGraphEdge): boolean {
        for (let i = 0; i < pathCount; i++) {
            if (
                edge.parents[i] &&
                keptVerticesPerPath[i].has(edge.incidentVertices[0]) &&
                keptVerticesPerPath[i].has(edge.incidentVertices[1])
            ) {
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

    return function getIncidenceSpeed({
        directionFlag,
        segments,
    }: MinorGraphEdge) {
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
    return function getIncidenceAngle(
        edge: MinorGraphEdge,
        offsetDistance = 0,
    ) {
        const { directionFlag, segments } = edge;
        const seg = segments[0]; // TODO: explain in comment why this is always the incident one in both fwd and bwd

        const tEnd = directionFlag ? 1 : 0;
        let t0 = tEnd;
        if (offsetDistance > 0) {
            const speed = getIncidenceSpeed(edge);
            // Cap the step so a slow parametrization cannot walk out of the
            // segment and pick up an angle from somewhere else entirely.
            const dt =
                speed > 0 ? Math.min(1, offsetDistance / speed) : EPS.param;
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
            const points = seg.slice(1) as Vector[];
            if (directionFlag) points.reverse();
            for (const point of points.slice(1)) {
                const dx = point[0] - points[0][0],
                    dy = point[1] - points[0][1];
                if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx);
            }
        }
        samplePathSegmentAtInto(seg, t0, p0);
        let dt = EPS.param;
        for (;;) {
            const tNext = directionFlag
                ? Math.max(0, t0 - dt)
                : Math.min(1, t0 + dt);
            samplePathSegmentAtInto(seg, tNext, pNext);
            const dx = pNext[0] - p0[0],
                dy = pNext[1] - p0[1];
            if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx);
            if (tNext === (directionFlag ? 0 : 1)) return 0;
            dt *= 2;
        }
    };
})();

// Equal leading Bezier control points imply equal leading power coefficients.
// The first differing control point then determines which curve departs to
// the left. This also resolves third-order contacts that tangent sampling
// rounds to a tie. A purely tangential difference needs reparametrization;
// leave that case to the general tangent/curvature comparison below.
function compareBezierDeparture(a: MinorGraphEdge, b: MinorGraphEdge): number {
    const sa = a.segments[0],
        sb = b.segments[0];
    if (sa[0] === "A" || sa[0] !== sb[0]) return 0;
    const pa = sa.slice(1) as Vector[],
        pb = sb.slice(1) as Vector[];
    if (a.directionFlag) pa.reverse();
    if (b.directionFlag) pb.reverse();
    if (pa[0][0] !== pb[0][0] || pa[0][1] !== pb[0][1]) return 0;
    let tangent: Vector | undefined;
    for (let i = 1; i < pa.length; i++) {
        if (pa[i][0] !== pb[i][0] || pa[i][1] !== pb[i][1]) {
            if (!tangent) return 0;
            return (
                tangent[0] * (pa[i][1] - pb[i][1]) -
                tangent[1] * (pa[i][0] - pb[i][0])
            );
        }
        const dx = pa[i][0] - pa[0][0],
            dy = pa[i][1] - pa[0][1];
        if (!tangent && (dx !== 0 || dy !== 0)) tangent = [dx, dy];
    }
    return 0;
}

function bezierCurvature(edge: MinorGraphEdge) {
    const seg = edge.segments[0];
    if (seg[0] !== "C" && seg[0] !== "Q") return undefined;
    const p = seg.slice(1) as Vector[];
    if (edge.directionFlag) p.reverse();
    const n = p.length - 1;
    const d = p
        .slice(1)
        .map((q, i) => [q[0] - p[i][0], q[1] - p[i][1]] as Vector);
    const v = d[0].map((x) => n * x) as Vector;
    const a = [
        n * (n - 1) * (d[1][0] - d[0][0]),
        n * (n - 1) * (d[1][1] - d[0][1]),
    ] as Vector;
    const j =
        n === 3
            ? ([
                  6 * (d[2][0] - 2 * d[1][0] + d[0][0]),
                  6 * (d[2][1] - 2 * d[1][1] + d[0][1]),
              ] as Vector)
            : ([0, 0] as Vector);
    const cross = (a: Vector, b: Vector) => a[0] * b[1] - a[1] * b[0];
    const speed = Math.hypot(...v),
        speed2 = speed * speed;
    if (speed === 0) return undefined;
    const va = cross(v, a),
        dot = v[0] * a[0] + v[1] * a[1];
    const curvature = va / (speed2 * speed);
    const derivative =
        (cross(v, j) * speed2 - 3 * va * dot) / (speed2 * speed2 * speed2);
    // Propagate coordinate roundoff through the endpoint derivatives. This
    // separates equal curvature with unequal curvature derivative without
    // letting the last bits of a subdivided control point decide the order.
    const error = 64 * Number.EPSILON * Math.max(...p.flat().map(Math.abs));
    const acceleration = Math.hypot(...a),
        jerk = Math.hypot(...j);
    const curvatureError = (error * (1 + acceleration / speed)) / speed2;
    const derivativeError =
        (error *
            (1 +
                (acceleration + jerk) / speed +
                (acceleration * acceleration) / speed2)) /
        (speed2 * speed);
    return { curvature, derivative, curvatureError, derivativeError };
}

function sortOutgoingEdgesByAngle({ vertices }: MinorGraph) {
    // TODO: this will hardly be a bottleneck, but profile whether memoization
    //  actually helps and maybe use a simpler function that's monotonic
    //  in angle.

    for (const vertex of vertices) {
        if (getOrder(vertex) > 2) {
            const angleCache = new WeakMap<MinorGraphEdge, number>();
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
                if (speed > 0) minSpeed = Math.min(minSpeed, speed);
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
            const turnCache = new WeakMap<MinorGraphEdge, number>();
            const curvatureCache = new WeakMap<
                MinorGraphEdge,
                ReturnType<typeof bezierCurvature>
            >();
            for (const edge of vertex.outgoingEdges) {
                curvatureCache.set(edge, bezierCurvature(edge));
                const primary = getIncidenceAngle(edge);
                angleCache.set(edge, primary);
                turnCache.set(
                    edge,
                    normalizeAngle(
                        getIncidenceAngle(edge, tieBreakDistance) - primary,
                    ),
                );
            }
            // Put the angular branch cut in the largest empty sector. atan2
            // spells the same leftward tangent as both -pi and +pi; leaving
            // that seam through a tangent group reverses the cyclic order.
            const angles = vertex.outgoingEdges
                .map((edge) => angleCache.get(edge)!)
                .sort((a, b) => a - b);
            let largestGap = -1,
                cut = 0;
            for (let i = 0; i < angles.length; i++) {
                const next =
                    i + 1 < angles.length
                        ? angles[i + 1]
                        : angles[0] + TAU_ANGLE;
                if (next - angles[i] > largestGap) {
                    largestGap = next - angles[i];
                    cut = (angles[i] + next) / 2;
                }
            }
            for (const edge of vertex.outgoingEdges) {
                angleCache.set(
                    edge,
                    (((angleCache.get(edge)! - cut) % TAU_ANGLE) + TAU_ANGLE) %
                        TAU_ANGLE,
                );
            }
            vertex.outgoingEdges.sort((a, b) => {
                const turnA = turnCache.get(a)!;
                const turnB = turnCache.get(b)!;
                /*
                 Directions count as the same when they differ by less than
                 either edge turns over that step: below that the measurement
                 cannot tell a genuine corner from the error in placing the
                 vertex, and curvature is the better discriminator. Straight
                 edges turn by nothing, so ANGLE_MIN_DIFF floors it and they
                 are ordered by direction as before.
                */
                const tolerance = Math.max(
                    ANGLE_MIN_DIFF,
                    Math.abs(turnA),
                    Math.abs(turnB),
                );
                const diff = angleCache.get(a)! - angleCache.get(b)!;
                if (Math.abs(diff) > tolerance) return diff;
                const exact = compareBezierDeparture(a, b);
                if (exact) return exact;
                const ca = curvatureCache.get(a),
                    cb = curvatureCache.get(b);
                if (ca && cb) {
                    const curvature = ca.curvature - cb.curvature;
                    if (
                        Math.abs(curvature) >
                        ca.curvatureError + cb.curvatureError
                    )
                        return curvature;
                    const derivative = ca.derivative - cb.derivative;
                    if (
                        Math.abs(derivative) >
                        ca.derivativeError + cb.derivativeError
                    )
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
function normalizeAngle(angle: number): number {
    const wrapped = (((angle + Math.PI) % TAU_ANGLE) + TAU_ANGLE) % TAU_ANGLE;
    return wrapped - Math.PI;
}

function getNextEdge(edge: MinorGraphEdge) {
    const { outgoingEdges } = edge.incidentVertices[1];
    const index = edge.twin?.indexInVertex;
    assertCondition(index !== undefined, "Twin edge index not found.");
    return outgoingEdges[(index + 1) % outgoingEdges.length];
}

const faceToPolygon = memoizeWeak((face: DualGraphVertex) =>
    face.incidentEdges.flatMap((edge): Vector[] => {
        const points: Vector[] = [];
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
    }),
);

function intervalCrossesPoint(a: number, b: number, p: number) {
    /*
     This deserves its own routine because of the following trick.
     We use different inequalities here to make sure we only count one of
     two intervals that meet precisely at p.
    */
    const dy1 = a >= p;
    const dy2 = b < p;
    return dy1 === dy2;
}

function lineSegmentIntersectsHorizontalRay(
    a: Vector,
    b: Vector,
    point: Vector,
): boolean {
    if (!intervalCrossesPoint(a[1], b[1], point[1])) return false;
    const x = linMap(point[1], a[1], b[1], a[0], b[0]);
    return x >= point[0];
}

function computePointWinding(polygon: Vector[], testedPoint: Vector) {
    if (polygon.length <= 2) return 0;
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
const faceSignedArea = memoizeWeak((face: DualGraphVertex) => {
    const origin = getStartPoint(face.incidentEdges[0].segments[0]);
    let total = 0,
        correction = 0;
    for (const edge of face.incidentEdges)
        for (const seg of edge.segments) {
            const term =
                segmentArea(seg, origin) * (edge.directionFlag ? -1 : 1);
            const adjusted = term - correction,
                next = total + adjusted;
            correction = next - total - adjusted;
            total = next;
        }
    return total;
});

const computeWinding = memoizeWeak((face: DualGraphVertex) => {
    const polygon = faceToPolygon(face);

    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const c = polygon[(i + 2) % polygon.length];
        const testedPoint: Vector = [
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

    assertUnreachable("No ear in polygon found.");
});

function computeDual({ edges, cycles }: MinorGraph): DualGraphComponent[] {
    const newVertices: DualGraphVertex[] = [];

    const minorToDualEdge = new WeakMap<MinorGraphEdge, DualGraphHalfEdge>();
    for (const startEdge of edges) {
        if (minorToDualEdge.has(startEdge)) continue;
        const face: DualGraphVertex = {
            incidentEdges: [],
            flags: [],
        };
        let edge = startEdge;
        do {
            assertDefined(edge.twin, "Edge doesn't have a twin");
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
        const innerFace: DualGraphVertex = {
            incidentEdges: [],
            flags: [],
        };

        const innerHalfEdge: DualGraphHalfEdge = {
            segments: cycle.segments,
            parents: cycle.parents,
            incidentVertex: innerFace,
            directionFlag: cycle.directionFlag,
            windings: cycle.windings,
            twin: null,
        };

        const outerFace: DualGraphVertex = {
            incidentEdges: [],
            flags: [],
        };

        const outerHalfEdge: DualGraphHalfEdge = {
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
    const isOuterFace = (face: DualGraphVertex) => faceSignedArea(face) > 0;

    const components: DualGraphComponent[] = [];

    const visitedVertices = new WeakSet<DualGraphVertex>();
    const visitedEdges = new WeakSet<DualGraphHalfEdge>();
    for (const vertex of newVertices) {
        if (visitedVertices.has(vertex)) continue;
        const componentVertices: DualGraphVertex[] = [];
        const componentEdges: DualGraphHalfEdge[] = [];
        const visit = (vertex: DualGraphVertex) => {
            if (!visitedVertices.has(vertex)) {
                componentVertices.push(vertex);
            }
            visitedVertices.add(vertex);
            for (const edge of vertex.incidentEdges) {
                if (visitedEdges.has(edge)) {
                    continue;
                }
                const { twin } = edge;
                assertDefined(twin, "Edge doesn't have a twin.");
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
            const primalVertices = new Set<Vector>();
            for (const edge of componentEdges) {
                const first = edge.segments[0];
                primalVertices.add(
                    edge.directionFlag
                        ? getEndPoint(first)
                        : getStartPoint(first),
                );
            }
            assertEqual(
                primalVertices.size -
                    componentEdges.length / 2 +
                    componentVertices.length,
                2,
                "Non-planar face arrangement.",
            );
        }
        const outerFace = componentVertices.find(isOuterFace);
        assertDefined(outerFace, "No outer face of a component found.");
        assertEqual(
            countIf(componentVertices, isOuterFace),
            1,
            "Multiple outer faces found.",
        );
        components.push({
            vertices: componentVertices,
            edges: componentEdges,
            outerFace,
        });
    }

    return components;
}

function boundingBoxIntersectsHorizontalRay(
    boundingBox: AABB,
    point: Vector,
): boolean {
    return (
        intervalCrossesPoint(boundingBox.top, boundingBox.bottom, point[1]) &&
        boundingBox.right >= point[0]
    );
}

function pathSegmentHorizontalRayIntersectionCount(
    origSeg: PathSegment,
    point: Vector,
    eps: Epsilons,
    totalBoundingBox: AABB = pathSegmentBoundingBox(origSeg),
): number {
    type IntersectionSegment = {
        boundingBox: AABB;
        seg: PathSegment;
        lo: number;
        hi: number;
    };
    if (!boundingBoxIntersectsHorizontalRay(totalBoundingBox, point)) return 0;
    const segments: IntersectionSegment[] = [
        { boundingBox: totalBoundingBox, seg: origSeg, lo: 0, hi: 1 },
    ];
    let count = 0;
    while (segments.length) {
        const { boundingBox, seg, lo, hi } = segments.pop()!;
        if (
            isNearlyLinearSegment(seg) ||
            boundingBoxMaxExtent(boundingBox) < eps.linear ||
            hi - lo <= eps.param
        ) {
            if (
                lineSegmentIntersectsHorizontalRay(
                    getStartPoint(seg),
                    getEndPoint(seg),
                    point,
                )
            )
                count++;
            continue;
        }
        const mid = (lo + hi) / 2;
        if (!(lo < mid && mid < hi))
            throw new Error(
                "Ray subdivision cannot advance its parameter interval",
            );
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

const getComponentInteriorPoint = memoizeWeak(
    (component: DualGraphComponent) => {
        for (const face of component.vertices) {
            if (face === component.outerFace) continue;
            return computeWinding(face).point;
        }
        assertUnreachable("No inner face found.");
    },
);

const getFaceIntersectionSegments = memoizeWeak((face: DualGraphVertex) =>
    face.incidentEdges.flatMap((edge) =>
        edge.segments.map((seg) => ({
            seg,
            boundingBox: pathSegmentBoundingBox(seg),
        })),
    ),
);

const getFaceBoundingBox = memoizeWeak((face: DualGraphVertex) => {
    let boundingBox: AABB | null = null;
    for (const { boundingBox: segBoundingBox } of getFaceIntersectionSegments(
        face,
    )) {
        boundingBox = mergeBoundingBoxes(boundingBox, segBoundingBox);
    }
    assertDefined(boundingBox, "Face has no segments.");
    return boundingBox;
});

const getComponentBoundingBox = memoizeWeak((component: DualGraphComponent) => {
    let boundingBox: AABB | null = null;
    for (const face of component.vertices) {
        if (face === component.outerFace) continue;
        boundingBox = mergeBoundingBoxes(boundingBox, getFaceBoundingBox(face));
    }
    assertDefined(boundingBox, "Component has no inner face.");
    return boundingBox;
});

function boundingBoxContainsPoint(
    boundingBox: AABB,
    point: Vector,
    eps: Epsilons,
): boolean {
    return (
        point[0] >= boundingBox.left - eps.point &&
        point[0] <= boundingBox.right + eps.point &&
        point[1] >= boundingBox.top - eps.point &&
        point[1] <= boundingBox.bottom + eps.point
    );
}

function boundingBoxArea({ top, right, bottom, left }: AABB): number {
    return (right - left) * (bottom - top);
}

function findContainingFace(
    component: DualGraphComponent,
    testedPoint: Vector,
    eps: Epsilons,
): DualGraphVertex | null {
    // TODO: Intersection counting will fail if a curve touches the horizontal line but doesn't go through.
    for (const face of component.vertices) {
        if (face === component.outerFace) continue;
        if (
            !boundingBoxContainsPoint(
                getFaceBoundingBox(face),
                testedPoint,
                eps,
            )
        ) {
            continue;
        }

        let count = 0;
        for (const { seg, boundingBox } of getFaceIntersectionSegments(face)) {
            if (!boundingBoxIntersectsHorizontalRay(boundingBox, testedPoint)) {
                continue;
            }
            count += pathSegmentHorizontalRayIntersectionCount(
                seg,
                testedPoint,
                eps,
                boundingBox,
            );
        }

        if (count % 2 === 1) return face;
    }
    return null;
}

function computeNestingTree(
    components: DualGraphComponent[],
    eps: Epsilons,
): NestingTree[] {
    type ComponentInfo = {
        index: number;
        component: DualGraphComponent;
        interiorPoint: Vector;
        boundingBox: AABB;
        area: number;
    };

    if (components.length === 0) {
        return [];
    }

    let totalBoundingBox: AABB | null = null;

    const info: ComponentInfo[] = components.map((component, index) => {
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

    assertDefined(totalBoundingBox, "No total component bounding box found.");

    const treeByComponent = new WeakMap<DualGraphComponent, NestingTree>();
    for (const component of components) {
        treeByComponent.set(component, { component, outgoingEdges: new Map() });
    }

    const componentTree = new QuadTree<number>(
        totalBoundingBox,
        POINT_TREE_DEPTH,
    );
    for (const entry of info) {
        componentTree.insert(entry.boundingBox, entry.index);
    }

    const roots: NestingTree[] = [];

    for (const entry of info) {
        const point = entry.interiorPoint;
        const queryBox = boundingBoxAroundPoint(point, eps.point);
        const candidateIds = componentTree.find(queryBox);
        let bestParent: ComponentInfo | null = null;
        let bestFace: DualGraphVertex | null = null;

        for (const candidateId of candidateIds) {
            if (candidateId === entry.index) continue;
            const candidate = info[candidateId];
            if (!boundingBoxContainsPoint(candidate.boundingBox, point, eps)) {
                continue;
            }

            // One interior sample can lie inside a smaller component (for
            // example inside a hole). A parent must enclose the child's whole
            // bounds, not merely that sample, or nesting can become cyclic.
            const a = candidate.boundingBox,
                b = entry.boundingBox;
            if (
                a.left > b.left + eps.point ||
                a.right < b.right - eps.point ||
                a.top > b.top + eps.point ||
                a.bottom < b.bottom - eps.point
            )
                continue;
            const face = findContainingFace(candidate.component, point, eps);
            if (!face) continue;

            if (!bestParent || candidate.area < bestParent.area) {
                bestParent = candidate;
                bestFace = face;
            }
        }

        const tree = treeByComponent.get(entry.component)!;

        if (!bestParent || !bestFace) {
            roots.push(tree);
            continue;
        }

        const parentTree = treeByComponent.get(bestParent.component)!;
        if (parentTree.outgoingEdges.has(bestFace)) {
            parentTree.outgoingEdges.get(bestFace)!.push(tree);
        } else {
            parentTree.outgoingEdges.set(bestFace, [tree]);
        }
    }

    return roots;
}

function getFlag(count: number, fillRule: FillRule): boolean {
    switch (fillRule) {
        case FillRule.NonZero:
            return count !== 0;
        case FillRule.EvenOdd:
            return count % 2 !== 0;
    }
}

function flagFaces(nestingTrees: NestingTree[], fillRules: FillRule[]) {
    const pathCount = fillRules.length;

    function visitTree(tree: NestingTree, runningCounts: number[]) {
        const visitedFaces = new WeakSet<DualGraphVertex>();

        function visitFace(face: DualGraphVertex, runningCounts: number[]) {
            if (visitedFaces.has(face)) return;
            visitedFaces.add(face);
            face.flags = runningCounts.map((count, i) =>
                getFlag(count, fillRules[i]),
            );
            for (const edge of face.incidentEdges) {
                const twin = edge.twin;
                assertDefined(twin, "Edge doesn't have a twin.");
                const nextCounts = runningCounts.slice();
                for (let i = 0; i < pathCount; i++) {
                    nextCounts[i] += edge.windings[i];
                }
                visitFace(twin.incidentVertex, nextCounts);
            }
            if (tree.outgoingEdges.has(face)) {
                const subtrees = tree.outgoingEdges.get(face)!;
                for (const subtree of subtrees) {
                    visitTree(subtree, runningCounts);
                }
            }
        }

        assertDefined(
            tree.component.outerFace,
            "Component doesn't have an outer face.",
        );

        visitFace(tree.component.outerFace, runningCounts);
    }

    for (const tree of nestingTrees) {
        visitTree(tree, new Array<number>(pathCount).fill(0));
    }
}

function* getSelectedFaces(
    nestingTrees: NestingTree[],
    predicate: (face: DualGraphVertex) => boolean,
): Iterable<DualGraphVertex> {
    function* visit(tree: NestingTree): Iterable<DualGraphVertex> {
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

function* walkFaces(faces: Set<DualGraphVertex>) {
    function isRemovedEdge(edge: DualGraphHalfEdge) {
        assertDefined(edge.twin, "Edge doesn't have a twin.");
        return (
            faces.has(edge.incidentVertex) ===
            faces.has(edge.twin.incidentVertex)
        );
    }

    const edgeToNext = new WeakMap<DualGraphHalfEdge, DualGraphHalfEdge>();
    for (const face of faces) {
        let prevEdge = face.incidentEdges[face.incidentEdges.length - 1];
        for (const edge of face.incidentEdges) {
            edgeToNext.set(prevEdge, edge);
            prevEdge = edge;
        }
    }

    const visitedEdges = new WeakSet<DualGraphHalfEdge>();
    for (const face of faces) {
        for (const startEdge of face.incidentEdges) {
            if (isRemovedEdge(startEdge) || visitedEdges.has(startEdge)) {
                continue;
            }
            let edge = startEdge;
            do {
                if (edge.directionFlag) {
                    yield* map(edge.segments, reversePathSegment);
                } else {
                    yield* edge.segments;
                }
                visitedEdges.add(edge);
                edge = edgeToNext.get(edge)!;
                while (isRemovedEdge(edge)) {
                    assertDefined(edge.twin, "Edge doesn't have a twin.");
                    edge = edgeToNext.get(edge.twin)!;
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
function enumerateFaces(
    nestingTrees: NestingTree[],
    predicate: (face: DualGraphVertex) => boolean,
): { faces: DualGraphVertex[]; paths: Path[] } {
    const faces: DualGraphVertex[] = [];
    const paths: Path[] = [];

    function visit(tree: NestingTree) {
        for (const face of tree.component.vertices) {
            if (!predicate(face) || face === tree.component.outerFace) {
                continue;
            }

            const path: Path = [];

            for (const edge of face.incidentEdges) {
                if (edge.directionFlag) {
                    path.push(...edge.segments.map(reversePathSegment));
                } else {
                    path.push(...edge.segments);
                }
            }

            // poke holes in the face
            if (tree.outgoingEdges.has(face)) {
                for (const subtree of tree.outgoingEdges.get(face)!) {
                    const { outerFace } = subtree.component;

                    assertDefined(outerFace, "Component has no outer face.");

                    for (const edge of outerFace.incidentEdges) {
                        if (edge.directionFlag) {
                            path.push(...edge.segments.map(reversePathSegment));
                        } else {
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

function dumpFaces(
    nestingTrees: NestingTree[],
    predicate: (face: DualGraphVertex) => boolean,
): Path[] {
    return enumerateFaces(nestingTrees, predicate).paths;
}

/*
 Adds the outer face of each nested child component whose parent face is already
 selected. `walkFaces` then traces those outer faces as holes, mirroring the
 hole-poking `enumerateFaces`/`dumpFaces` perform per face — except here the
 selected regions are unioned, so a child whose own region is also selected has
 its boundary removed as an internal edge instead of becoming a hole.
*/
function addNestedOuterFaces(
    nestingTrees: NestingTree[],
    selected: Set<DualGraphVertex>,
) {
    function visit(tree: NestingTree) {
        for (const [parentFace, subtrees] of tree.outgoingEdges) {
            if (selected.has(parentFace)) {
                for (const subtree of subtrees) {
                    const { outerFace } = subtree.component;
                    assertDefined(outerFace, "Component has no outer face.");
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

function majorGraphToDot({ vertices, edges }: MajorGraph) {
    const toNumber = createObjectCounter();
    return `digraph {
${vertices.map((v) => `  ${toNumber(v)} [pos="${v.point.map((v) => v / 10).join(",")}!"]`).join("\n")}
${edges.map((edge) => "  " + edge.incidentVertices.map(toNumber).join(" -> ")).join("\n")}
}
`;
}

function minorGraphToDot(edges: MinorGraphEdge[]) {
    const toNumber = createObjectCounter();
    return `digraph {
${edges.map((edge) => "  " + edge.incidentVertices.map(toNumber).join(" -> ")).join("\n")}
}
`;
}

function dualGraphToDot(components: DualGraphComponent[]) {
    const toNumber = createObjectCounter();
    return `strict graph {
${components.map(({ edges }) => edges.map((edge) => `  ${toNumber(edge.incidentVertex)} -- ${toNumber(edge.twin!.incidentVertex)}`).join("\n")).join("\n")}
}
`;
}

function nestingTreesToDot(trees: NestingTree[]) {
    const toNumber = createObjectCounter();
    let out = "digraph {\n";

    function visit(tree: NestingTree) {
        for (const edges of tree.outgoingEdges.values()) {
            for (const subtree of edges) {
                out += `  ${toNumber(tree.component)} -> ${toNumber(subtree.component)}\n`;
                visit(subtree);
            }
        }
    }

    trees.forEach(visit);

    return out + "}\n";
}

/*
 Operation predicates over the per-path inside/outside flags. The binary
 operations generalize to N paths by a left-fold ("first vs the rest"):
 Difference is the first path minus the union of the others, Exclusion is the
 XOR (odd number of paths), and Division dumps the faces of the first path.
*/
const operationPredicates: Record<
    PathBooleanOperation,
    (flags: boolean[]) => boolean
> = {
    [PathBooleanOperation.Union]: (flags) => flags.some(Boolean),
    [PathBooleanOperation.Difference]: (flags) =>
        flags[0] && !flags.slice(1).some(Boolean),
    [PathBooleanOperation.Intersection]: (flags) => flags.every(Boolean),
    [PathBooleanOperation.Exclusion]: (flags) =>
        flags.reduce((count, f) => count + (f ? 1 : 0), 0) % 2 === 1,
    [PathBooleanOperation.Division]: (flags) => flags[0],
    [PathBooleanOperation.Fracture]: (flags) => flags.some(Boolean),
};

export type PathBooleanInput = {
    path: Path;
    fillRule: FillRule;
};

function translateSegment(
    seg: PathSegment,
    dx: number,
    dy: number,
): PathSegment {
    return seg.map((value) =>
        Array.isArray(value) ? [value[0] + dx, value[1] + dy] : value,
    ) as PathSegment;
}

/*
 Runs the boolean-operation pipeline up to and including face flagging for a set
 of N input paths in the constructor, then selects faces per operation in `get`.
 The expensive geometric work happens once; multiple `get` calls reuse it.
*/
export class PathBoolean {
    private readonly origin: Vector = [0, 0];
    private restore(path: Path): Path {
        return path.map((seg) =>
            translateSegment(seg, this.origin[0], this.origin[1]),
        );
    }
    private readonly nestingTrees: NestingTree[];
    private regions?: { faces: DualGraphVertex[]; paths: Path[] };

    constructor(inputs: PathBooleanInput[]) {
        const pathCount = inputs.length;

        const unsplitEdges = inputs.flatMap(({ path }, i) =>
            path.map(segmentToEdge(pathCount, i)),
        );

        /*
         Length-valued tolerances scale with how big the geometry is; see
         epsilonsForExtent. Measured before anything is split, so that every
         stage of a run shares one set of values.
        */
        let inputBoundingBox: AABB | null = null;
        for (const { seg } of unsplitEdges) {
            inputBoundingBox = mergeBoundingBoxes(
                inputBoundingBox,
                pathSegmentBoundingBox(seg),
            );
        }
        // Keep arithmetic near the drawing. Choose the point of the bounding
        // box nearest the origin: an axis already spanning zero stays put.
        // This avoids subtracting large almost-equal area and curve terms for
        // tiny drawings located far away, without moving near-zero detail far.
        if (inputBoundingBox) {
            const nearest = (lo: number, hi: number) =>
                lo > 0 ? lo : hi < 0 ? hi : 0;
            this.origin = [
                nearest(inputBoundingBox.left, inputBoundingBox.right),
                nearest(inputBoundingBox.top, inputBoundingBox.bottom),
            ];
            for (const edge of unsplitEdges)
                edge.seg = translateSegment(
                    edge.seg,
                    -this.origin[0],
                    -this.origin[1],
                );
        }
        const eps = epsilonsForExtent(
            inputBoundingBox ? boundingBoxMaxExtent(inputBoundingBox) : 0,
        );

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

        const { edges: splitEdges, totalBoundingBox } = splitAtIntersections(
            unsplitEdges,
            eps,
        );

        if (!totalBoundingBox) {
            // input geometry is empty
            this.nestingTrees = [];
            return;
        }

        const majorGraph = findVertices(
            splitEdges,
            totalBoundingBox,
            eps,
            inputPoints,
        );
        assertMajorGraphInvariants(majorGraph);
        // console.log(majorGraphToDot(majorGraph));

        const minorGraph = computeMinor(majorGraph);
        // console.log(minorGraphToDot(minorGraph.edges));
        // console.dir(minorGraph.cycles, { depth: 4 });

        removeDanglingEdges(minorGraph, pathCount);
        assertMinorGraphInvariants(minorGraph);
        // console.log(minorGraphToDot(minorGraph.edges));

        sortOutgoingEdgesByAngle(minorGraph);

        const dualGraphComponents = computeDual(minorGraph);
        assertDualGraphInvariants(dualGraphComponents);
        // console.log(dualGraphToDot(dualGraphComponents));

        const nestingTrees = computeNestingTree(dualGraphComponents, eps);
        // console.log(nestingTrees.length, nestingTreesToDot(nestingTrees));

        flagFaces(
            nestingTrees,
            inputs.map(({ fillRule }) => fillRule),
        );

        this.nestingTrees = nestingTrees;
    }

    get(op: PathBooleanOperation): Path[] {
        const predicate = (face: DualGraphVertex) =>
            operationPredicates[op](face.flags);

        switch (op) {
            case PathBooleanOperation.Division:
            case PathBooleanOperation.Fracture:
                return dumpFaces(this.nestingTrees, predicate).map((path) =>
                    this.restore(path),
                );
            default: {
                const selectedFaces = new Set(
                    getSelectedFaces(this.nestingTrees, predicate),
                );
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
    getFaces(): Path[] {
        return this.getRegions().paths;
    }

    /*
     Merges the regions at the given `getFaces` indices into a single shape,
     tracing the outline of their union (with holes where appropriate). Indices
     out of range are ignored. This is the Shape Builder "combine selection"
     operation.
    */
    buildShape(indices: Iterable<number>): Path {
        const { faces } = this.getRegions();
        const selected = new Set<DualGraphVertex>();
        for (const i of indices) {
            const face = faces[i];
            if (face) selected.add(face);
        }
        addNestedOuterFaces(this.nestingTrees, selected);
        return this.restore([...walkFaces(selected)]);
    }

    private getRegions(): { faces: DualGraphVertex[]; paths: Path[] } {
        if (!this.regions) {
            const regions = enumerateFaces(this.nestingTrees, (face) =>
                face.flags.some(Boolean),
            );
            this.regions = {
                faces: regions.faces,
                paths: regions.paths.map((path) => this.restore(path)),
            };
        }
        return this.regions;
    }
}

export const __testOnly = {
    assertMajorGraphInvariants,
    assertMinorGraphInvariants,
    assertDualGraphInvariants,
};
