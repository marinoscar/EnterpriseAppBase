// =============================================================================
// The AI provider card registry (PP-14.6, issue #924)
// =============================================================================
//
// The admin AI page (`/admin/settings/ai`) draws one card per provider the API
// lists. WHICH component draws a card is decided here, by provider id:
//
//   - a provider with a REGISTERED card gets that component. The five built-in
//     providers register their bespoke cards (`./builtinAiProviderCards.ts`),
//     so their markup is exactly what it was before this registry existed;
//   - every other provider gets `AiGenericProviderCard`, a card generated from
//     the descriptor the API serves for it (`GET /api/admin/ai/config`,
//     `descriptors`). An app that adds a provider with `registerAiProvider`
//     (`@marinoscar/platform-api/ai`) therefore needs no web code at all, and
//     registers a card here only to replace the generated one.
//
// A registered card is a presentation choice; it enforces nothing. The API
// validates every save (`AI_PROVIDER_SETTINGS_INVALID`, ...).
// =============================================================================

import type { ComponentType } from 'react';

import type { AiProviderCardProps } from './AiProviderCard.js';

/**
 * A component that draws one provider's card on the admin AI page. It
 * receives {@link AiProviderCardProps}: the provider as the API describes it,
 * the editable form value, the key actions and their state.
 *
 * @stability experimental
 */
export type AiProviderCardComponent = ComponentType<AiProviderCardProps>;

const cards = new Map<string, AiProviderCardComponent>();
const builtinCards = new Map<string, AiProviderCardComponent>();

/**
 * Registers the component that draws provider `id`'s card on the admin AI
 * page, replacing the generated card (and an earlier registration for the
 * same id, so a hot module reload that re-runs the registering module works).
 * Call it at module scope, before the page renders. An app's registration
 * wins over a built-in's whichever module loads first.
 *
 * Needed only for a bespoke card: a provider registered with
 * `registerAiProvider` is drawn from its descriptor without it.
 *
 * @param id - the provider id the card is for (`'example-transcribe'`).
 * @param Component - the card; see {@link AiProviderCardProps} for its props.
 *
 * @example
 * ```tsx
 * import { registerAiProviderCard } from '@marinoscar/platform-web/ai/ui';
 *
 * registerAiProviderCard('example-transcribe', ExampleTranscribeCard);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiProviderCard(id: string, Component: AiProviderCardComponent): void {
  cards.set(id, Component);
}

/**
 * Registers a built-in provider's bespoke card. Never replaces an app's
 * registration for the same id, so the result does not depend on which module
 * loaded first.
 *
 * @internal
 */
export function registerBuiltinAiProviderCard(id: string, Component: AiProviderCardComponent): void {
  builtinCards.set(id, Component);
}

/**
 * The component registered for `id`, or `undefined` (the page then draws the
 * generated card).
 *
 * @param id - the provider id.
 * @stability experimental
 */
export function getAiProviderCard(id: string): AiProviderCardComponent | undefined {
  return cards.get(id) ?? builtinCards.get(id);
}

/**
 * Forgets every app registration (tests only). The built-in cards stay.
 *
 * @internal
 */
export function resetAiProviderCardsForTests(): void {
  cards.clear();
}
