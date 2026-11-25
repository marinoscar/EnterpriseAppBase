/**
 * Collects the demo checks.
 *
 * @stability stable
 */
export class DemoRegistry {
  /** The ids registered so far, in registration order. */
  readonly ids: string[] = [];

  /**
   * Adds a check. Throws on a duplicate id.
   *
   * @param id - Unique id of the check.
   * @extensionPoint registry
   */
  register(id: string): void {
    if (this.ids.includes(id)) throw new Error(`duplicate ${id}`);
    this.ids.push(id);
  }
}

/**
 * The demo package name.
 *
 * @stability experimental
 */
export const DEMO_NAME = 'demo';
