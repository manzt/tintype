/**
 * Vite plugin for inline TypeScript type snapshots.
 *
 * Recognises `expectType(expr).toMatchInlineSnapshot(...)` in test files
 * and replaces the `expectType(expr)` call with
 * `expect({ [Symbol.for("tintype")]: "<resolved>" })` at transform time, using the
 * TypeScript checker to resolve the type.
 *
 * Because the method name stays `toMatchInlineSnapshot`, vitest's
 * built-in `--update` mechanism works out of the box.
 *
 * Type resolution is backend-dependent: typescript 5.x/6.x uses the classic
 * language service, typescript 7+ uses the `typescript/unstable/*` API. See
 * `resolver.ts`.
 */

import type { Plugin } from "vitest/config";
import * as NodeChildProcess from "node:child_process";
import MagicString from "magic-string";
import { createResolver, type Resolver } from "./resolver.ts";

export interface TypeSnapshotsOptions {
  /** Path to tsconfig.json. Auto-detected if not provided. */
  tsconfig?: string;
  /**
   * Shell command to format the resolved type string.
   *
   * The type is wrapped as `type __tintype__ = <type>;` and piped to
   * the command via stdin. The command should write the formatted result
   * to stdout. Use `{filename}` as a placeholder for the source file path.
   *
   * @example "prettier --parser typescript"
   * @example "biome format --stdin-file-path {filename}"
   */
  formatCommand?: string;
}

function formatTypes(types: string[], command: string, filename: string): string[] {
  const pad = String(types.length - 1).length;
  const input =
    types.map((t, i) => `type __tintype_${String(i).padStart(pad, "0")}__ = ${t};`).join("\n") +
    "\n";
  const cmd = command.replaceAll("{filename}", filename);
  const stdout = NodeChildProcess.execSync(cmd, { input, encoding: "utf-8" });
  const re = /type\s+__tintype_(\d+)__\s*=\s*([\s\S]*?)\s*;\s*(?=type\s+__tintype_\d+__|$)/g;
  const formatted: Array<string> = Array.from({ length: types.length });
  for (let m; (m = re.exec(stdout)); ) {
    formatted[Number(m[1])] = m[2];
  }
  return types.map((t, i) => formatted[i] ?? t);
}

export default function tintype(options?: TypeSnapshotsOptions): Plugin {
  let resolverPromise: Promise<Resolver> | null = null;

  return {
    name: "tintype",
    enforce: "pre",

    async transform(code, id) {
      if (!code.includes("expectType")) {
        return;
      }

      resolverPromise ??= createResolver({ tsconfig: options?.tsconfig });
      const resolver = await resolverPromise;

      const { calls, hasExpectImport } = resolver.analyze(id, code);
      if (calls.length === 0) {
        return;
      }

      const s = new MagicString(code);

      // Ensure `expect` is in scope after we rewrite expectType → expect
      if (!hasExpectImport) {
        s.prepend('import { expect } from "vitest";\n');
      }

      let resolvedTypes = calls.map((call) => call.type);
      if (options?.formatCommand) {
        resolvedTypes = formatTypes(resolvedTypes, options.formatCommand, id);
      }

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const json = JSON.stringify(resolvedTypes[i]);
        s.overwrite(call.start, call.end, `expect({ [Symbol.for("tintype")]: ${json} })`);
      }

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true }),
      };
    },

    async closeBundle() {
      const resolver = await resolverPromise;
      resolver?.dispose();
      resolverPromise = null;
    },
  };
}
