import assert from "node:assert/strict";
import test from "node:test";
import { distributeSaleDiscount, saleDiscountAmount, saleLineTotals, saleTotals } from "../src/sale-form-model.ts";

test("line discounts drive the invoice amount, percentage and total with shipping", () => {
  const lines = [{ quantity: 1, unit_price: 140, line_discount_input: "5" }];
  assert.deepEqual(saleTotals(lines, { shipping_charged: 30 }), {
    subtotal: 140, discount: 5, percent: 3.57, shipping: 30, total: 165,
  });
});

test("a header discount replaces existing line amounts, distributes cents and excludes gifts", () => {
  const lines = [
    { quantity: 1, unit_price: 100, line_discount_input: "12" },
    { quantity: 2, unit_price: 25 },
    { quantity: 1, unit_price: 40, is_gift: true },
  ];
  const distributed = distributeSaleDiscount(lines, 10.01);
  assert.deepEqual(distributed.map((line) => saleLineTotals(line).discount), [6.67, 3.34, 0]);
  assert.equal(saleTotals(distributed, {}).total, 139.99);
  assert.equal(saleTotals(distributeSaleDiscount(distributed, 0), {}).discount, 0);
});

test("opening a legacy invoice combines its discounts without changing its total", () => {
  const lines = [
    { quantity: 1, unit_price: 50, line_discount: 50 },
    { quantity: 2, unit_price: 35, line_discount: 5 },
  ];
  const converted = distributeSaleDiscount(lines, 15, true);
  assert.deepEqual(converted.map((line) => saleLineTotals(line).discount), [50, 20]);
  assert.equal(saleTotals(converted, {}).total, 50);
  assert.equal(saleDiscountAmount({ discount: 15, lines }), 70);
});
