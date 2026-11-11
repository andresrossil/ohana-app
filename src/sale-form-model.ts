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
export function saleTotals(lines: Row[], delivery: Row, mode: string, input: string | number) {
  const subtotal = roundMoney(lines.reduce((sum,line)=>sum+saleLineTotals(line).net,0));
  const source=Number(input||0);
  const discount=mode==='percent'?roundMoney(subtotal*source/100):roundMoney(source);
  const percent=subtotal>0?roundMoney(discount/subtotal*100):0;
  const shipping=delivery.kind==='pickup'||delivery.payer==='customer'?0:Number(delivery.shipping_charged||0);
  return {subtotal,discount,percent,shipping,total:roundMoney(subtotal-discount+shipping)};
}
