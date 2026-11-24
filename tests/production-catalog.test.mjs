import assert from "node:assert/strict";
import { test } from "node:test";
import { productionDate, productionMatches, productionStatus } from "../src/production-catalog.ts";

test("production search combines product, document and formula terms", () => {
  const fields = ["PROD-0042", "Jabón de limón", "F-018"];
  assert.equal(productionMatches("limon prod-0042 f-018", ...fields), true);
  assert.equal(productionMatches("   ", ...fields), true);
  assert.equal(productionMatches("limón F-019", ...fields), false);
});

test("production filters keep existing curing and finalization boundaries", () => {
  const today = "2026-11-24";
  assert.equal(productionStatus({ state: "curing", available_on: "2026-11-25" }, today), "curing");
  assert.equal(productionStatus({ state: "curing", available_on: today }, today), "ready_to_release");
  assert.equal(productionStatus({ state: "released", finalized_at: today }, today), "finished");
  assert.equal(productionStatus({ state: "cancelled", available_on: today }, today), "cancelled");
  assert.equal(productionDate(today), "24/11/2026");
  assert.equal(productionDate(null), "—");
});
