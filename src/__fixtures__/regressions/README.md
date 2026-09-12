Hand-maintained reductions; do not regenerate from the corpus generator.

- `near-coincident-cubics.json`: reduced from artwork `commons-12175526/00`.
  Two cubic boundaries cross close to a shared endpoint. Treating the whole
  shallow excursion as one contact joins distinct faces.
- `near-endpoint-cubics.json`: reduced from artwork `commons-8667810/00`.
  Two curves cross shortly after a shared endpoint. A chord approximation
  retains the endpoint but misses the second crossing, corrupting the faces.
- `merged-intersections.json`: complete contours from `commons-48353204/05`.
  Distinct intersections closer than the default point tolerance must retain
  their connecting edges. Merge radii follow the resolved incident edges;
  duplicate coordinate arrays must share the same radius. The separate unit
  square retains the original coordinate and tolerance scale.
- `translated-thin-polygons.json`: reduced from `commons-8667810/00`.
  Restoring the drawing's coordinate offset rounds a thin triangle enough to
  reverse its signed area. Output traversal must preserve the graph's winding
  without changing the rounded boundary or dropping the face.
- `cubic-departures.json`: the first pair comes from `commons-12175526/00`. Its
  subdivided cubics have the same tangent and curvature but different
  curvature derivatives. The second pair is a small construction whose
  cubics share leading control points and separate at a later coefficient.
  Sampling close to the endpoint rounds away that distinction.

- `mixed-scale-arc-and-line.json`: an existing fuzz seed with a valid, distant
  arc endpoint. Its closing line crosses a small shape near its own endpoint;
  a fixed parameter cutoff discarded a crossing a full unit away. Preserve
  the raw strings, including the fill-rule parity used by the fuzz target.

The near-endpoint, near-coincident and departure curve chains close along a
common exterior polyline. These closures keep the input regions simple, so
their independently measured signed areas can check the union/intersection
identity. A straight closing chord through the curves would introduce
self-intersections. The complete contours in `merged-intersections.json`
retain a tiny self-crossing; its area contribution fits within the existing
area comparison tolerance, while the erroneous endpoint merge does not.
