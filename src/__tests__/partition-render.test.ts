import { expect, test } from "@jest/globals";
import { Resvg } from "@resvg/resvg-js";

import { partitionRender } from "./support/partition-render";

test("partition rendering ignores path order but preserves internal boundaries", () => {
    const left = '<path d="M 1 1 H 10 V 19 H 1 Z"/>';
    const right = '<path d="M 10 1 H 19 V 19 H 10 Z"/>';
    const merged = '<path d="M 1 1 H 19 V 19 H 1 Z"/>';
    const render = (paths: string) =>
        new Resvg(
            partitionRender(
                `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" style="fill:red;stroke:black;stroke-width:1">${paths}</svg>`,
            ),
        ).render().pixels;
    expect(render(left + right)).toEqual(render(right + left));
    expect(render(left + right)).not.toEqual(render(merged));
});
