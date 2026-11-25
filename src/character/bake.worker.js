// Worker: meshes character parts off the main thread.
import { bake } from './bake.js';

self.onmessage = (e) => {
  const { id, kind, params, quality } = e.data;
  try {
    const r = bake(kind, params, quality);
    self.postMessage({ id, r }, [r.position.buffer, r.normal.buffer, r.index.buffer, r.skinIndex.buffer, r.skinWeight.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
