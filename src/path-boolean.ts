/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { Epsilons } from "./Epsilons";
import { QuadTree } from "./QuadTree";
import {
    assertCondition,
    assertDefined,
    assertEqual,
    assertUnreachable,
} from "./assert";
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
    pathSegmentBoundingBox,
    reversePathSegment,
    samplePathSegmentAt,
    splitCubicSegmentAt,
    splitSegmentAt,
} from "./primitives/PathSegment";
import { Vector, vectorsEqual } from "./primitives/Vector";
import { countIf, hasOwn, memoizeWeak } from "./util/generic";
import { map } from "./util/iterators";
import { linMap } from "./util/math";

const INTERSECTION_TREE_DEPTH = 8;
const POINT_TREE_DEPTH = 8;

const EPS: Epsilons = {
    point: 1e-6,
    linear: 1e-4,
    param: 1e-8,
};

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
    parent: number;
};

type MajorGraphEdgeStage2 = MajorGraphEdgeStage1 & {
    boundingBox: AABB;
};

type MajorGraphEdge = MajorGraphEdgeStage2 & {
    incidentVertices: [MajorGraphVertex, MajorGraphVertex];
    directionFlag: boolean;
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
    parent: number;
    incidentVertices: [MinorGraphVertex, MinorGraphVertex];
    directionFlag: boolean;
    twin: MinorGraphEdge | null;
};

type MinorGraphVertex = {
    outgoingEdges: MinorGraphEdge[];
};

type MinorGraphCycle = {
    segments: PathSegment[];
    parent: number;
    directionFlag: boolean;
};

type MinorGraph = {
    edges: MinorGraphEdge[];
    vertices: MinorGraphVertex[];
    cycles: MinorGraphCycle[];
};

type DualGraphHalfEdge = {
    segments: PathSegment[];
    parent: number;
    incidentVertex: DualGraphVertex;
    directionFlag: boolean;
    twin: DualGraphHalfEdge | null;
};

type DualGraphVertex = {
    incidentEdges: DualGraphHalfEdge[];
    flag: number;
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

function firstElementOfSet<T>(set: Set<T>): T {
    return set.values().next().value;
}

function createObjectCounter(): (obj: Object) => number {
    let i = 0;
    return memoizeWeak(() => i++);
}

function segmentToEdge(
    parent: 1 | 2,
): (seg: PathSegment) => MajorGraphEdgeStage1 {
    return (seg) => ({ seg, parent });
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
                parent: edge.parent,
            };
            edges.push({
                seg: seg2,
                parent: edge.parent,
            });
        } else {
            const [seg1, tmpSeg] = splitCubicSegmentAt(edge.seg, t1);
            const [seg2, seg3] = splitCubicSegmentAt(
                tmpSeg,
                (t2 - t1) / (1 - t1),
            );
            edges[i] = {
                seg: seg1,
                parent: edge.parent,
            };
            edges.push(
                {
                    seg: seg2,
                    parent: edge.parent,
                },
                {
                    seg: seg3,
                    parent: edge.parent,
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

    for (let i = 0; i < withBoundingBox.length; i++) {
        const edge = withBoundingBox[i];
        const candidates = edgeTree.find(edge.boundingBox);
        for (const j of candidates) {
            const candidate = edges[j];
            const includeEndpoints =
                edge.parent !== candidate.parent ||
                !(
                    // TODO: this is not correct
                    (
                        vectorsEqual(
                            getEndPoint(candidate.seg),
                            getStartPoint(edge.seg),
                            EPS.point,
                        ) ||
                        vectorsEqual(
                            getStartPoint(candidate.seg),
                            getEndPoint(edge.seg),
                            EPS.point,
                        )
                    )
                );
            const intersection = pathSegmentIntersection(
                edge.seg,
                candidate.seg,
                includeEndpoints,
                EPS,
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
        splits.sort();
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
    const vertexPairIdToEdges: Record<
        string,
        [MajorGraphEdgeStage2, MajorGraphEdge, MajorGraphEdge][]
    > = {};

    const newEdges = edges.flatMap((edge) => {
        const startVertex = getVertex(getStartPoint(edge.seg));
        const endVertex = getVertex(getEndPoint(edge.seg));

        // discard zero-length segments
        if (startVertex === endVertex) {
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
                    if (edge.seg[5] === false) {
                        return [];
                    }
                    break;
            }
        }

        const vertexPairId = `${getVertexId(startVertex)}:${getVertexId(endVertex)}`;
        // TODO: check other direction
        if (hasOwn(vertexPairIdToEdges, vertexPairId)) {
            const existingEdge = vertexPairIdToEdges[vertexPairId].find(
                (other) => segmentsEqual(other[0].seg, edge.seg, EPS.point),
            );
            if (existingEdge) {
                existingEdge[1].parent |= edge.parent;
                existingEdge[2].parent |= edge.parent;
                return [];
            }
        }

        const fwdEdge: MajorGraphEdge = {
            ...edge,
            incidentVertices: [startVertex, endVertex],
            directionFlag: false,
            twin: null,
        };

        const bwdEdge: MajorGraphEdge = {
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
        } else {
            vertexPairIdToEdges[vertexPairId] = [[edge, fwdEdge, bwdEdge]];
        }

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

    const toMinorVertex = memoizeWeak((_majorVertex: MajorGraphVertex) => {
        const minorVertex: MinorGraphVertex = { outgoingEdges: [] };
        newVertices.push(minorVertex);
        return minorVertex;
    }) as (majorVertex: MajorGraphVertex) => MinorGraphVertex;

    const getEdgeId = createObjectCounter();
    const idToEdge: Record<string, MinorGraphEdge> = {};
    const visited = new WeakSet<MajorGraphVertex>();

    // first handle components that are not cycles
    for (const vertex of vertices) {
        if (getOrder(vertex) === 2) continue;

        const startVertex = toMinorVertex(vertex);

        for (const startEdge of vertex.outgoingEdges) {
            const segments: PathSegment[] = [];
            let edge = startEdge;
            while (
                edge.parent === startEdge.parent &&
                edge.directionFlag === startEdge.directionFlag &&
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
            const edgeId = `${getEdgeId(startEdge)}-${getEdgeId(edge)}`;
            const twinId = `${getEdgeId(edge.twin)}-${getEdgeId(startEdge.twin)}`;
            const twin = idToEdge[twinId] ?? null;
            const newEdge: MinorGraphEdge = {
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
    const cycles: MinorGraphCycle[] = [];
    for (const vertex of vertices) {
        if (getOrder(vertex) !== 2 || visited.has(vertex)) continue;
        let edge = vertex.outgoingEdges[0];
        const cycle: MinorGraphCycle = {
            segments: [],
            parent: edge.parent,
            directionFlag: edge.directionFlag,
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

function removeDanglingEdges(graph: MinorGraph) {
    function walk(parent: 1 | 2) {
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
                if (edge.parent & parent && edge !== incomingEdge) {
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
            if (edge.parent & parent) {
                visit(edge.incidentVertices[0], null, 0);
            }
        }

        return keptVertices;
    }

    const keptVerticesA = walk(1);
    const keptVerticesB = walk(2);

    function keepVertex(vertex: MinorGraphVertex): boolean {
        return keptVerticesA.has(vertex) || keptVerticesB.has(vertex);
    }

    function keepEdge(edge: MinorGraphEdge): boolean {
        return (
            ((edge.parent & 1) === 1 &&
                keptVerticesA.has(edge.incidentVertices[0]) &&
                keptVerticesA.has(edge.incidentVertices[1])) ||
            ((edge.parent & 2) === 2 &&
                keptVerticesB.has(edge.incidentVertices[0]) &&
                keptVerticesB.has(edge.incidentVertices[1]))
        );
    }

    graph.vertices = graph.vertices.filter(keepVertex);

    for (const vertex of graph.vertices) {
        vertex.outgoingEdges = vertex.outgoingEdges.filter(keepEdge);
    }

    graph.edges = graph.edges.filter(keepEdge);
}

function getIncidenceAngle({ directionFlag, segments }: MinorGraphEdge) {
    let p0: Vector;
    let p1: Vector;

    const seg = segments[0]; // TODO: explain in comment why this is always the incident one in both fwd and bwd

    if (!directionFlag) {
        p0 = samplePathSegmentAt(seg, 0);
        p1 = samplePathSegmentAt(seg, EPS.param);
    } else {
        p0 = samplePathSegmentAt(seg, 1);
        p1 = samplePathSegmentAt(seg, 1 - EPS.param);
    }

    return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
}

function sortOutgoingEdgesByAngle({ vertices }: MinorGraph) {
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

function getNextEdge(edge: MinorGraphEdge) {
    const { outgoingEdges } = edge.incidentVertices[1];
    const index = outgoingEdges.findIndex((other) => other.twin === edge);
    return outgoingEdges[(index + 1) % outgoingEdges.length];
}

const faceToPolygon = memoizeWeak((face: DualGraphVertex) =>
    face.incidentEdges.flatMap((edge): Vector[] => {
        const CNT = 64;

        const points: Vector[] = [];

        for (const seg of edge.segments) {
            for (let i = 0; i < CNT; i++) {
                const t0 = i / CNT;
                const t = edge.directionFlag ? 1 - t0 : t0;
                points.push(samplePathSegmentAt(seg, t));
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

function computeWinding(face: DualGraphVertex) {
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
}

function computeDual({ edges, cycles }: MinorGraph): DualGraphComponent[] {
    const newVertices: DualGraphVertex[] = [];

    const minorToDualEdge = new WeakMap<MinorGraphEdge, DualGraphHalfEdge>();
    for (const startEdge of edges) {
        if (minorToDualEdge.has(startEdge)) continue;
        const face: DualGraphVertex = {
            incidentEdges: [],
            flag: 0,
        };
        let edge = startEdge;
        do {
            assertDefined(edge.twin, "Edge doesn't have a twin");
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
        const innerFace: DualGraphVertex = {
            incidentEdges: [],
            flag: 0,
        };

        const innerHalfEdge: DualGraphHalfEdge = {
            segments: cycle.segments,
            parent: cycle.parent,
            incidentVertex: innerFace,
            directionFlag: cycle.directionFlag,
            twin: null,
        };

        const outerFace: DualGraphVertex = {
            incidentEdges: [],
            flag: 0,
        };

        const outerHalfEdge: DualGraphHalfEdge = {
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
): number {
    type IntersectionSegment = { boundingBox: AABB; seg: PathSegment };
    const totalBoundingBox = pathSegmentBoundingBox(origSeg);
    if (!boundingBoxIntersectsHorizontalRay(totalBoundingBox, point)) return 0;
    let segments: IntersectionSegment[] = [
        { boundingBox: totalBoundingBox, seg: origSeg },
    ];
    let count = 0;
    while (segments.length > 0) {
        const nextSegments: IntersectionSegment[] = [];
        for (const { boundingBox, seg } of segments) {
            if (boundingBoxMaxExtent(boundingBox) < EPS.linear) {
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

function testInclusion(a: DualGraphComponent, b: DualGraphComponent) {
    // TODO: Intersection counting will fail if a curve touches the horizontal line but doesn't go through.
    const testedPoint = getStartPoint(a.edges[0].segments[0]);
    for (const face of b.vertices) {
        if (face === b.outerFace) continue;
        let count = 0;
        for (const edge of face.incidentEdges) {
            for (const seg of edge.segments) {
                count += pathSegmentHorizontalRayIntersectionCount(
                    seg,
                    testedPoint,
                );
            }
        }

        if (count % 2 === 1) return face;
    }
    return null;
}

function computeNestingTree(components: DualGraphComponent[]): NestingTree[] {
    let nestingTrees: NestingTree[] = [];

    function insert(trees: NestingTree[], component: DualGraphComponent) {
        let found = false;
        for (const tree of trees) {
            const face = testInclusion(component, tree.component);
            if (face) {
                if (tree.outgoingEdges.has(face)) {
                    const children = tree.outgoingEdges.get(face)!;
                    tree.outgoingEdges.set(face, insert(children, component));
                } else {
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
        } else {
            const newTree: NestingTree = {
                component,
                outgoingEdges: new Map(),
            };
            const newTrees: NestingTree[] = [newTree];
            for (const tree of trees) {
                const face = testInclusion(tree.component, component);
                if (face) {
                    if (newTree.outgoingEdges.has(face)) {
                        newTree.outgoingEdges.get(face)!.push(tree);
                    } else {
                        newTree.outgoingEdges.set(face, [tree]);
                    }
                } else {
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

function getFlag(count: number, fillRule: FillRule) {
    switch (fillRule) {
        case FillRule.NonZero:
            return count === 0 ? 0 : 1;
        case FillRule.EvenOdd:
            return count % 2 === 0 ? 0 : 1;
    }
}

function flagFaces(
    nestingTrees: NestingTree[],
    aFillRule: FillRule,
    bFillRule: FillRule,
) {
    function visitTree(
        tree: NestingTree,
        aRunningCount: number,
        bRunningCount: number,
    ) {
        const visitedFaces = new WeakSet<DualGraphVertex>();

        function visitFace(
            face: DualGraphVertex,
            aRunningCount: number,
            bRunningCount: number,
        ) {
            if (visitedFaces.has(face)) return;
            visitedFaces.add(face);
            const aFlag = getFlag(aRunningCount, aFillRule);
            const bFlag = getFlag(bRunningCount, bFillRule);
            face.flag = aFlag | (bFlag << 1);
            for (const edge of face.incidentEdges) {
                const twin = edge.twin;
                assertDefined(twin, "Edge doesn't have a twin.");
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
                const subtrees = tree.outgoingEdges.get(face)!;
                for (const subtree of subtrees) {
                    visitTree(subtree, aRunningCount, bRunningCount);
                }
            }
        }

        assertDefined(
            tree.component.outerFace,
            "Component doesn't have an outer face.",
        );

        visitFace(tree.component.outerFace, aRunningCount, bRunningCount);
    }

    for (const tree of nestingTrees) {
        visitTree(tree, 0, 0);
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

function dumpFaces(
    nestingTrees: NestingTree[],
    predicate: (face: DualGraphVertex) => boolean,
): Path[] {
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

const operationPredicates: Record<
    PathBooleanOperation,
    (face: DualGraphVertex) => boolean
> = {
    [PathBooleanOperation.Union]: ({ flag }) => flag > 0,
    [PathBooleanOperation.Difference]: ({ flag }) => flag === 1,
    [PathBooleanOperation.Intersection]: ({ flag }) => flag === 3,
    [PathBooleanOperation.Exclusion]: ({ flag }) => flag === 1 || flag === 2,
    [PathBooleanOperation.Division]: ({ flag }) => (flag & 1) === 1,
    [PathBooleanOperation.Fracture]: ({ flag }) => flag > 0,
};

export function pathBoolean(
    a: Path,
    aFillRule: FillRule,
    b: Path,
    bFillRule: FillRule,
    op: PathBooleanOperation,
): Path[] {
    const unsplitEdges = [
        ...map(a, segmentToEdge(1)),
        ...map(b, segmentToEdge(2)),
    ];

    splitAtSelfIntersections(unsplitEdges);

    const { edges: splitEdges, totalBoundingBox } =
        splitAtIntersections(unsplitEdges);

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
            const selectedFaces = new Set(
                getSelectedFaces(nestingTrees, predicate),
            );
            return [[...walkFaces(selectedFaces)]];
        }
    }
}
