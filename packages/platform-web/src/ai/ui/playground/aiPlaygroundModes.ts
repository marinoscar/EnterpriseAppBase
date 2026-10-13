/**
 * The AI Playground's modes — issue #445, epic #420; open since PP-14.17 (#935).
 *
 * One entry per kind of AI call the playground can demonstrate. A mode is
 * defined by the ONE capability a model must declare to serve it (the API's
 * capability strings, `shared/aiCapabilities.ts`), so which modes are offered
 * and which models each lists is derived entirely from `GET /api/ai/models`:
 * there is no model name anywhere in this file, and there must never be one.
 *
 * THE LIST IS A REGISTRY. An app adds a mode with `registerAiPlaygroundMode`
 * (its `Panel` is the work area; the mode selector, the model filtering and the
 * "no usable model" reasons come with it). The six built-in modes register
 * through the same function (`builtinAiPlaygroundModes.ts`, which imports their
 * panels and so lives apart from this file): no private fast path. Order is
 * display order: the built-ins first, then the app's in registration order.
 *
 * This file imports no panel and no page, so an app registers a mode from its
 * main chunk (`@marinoscar/platform-web/ai/ui/playground-modes`) without pulling
 * the playground in.
 */
import type { ComponentType } from 'react';
import type { UsableAiModel } from '../../headless/types.js';
import { hasAiCapability } from '../shared/AiModelSelect.js';

/** The ids of the playground's own modes. */
export type BuiltinAiPlaygroundModeId = 'chat' | 'image' | 'transcribe' | 'speech' | 'embeddings' | 'voice';

/**
 * A playground mode id: a built-in one (autocompleted) or any id an app
 * registered with `registerAiPlaygroundMode`.
 *
 * @stability experimental
 */
export type AiPlaygroundModeId = BuiltinAiPlaygroundModeId | (string & {});

/**
 * What the playground hands a mode's `Panel`: the usable models that declare the
 * mode's capability (already filtered, in the API's order), the viewer's default
 * model, and whether the model list and settings finished loading.
 *
 * @stability experimental
 */
export interface AiPlaygroundPanelProps {
  /** The usable models declaring the mode's capability. */
  models: UsableAiModel[];
  /** The viewer's `user_settings.ai.defaultModel`, when set. */
  preferredModel?: { provider: string; modelId: string } | null;
  /** Whether the models and the settings are loaded (start from the default model only then). */
  ready?: boolean;
}

/**
 * What an app tells the playground about a mode it adds.
 *
 * @example
 * ```tsx
 * registerAiPlaygroundMode({
 *   id: 'diarize',
 *   label: 'Diarize',
 *   operation: 'audio.diarize',
 *   capability: 'speaker_diarization',
 *   Panel: (props) => <AiTranscribeMode {...props} providerOptions={{ 'example-transcribe': { diarize: true } }} />,
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface AiPlaygroundModeDefinition {
  /** Stable id, `^[a-z][a-z0-9-]{0,31}$`. Registering a built-in's id replaces that mode. */
  id: string;
  /** The label on the mode switch. */
  label: string;
  /**
   * The AI operation the mode exercises (`audio.diarize`, `responses`): the
   * `operation` its usage rows carry on the API (`GET /admin/ai/capabilities`).
   */
  operation: string;
  /**
   * The capability a model needs to be listed in this mode. Default: `operation`
   * (right when the capability and the operation share an id, as `embeddings`
   * does; give it for an operation that needs another capability).
   */
  capability?: string;
  /** Why the mode is unavailable when no usable model declares the capability. */
  unavailableReason?: string;
  /** The mode's work area. */
  Panel: ComponentType<AiPlaygroundPanelProps>;
}

/**
 * One mode as the playground uses it: {@link AiPlaygroundModeDefinition} with its defaults applied.
 *
 * @stability experimental
 */
export interface AiPlaygroundMode {
  /** The id. */
  id: AiPlaygroundModeId;
  /** The label on the mode switch. */
  label: string;
  /** The operation it exercises. */
  operation: string;
  /** The capability a model needs to be listed in this mode. */
  capability: string;
  /** Why the mode is unavailable when no usable model declares {@link capability}. */
  unavailableReason: string;
  /** The mode's work area. */
  Panel: ComponentType<AiPlaygroundPanelProps>;
}

const MODE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

const builtinModes = new Map<string, AiPlaygroundMode>();
/** The built-ins as the platform registered them, so a test can undo an app's replacement of one. */
const builtinOriginals = new Map<string, AiPlaygroundMode>();
const appModes = new Map<string, AiPlaygroundMode>();

function resolveMode(def: AiPlaygroundModeDefinition): AiPlaygroundMode {
  if (typeof def.id !== 'string' || !MODE_ID_PATTERN.test(def.id)) {
    throw new Error(`Invalid playground mode id ${JSON.stringify(def.id)}: it must match ${MODE_ID_PATTERN}.`);
  }
  if (typeof def.label !== 'string' || def.label.trim() === '') {
    throw new Error(`Playground mode "${def.id}": label must be a non-empty string.`);
  }
  if (typeof def.operation !== 'string' || !OPERATION_PATTERN.test(def.operation)) {
    throw new Error(`Playground mode "${def.id}": operation must be an operation id such as "audio.diarize".`);
  }
  if (def.Panel === undefined || def.Panel === null || !(typeof def.Panel === 'function' || typeof def.Panel === 'object')) {
    throw new Error(`Playground mode "${def.id}": Panel must be a React component.`);
  }

  const capability = def.capability ?? def.operation;

  return {
    id: def.id,
    label: def.label,
    operation: def.operation,
    capability,
    unavailableReason:
      def.unavailableReason ?? `None of the models available to you can do ${def.label.toLowerCase()}`,
    Panel: def.Panel,
  };
}

/**
 * Adds a mode to the AI Playground. Call it at module scope, before the page
 * renders. A later registration with the same id replaces the earlier one (so
 * a hot reload works), and one with a built-in's id replaces that mode's
 * definition where it stands in the order: how an app swaps a built-in panel.
 *
 * @param def - the mode: id, label, the operation it exercises and its panel.
 * @throws Error when the id, label, operation or panel is malformed.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiPlaygroundMode(def: AiPlaygroundModeDefinition): void {
  const mode = resolveMode(def);

  if (builtinModes.has(mode.id)) {
    // Replace in place: keeps the built-in's position in the switch.
    builtinModes.set(mode.id, mode);
    return;
  }

  appModes.set(mode.id, mode);
}

/**
 * Registers one of the playground's own modes. Never replaces an app's
 * registration of the same id, so the result does not depend on which module
 * loaded first.
 *
 * @internal
 */
export function registerBuiltinAiPlaygroundMode(def: AiPlaygroundModeDefinition): void {
  const mode = resolveMode(def);
  const app = appModes.get(mode.id);

  appModes.delete(mode.id);
  builtinOriginals.set(mode.id, mode);
  builtinModes.set(mode.id, app ?? mode);
}

/**
 * Every mode, in display order: the built-ins, then the app's in registration order.
 *
 * @stability experimental
 */
export function listAiPlaygroundModes(): AiPlaygroundMode[] {
  return [...builtinModes.values(), ...appModes.values()];
}

/**
 * The registered mode, or `undefined`.
 *
 * @param id - the mode id.
 *
 * @stability experimental
 */
export function getAiPlaygroundMode(id: AiPlaygroundModeId): AiPlaygroundMode | undefined {
  return builtinModes.get(id) ?? appModes.get(id);
}

/**
 * Forgets every app registration (tests only), including an app's replacement
 * of a built-in mode. The built-in modes stay.
 *
 * @internal
 */
export function resetAiPlaygroundModesForTests(): void {
  appModes.clear();
  for (const [id, mode] of builtinOriginals) builtinModes.set(id, mode);
}

/**
 * Modes an administrator has switched off for the deployment, so they are
 * not offered at all (as opposed to {@link unavailableModes}, which are
 * offered but disabled with a reason). Voice needs `allowRealtime: true`; an
 * older API that omits the flag reads as off.
 */
export function hiddenPlaygroundModes(config: { allowRealtime?: boolean }): Set<AiPlaygroundModeId> {
  return config.allowRealtime === true ? new Set() : new Set<AiPlaygroundModeId>(['voice']);
}

/** The registered mode for `id`, else the first mode (Chat). */
export function aiPlaygroundMode(id: AiPlaygroundModeId): AiPlaygroundMode {
  return getAiPlaygroundMode(id) ?? (listAiPlaygroundModes()[0] as AiPlaygroundMode);
}

/** The usable models that can serve `mode`, in the API's order. */
export function modelsForMode(models: readonly UsableAiModel[], mode: AiPlaygroundMode): UsableAiModel[] {
  return models.filter((model) => hasAiCapability(model, mode.capability));
}

/**
 * The modes that cannot be selected: those no usable model can serve (offered,
 * but disabled with their reason), plus any `hidden` ones.
 */
export function unavailableModes(
  models: readonly UsableAiModel[],
  hidden: ReadonlySet<AiPlaygroundModeId> = new Set(),
): Set<AiPlaygroundModeId> {
  return new Set(
    listAiPlaygroundModes()
      .filter((mode) => hidden.has(mode.id) || modelsForMode(models, mode).length === 0)
      .map((mode) => mode.id),
  );
}

/** The mode to open on: Chat when it can be used, else the first mode that can. */
export function initialPlaygroundMode(
  models: readonly UsableAiModel[],
  hidden: ReadonlySet<AiPlaygroundModeId> = new Set(),
): AiPlaygroundModeId {
  const unavailable = unavailableModes(models, hidden);
  const modes = listAiPlaygroundModes();

  return modes.find((mode) => !unavailable.has(mode.id))?.id ?? 'chat';
}
