// Helpers the settings suites share (issue #742).

import type { WebConformanceCard, WebConformanceContext, WebConformanceSection } from '../../testing/index.js';
import type { SettingsSectionDef } from '../ui/registry.js';

/** One registry under test: its sections, hub and a label for test titles. */
export interface RegistryUnderTest {
  /** `admin` or `user`, in test titles. */
  name: 'admin' | 'user';
  /** The registry's sections. */
  sections: WebConformanceSection[];
  /** The hub's route. */
  hubPath: string;
  /** The hub's title. */
  hubTitle: string;
}

/** The admin and the user registry of the app, in that order. */
export function registriesOf(context: WebConformanceContext): RegistryUnderTest[] {
  return [
    { name: 'admin', sections: context.adminSections, hubPath: context.hubs.admin.path, hubTitle: context.hubs.admin.title },
    { name: 'user', sections: context.userSettingsSections, hubPath: context.hubs.user.path, hubTitle: context.hubs.user.title },
  ];
}

/** The registry as the settings helpers type it. */
export function asSections(sections: WebConformanceSection[]): SettingsSectionDef[] {
  return sections as unknown as SettingsSectionDef[];
}

/** Every card of a registry, flattened. */
export function cardsOf(sections: readonly WebConformanceSection[]): WebConformanceCard[] {
  return sections.flatMap((section) => section.cards);
}

/** The titles of the cards of already-filtered sections, in order. */
export function titlesOf(sections: readonly { cards: readonly { title: string }[] }[]): string[] {
  return sections.flatMap((section) => section.cards.map((card) => card.title));
}

/** The permissions a card names: its string, its any-of list, or none. */
export function permissionsOf(card: WebConformanceCard): string[] {
  if (card.permission === undefined || card.permission === '') return [];
  return typeof card.permission === 'string' ? [card.permission] : [...card.permission];
}
