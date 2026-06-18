/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

export { PathBooleanOperation, FillRule, PathBoolean } from "./path-boolean";
export type { PathBooleanInput } from "./path-boolean";

export {
    arcSegmentToCubics,
    pathSegmentBoundingBox,
    samplePathSegmentAt,
} from "./primitives/PathSegment";

export { pathSegmentIntersection } from "./intersections/path-segment";

export { pathCubicSegmentSelfIntersection } from "./intersections/path-cubic-segment-self-intersection";

export {
    pathToPathData,
    pathFromPathData,
    commandsFromPathData,
} from "./path-data";

export { pathFromCommands, pathToCommands } from "./primitives/Path";
export type { Path } from "./primitives/Path";
