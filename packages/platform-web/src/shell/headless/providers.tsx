// =============================================================================
// The shell's providers composition (issue #868)
// =============================================================================
//
// An app mounts a stack of providers around its signed-in shell: the
// notification centre, its feature configs, each slice's adapters, the
// platform host, onboarding. Written by hand that is a staircase nine levels
// deep whose ORDER matters (the platform host must sit inside whatever feeds
// its feature map). `ShellProviders` takes the stack as a list, outermost
// first, so the order is one readable array and a test can assert it.
// =============================================================================

import type { ComponentType, ReactElement, ReactNode } from 'react';

/**
 * One provider of the stack: any component that renders its `children`.
 * Bind props with a small wrapper (`({ children }) => <X api={api}>{children}</X>`)
 * declared at module scope, so its identity is stable.
 *
 * @stability experimental
 */
export type ShellProvider = ComponentType<ShellProviderProps>;

/**
 * What {@link ShellProviders} passes each provider.
 *
 * @stability experimental
 */
export interface ShellProviderProps {
  /** The rest of the stack, then the shell. */
  children: ReactNode;
}

/**
 * Nest `providers` around `children`, the first OUTERMOST. Renders no element
 * of its own, so the DOM is the same as the hand-written staircase.
 *
 * @param props - `providers`: the stack, outermost first (declare it at module
 *   scope); `children`: what the innermost provider wraps (the shell layout).
 * @returns the nested tree.
 *
 * @example
 * ```tsx
 * const SHELL_PROVIDERS: readonly ShellProvider[] = [NotificationProvider, AppPlatformHostProvider];
 * <ShellProviders providers={SHELL_PROVIDERS}><Layout /></ShellProviders>
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export function ShellProviders(props: { providers: readonly ShellProvider[]; children: ReactNode }): ReactElement {
  let tree: ReactNode = props.children;
  for (let index = props.providers.length - 1; index >= 0; index -= 1) {
    const Provider = props.providers[index]!;
    tree = <Provider>{tree}</Provider>;
  }
  return <>{tree}</>;
}
