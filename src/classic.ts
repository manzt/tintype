/**
 * Resolver backend for typescript 5.x/6.x, built on the classic JS compiler
 * API (`ts.createLanguageService`). typescript 7+ no longer ships this API;
 * see `native.ts` for the replacement.
 */

import ts from "typescript";
import type { ExpectTypeCall, FileAnalysis, Resolver, ResolverOptions } from "./resolver.ts";

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

function hasExpectImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings) &&
      stmt.importClause.namedBindings.elements.some((el) => el.name.text === "expect"),
  );
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

export function createClassicResolver(options: ResolverOptions): Resolver {
  const service = createLanguageService(loadCompilerOptions(options.tsconfig));

  return {
    analyze(fileName, code): FileAnalysis {
      const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
      const found = findExpectTypeCalls(sourceFile);
      if (found.length === 0) {
        return { calls: [], hasExpectImport: false };
      }

      service.addFile(fileName, code);
      const calls: ExpectTypeCall[] = found.map(({ node, arg }) => ({
        start: node.getStart(),
        end: node.getEnd(),
        type: getTypeAtPosition(service, fileName, arg),
      }));
      return { calls, hasExpectImport: hasExpectImport(sourceFile) };
    },
    dispose() {
      service.dispose();
    },
  };
}
