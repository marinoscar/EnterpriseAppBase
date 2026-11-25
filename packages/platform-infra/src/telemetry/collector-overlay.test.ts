// The collector overlay point, checked without a collector: the compose file
// wires both configs in manifest order, the shipped example is empty, and an
// overlay that adds a `metrics/app` pipeline merges (with the collector's
// rule: maps merge, lists are replaced) into a config whose platform pipelines
// are untouched and whose new pipeline references only defined components.
// CI's `otelcol validate` step runs the real collector over the same files.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { telemetryInfraFragment } from './index.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(join(PACKAGE_ROOT, path), 'utf8');

type Yaml = Record<string, unknown>;
type Pipeline = { receivers: string[]; processors?: string[]; exporters: string[] };

/** The collector's merge (confmap, default): maps merge key by key; anything else, lists included, is replaced. */
function merge(base: unknown, overlay: unknown): unknown {
  if (overlay === null || overlay === undefined) return base;
  if (isMap(base) && isMap(overlay)) {
    const out: Yaml = { ...base };
    for (const [key, value] of Object.entries(overlay)) out[key] = merge(base[key], value);
    return out;
  }
  return overlay;
}

function isMap(value: unknown): value is Yaml {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const fromApp = (to: string): string => {
  const file = telemetryInfraFragment.files.find((f) => f.to === to) ?? telemetryInfraFragment.appOwnedFiles.find((f) => f.to === to);
  if (!file) throw new Error(`no fragment file materialises ${to}`);
  return file.from;
};

const platformConfig = parse(read(fromApp(telemetryInfraFragment.collectorConfigs.platform))) as Yaml;
const pipelinesOf = (config: Yaml): Record<string, Pipeline> =>
  (config['service'] as { pipelines: Record<string, Pipeline> }).pipelines;

describe('telemetry.compose.yml wires the overlay', () => {
  const compose = parse(read('telemetry/compose/telemetry.compose.yml')) as {
    services: Record<string, { command: string[]; volumes: string[] }>;
  };
  const collector = compose.services['otel-collector']!;

  it('starts the collector with two --config files: platform, then app', () => {
    expect(collector.command).toEqual(['--config=/etc/otelcol/platform.yaml', '--config=/etc/otelcol/app.yaml']);
  });

  it('mounts both configs read-only from infra/otel/, under the names the manifest declares', () => {
    const { platform, app } = telemetryInfraFragment.collectorConfigs;
    expect(collector.volumes).toContain(`../otel/${basename(platform)}:/etc/otelcol/platform.yaml:ro`);
    expect(collector.volumes).toContain(`../otel/${basename(app)}:/etc/otelcol/app.yaml:ro`);
    expect(platform).toBe(`infra/otel/${basename(platform)}`);
    expect(app).toBe(`infra/otel/${basename(app)}`);
  });
});

describe('app-collector.example.yaml', () => {
  const example = read('telemetry/otel/app-collector.example.yaml');

  it('is behaviour-neutral: comments only, no configuration at all', () => {
    expect(parse(example)).toBeNull();
    expect(merge(platformConfig, parse(example))).toEqual(platformConfig);
  });

  it('documents the list-replacement rule and the metrics/app pattern', () => {
    expect(example).toMatch(/Lists are REPLACED, never appended/);
    expect(example).toContain('metrics/app:');
  });

  it('carries an example that parses once uncommented and reuses platform components', () => {
    const start = example.indexOf('# Example:');
    const end = example.indexOf('# A variable read here');
    const block = example
      .slice(start, end)
      .split('\n')
      .filter((line) => line.startsWith('#   '))
      .map((line) => line.slice(4))
      .join('\n');
    const sample = parse(block) as Yaml;
    expect(Object.keys(sample)).toEqual(['receivers', 'service']);
    const merged = merge(platformConfig, sample) as Yaml;
    assertReferencesDefined(merged, 'metrics/app');
  });
});

describe('an overlay adding a metrics/app pipeline (test/fixtures/metrics-app.overlay.yaml)', () => {
  const overlay = parse(read('test/fixtures/metrics-app.overlay.yaml')) as Yaml;
  const merged = merge(platformConfig, overlay) as Yaml;

  it('keeps every platform pipeline exactly as it was', () => {
    for (const [name, pipeline] of Object.entries(pipelinesOf(platformConfig))) {
      expect(pipelinesOf(merged)[name], name).toEqual(pipeline);
    }
    expect((merged['service'] as Yaml)['extensions']).toEqual((platformConfig['service'] as Yaml)['extensions']);
  });

  it('adds the new pipeline, referencing only defined receivers, processors and exporters', () => {
    expect(Object.keys(pipelinesOf(merged))).toContain('metrics/app');
    assertReferencesDefined(merged, 'metrics/app');
  });

  it('shows why restating an existing pipeline is the unsafe pattern (lists are replaced)', () => {
    const unsafe = merge(platformConfig, { service: { pipelines: { metrics: { receivers: ['nginx'] } } } }) as Yaml;
    expect(pipelinesOf(unsafe)['metrics']!.receivers).toEqual(['nginx']);
    expect(pipelinesOf(platformConfig)['metrics']!.receivers).toEqual(['otlp']);
  });
});

function assertReferencesDefined(config: Yaml, pipelineName: string): void {
  const pipeline = pipelinesOf(config)[pipelineName];
  expect(pipeline, pipelineName).toBeDefined();
  for (const [section, ids] of [
    ['receivers', pipeline!.receivers],
    ['processors', pipeline!.processors ?? []],
    ['exporters', pipeline!.exporters],
  ] as const) {
    const defined = Object.keys((config[section] as Yaml | undefined) ?? {});
    for (const id of ids) expect(defined, `${pipelineName} ${section} ${id}`).toContain(id);
  }
}
