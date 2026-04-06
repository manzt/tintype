import { expect } from "vitest";

const kType = Symbol.for("tintype");

expect.addSnapshotSerializer({
  test: (val) => val != null && typeof val === "object" && kType in val,
  serialize: (val) => (val as { [kType]: string })[kType],
});
