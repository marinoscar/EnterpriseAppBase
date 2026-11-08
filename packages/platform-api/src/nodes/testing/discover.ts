import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

type ImportLike = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

const isDynamic = (value: unknown): value is DynamicModule => typeof value === 'object' && value !== null && 'module' in value;
const isForwardRef = (value: unknown): value is ForwardReference => typeof value === 'object' && value !== null && 'forwardRef' in value;

/**
 * Every controller class reachable from `root` through module imports (static
 * and dynamic), each once. A local copy of the identity suite's walk: a slice
 * may not import another slice's internals, only its index.
 *
 * @param root - the app's root module.
 * @returns the controllers, in discovery order.
 *
 * @stability experimental
 */
export function discoverAppControllers(root: Type<unknown> | DynamicModule): Array<Type<unknown>> {
  const seen = new Set<unknown>();
  const controllers: Array<Type<unknown>> = [];
  const visit = (entry: ImportLike | undefined): void => {
    if (!entry || entry instanceof Promise) return;
    const resolved = isForwardRef(entry) ? (entry.forwardRef() as ImportLike) : entry;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const moduleClass = isDynamic(resolved) ? resolved.module : (resolved as Type<unknown>);
    const staticImports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? []) as ImportLike[];
    const staticControllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ?? []) as Array<Type<unknown>>;
    const dynamicImports = (isDynamic(resolved) ? resolved.imports ?? [] : []) as ImportLike[];
    const dynamicControllers = isDynamic(resolved) ? resolved.controllers ?? [] : [];
    for (const controller of [...staticControllers, ...dynamicControllers]) {
      if (!controllers.includes(controller)) controllers.push(controller);
    }
    for (const child of [...staticImports, ...dynamicImports]) visit(child);
  };
  visit(root);
  return controllers;
}
