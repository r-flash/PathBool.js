import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

import {
    IDENTITY,
    transform,
    multiply,
    transformedData,
    decode,
    bounds,
    fixtureSvg,
    viewBox,
} from "./geometry.cjs";

export const EXTRACTION_VERSION = 1;
export const hash = (data) => createHash("sha256").update(data).digest("hex");
const declarations = (text) =>
    Object.fromEntries(
        (text ?? "")
            .split(";")
            .filter((s) => s.includes(":"))
            .map((s) => {
                const colon = s.indexOf(":");
                return [s.slice(0, colon).trim(), s.slice(colon + 1).trim()];
            }),
    );

function nestedViewport($el) {
    const length = (key, fallback) => {
        const value = $el.attr(key);
        if (value === undefined) return fallback;
        if (!/^[-+\d.eE]+(?:px)?$/.test(value))
            throw new Error(
                `Unsupported nested viewport length: ${key}=${value}`,
            );
        return Number(value.replace(/px$/, ""));
    };
    const x = length("x", 0),
        y = length("y", 0);
    if (!$el.attr("viewBox")) return [1, 0, 0, 1, x, y];
    const [vx, vy, w, h] = $el
        .attr("viewBox")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    const width = length("width", NaN),
        height = length("height", NaN);
    if (
        ![vx, vy, w, h, width, height].every(Number.isFinite) ||
        w <= 0 ||
        h <= 0 ||
        width <= 0 ||
        height <= 0
    )
        throw new Error("Unresolved nested viewport");
    const aspect = $el.attr("preserveAspectRatio") ?? "xMidYMid meet";
    if (aspect === "none")
        return [
            width / w,
            0,
            0,
            height / h,
            x - (vx * width) / w,
            y - (vy * height) / h,
        ];
    const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)(?:\s+(meet|slice))?$/.exec(
        aspect,
    );
    if (!match) throw new Error("Unsupported preserveAspectRatio");
    const scale = (match[3] === "slice" ? Math.max : Math.min)(
        width / w,
        height / h,
    );
    const align = { Min: 0, Mid: 0.5, Max: 1 };
    return [
        scale,
        0,
        0,
        scale,
        x - vx * scale + (width - w * scale) * align[match[1]],
        y - vy * scale + (height - h * scale) * align[match[2]],
    ];
}

export function features(d, fillRule) {
    const { segments, commands, open } = decode(d),
        box = bounds(d);
    const counts = { L: 0, Q: 0, C: 0, A: 0 };
    let collapsed = 0,
        shortEdges = 0,
        closedCurves = 0;
    const extent = Math.max(box[2] - box[0], box[3] - box[1]);
    for (const s of segments) {
        counts[s[0]]++;
        const points = s.slice(1).filter(Array.isArray),
            a = points[0],
            b = points.at(-1);
        if (points.every((p) => p[0] === a[0] && p[1] === a[1])) collapsed++;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < extent * 1e-6) shortEdges++;
        if (s[0] === "C" && a[0] === b[0] && a[1] === b[1]) closedCurves++;
    }
    return {
        segments: segments.length,
        commands: counts,
        subpaths: commands.filter((c) => c[0] === "M").length,
        open,
        collapsed,
        shortEdges,
        closedCurves,
        fillRule,
        extent,
        magnitude: Math.max(...box.map(Math.abs)),
        complexity:
            segments.length < 20
                ? "small"
                : segments.length < 200
                  ? "medium"
                  : "large",
    };
}

export function extract(svg) {
    if (/<!ENTITY|<script\b|<foreignObject\b/i.test(svg))
        throw new Error("Unsupported active content or entities");
    const $ = cheerio.load(svg, { xml: true }),
        paths = [],
        exclusions = [];
    if (!$("svg").length) throw new Error("Not an SVG document");
    const rules = [];
    for (const style of $("style").toArray()) {
        const text = $(style)
            .text()
            .replace(/\/\*[\s\S]*?\*\//g, "");
        if (/@|:/.test(text.replace(/\{[^}]*\}/g, "")))
            throw new Error("Unsupported dynamic stylesheet");
        for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            for (const selector of match[1].split(",")) {
                const s = selector.trim();
                rules.push({
                    selector: s,
                    values: declarations(match[2]),
                    specificity:
                        (s.match(/#/g) ?? []).length * 100 +
                        (s.match(/[.\[]/g) ?? []).length * 10 +
                        (s.match(/(?:^|[\s>+~])[a-zA-Z]/g) ?? []).length,
                });
            }
        }
    }
    rules.sort((a, b) => a.specificity - b.specificity);
    const ancestorCache = new WeakMap();
    $("path").each((index, element) => {
        const el = $(element),
            d = el.attr("d") ?? "",
            location = `path[${index}]`;
        try {
            const ancestors = [...el.parents().toArray().reverse(), element];
            let matrix = IDENTITY,
                fillRule = "nonzero",
                fill = "black",
                context = "painted",
                hidden = false;
            for (const ancestor of ancestors) {
                const a = $(ancestor),
                    tag = ancestor.name;
                if (!tag) continue;
                let cached = ancestorCache.get(ancestor);
                if (!cached) {
                    const style = {
                        ...Object.fromEntries(
                            [
                                "fill-rule",
                                "clip-rule",
                                "fill",
                                "display",
                                "visibility",
                            ]
                                .map((k) => [k, a.attr(k)])
                                .filter(([, v]) => v !== undefined),
                        ),
                    };
                    for (const r of rules)
                        if (a.is(r.selector)) Object.assign(style, r.values);
                    Object.assign(style, declarations(a.attr("style")));
                    cached = {
                        style,
                        animated:
                            a.children("animate,animateTransform,set").length >
                            0,
                    };
                    ancestorCache.set(ancestor, cached);
                }
                const { style } = cached;
                if (
                    Object.values(style).some((v) =>
                        /!important|var\(|calc\(/.test(v),
                    )
                )
                    throw new Error("Unsupported computed CSS value");
                if (style.transform)
                    throw new Error("CSS transforms require layout");
                if (style["fill-rule"] && style["fill-rule"] !== "inherit")
                    fillRule = style["fill-rule"];
                if (style.fill && style.fill !== "inherit") fill = style.fill;
                if (style.display === "none" || style.visibility === "hidden")
                    hidden = true;
                if (
                    [
                        "defs",
                        "clipPath",
                        "mask",
                        "symbol",
                        "pattern",
                        "marker",
                    ].includes(tag)
                )
                    context = tag;
                if (tag === "clipPath" && style["clip-rule"])
                    fillRule = style["clip-rule"];
                if (cached.animated)
                    throw new Error("Animated geometry or style");
                matrix = multiply(matrix, transform(a.attr("transform")));
                if (tag === "svg" && a.parents("svg").length)
                    matrix = multiply(matrix, nestedViewport(a));
            }
            if (!["nonzero", "evenodd"].includes(fillRule))
                throw new Error(`Unsupported fill rule: ${fillRule}`);
            const f = features(d, fillRule);
            const singular =
                matrix[0] * matrix[3] - matrix[1] * matrix[2] === 0;
            const local = singular;
            const data = local ? d : transformedData(d, matrix);
            if (
                !matrix.every(Number.isFinite) ||
                !bounds(data).every(Number.isFinite)
            )
                throw new Error("Non-finite transformed geometry");
            paths.push({
                location,
                elementId: el.attr("id") ?? null,
                d,
                dHash: hash(d),
                data,
                matrix: local ? IDENTITY : matrix,
                sourceMatrix: matrix,
                local,
                fillRule,
                features: f,
                box: bounds(data),
                context: hidden
                    ? "hidden"
                    : fill === "none"
                      ? "stroke-only"
                      : context,
                ...(local
                    ? {
                          note: "Singular transform retained in local coordinates; excluded from placed pairs.",
                      }
                    : {}),
            });
        } catch (error) {
            exclusions.push({ location, reason: error.message });
        }
    });
    for (const tag of [
        "use",
        "text",
        "image",
        "rect",
        "circle",
        "ellipse",
        "polygon",
        "polyline",
        "line",
    ]) {
        const count = $(tag).length;
        if (count)
            exclusions.push({
                kind: tag,
                count,
                reason: "Only existing path elements are extracted; no reference expansion or shape conversion.",
            });
    }
    return { paths, exclusions };
}

export function selectPairs(paths, limit = 8) {
    const ordered = [...paths].sort(
        (a, b) =>
            b.features.collapsed +
                b.features.closedCurves -
                (a.features.collapsed + a.features.closedCurves) ||
            a.features.segments - b.features.segments ||
            a.location.localeCompare(b.location),
    );
    const candidates = [],
        seen = new Set();
    const add = (a, b, relationship) => {
        const key = `${a.location}:${b?.location ?? "empty"}`;
        if (!seen.has(key)) {
            candidates.push({ a, b, relationship });
            seen.add(key);
        }
    };
    // Spatial index by min-X; bound pair discovery, never truncate an operand.
    const placed = paths
        .filter((p) => !p.local && p.context === "painted")
        .sort((a, b) => a.box[0] - b.box[0]);
    for (let i = 0; i < placed.length && candidates.length < limit * 4; i++) {
        const a = placed[i];
        for (let j = i + 1; j < placed.length && j < i + 64; j++) {
            const b = placed[j];
            if (b.box[0] > a.box[2]) {
                add(a, b, "disjoint");
                break;
            }
            if (a.box[1] <= b.box[3] && b.box[1] <= a.box[3])
                add(a, b, "overlapping-bounds");
            if (candidates.length >= limit * 4) break;
        }
    }
    const selected = candidates
        .filter((c) => c.relationship !== "disjoint")
        .slice(0, Math.max(0, limit - 3));
    const disjoint = candidates.find((c) => c.relationship === "disjoint");
    if (disjoint) selected.push(disjoint);
    for (const a of ordered) {
        if (selected.length >= limit) break;
        selected.push({ a, b: null, relationship: "empty-counterpart" });
        if (selected.length < limit)
            selected.push({ a, b: a, relationship: "self-identity" });
    }
    return selected;
}

export function materializePair(pair) {
    const empty = { d: "", data: "", fillRule: "nonzero", matrix: IDENTITY };
    const operands = [pair.a, pair.b ?? empty];
    const inputs = operands.map((p) => ({ d: p.data, fillRule: p.fillRule }));
    const vb = viewBox(inputs.map((p) => p.d));
    return {
        original: fixtureSvg(inputs, vb),
        oracle: fixtureSvg(operands, vb),
        metadata: {
            relationship: pair.relationship,
            operands: operands.map((p) => ({
                location: p.location ?? null,
                dHash: p.dHash ?? hash(""),
                fillRule: p.fillRule,
                matrix: p.matrix,
                context: p.context ?? "empty",
            })),
            ...(operands.some((p) => p.features?.open)
                ? {
                      structuralOnly:
                          "Original open subpath retained without implicit closure; filled-region contract is not established.",
                  }
                : {}),
        },
    };
}
