/**
 * Resolver backend for typescript 7+, built on the Go implementation's client
 * API shipped under `typescript/unstable/*`. The API spawns the bundled tsgo
 * binary and proxies a project/program/checker over a synchronous IPC channel;
 * ASTs transfer whole, while types are remote handles.
 *
 * Type information comes from the aliased `typescript7` devDependency so this
 * file can be checked against typescript 7's declarations while the package's
 * own `typescript` stays 5.x; at runtime the specifier is the real peer.
 */

import type { API, Checker, Project, Snapshot } from "typescript7/unstable/sync";
import type { CallExpression, Expression, Node, SourceFile } from "typescript7/unstable/ast";
import type { ExpectTypeCall, FileAnalysis, Resolver, ResolverOptions } from "./resolver.ts";

type SyncModule = typeof import("typescript7/unstable/sync");
type IsModule = typeof import("typescript7/unstable/ast/is");

// `typescript/unstable/*` does not export TypeFormatFlags; the numeric values
// are unchanged from the classic enum.
const NO_TRUNCATION = 1;
const USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE = 1 << 14;

export interface NativeResolverOptions extends ResolverOptions {
  /**
   * Module specifier to load the API from. Overridable so tintype's own test
   * suite can exercise this backend via an aliased typescript 7 install while
   * its `typescript` peer remains 5.x.
   */
  typescriptSpecifier?: string;
}

export async function createNativeResolver(options: NativeResolverOptions): Promise<Resolver> {
  const specifier = options.typescriptSpecifier ?? "typescript";
  const [{ API: APIConstructor }, is] = await Promise.all([
    import(`${specifier}/unstable/sync`) as Promise<SyncModule>,
    import(`${specifier}/unstable/ast/is`) as Promise<IsModule>,
  ]);

  // Serve in-flight (vitest-transformed) sources instead of their on-disk
  // contents; `undefined` falls back to the real filesystem.
  const files = new Map<string, string>();
  const api: API = new APIConstructor({
    fs: {
      readFile: (fileName) => files.get(fileName),
      fileExists: (fileName) => (files.has(fileName) ? true : undefined),
    },
  });
  let snapshot: Snapshot | undefined;

  function findExpectTypeCalls(
    sourceFile: SourceFile,
  ): { node: CallExpression; arg: Expression }[] {
    const results: { node: CallExpression; arg: Expression }[] = [];

    function visit(node: Node): undefined {
      if (
        is.isCallExpression(node) &&
        is.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "toMatchInlineSnapshot"
      ) {
        const obj = node.expression.expression;
        if (
          is.isCallExpression(obj) &&
          is.isIdentifier(obj.expression) &&
          obj.expression.text === "expectType" &&
          obj.arguments.length === 1
        ) {
          results.push({ node: obj, arg: obj.arguments[0] });
        }
      }
      node.forEachChild(visit);
    }

    visit(sourceFile);
    return results;
  }

  function hasExpectImport(sourceFile: SourceFile): boolean {
    return sourceFile.statements.some(
      (stmt) =>
        is.isImportDeclaration(stmt) &&
        stmt.importClause?.namedBindings &&
        is.isNamedImports(stmt.importClause.namedBindings) &&
        stmt.importClause.namedBindings.elements.some((el) => el.name.text === "expect"),
    );
  }

  function resolveTypes(checker: Checker, args: Expression[]): string[] {
    const types = checker.getTypeAtLocation(args);
    return args.map((arg, i) => {
      const type = types[i];
      if (!type) {
        return "unknown";
      }
      return checker.typeToString(
        type,
        arg,
        NO_TRUNCATION | USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE,
      );
    });
  }

  return {
    analyze(fileName, code): FileAnalysis {
      // An open file's content is authoritative from open time, so re-analysis
      // must close and reopen it (in separate updates — combining them in one
      // detaches the file from its project) and drop the client-side AST cache.
      const reopen = files.has(fileName);
      files.set(fileName, code);
      snapshot?.dispose();
      if (reopen) {
        api.updateSnapshot({ closeFiles: [fileName] }).dispose();
        api.clearSourceFileCache();
      }
      snapshot = api.updateSnapshot({
        openFiles: [fileName],
        ...(options.tsconfig ? { openProjects: [options.tsconfig] } : {}),
        ...(reopen ? { fileChanges: { changed: [fileName] } } : {}),
      });

      const project: Project | undefined = snapshot.getDefaultProjectForFile(fileName);
      const sourceFile = project?.program.getSourceFile(fileName);
      if (!project || !sourceFile) {
        return { calls: [], hasExpectImport: false };
      }

      const found = findExpectTypeCalls(sourceFile);
      if (found.length === 0) {
        return { calls: [], hasExpectImport: false };
      }

      const types = resolveTypes(
        project.checker,
        found.map(({ arg }) => arg),
      );
      const calls: ExpectTypeCall[] = found.map(({ node }, i) => ({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        type: types[i],
      }));
      return { calls, hasExpectImport: hasExpectImport(sourceFile) };
    },
    dispose() {
      snapshot?.dispose();
      snapshot = undefined;
      api.close();
    },
  };
}
