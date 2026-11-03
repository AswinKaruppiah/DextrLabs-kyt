import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAge } from "./format.js";

test("formatAge: days, months and years read naturally", () => {
  assert.equal(formatAge(null), null);
  assert.equal(formatAge(0), "less than a day");
  assert.equal(formatAge(1), "1 day");
  assert.equal(formatAge(45), "45 days");
  assert.equal(formatAge(100), "3 months");
  assert.equal(formatAge(362), "1 year"); // not "12 months"
  assert.equal(formatAge(365), "1 year");
  assert.equal(formatAge(820), "2 years 3 months");
});
