import assert from "node:assert/strict";
import { test } from "node:test";
import { inventoryCountPreview } from "../src/inventory-count-preview.ts";

test("count preview supports mixed actions and explicit zero", () => {
  for (const [input, action, resulting, difference] of [
    ["50", "count", 50, -4],
    ["10", "adjust_in", 64, 10],
    ["10", "adjust_out", 44, -10],
    ["0", "count", 0, -54],
    ["54", "count", 54, 0],
    ["1.25", "adjust_out", 52.75, -1.25],
  ]) {
    assert.deepEqual(inventoryCountPreview(54, input, action), { theoretical: 54, resulting, difference });
  }
});

test("count preview leaves uncaptured, missing and invalid quantities pending", () => {
  for (const input of ["", " ", undefined, null, "abc", "-1"]) {
    assert.deepEqual(inventoryCountPreview(54, input, "count"), { theoretical: 54, resulting: null, difference: null });
  }
  assert.deepEqual(inventoryCountPreview(54, "0", "adjust_in"), { theoretical: 54, resulting: null, difference: null });
  assert.deepEqual(inventoryCountPreview(null, "0", "count"), { theoretical: null, resulting: null, difference: null });
});
