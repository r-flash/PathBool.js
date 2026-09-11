// Types for the independent SVG decoder, separate from the library's model.
// Arc flags here are numeric SVG flags, not the library's boolean flags.
export type Point = [x: number, y: number];
export type Matrix = [
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
];
export type ArcFlag = 0 | 1;

export type Segment =
    | ["L", Point, Point]
    | ["C", Point, Point, Point, Point]
    | ["Q", Point, Point, Point]
    | ["A", Point, number, number, number, ArcFlag, ArcFlag, Point];

// Commands are absolute, with H/V/S/T expanded, and retain M/Z boundaries.
export type Command =
    | ["M", Point]
    | ["L", Point]
    | ["C", Point, Point, Point]
    | ["Q", Point, Point]
    | ["A", number, number, number, ArcFlag, ArcFlag, Point]
    | ["Z"];

export interface DecodedPath {
    commands: Command[];
    segments: Segment[];
    open: boolean;
}

export interface FixtureInput {
    d: string;
    matrix?: Matrix;
    fillRule?: "nonzero" | "evenodd";
}

export const IDENTITY: Matrix;
export function point(matrix: Matrix, point: Point): Point;
export function multiply(a: Matrix, b: Matrix): Matrix;
export function transform(text?: string): Matrix;
export function decode(d: string): DecodedPath;
export function transformedData(d: string, matrix: Matrix): string;
export function bounds(
    d: string,
): [minX: number, minY: number, maxX: number, maxY: number];
export function viewBox(paths: string[]): string;
export function escapeXml(value: unknown): string;
export function fixtureSvg(inputs: FixtureInput[], viewBox?: string): string;
export function translatedData(
    d: string,
    dx: number,
    dy: number,
    scale?: number,
): string;
export function correctRadii(d: string): string;
