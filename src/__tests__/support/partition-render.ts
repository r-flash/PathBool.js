import * as cheerio from "cheerio";

// Partition order is not part of the API. Paint every fill before any stroke
// so a later region cannot erase an earlier region's antialiased boundary.
// The path-count assertion still uses the original, unlayered SVG.
export function partitionRender(code: string): string {
    const $ = cheerio.load(code, { xml: true });
    const paths = $("path");
    const first = paths.first();
    paths.each((_, path) => {
        $(path).clone().css("stroke", "none").insertBefore(first);
        $(path).css("fill", "none");
    });
    return $.xml();
}
