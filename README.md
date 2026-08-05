<h1>
<p align="center">
  <img src="./assets/logo.svg" alt="tintype logo" width="200">
  <br>tintype
</h1>
<p align="center">
  because types deserve snapshots too
</p>
</p>

**tintype** is a tiny [vitest](https://vitest.dev) plugin that snapshots
inferred TypeScript types. It piggybacks on
[`toMatchInlineSnapshot`](https://vitest.dev/api/expect.html#tomatchinlinesnapshot),
but rather than snapshotting the value, it injects the inferred type from
the TypeScript checker.

## install

```sh
npm install tintype
```

## setup

```ts
// vitest.config.ts
import tintype from "tintype/plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tintype()],
  test: { setupFiles: ["tintype/setup"] },
});
```

## usage

```ts
// math.test.ts
import { expectType } from "tintype";
import { add } from "./math.js";

test("add returns a number", () => {
  expectType(add(1, 2)).toMatchInlineSnapshot(`number`);
});
```

It gets more interesting with narrowing and generics:

```ts
import { assert } from "vitest";
import { expectType } from "tintype";
import { isUser } from "./guards.js";

test("isUser narrows to User", () => {
  const user: unknown = { name: "alice", role: "admin" };
  assert(isUser(user), "Expected user");
  expectType(user).toMatchInlineSnapshot(`User`);
});
```

```ts
import { expectType } from "tintype";

declare function query<T extends Record<string, unknown>>(
  table: T[],
  key: keyof T,
): Pick<T, typeof key>[];

test("query narrows to picked fields", () => {
  const data = [{ id: 1, name: "a", score: 0.5 }];
  expectType(query(data, "name")).toMatchInlineSnapshot(
    `Pick<{ id: number; name: string; score: number; }, "name">[]`,
  );
});
```

Run `vitest --update` and the snapshot fills itself in. If the inferred type
ever changes, the snapshot drifts and the test fails.

## options

```ts
tintype({
  tsconfig: "./tsconfig.test.json",
  formatCommand: "prettier --parser typescript",
});
```

| option          | default       | description                                                                                                                                         |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig`      | auto-detected | Path to `tsconfig.json` for type resolution                                                                                                         |
| `formatCommand` | none          | Shell command to format type strings. Each type is wrapped as `type __tintype__ = <type>;` and piped via stdin. Use `{filename}` for the file path. |

## motivation

I love snapshot testing. I also write libraries that make heavy use of
TypeScript's type inference (like [quiver](https://github.com/manzt/quiver) and
[zarrita.js](https://github.com/manzt/zarrita.js)). TypeScript changes between
releases, and it's surprisingly hard to capture the _preciseness_ of what your
types actually infer — or don't. tintype lets you write a test, run `--update`,
and get a snapshot of exactly what TypeScript thinks. When inference breaks or
drifts, you see it in the diff.

At transform time, tintype finds `expectType(expr)` calls and uses the
TypeScript checker to resolve the type of `expr`. It rewrites the call to a
plain `expect` with the resolved type string, so vitest's snapshot machinery
takes over from there.

Both TypeScript API generations are supported, chosen by the installed
`typescript` version: 5.x/6.x uses the classic language service, and 7+ uses
the native (Go) implementation's `typescript/unstable/*` API. Type printing
can differ between the two (e.g. union member ordering), so expect a one-time
`--update` when crossing that boundary.

## development

This project uses [Vite+](https://vite.dev/plus/).

```sh
vp check         # format, lint, and type check
vp test          # run tests
vp run build     # build with tsc
```

## license

MIT
