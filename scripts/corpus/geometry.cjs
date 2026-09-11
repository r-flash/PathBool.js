// Independent SVG decoding for fixture extraction; never sanitizes geometry.
const IDENTITY = [1, 0, 0, 1, 0, 0];
const point = (m, [x, y]) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
];
const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
];
const number = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y;

function transform(text = "") {
    let matrix = [...IDENTITY];
    let consumed = "";
    for (const match of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
        if (text.slice(consumed.length, match.index).trim().replace(/,/g, ""))
            throw new Error("Unsupported transform");
        consumed = text.slice(0, match.index + match[0].length);
        const values = match[2]
            .trim()
            .split(/[\s,]+/)
            .map(Number);
        if (!values.every(Number.isFinite))
            throw new Error("Non-finite transform");
        const [a, b = 0, c = 0] = values;
        let next;
        switch (match[1]) {
            case "matrix":
                if (values.length === 6) next = values;
                break;
            case "translate":
                if (values.length <= 2) next = [1, 0, 0, 1, a, b];
                break;
            case "scale":
                if (values.length <= 2) next = [a, 0, 0, values[1] ?? a, 0, 0];
                break;
            case "rotate": {
                if (![1, 3].includes(values.length)) break;
                const t = (a * Math.PI) / 180,
                    co = Math.cos(t),
                    si = Math.sin(t);
                next = multiply(
                    multiply([1, 0, 0, 1, b, c], [co, si, -si, co, 0, 0]),
                    [1, 0, 0, 1, -b, -c],
                );
                break;
            }
            case "skewX":
                if (values.length === 1)
                    next = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
                break;
            case "skewY":
                if (values.length === 1)
                    next = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
                break;
        }
        if (!next) throw new Error(`Unsupported transform: ${match[0]}`);
        matrix = multiply(matrix, next);
    }
    if (text.slice(consumed.length).trim())
        throw new Error("Unsupported transform");
    return matrix;
}

/** Keeps M and Z (including duplicates), implicit closure status and all segments. */
function decode(d) {
    let i = 0,
        command,
        current = [0, 0],
        start = [0, 0],
        previous = "",
        control = null;
    const commands = [],
        segments = [];
    const skip = () => {
        while (i < d.length && /[\s,]/.test(d[i])) i++;
    };
    const read = (flag = false) => {
        skip();
        if (flag) {
            if (!/[01]/.test(d[i] ?? "x"))
                throw new Error(`Invalid arc flag at ${i}`);
            return Number(d[i++]);
        }
        number.lastIndex = i;
        const m = number.exec(d);
        if (!m || !Number.isFinite(Number(m[0])))
            throw new Error(`Invalid coordinate at ${i}`);
        i = number.lastIndex;
        return Number(m[0]);
    };
    const arities = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
    while (true) {
        skip();
        if (i === d.length) break;
        if (/[a-zA-Z]/.test(d[i])) command = d[i++];
        else if (!command || command.toUpperCase() === "Z")
            throw new Error(`Missing command at ${i}`);
        const upper = command.toUpperCase(),
            relative = upper !== command;
        if (!commands.length && upper !== "M")
            throw new Error("Path must begin with moveto");
        if (upper === "Z") {
            segments.push(["L", current, start]);
            commands.push(["Z"]);
            current = start;
            control = null;
            previous = upper;
            command = null;
            continue;
        }
        if (!arities[upper]) throw new Error(`Unknown command ${command}`);
        const v = Array.from({ length: arities[upper] }, (_, n) =>
            read(upper === "A" && (n === 3 || n === 4)),
        );
        const at = (n) => [
            v[n] + (relative ? current[0] : 0),
            v[n + 1] + (relative ? current[1] : 0),
        ];
        let seg, end;
        const reflected = (types) =>
            types.includes(previous) && control
                ? [2 * current[0] - control[0], 2 * current[1] - control[1]]
                : current;
        switch (upper) {
            case "M":
                current = start = at(0);
                commands.push(["M", current]);
                control = null;
                command = relative ? "l" : "L";
                break;
            case "L":
                end = at(0);
                seg = ["L", current, end];
                break;
            case "H":
                end = [v[0] + (relative ? current[0] : 0), current[1]];
                seg = ["L", current, end];
                break;
            case "V":
                end = [current[0], v[0] + (relative ? current[1] : 0)];
                seg = ["L", current, end];
                break;
            case "C":
                end = at(4);
                seg = ["C", current, at(0), at(2), end];
                break;
            case "S":
                end = at(2);
                seg = ["C", current, reflected(["C", "S"]), at(0), end];
                break;
            case "Q":
                end = at(2);
                seg = ["Q", current, at(0), end];
                break;
            case "T":
                end = at(0);
                seg = ["Q", current, reflected(["Q", "T"]), end];
                break;
            case "A":
                end = at(5);
                seg = ["A", current, ...v.slice(0, 5), end];
                break;
        }
        if (seg) {
            segments.push(seg);
            commands.push([seg[0], ...seg.slice(2)]);
            current = end;
            control = seg[0] === "C" ? seg[3] : seg[0] === "Q" ? seg[2] : null;
        }
        previous = upper;
    }
    let open = false,
        first = null,
        last = null;
    for (const c of commands) {
        if (c[0] === "M") {
            if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
                open = true;
            first = last = c[1];
        } else if (c[0] === "Z") last = first;
        else last = c.at(-1);
    }
    if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
        open = true;
    return { commands, segments, open };
}

// Transform the ellipse basis, diagonalize B B^T, and keep the original arc
// selection. Radius correction commutes with an invertible affine transform.
function arcFrame(rx, ry, rotation, m) {
    const t = (rotation * Math.PI) / 180,
        c = Math.cos(t),
        s = Math.sin(t);
    const u = [(m[0] * c + m[2] * s) * rx, (m[1] * c + m[3] * s) * rx];
    const v = [(-m[0] * s + m[2] * c) * ry, (-m[1] * s + m[3] * c) * ry];
    const scale = Math.max(...u.map(Math.abs), ...v.map(Math.abs));
    if (!scale) return [0, 0, 0];
    const [ux, uy] = u.map((x) => x / scale),
        [vx, vy] = v.map((x) => x / scale);
    const xx = ux * ux + vx * vx,
        yy = uy * uy + vy * vy,
        xy = ux * uy + vx * vy;
    const hi = (xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2;
    const lo = (ux * vy - uy * vx) ** 2 / hi;
    return [
        Math.sqrt(hi) * scale,
        Math.sqrt(lo) * scale,
        (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI,
    ];
}

function transformedData(d, m) {
    if (m.every((v, i) => v === IDENTITY[i])) return d;
    if (m[0] * m[3] - m[1] * m[2] === 0)
        throw new Error("Singular transform: local-coordinate case only");
    const { commands } = decode(d);
    return commands
        .map((c) => {
            if (c[0] === "Z") return "Z";
            if (c[0] === "A") {
                const [rx, ry, rot] = arcFrame(c[1], c[2], c[3], m);
                const sweep = m[0] * m[3] - m[1] * m[2] < 0 ? 1 - c[5] : c[5];
                return `A ${rx} ${ry} ${rot} ${c[4]} ${sweep} ${point(m, c[6]).join(" ")}`;
            }
            return `${c[0]} ${c
                .slice(1)
                .map((p) => point(m, p).join(" "))
                .join(" ")}`;
        })
        .join(" ");
}

function bounds(d) {
    const { segments, commands } = decode(d);
    const points = commands.filter((c) => c[0] === "M").map((c) => c[1]);
    for (const s of segments) {
        points.push(...s.slice(1).filter(Array.isArray));
        if (s[0] === "A") {
            // Conservative arc bound, including SVG radius correction. Used for
            // sampling/viewports, never as the boolean oracle.
            const a = s[1],
                b = s[7],
                rx = Math.abs(s[2]),
                ry = Math.abs(s[3]);
            if (rx && ry) {
                const t = (s[4] * Math.PI) / 180,
                    dx = (a[0] - b[0]) / 2,
                    dy = (a[1] - b[1]) / 2;
                const k = Math.max(
                    1,
                    Math.hypot(
                        (Math.cos(t) * dx + Math.sin(t) * dy) / rx,
                        (-Math.sin(t) * dx + Math.cos(t) * dy) / ry,
                    ),
                );
                const r = Math.max(rx, ry) * k * 2;
                points.push([a[0] - r, a[1] - r], [a[0] + r, a[1] + r]);
            }
        }
    }
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of points)
        box = [
            Math.min(box[0], x),
            Math.min(box[1], y),
            Math.max(box[2], x),
            Math.max(box[3], y),
        ];
    return points.length ? box : [0, 0, 0, 0];
}
function viewBox(ds) {
    const bs = ds.map(bounds),
        lo = [
            Math.min(...bs.map((b) => b[0])),
            Math.min(...bs.map((b) => b[1])),
        ];
    const hi = [
        Math.max(...bs.map((b) => b[2])),
        Math.max(...bs.map((b) => b[3])),
    ];
    const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-12) * 1.08;
    return [
        (lo[0] + hi[0] - extent) / 2,
        (lo[1] + hi[1] - extent) / 2,
        extent,
        extent,
    ].join(" ");
}
const escapeXml = (s) =>
    String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
function fixtureSvg(inputs, vb = viewBox(inputs.map((i) => i.d))) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${vb}">\n${inputs.map((p, i) => `<path id="${i === 0 ? "a" : "b"}" d="${escapeXml(p.d)}" transform="matrix(${(p.matrix ?? IDENTITY).join(" ")})" style="fill:#ff0000;fill-rule:${p.fillRule ?? "nonzero"}"/>`).join("\n")}\n</svg>\n`;
}

// Translation alone leaves arc frames and flags untouched. Used to compensate
// for resvg's float32 coordinate storage at large offsets, independently of the
// library parser and of the affine arc conversion under test.
function translatedData(d, dx, dy, scale = 1) {
    return decode(d)
        .commands.map((c) => {
            if (c[0] === "Z") return "Z";
            const at = (p) => `${(p[0] + dx) * scale} ${(p[1] + dy) * scale}`;
            if (c[0] === "A")
                return `A ${c[1] * scale} ${c[2] * scale} ${c.slice(3, 6).join(" ")} ${at(c[6])}`;
            return `${c[0]} ${c.slice(1).map(at).join(" ")}`;
        })
        .join(" ");
}

exports.IDENTITY = IDENTITY;
exports.point = point;
exports.multiply = multiply;
exports.transform = transform;
exports.decode = decode;
exports.transformedData = transformedData;
exports.bounds = bounds;
exports.viewBox = viewBox;
exports.escapeXml = escapeXml;
exports.fixtureSvg = fixtureSvg;
exports.translatedData = translatedData;

// SVG's mandatory radius correction, performed before resvg can classify very
// small positive radii as zero. This is only used by the reference renderer;
// the original corpus input and the input handed to the library stay untouched.
function correctRadii(d) {
    const { commands, segments } = decode(d);
    let index = 0,
        changed = false;
    for (const command of commands) {
        if (command[0] === "M") continue;
        const segment = segments[index++];
        if (command[0] !== "A" || !command[1] || !command[2]) continue;
        const rx = Math.abs(command[1]),
            ry = Math.abs(command[2]),
            angle = (command[3] * Math.PI) / 180;
        const dx = (segment[1][0] - segment[7][0]) / 2,
            dy = (segment[1][1] - segment[7][1]) / 2;
        const correction = Math.hypot(
            (Math.cos(angle) * dx + Math.sin(angle) * dy) / rx,
            (-Math.sin(angle) * dx + Math.cos(angle) * dy) / ry,
        );
        if (correction > 1) {
            command[1] = rx * correction;
            command[2] = ry * correction;
            changed = true;
        }
    }
    if (!changed) return d;
    return commands
        .map((c) =>
            c.map((v) => (Array.isArray(v) ? v.join(" ") : v)).join(" "),
        )
        .join(" ");
}
exports.correctRadii = correctRadii;
