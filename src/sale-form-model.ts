type Row = Record<string, any>;
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function saleLineTotals(line: Row) {
  const gross = line.is_gift ? 0 : roundMoney(Number(line.quantity || 0) * roundMoney(Number(line.unit_price || 0)));
  const input = Number(line.line_discount_input ?? line.line_discount ?? 0);
  const discount = line.is_gift ? 0 : roundMoney(
    line.line_discount_mode === "percent" ? gross * input / 100 : input,
  );
  return {
    gross,
    discount,
    percent: gross > 0 ? roundMoney(discount / gross * 100) : 0,
    net: roundMoney(gross - discount),
    valid: Number.isFinite(discount) && discount >= 0 && discount <= gross &&
      (line.is_gift || line.line_discount_mode !== "percent" || input <= 100),
  };
}
export function distributeSaleDiscount(lines: Row[], amount: number, addToExisting = false) {
  const values = lines.map(saleLineTotals);
  const bases = values.map((line) => Math.round((addToExisting ? line.net : line.gross) * 100));
  const base = bases.reduce((sum, cents) => sum + cents, 0);
  const requested = Math.round(roundMoney(amount) * 100);
  if (!Number.isFinite(requested) || requested < 0 || requested > base) return lines;

  // Round cumulative shares so the last cent is included in the line amounts.
  let covered = 0;
  let allocated = 0;
  return lines.map((line, index) => {
    covered += bases[index];
    const cumulative = base > 0 ? Math.round(requested * (covered / base)) : 0;
    const cents = cumulative - allocated;
    allocated = cumulative;
    const previous = addToExisting ? values[index].discount : 0;
    return { ...line, line_discount_mode: "amount", line_discount_input: roundMoney(previous + cents / 100).toFixed(2) };
  });
}

export function saleDiscountAmount(order: Row) {
  return roundMoney(Number(order.discount || 0) + (order.lines ?? []).reduce(
    (sum: number, line: Row) => sum + Number(line.line_discount || 0), 0,
  ));
}

export function saleTotals(lines: Row[], delivery: Row) {
  const values = lines.map(saleLineTotals);
  const subtotal = roundMoney(values.reduce((sum, line) => sum + line.gross, 0));
  const discount = roundMoney(values.reduce((sum, line) => sum + line.discount, 0));
  const percent = subtotal > 0 ? roundMoney(discount / subtotal * 100) : 0;
  const shipping=delivery.kind==='pickup'||delivery.payer==='customer'?0:Number(delivery.shipping_charged||0);
  return {subtotal,discount,percent,shipping,total:roundMoney(subtotal-discount+shipping)};
}
