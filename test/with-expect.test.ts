import { expect, test } from "vitest";
import { expectType } from "../src/index.js";

test("works alongside existing expect import", () => {
  const x = [1, 2, 3];
  expectType(x).toMatchInlineSnapshot(`number[]`);
  expect(x).toHaveLength(3);
});
