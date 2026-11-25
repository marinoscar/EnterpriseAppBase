import { Box, Text } from 'ink';
import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

import { listTuiScreenSections, type TuiSectionProps, type TuiSectionRegistration } from './section-registry.js';

// =============================================================================
// The slot the node and deploy screens render  (PP-14.22)
// =============================================================================
//
// One section failing - a throw while rendering, a `load` that rejects - shows
// a one-line notice in its place and leaves the screen working: a section is
// the app's code in the middle of the platform's operator screens, and an
// operator running a deploy must never lose the screen to it.
// =============================================================================

interface BoundaryProps {
  label: string;
  children: ReactNode;
}

class SectionBoundary extends Component<BoundaryProps, { failure: string | undefined }> {
  override state: { failure: string | undefined } = { failure: undefined };

  static getDerivedStateFromError(error: unknown): { failure: string } {
    return { failure: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Rendered in place; nothing else to do.
  }

  override render(): ReactNode {
    return this.state.failure === undefined ? (
      this.props.children
    ) : (
      <Text color="yellow">
        section {this.props.label} failed: {this.state.failure}
      </Text>
    );
  }
}

function LazySection({ registration }: { registration: TuiSectionRegistration }): ReactNode {
  const [component, setComponent] = useState<ComponentType<TuiSectionProps> | undefined>(() => registration.component);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (registration.component !== undefined || registration.load === undefined) return;
    let live = true;
    registration.load().then(
      (loaded) => live && setComponent(() => loaded),
      (error: unknown) => live && setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [registration]);

  if (failure !== undefined) {
    return (
      <Text color="yellow">
        section {registration.screen}:{registration.id} failed to load: {failure}
      </Text>
    );
  }
  const Section = component;
  return Section === undefined ? null : <Section screen={registration.screen} />;
}

/**
 * Renders the sections registered for `screen`, below the screen's own list.
 * Renders nothing, and adds no node to the tree, when there are none.
 */
export function TuiScreenSections({ screen }: { screen: string }): ReactNode {
  const sections = listTuiScreenSections(screen);
  if (sections.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      {sections.map((registration) => (
        <SectionBoundary key={registration.id} label={`${registration.screen}:${registration.id}`}>
          <LazySection registration={registration} />
        </SectionBoundary>
      ))}
    </Box>
  );
}
