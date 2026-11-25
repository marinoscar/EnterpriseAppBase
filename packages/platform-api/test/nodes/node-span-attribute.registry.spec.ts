// =============================================================================
// The relayed span attribute allowlist (PP-14.19)
// =============================================================================

import {
  BUILTIN_NODE_SPAN_ATTRIBUTES,
  MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH,
  nodeSpanAttributeRegistry,
  registerNodeSpanAttribute,
  resolveRelayedAttribute,
} from '../../src/nodes/node-span-attribute.registry';

describe('registerNodeSpanAttribute', () => {
  it('refuses a key outside the key pattern', () => {
    for (const key of ['Bad', 'a', '1x', 'has space', 'a.b', 'x'.repeat(33), '__proto__']) {
      expect(() => registerNodeSpanAttribute({ key, type: 'int' })).toThrow(/Invalid id/);
    }
  });

  it("refuses the platform's own keys: they are not the app's to redefine", () => {
    for (const key of Object.keys(BUILTIN_NODE_SPAN_ATTRIBUTES)) {
      expect(() => registerNodeSpanAttribute({ key, type: 'int' })).toThrow(/platform's own attributes/);
    }
  });

  it('refuses an unknown type, maxLength on an int, and a maxLength outside 1..128', () => {
    expect(() => registerNodeSpanAttribute({ key: 'badType', type: 'float' as never })).toThrow(/type must be/);
    expect(() => registerNodeSpanAttribute({ key: 'intWithMax', type: 'int', maxLength: 5 })).toThrow(/string attribute only/);
    for (const maxLength of [0, -1, 1.5, MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH + 1]) {
      expect(() => registerNodeSpanAttribute({ key: 'strWithMax', type: 'string', maxLength })).toThrow(/maxLength must be/);
    }
  });

  it('refuses a repeat registration', () => {
    registerNodeSpanAttribute({ key: 'dupAttr', type: 'int' });
    expect(() => registerNodeSpanAttribute({ key: 'dupAttr', type: 'string' })).toThrow(/Duplicate id/);
    expect(nodeSpanAttributeRegistry.get('dupAttr')).toEqual({ key: 'dupAttr', type: 'int' });
  });
});

describe('resolveRelayedAttribute', () => {
  beforeAll(() => {
    registerNodeSpanAttribute({ key: 'frames', type: 'int' });
    registerNodeSpanAttribute({ key: 'codec', type: 'string', maxLength: 8 });
    registerNodeSpanAttribute({ key: 'label', type: 'string' });
  });

  it("maps the platform's four integers to their OpenTelemetry names and enforces their ranges", () => {
    expect(resolveRelayedAttribute('bytes', 10)).toEqual({ name: 'job.phase.bytes', value: 10 });
    expect(resolveRelayedAttribute('attempt', 2)).toEqual({ name: 'job.attempt', value: 2 });
    expect(resolveRelayedAttribute('exitCode', -1)).toEqual({ name: 'process.exit_code', value: -1 });
    expect(resolveRelayedAttribute('httpStatus', 404)).toEqual({ name: 'http.response.status_code', value: 404 });
    expect(resolveRelayedAttribute('bytes', -1)).toBeUndefined();
    expect(resolveRelayedAttribute('attempt', 10_001)).toBeUndefined();
    expect(resolveRelayedAttribute('exitCode', 1025)).toBeUndefined();
    expect(resolveRelayedAttribute('httpStatus', 99)).toBeUndefined();
    expect(resolveRelayedAttribute('bytes', '10')).toBeUndefined();
    expect(resolveRelayedAttribute('bytes', 1.5)).toBeUndefined();
  });

  it('emits a registered integer as job.app.<key>, non-negative whole numbers only', () => {
    expect(resolveRelayedAttribute('frames', 240)).toEqual({ name: 'job.app.frames', value: 240 });
    expect(resolveRelayedAttribute('frames', 0)).toEqual({ name: 'job.app.frames', value: 0 });
    for (const bad of [-1, 1.5, '240', null, undefined, NaN, Infinity, 2 ** 60, {}, []]) {
      expect(resolveRelayedAttribute('frames', bad)).toBeUndefined();
    }
  });

  it('emits a registered string only when token-shaped and within its length cap', () => {
    expect(resolveRelayedAttribute('codec', 'h264')).toEqual({ name: 'job.app.codec', value: 'h264' });
    expect(resolveRelayedAttribute('codec', 'x'.repeat(8))).toBeDefined();
    expect(resolveRelayedAttribute('codec', 'x'.repeat(9))).toBeUndefined();
    expect(resolveRelayedAttribute('label', 'x'.repeat(64))).toBeDefined();
    expect(resolveRelayedAttribute('label', 'x'.repeat(65))).toBeUndefined();
    for (const bad of ['', 'a b', '/etc/passwd', 'https://x', 'a:b', "a'b", 'a\nb', 'é', 5, null]) {
      expect(resolveRelayedAttribute('label', bad)).toBeUndefined();
    }
  });

  it('drops an unregistered key, and never treats a prototype property name as registered', () => {
    for (const key of ['bitrate', 'node.id', 'job.id', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolveRelayedAttribute(key, 1)).toBeUndefined();
    }
  });

  it('can never produce a name outside job.app.* and the four built-ins', () => {
    const allowed = new Set(['job.phase.bytes', 'job.attempt', 'process.exit_code', 'http.response.status_code']);
    for (const key of ['frames', 'codec', 'label', ...Object.keys(BUILTIN_NODE_SPAN_ATTRIBUTES)]) {
      const resolved = resolveRelayedAttribute(key, key === 'frames' || key in BUILTIN_NODE_SPAN_ATTRIBUTES ? 5 : 'tok');
      if (resolved) expect(allowed.has(resolved.name) || /^job\.app\.[a-zA-Z0-9]+$/.test(resolved.name)).toBe(true);
    }
  });
});
