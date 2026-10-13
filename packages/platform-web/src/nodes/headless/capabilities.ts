// =============================================================================
// A node's capabilities, as a read-only list
// =============================================================================
//
// `WorkerNode.capabilities` is the node's self-reported bag (open JSON, shown
// on the fleet page and used for nothing else). The CLI's capability probe puts
// the satisfied keys under `probe.capabilities` (`binary:ffmpeg`, `binary:pg_dump`)
// and, when it has them, short version banners under `probe.versions`.
//
// The bag is UNTRUSTED: a node wrote it. So this reads it defensively, keeps
// only short printable strings, and bounds the count; it is rendered as text,
// never as markup or a link, and never acted on.
// =============================================================================

/**
 * Most capabilities listed.
 *
 * @stability experimental
 */
export const MAX_LISTED_CAPABILITIES = 64;

/**
 * Longest capability or version text printed.
 *
 * @stability experimental
 */
export const MAX_CAPABILITY_TEXT_LENGTH = 80;

/**
 * One capability to print.
 *
 * @stability experimental
 */
export interface NodeCapabilityItem {
  /** The capability key (`binary:ffmpeg`). */
  key: string;
  /** Its version banner, when the probe captured one. */
  version?: string | undefined;
}

function printable(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Control characters and anything past the cap are cut; an empty result is dropped.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_CAPABILITY_TEXT_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * The capabilities a node reported, as a bounded, sorted list: the probe's
 * satisfied capability keys, each with its version banner when the probe
 * captured one. Anything else in the bag is not listed.
 *
 * @param capabilities - `WorkerNode.capabilities`.
 * @returns at most {@link MAX_LISTED_CAPABILITIES} items; empty when none were reported.
 *
 * @stability experimental
 */
export function nodeCapabilityItems(capabilities: unknown): NodeCapabilityItem[] {
  const probe = asRecord(asRecord(capabilities)?.['probe']);
  const keys = Array.isArray(probe?.['capabilities']) ? (probe['capabilities'] as unknown[]) : [];
  const versions = asRecord(probe?.['versions']) ?? {};

  const items: NodeCapabilityItem[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = printable(raw);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    const name = key.startsWith('binary:') ? key.slice('binary:'.length) : undefined;
    const version = name !== undefined && Object.hasOwn(versions, name) ? printable(versions[name]) : undefined;
    items.push(version === undefined ? { key } : { key, version });
    if (items.length >= MAX_LISTED_CAPABILITIES) break;
  }

  return items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
