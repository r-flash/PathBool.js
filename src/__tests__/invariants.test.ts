/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { expect, test } from "@jest/globals";

import { AssertionError } from "../assert";
import { __testOnly } from "../path-boolean";
import { pathSegmentBoundingBox } from "../primitives/PathSegment";

const { assertMajorGraphInvariants } = __testOnly;

const createValidGraph = () => {
    const v0: any = { point: [0, 0], outgoingEdges: [] };
    const v1: any = { point: [1, 0], outgoingEdges: [] };
    const seg: any = ["L", [0, 0], [1, 0]];
    const segTwin: any = ["L", [1, 0], [0, 0]];

    const edge: any = {
        seg,
        parent: 1,
        boundingBox: pathSegmentBoundingBox(seg),
        incidentVertices: [v0, v1],
        directionFlag: false,
        directionFlagA: false,
        directionFlagB: false,
        twin: null,
    };
    const twin: any = {
        seg: segTwin,
        parent: 1,
        boundingBox: pathSegmentBoundingBox(segTwin),
        incidentVertices: [v1, v0],
        directionFlag: false,
        directionFlagA: false,
        directionFlagB: false,
        twin: edge,
    };

    edge.twin = twin;
    v0.outgoingEdges.push(edge);
    v1.outgoingEdges.push(twin);

    return { graph: { edges: [edge, twin], vertices: [v0, v1] }, edge, twin, v0, v1 };
};

test("dev invariants catch broken twin structure", () => {
    const v0: any = { point: [0, 0], outgoingEdges: [] };
    const v1: any = { point: [1, 0], outgoingEdges: [] };
    const seg: any = ["L", [0, 0], [1, 0]];
    const edge: any = {
        seg,
        parent: 1,
        boundingBox: pathSegmentBoundingBox(seg),
        incidentVertices: [v0, v1],
        directionFlag: false,
        directionFlagA: false,
        directionFlagB: false,
        twin: null,
    };

    v0.outgoingEdges.push(edge);
    v1.outgoingEdges.push(edge);

    const graph: any = { edges: [edge], vertices: [v0, v1] };

    expect(() => assertMajorGraphInvariants(graph)).toThrow(AssertionError);
});

test("dev invariants catch vertex without outgoing edges", () => {
    const { graph, v0 } = createValidGraph();
    v0.outgoingEdges = [];

    expect(() => assertMajorGraphInvariants(graph)).toThrow(AssertionError);
});

test("dev invariants catch edge without twin", () => {
    const { graph, edge } = createValidGraph();
    edge.twin = null;

    expect(() => assertMajorGraphInvariants(graph)).toThrow(AssertionError);
});

test("dev invariants catch non-reciprocal twin", () => {
    const { graph, edge, twin } = createValidGraph();
    twin.twin = null;

    expect(() => assertMajorGraphInvariants(graph)).toThrow(AssertionError);
});

test("dev invariants catch edge missing from outgoing edges", () => {
    const { graph, v0, twin } = createValidGraph();
    v0.outgoingEdges = [twin];

    expect(() => assertMajorGraphInvariants(graph)).toThrow(AssertionError);
});

test("dev invariants catch twin missing from outgoing edges", () => {
    const { graph, v1 } = createValidGraph();
    v1.outgoingEdges = [];

    expect(() => assertMajorGraphInvariants(graph)).toThrow(AssertionError);
});
