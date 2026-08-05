/**
 * Type-resolution backends.
 *
 * tintype supports two TypeScript API surfaces:
 *
 * - `classic.ts` — the JS compiler API (`createLanguageService`), for
 *   typescript 5.x and 6.x.
 * - `native.ts` — the Go implementation's client API shipped under
 *   `typescript/unstable/*`, for typescript 7+.
 *
 * The backend is chosen from the resolved `typescript` peer's major version,
 * and each backend is loaded lazily so the other's imports never execute.
 */

import { createRequire } from "node:module";

/** A `expectType(EXPR).toMatchInlineSnapshot(...)` call site. */
export interface ExpectTypeCall {
  /** Start offset of the `expectType(EXPR)` call expression. */
  start: number;
  /** End offset of the `expectType(EXPR)` call expression. */
  end: number;
  /** The type of EXPR as printed by the checker. */
  type: string;
}

export interface FileAnalysis {
  calls: ExpectTypeCall[];
  /** Whether the file already imports `expect` via named import. */
  hasExpectImport: boolean;
}

export interface Resolver {
  analyze(fileName: string, code: string): FileAnalysis;
  dispose(): void;
}

export interface ResolverOptions {
  /** Path to tsconfig.json. Auto-detected if not provided. */
  tsconfig?: string;
}

export async function createResolver(options: ResolverOptions): Promise<Resolver> {
  const require = createRequire(import.meta.url);
  const { version } = require("typescript/package.json") as { version: string };
  const major = Number(version.split(".")[0]);
  if (major >= 7) {
    const { createNativeResolver } = await import("./native.ts");
    return createNativeResolver(options);
  }
  const { createClassicResolver } = await import("./classic.ts");
  return createClassicResolver(options);
}
