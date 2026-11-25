// Mesh one part and weight it to the skeleton. Runs in a worker (or inline as a fallback).
import { meshRaw } from './sculpt.js';
import { partShape } from './parts.js';
import { skinWeights } from './rig.js';

/** quality > 1 coarsens the grid (fewer triangles, faster) */
export function bake(kind, params, quality = 1) {
  const s = partShape(kind, params);
  const g = meshRaw(s.sdf, s.box[0], s.box[1], s.cell * quality);
  return { ...g, ...skinWeights(g.position, s.bones) };
}
