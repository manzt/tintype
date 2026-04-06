/**
 * tintype — inline type snapshot testing for vitest.
 *
 * The plugin (tintype/plugin) transforms `expectType(expr)` calls at build
 * time, resolving the TypeScript type of `expr` via the language service and
 * rewriting the call to a plain `expect` with the resolved type string. A
 * custom snapshot serializer (tintype/setup) ensures the snapshot prints as
 * a clean type literal. This module provides the `expectType` function that
 * ties the two together.
 *
 * @module
 */

import { expect } from "vitest";

/**
 * Assert that an expression has a specific inferred type via an inline snapshot.
 *
 * @example
 * ```ts
 * import { expectType } from "tintype";
 *
 * const x = [1, 2, 3];
 * expectType(x).toMatchInlineSnapshot(`number[]`);
 * ```
 *
 * @example
 * ```ts
 * import { assert } from "vitest";
 * import { expectType } from "tintype";
 * import { isUser } from "./guards.js";
 *
 * const user: unknown = { name: "alice" };
 * assert(isUser(user));
 * expectType(user).toMatchInlineSnapshot(`User`);
 * ```
 */
export function expectType<T>(_val: T): {
  toMatchInlineSnapshot(snapshot?: string): void;
} {
  return expect(_val);
}
