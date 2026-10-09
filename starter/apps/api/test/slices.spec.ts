// The slice manifest (`packages/shared/slices.json`) and its resolution: what
// "drop a slice by removing one line" promises, as tests.
import { SLICE_IDS, SliceManifestError, resolveSlices, type SliceId } from '../src/platform/slices/slice';
import { ALL_SLICES } from '../src/platform/slices/definitions';

const everything = [...SLICE_IDS];

describe('resolveSlices', () => {
  it('defines every id the manifest can name, once', () => {
    expect(Object.keys(ALL_SLICES).sort()).toEqual([...SLICE_IDS].sort());
    for (const id of SLICE_IDS) expect(ALL_SLICES[id].id).toBe(id);
  });

  it('accepts all slices and mounts them in dependency order whatever the file order', () => {
    const resolved = resolveSlices([...everything].reverse(), ALL_SLICES).map((slice) => slice.id);
    expect(resolved).toEqual(everything);
  });

  it('accepts an empty list: the core alone', () => {
    expect(resolveSlices([], ALL_SLICES)).toEqual([]);
  });

  it('only ever requires a slice that mounts earlier', () => {
    for (const id of SLICE_IDS) {
      for (const required of ALL_SLICES[id].requires) {
        expect(SLICE_IDS.indexOf(required)).toBeLessThan(SLICE_IDS.indexOf(id));
      }
    }
  });

  it('names the slice and the line to add when a requirement is missing', () => {
    const without = everything.filter((id) => id !== 'notifications');
    expect(() => resolveSlices(without, ALL_SLICES)).toThrow(/slice "sharing" requires "notifications"/);
    expect(() => resolveSlices(without, ALL_SLICES)).toThrow(/Add it to "enabled", or remove "sharing" too/);
  });

  it('refuses an unknown id and a duplicate', () => {
    expect(() => resolveSlices(['storege'], ALL_SLICES)).toThrow(SliceManifestError);
    expect(() => resolveSlices(['storege'], ALL_SLICES)).toThrow(/unknown slice "storege"/);
    expect(() => resolveSlices(['credentials', 'credentials'], ALL_SLICES)).toThrow(/listed twice/);
  });

  it.each(everything.map((id) => [id]))('lets %s stand with its requirements only', (id) => {
    const closure = new Set<SliceId>();
    const visit = (next: SliceId): void => {
      if (closure.has(next)) return;
      closure.add(next);
      ALL_SLICES[next].requires.forEach(visit);
    };
    visit(id as SliceId);
    expect(() => resolveSlices([...closure], ALL_SLICES)).not.toThrow();
  });
});
