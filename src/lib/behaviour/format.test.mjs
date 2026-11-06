import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAge, countOf } from "./format.js";

test("formatAge: days, months and years read naturally", () => {
  assert.equal(formatAge(null), null);
  assert.equal(formatAge(0), "less than a day");
  assert.equal(formatAge(1), "1 day");
  assert.equal(formatAge(45), "45 days");
  assert.equal(formatAge(100), "3 months");
  assert.equal(formatAge(362), "11 months"); // 11 months 27 days: not rounded up to a year
  assert.equal(formatAge(365), "1 year"); // not "12 months"
  assert.equal(formatAge(716), "1 year 11 months"); // was shown as "2 years"
  assert.equal(formatAge(820), "2 years 2 months");
});

test("countOf: singular for one, thousands separator for many", () => {
  assert.equal(countOf(1, "wallet"), "1 wallet");
  assert.equal(countOf(0, "transfer"), "0 transfers");
  assert.equal(countOf(1282, "transfer"), "1,282 transfers");
});
