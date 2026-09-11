Hand-maintained reductions; do not regenerate from the corpus generator.

- `near-coincident-cubics.json`: reduced from artwork `commons-12175526/00`.
  Two cubic boundaries cross close to a shared endpoint. Treating the whole
  shallow excursion as one contact joins distinct faces.
- `cubic-departures.json`: the first pair comes from the same artwork. Its
  subdivided cubics have the same tangent and curvature but different
  curvature derivatives. The second pair is a small construction whose
  cubics share leading control points and separate at a later coefficient.
  Sampling close to the endpoint rounds away that distinction.

Each curve chain closes along a common exterior polyline. These closures keep
the input regions simple, so their independently measured signed areas can
check the union/intersection identity. A straight closing chord through the
curves would make that identity invalid by introducing self-intersections.
