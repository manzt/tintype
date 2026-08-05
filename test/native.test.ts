import { afterAll, expect, test } from "vitest";
import { createNativeResolver } from "../src/native.js";

// Exercise the typescript 7 backend through the aliased `typescript7`
// devDependency; the package's own `typescript` peer stays 5.x.
const resolver = await createNativeResolver({ typescriptSpecifier: "typescript7" });

afterAll(() => resolver.dispose());

const fileName = new URL("./__ts7_virtual__.ts", import.meta.url).pathname;

function program(body: string): string {
  return [
    "declare function expectType<T>(x: T): { toMatchInlineSnapshot(s?: string): void };",
    body,
  ].join("\n");
}

test("resolves types for expectType call sites", () => {
  const code = program(
    [
      "const arr = [1, 2, 3];",
      "expectType(arr).toMatchInlineSnapshot();",
      'const obj = { name: "alice", age: 30 };',
      "expectType(obj).toMatchInlineSnapshot();",
    ].join("\n"),
  );

  const result = resolver.analyze(fileName, code);
  expect(result.calls.map((c) => c.type)).toEqual(["number[]", "{ name: string; age: number; }"]);
  expect(code.slice(result.calls[0].start, result.calls[0].end)).toBe("expectType(arr)");
  expect(result.hasExpectImport).toBe(false);
});

test("re-analyzing changed content returns fresh types", () => {
  const before = program('const x = "hello" as const;\nexpectType(x).toMatchInlineSnapshot();');
  expect(resolver.analyze(fileName, before).calls[0].type).toBe('"hello"');

  const after = program("const x = 42 as const;\nexpectType(x).toMatchInlineSnapshot();");
  expect(resolver.analyze(fileName, after).calls[0].type).toBe("42");
});

test("detects an existing expect import", () => {
  const code = program(
    ['import { expect } from "vitest";', "expectType(1 + 1).toMatchInlineSnapshot();"].join("\n"),
  );
  expect(resolver.analyze(fileName, code).hasExpectImport).toBe(true);
});

test("ignores files without matching call chains", () => {
  const code = program("const y: number = 1;\nexpectType;");
  expect(resolver.analyze(fileName, code).calls).toEqual([]);
});
