/**
 * Vite plugin for inline TypeScript type snapshots.
 *
 * Recognises `expectType(expr).toMatchInlineSnapshot(...)` in test files
 * and replaces the `expectType(expr)` call with
 * `expect({ [Symbol.for("tintype")]: "<resolved>" })` at transform time, using the
 * TypeScript language service to resolve the type.
 *
 * Because the method name stays `toMatchInlineSnapshot`, vitest's
 * built-in `--update` mechanism works out of the box.
 */

import type { Plugin } from "vitest/config";
import * as NodeChildProcess from "node:child_process";
import ts from "typescript";
import MagicString from "magic-string";

// ---------------------------------------------------------------------------
// TypeScript language service
// ---------------------------------------------------------------------------

interface LanguageServiceWithAdd extends ts.LanguageService {
  addFile(fileName: string, content: string): void;
}

function createLanguageService(compilerOptions: ts.CompilerOptions): LanguageServiceWithAdd {
  const files = new Map<string, { version: number; content: string }>();

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (fileName) => String(files.get(fileName)?.version ?? 0),
    getScriptSnapshot(fileName) {
      const file = files.get(fileName);
      if (file) {
        return ts.ScriptSnapshot.fromString(file.content);
      }
      const content = ts.sys.readFile(fileName);
      return content ? ts.ScriptSnapshot.fromString(content) : undefined;
    },
    getCurrentDirectory: ts.sys.getCurrentDirectory.bind(ts.sys),
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists.bind(ts.sys),
    readFile: ts.sys.readFile.bind(ts.sys),
    readDirectory: ts.sys.readDirectory.bind(ts.sys),
    directoryExists: ts.sys.directoryExists.bind(ts.sys),
    getDirectories: ts.sys.getDirectories.bind(ts.sys),
    realpath: ts.sys.realpath?.bind(ts.sys),
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return Object.assign(service, {
    addFile(fileName: string, content: string) {
      const existing = files.get(fileName);
      if (existing) {
        existing.version++;
        existing.content = content;
      } else {
        files.set(fileName, { version: 0, content });
      }
    },
  });
}

function getTypeAtPosition(service: ts.LanguageService, fileName: string, node: ts.Node): string {
  const program = service.getProgram();
  if (!program) {
    return "unknown";
  }

  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
    return "unknown";
  }

  const target = findNodeAtPosition(sourceFile, node.getStart(), node.getEnd());
  if (!target) {
    return "unknown";
  }

  const type = checker.getTypeAtLocation(target);
  return checker.typeToString(
    type,
    target,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
}

function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Node | undefined {
  let result: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (node.getStart() === start && node.getEnd() === end) {
      result = node;
      return;
    }
    if (node.getStart() <= start && node.getEnd() >= end) {
      ts.forEachChild(node, visit);
    }
  }
  visit(sourceFile);
  return result;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Walk the TS AST looking for call chains of the form:
 *   expectType(EXPR).toMatchInlineSnapshot(...)
 *
 * Returns the `expectType(EXPR)` CallExpression nodes.
 */
function findExpectTypeCalls(
  sourceFile: ts.SourceFile,
): { node: ts.CallExpression; arg: ts.Expression }[] {
  const results: { node: ts.CallExpression; arg: ts.Expression }[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "toMatchInlineSnapshot"
    ) {
      const obj = node.expression.expression;
      if (
        ts.isCallExpression(obj) &&
        ts.isIdentifier(obj.expression) &&
        obj.expression.text === "expectType" &&
        obj.arguments.length === 1
      ) {
        results.push({ node: obj, arg: obj.arguments[0] });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

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

function loadCompilerOptions(tsconfigPath?: string): ts.CompilerOptions {
  const configPath =
    tsconfigPath ?? ts.findConfigFile(ts.sys.getCurrentDirectory(), ts.sys.fileExists.bind(ts.sys));

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        ts.sys.getCurrentDirectory(),
      );
      return parsed.options;
    }
  }

  // Fallback defaults
  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
  };
}

export default function tintype(options?: TypeSnapshotsOptions): Plugin {
  let service: LanguageServiceWithAdd | null = null;

  function getService(): LanguageServiceWithAdd {
    if (service) {
      return service;
    }
    const compilerOptions = loadCompilerOptions(options?.tsconfig);
    service = createLanguageService(compilerOptions);
    return service;
  }

  return {
    name: "tintype",
    enforce: "pre",

    transform(code, id) {
      if (!code.includes("expectType")) {
        return;
      }

      const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
      const calls = findExpectTypeCalls(sourceFile);
      if (calls.length === 0) {
        return;
      }

      const svc = getService();
      svc.addFile(id, code);
      const s = new MagicString(code);

      // Ensure `expect` is in scope after we rewrite expectType → expect
      const hasExpectImport = sourceFile.statements.some(
        (stmt) =>
          ts.isImportDeclaration(stmt) &&
          stmt.importClause?.namedBindings &&
          ts.isNamedImports(stmt.importClause.namedBindings) &&
          stmt.importClause.namedBindings.elements.some((el) => el.name.text === "expect"),
      );
      if (!hasExpectImport) {
        s.prepend('import { expect } from "vitest";\n');
      }

      let resolvedTypes = calls.map(({ arg }) => getTypeAtPosition(svc, id, arg));
      if (options?.formatCommand) {
        resolvedTypes = formatTypes(resolvedTypes, options.formatCommand, id);
      }

      for (let i = 0; i < calls.length; i++) {
        const { node } = calls[i];
        const json = JSON.stringify(resolvedTypes[i]);
        s.overwrite(node.getStart(), node.getEnd(), `expect({ [Symbol.for("tintype")]: ${json} })`);
      }

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true }),
      };
    },
  };
}
