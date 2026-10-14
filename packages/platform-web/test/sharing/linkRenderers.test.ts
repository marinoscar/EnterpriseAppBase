import { describe, expect, it } from 'vitest';

import { LinkRendererRegistry, LinkRendererRegistryError } from '../../src/sharing/headless/index.js';

const View = () => null;
const Other = () => null;

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LinkRendererRegistryError);
    return (err as LinkRendererRegistryError).code;
  }
  return undefined;
}

describe('LinkRendererRegistry (#731)', () => {
  it('registers and looks up a renderer per resource type, in registration order', () => {
    const registry = new LinkRendererRegistry();
    registry.register('media_item', View);
    registry.register('album', Other);
    expect(registry.get('media_item')).toBe(View);
    expect(registry.get('album')).toBe(Other);
    expect(registry.get('transcript')).toBeUndefined();
    expect(registry.types()).toEqual(['media_item', 'album']);
  });

  it('refuses a duplicate id with DUPLICATE_ID and keeps the first renderer', () => {
    const registry = new LinkRendererRegistry();
    registry.register('media_item', View);
    expect(codeOf(() => registry.register('media_item', Other))).toBe('DUPLICATE_ID');
    expect(registry.get('media_item')).toBe(View);
  });

  it('refuses an id that is not a resource type id with INVALID_ID', () => {
    const registry = new LinkRendererRegistry();
    expect(codeOf(() => registry.register('Media-Item', View))).toBe('INVALID_ID');
    expect(codeOf(() => registry.register('', View))).toBe('INVALID_ID');
    expect(registry.types()).toEqual([]);
  });

  it('refuses every registration once frozen, while reads keep working; freeze is idempotent', () => {
    const registry = new LinkRendererRegistry();
    registry.register('media_item', View);
    registry.freeze();
    registry.freeze();
    expect(registry.isFrozen()).toBe(true);
    expect(codeOf(() => registry.register('album', Other))).toBe('FROZEN');
    expect(registry.get('media_item')).toBe(View);
    expect(registry.types()).toEqual(['media_item']);
  });

  it('names the id on the error', () => {
    const registry = new LinkRendererRegistry();
    registry.register('album', View);
    try {
      registry.register('album', View);
    } catch (err) {
      expect((err as LinkRendererRegistryError).id).toBe('album');
    }
  });
});
