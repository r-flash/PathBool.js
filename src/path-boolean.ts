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
    MAX_INTERSECTION_PAIRS,
    MAX_SUBDIVISION_ITERS,
    MAX_SUBSEGMENTS_PER_ORIG_SEGMENT,
    MAX_TANGENT_SAMPLE_ITERS,
    TANGENT_MIN_LEN_SQ,
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
    mergeBoundingBoxes,
} from "./primitives/AABB";
import { Path } from "./primitives/Path";
import {
    getEndPoint,
    getStartPoint,
    PathSegment,
    isNearlyLinearSegment,
    pathSegmentBoundingBox,
    pathSegmentTangentAtInto,
    reversePathSegment,
    samplePathSegmentAtInto,
    splitCubicSegmentAt,
    splitSegmentAt,
} from "./primitives/PathSegment";
import { createVector, Vector, vectorsEqual } from "./primitives/Vector";
import { countIf, hasOwn, memoizeWeak } from "./util/generic";
import { map } from "./util/iterators";
import { linMap } from "./util/math";

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
    directionFlags: boolean[];
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
    directionFlags: boolean[];
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
    directionFlags: boolean[];
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
    directionFlags: boolean[];
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

function firstElementOfSet<T>(set: Set<T>): T {
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

function orBooleansInto(target: boolean[], source: boolean[]) {
    for (let i = 0; i < source.length; i++) {
        if (source[i]) target[i] = true;
    }
}

/*
 Records how a path joining an already-created edge is oriented relative to it.

 `directionFlags[i]` means "path i's own segment runs against this half-edge",
 so the two half-edges always hold opposite values for any path on the edge.
 `againstForward` says which way round the joining path goes.

 Only the joining path's slots are written. Assigning the whole array would
 wipe the orientations of the paths already sharing the edge, which is what
 made Intersection and Exclusion depend on the order of the inputs wherever
 two paths shared a collinear edge.
*/
function setDirectionFlags(
    existingEdge: [MajorGraphEdgeStage2, MajorGraphEdge, MajorGraphEdge],
    parents: boolean[],
    againstForward: boolean,
) {
    const [, forward, backward] = existingEdge;
    for (let i = 0; i < parents.length; i++) {
        if (!parents[i]) continue;
        forward.directionFlags[i] = againstForward;
        backward.directionFlags[i] = !againstForward;
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

function splitAtSelfIntersections(edges: MajorGraphEdgeStage1[]) {
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (edge.seg[0] !== "C") continue;
        const intersection = pathCubicSegmentSelfIntersection(edge.seg);
        if (!intersection) continue;
        if (intersection[0] > intersection[1]) {
            intersection.reverse();
        }
        const [t1, t2] = intersection;
        if (Math.abs(t1 - t2) < EPS.param) {
            const [seg1, seg2] = splitCubicSegmentAt(edge.seg, t1);
            edges[i] = {
                seg: seg1,
                parents: edge.parents,
            };
            edges.push({
                seg: seg2,
                parents: edge.parents,
            });
        } else {
            const [seg1, tmpSeg] = splitCubicSegmentAt(edge.seg, t1);
            const [seg2, seg3] = splitCubicSegmentAt(
                tmpSeg,
                (t2 - t1) / (1 - t1),
            );
            edges[i] = {
                seg: seg1,
                parents: edge.parents,
            };
            edges.push(
                {
                    seg: seg2,
                    parents: edge.parents,
                },
                {
                    seg: seg3,
                    parents: edge.parents,
                },
            );
        }
    }
}

function splitAtIntersections(edges: MajorGraphEdgeStage1[]) {
    const withBoundingBox: MajorGraphEdgeStage2[] = edges.map((edge) => ({
        ...edge,
        boundingBox: pathSegmentBoundingBox(edge.seg),
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

    let pairChecks = 0;
    for (let i = 0; i < withBoundingBox.length; i++) {
        const edge = withBoundingBox[i];
        const candidates = edgeTree.find(edge.boundingBox);
        for (const j of candidates) {
            if (pairChecks >= MAX_INTERSECTION_PAIRS) {
                break;
            }
            const candidate = edges[j];
            const intersection = pathSegmentIntersection(
                edge.seg,
                candidate.seg,
                EPS,
            );
            for (const [t0, t1] of intersection) {
                addSplit(i, t0);
                addSplit(j, t1);
            }
            pairChecks++;
        }

        /*
         Insert the edge to the tree here, after checking intersections.
         That way, each pair is only tested once.
        */
        edgeTree.insert(edge.boundingBox, i);
        if (pairChecks >= MAX_INTERSECTION_PAIRS) {
            break;
        }
    }

    const newEdges: MajorGraphEdgeStage2[] = [];

    for (let i = 0; i < withBoundingBox.length; i++) {
        const edge = withBoundingBox[i];
        if (!hasOwn(splitsPerEdge, i)) {
            newEdges.push(edge);
            continue;
        }
        const splits = splitsPerEdge[i];
        splits.sort();
        if (splits.length + 1 > MAX_SUBSEGMENTS_PER_ORIG_SEGMENT) {
            splits.length = Math.max(0, MAX_SUBSEGMENTS_PER_ORIG_SEGMENT - 1);
        }
        let tmpSeg = edge.seg;
        let prevT = 0;
        for (let j = 0; j < splits.length; j++) {
            const t = splits[j];

            if (t > 1 - EPS.param) break; // skip splits near end

            const tt = (t - prevT) / (1 - prevT);
            prevT = t;

            if (tt < EPS.param) continue; // skip splits near start
            if (tt > 1 - EPS.param) continue; // skip splits near end

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
): MajorGraph {
    const vertexTree = new QuadTree<MajorGraphVertex>(
        boundingBox,
        POINT_TREE_DEPTH,
    );

    const newVertices: MajorGraphVertex[] = [];

    function getVertex(point: Vector): MajorGraphVertex {
        const box = boundingBoxAroundPoint(point, EPS.point);
        const existingVertices = vertexTree.find(box);
        if (existingVertices.size) {
            return firstElementOfSet(existingVertices);
        } else {
            const vertex: MajorGraphVertex = {
                point,
                outgoingEdges: [],
            };
            vertexTree.insert(box, vertex);
            newVertices.push(vertex);
            return vertex;
        }
    }

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
        if (vectorsEqual(startPoint, endPoint, EPS.point)) {
            switch (edge.seg[0]) {
                case "L":
                    return [];
                case "C":
                    if (
                        vectorsEqual(edge.seg[1], edge.seg[2], EPS.point) &&
                        vectorsEqual(edge.seg[3], edge.seg[4], EPS.point)
                    ) {
                        return [];
                    }
                    break;
                case "Q":
                    if (vectorsEqual(edge.seg[1], edge.seg[2], EPS.point)) {
                        return [];
                    }
                    break;
                case "A":
                    // Check large-arc-flag
                    if (edge.seg[5] === false) {
                        return [];
                    }
                    break;
            }
        }

        const startVertex = getVertex(startPoint);
        const endVertex = getVertex(endPoint);

        const startId = getVertexId(startVertex);
        const endId = getVertexId(endVertex);
        const existingEdges = getVertexPairEdges(startId, endId);
        if (existingEdges) {
            const existingEdge = existingEdges.find((other) =>
                segmentsEqual(other[0].seg, edge.seg, EPS.point),
            );
            if (existingEdge) {
                // A shared edge traversed the same way round. The joining path
                // runs along the forward half-edge and against the backward
                // one, matching how a fresh edge pair is built below. Only the
                // joining path's own slots are touched; the slots belonging to
                // paths already on this edge keep their own orientation.
                setDirectionFlags(existingEdge, edge.parents, false);
                orBooleansInto(existingEdge[1].parents, edge.parents);
                orBooleansInto(existingEdge[2].parents, edge.parents);
                return [];
            }
        }

        const existingEdgesInv = getVertexPairEdges(endId, startId);
        if (existingEdgesInv) {
            const reversedSeg = reversePathSegment(edge.seg);
            const existingEdge = existingEdgesInv.find((other) =>
                segmentsEqual(other[0].seg, reversedSeg, EPS.point),
            );
            if (existingEdge) {
                if (booleanArraysEqual(existingEdge[0].parents, edge.parents)) {
                    // discard "there and back" pairs
                    return [];
                }

                // A shared edge traversed the opposite way round: the joining
                // path runs along the backward half-edge and against the
                // forward one.
                setDirectionFlags(existingEdge, edge.parents, true);
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
            directionFlags: new Array<boolean>(edge.parents.length).fill(false),
            twin: null,
        };

        const bwdEdge: MajorGraphEdge = {
            ...edge,
            parents: edge.parents.slice(),
            incidentVertices: [endVertex, startVertex],
            directionFlag: true,
            // directionFlags[p] = parents[p]: on the backward half-edge the
            // originating path runs against its own orientation.
            directionFlags: edge.parents.slice(),
            twin: fwdEdge,
        };

        fwdEdge.twin = bwdEdge;

        startVertex.outgoingEdges.push(fwdEdge);
        endVertex.outgoingEdges.push(bwdEdge);

        ensureVertexPairEdges(startId, endId).push([edge, fwdEdge, bwdEdge]);

        return [fwdEdge, bwdEdge];
    });

    return {
        edges: newEdges,
        vertices: newVertices,
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

    // first handle components that are not cycles
    for (const vertex of vertices) {
        if (getOrder(vertex) === 2) continue;

        const startVertex = toMinorVertex(vertex);

        for (const startEdge of vertex.outgoingEdges) {
            const segments: PathSegment[] = [];
            let edge = startEdge;
            while (
                booleanArraysEqual(edge.parents, startEdge.parents) &&
                edge.directionFlag === startEdge.directionFlag &&
                booleanArraysEqual(
                    edge.directionFlags,
                    startEdge.directionFlags,
                ) &&
                getOrder(edge.incidentVertices[1]) === 2
            ) {
                segments.push(edge.seg);
                visited.add(edge.incidentVertices[1]);
                const [edge1, edge2] = edge.incidentVertices[1].outgoingEdges;
                assertCondition(
                    edge1.twin === edge || edge2.twin === edge,
                    "Wrong twin structure.",
                );
                edge = edge1.twin === edge ? edge2 : edge1; // choose the one we didn't use to come here
            }
            segments.push(edge.seg);
            const endVertex = toMinorVertex(edge.incidentVertices[1]);
            assertDefined(edge.twin, "Edge doesn't have a twin.");
            assertDefined(startEdge.twin, "Edge doesn't have a twin.");
            const startId = getEdgeId(startEdge);
            const endId = getEdgeId(edge);
            const twinStartId = getEdgeId(edge.twin);
            const twinEndId = getEdgeId(startEdge.twin);
            const twin = getEdgeById(twinStartId, twinEndId) ?? null;
            const newEdge: MinorGraphEdge = {
                segments,
                parents: startEdge.parents,
                incidentVertices: [startVertex, endVertex],
                directionFlag: startEdge.directionFlag,
                directionFlags: startEdge.directionFlags,
                twin: twin,
                id: nextEdgeId++,
            };
            if (twin) {
                twin.twin = newEdge;
            }
            setEdgeById(startId, endId, newEdge);
            startVertex.outgoingEdges.push(newEdge);
            newEdges.push(newEdge);
        }
    }

    // handle cyclic components
    const cycles: MinorGraphCycle[] = [];
    for (const vertex of vertices) {
        if (getOrder(vertex) !== 2 || visited.has(vertex)) continue;
        let edge = vertex.outgoingEdges[0];
        const cycle: MinorGraphCycle = {
            segments: [],
            parents: edge.parents,
            directionFlag: edge.directionFlag,
            directionFlags: edge.directionFlags,
        };
        do {
            cycle.segments.push(edge.seg);
            visited.add(edge.incidentVertices[0]);
            assertEqual(
                getOrder(edge.incidentVertices[1]),
                2,
                "Found an unvisited vertex of order != 2.",
            );
            const [edge1, edge2] = edge.incidentVertices[1].outgoingEdges;
            assertCondition(
                edge1.twin === edge || edge2.twin === edge,
                "Wrong twin structure.",
            );
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

const getIncidenceAngle = (() => {
    const p0 = createVector();
    const pNext = createVector();
    const tangent = createVector();

    return function getIncidenceAngle(
        { directionFlag, segments }: MinorGraphEdge,
        offset = false,
    ) {
        const seg = segments[0]; // TODO: explain in comment why this is always the incident one in both fwd and bwd

        // First attempt: analytical tangent
        const t0 = directionFlag
            ? offset
                ? 1 - EPS.param
                : 1
            : offset
              ? EPS.param
              : 0;
        pathSegmentTangentAtInto(seg, t0, tangent);
        if (directionFlag) {
            tangent[0] = -tangent[0];
            tangent[1] = -tangent[1];
        }
        const lenSq = tangent[0] * tangent[0] + tangent[1] * tangent[1];
        if (lenSq >= TANGENT_MIN_LEN_SQ) {
            return Math.atan2(tangent[1], tangent[0]);
        }

        // Second attempt: numerical tangent
        samplePathSegmentAtInto(seg, t0, p0);
        let dt = EPS.param;
        for (let i = 0; i < MAX_TANGENT_SAMPLE_ITERS; i++) {
            const tNext = directionFlag
                ? Math.max(0, t0 - dt)
                : Math.min(1, t0 + dt);
            samplePathSegmentAtInto(seg, tNext, pNext);
            const dx = pNext[0] - p0[0];
            const dy = pNext[1] - p0[1];
            const lenSq = dx * dx + dy * dy;
            if (lenSq >= TANGENT_MIN_LEN_SQ) {
                return Math.atan2(dy, dx);
            }
            dt *= 2;
        }

        // Fallback: treat the segment as linear
        const start = getStartPoint(seg);
        const end = getEndPoint(seg);
        let dx = end[0] - start[0];
        let dy = end[1] - start[1];
        if (directionFlag) {
            dx = -dx;
            dy = -dy;
        }

        return Math.atan2(dy, dx);
    };
})();

function sortOutgoingEdgesByAngle({ vertices }: MinorGraph) {
    // TODO: this will hardly be a bottleneck, but profile whether memoization
    //  actually helps and maybe use a simpler function that's monotonic
    //  in angle.

    for (const vertex of vertices) {
        if (getOrder(vertex) > 2) {
            const angleCache = new WeakMap<MinorGraphEdge, number>();
            for (let i = 0; i < vertex.outgoingEdges.length; i++) {
                const edge = vertex.outgoingEdges[i];
                angleCache.set(edge, getIncidenceAngle(edge));
            }
            vertex.outgoingEdges.sort((a, b) => {
                const diff = angleCache.get(a)! - angleCache.get(b)!;
                if (Math.abs(diff) > ANGLE_MIN_DIFF) return diff;
                return getIncidenceAngle(a, true) - getIncidenceAngle(b, true);
            });
        }
        for (let i = 0; i < vertex.outgoingEdges.length; i++) {
            vertex.outgoingEdges[i].indexInVertex = i;
        }
    }
}

function getNextEdge(edge: MinorGraphEdge) {
    const { outgoingEdges } = edge.incidentVertices[1];
    const index = edge.twin?.indexInVertex;
    assertCondition(index !== undefined, "Twin edge index not found.");
    return outgoingEdges[(index + 1) % outgoingEdges.length];
}

const faceToPolygon = memoizeWeak((face: DualGraphVertex) =>
    face.incidentEdges.flatMap((edge): Vector[] => {
        const CNT = 64;

        const points: Vector[] = [];
        const p = createVector();

        for (const seg of edge.segments) {
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
                directionFlags: edge.directionFlags,
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
            directionFlags: cycle.directionFlags,
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
            directionFlags: cycle.directionFlags.map((f) => !f),
            twin: innerHalfEdge,
        };

        innerHalfEdge.twin = outerHalfEdge;
        innerFace.incidentEdges.push(innerHalfEdge);
        outerFace.incidentEdges.push(outerHalfEdge);

        newVertices.push(innerFace, outerFace);
    }

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
        const outerFace = componentVertices.find(
            (face) => computeWinding(face).winding < 0,
        );
        assertDefined(outerFace, "No outer face of a component found.");
        assertEqual(
            countIf(
                componentVertices,
                (face) => computeWinding(face).winding < 0,
            ),
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
    totalBoundingBox: AABB = pathSegmentBoundingBox(origSeg),
): number {
    type IntersectionSegment = { boundingBox: AABB; seg: PathSegment };
    if (!boundingBoxIntersectsHorizontalRay(totalBoundingBox, point)) return 0;
    let segments: IntersectionSegment[] = [
        { boundingBox: totalBoundingBox, seg: origSeg },
    ];
    let count = 0;
    let iterations = 0;
    while (segments.length > 0) {
        if (
            iterations++ > MAX_SUBDIVISION_ITERS ||
            segments.length > MAX_SUBSEGMENTS_PER_ORIG_SEGMENT
        ) {
            for (const { seg } of segments) {
                if (
                    lineSegmentIntersectsHorizontalRay(
                        getStartPoint(seg),
                        getEndPoint(seg),
                        point,
                    )
                ) {
                    count++;
                }
            }
            break;
        }
        const nextSegments: IntersectionSegment[] = [];
        for (const { boundingBox, seg } of segments) {
            if (
                isNearlyLinearSegment(seg) ||
                boundingBoxMaxExtent(boundingBox) < EPS.linear
            ) {
                if (
                    lineSegmentIntersectsHorizontalRay(
                        getStartPoint(seg),
                        getEndPoint(seg),
                        point,
                    )
                ) {
                    count++;
                }
            } else {
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

function boundingBoxContainsPoint(boundingBox: AABB, point: Vector): boolean {
    return (
        point[0] >= boundingBox.left - EPS.point &&
        point[0] <= boundingBox.right + EPS.point &&
        point[1] >= boundingBox.top - EPS.point &&
        point[1] <= boundingBox.bottom + EPS.point
    );
}

function boundingBoxArea({ top, right, bottom, left }: AABB): number {
    return (right - left) * (bottom - top);
}

function findContainingFace(
    component: DualGraphComponent,
    testedPoint: Vector,
): DualGraphVertex | null {
    // TODO: Intersection counting will fail if a curve touches the horizontal line but doesn't go through.
    for (const face of component.vertices) {
        if (face === component.outerFace) continue;
        if (!boundingBoxContainsPoint(getFaceBoundingBox(face), testedPoint)) {
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
                boundingBox,
            );
        }

        if (count % 2 === 1) return face;
    }
    return null;
}

function computeNestingTree(components: DualGraphComponent[]): NestingTree[] {
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
        const queryBox = boundingBoxAroundPoint(point, EPS.point);
        const candidateIds = componentTree.find(queryBox);
        let bestParent: ComponentInfo | null = null;
        let bestFace: DualGraphVertex | null = null;

        for (const candidateId of candidateIds) {
            if (candidateId === entry.index) continue;
            const candidate = info[candidateId];
            if (!boundingBoxContainsPoint(candidate.boundingBox, point)) {
                continue;
            }

            const face = findContainingFace(candidate.component, point);
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
                    if (edge.parents[i]) {
                        nextCounts[i] += edge.directionFlags[i] ? -1 : 1;
                    }
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

/*
 Runs the boolean-operation pipeline up to and including face flagging for a set
 of N input paths in the constructor, then selects faces per operation in `get`.
 The expensive geometric work happens once; multiple `get` calls reuse it.
*/
export class PathBoolean {
    private readonly nestingTrees: NestingTree[];
    private regions?: { faces: DualGraphVertex[]; paths: Path[] };

    constructor(inputs: PathBooleanInput[]) {
        const pathCount = inputs.length;

        const unsplitEdges = inputs.flatMap(({ path }, i) =>
            path.map(segmentToEdge(pathCount, i)),
        );

        splitAtSelfIntersections(unsplitEdges);

        const { edges: splitEdges, totalBoundingBox } =
            splitAtIntersections(unsplitEdges);

        if (!totalBoundingBox) {
            // input geometry is empty
            this.nestingTrees = [];
            return;
        }

        const majorGraph = findVertices(splitEdges, totalBoundingBox);
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

        const nestingTrees = computeNestingTree(dualGraphComponents);
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
                return dumpFaces(this.nestingTrees, predicate);
            default: {
                const selectedFaces = new Set(
                    getSelectedFaces(this.nestingTrees, predicate),
                );
                return [[...walkFaces(selectedFaces)]];
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
        return [...walkFaces(selected)];
    }

    private getRegions(): { faces: DualGraphVertex[]; paths: Path[] } {
        return (this.regions ??= enumerateFaces(this.nestingTrees, (face) =>
            face.flags.some(Boolean),
        ));
    }
}

export const __testOnly = {
    assertMajorGraphInvariants,
    assertMinorGraphInvariants,
    assertDualGraphInvariants,
};
