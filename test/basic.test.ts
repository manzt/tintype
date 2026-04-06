import { test } from "vitest";
import { expectType } from "../src/index.js";

test("literal types", () => {
  const x = "hello" as const;
  expectType(x).toMatchInlineSnapshot(`"hello"`);
});

test("primitive types", () => {
  const n = 42;
  expectType(n).toMatchInlineSnapshot(`42`);

  const s = "world";
  expectType(s).toMatchInlineSnapshot(`"world"`);

  const b = true;
  expectType(b).toMatchInlineSnapshot(`true`);
});

test("arrays", () => {
  const arr = [1, 2, 3];
  expectType(arr).toMatchInlineSnapshot(`number[]`);
});

test("objects", () => {
  const obj = { name: "alice", age: 30 };
  expectType(obj).toMatchInlineSnapshot(`{ name: string; age: number; }`);
});

test("generics", () => {
  function identity<T>(x: T): T {
    return x;
  }
  expectType(identity(42)).toMatchInlineSnapshot(`42`);
  expectType(identity("hi")).toMatchInlineSnapshot(`"hi"`);
});

test("union types", () => {
  const x: string | number = Math.random() > 0.5 ? "a" : 1;
  expectType(x).toMatchInlineSnapshot(`string | number`);
});

test("narrowing", () => {
  const x: string | number = "hello";
  if (typeof x === "string") {
    expectType(x).toMatchInlineSnapshot(`string`);
  }
});

test("mapped types", () => {
  type Readonly<T> = { readonly [K in keyof T]: T[K] };
  const obj: Readonly<{ a: number; b: string }> = { a: 1, b: "x" };
  expectType(obj).toMatchInlineSnapshot(`Readonly<{ a: number; b: string; }>`);
});

test("property access", () => {
  const obj = { name: "alice" as const, age: 30 };
  expectType(obj.name).toMatchInlineSnapshot(`"alice"`);
  expectType(obj.age).toMatchInlineSnapshot(`number`);
});

test("method return type", () => {
  const arr = [1, 2, 3];
  expectType(arr.map((x) => String(x))).toMatchInlineSnapshot(`string[]`);
});

test("type guard narrowing on property", () => {
  class Box<T> {
    constructor(public value: T) {}
    is(check: "string"): this is Box<string>;
    is(check: "number"): this is Box<number>;
    is(check: string): boolean {
      return typeof this.value === check;
    }
  }
  const box = new Box<string | number>("hello");
  expectType(box.value).toMatchInlineSnapshot(`string | number`);
  if (box.is("string")) {
    expectType(box.value).toMatchInlineSnapshot(`string`);
  }
});
