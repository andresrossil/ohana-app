type Row = Record<string, any>;
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function saleTotals(lines: Row[], delivery: Row, mode: string, input: string | number) {
  const subtotal = roundMoney(lines.reduce((sum,l)=>sum+(l.is_gift?0:roundMoney(Number(l.quantity||0)*Number(l.unit_price||0))),0));
  const source=Number(input||0);
  const discount=mode==='percent'?roundMoney(subtotal*source/100):roundMoney(source);
  const percent=subtotal>0?roundMoney(discount/subtotal*100):0;
  const shipping=delivery.kind==='pickup'||delivery.payer==='customer'?0:Number(delivery.shipping_charged||0);
  return {subtotal,discount,percent,shipping,total:roundMoney(subtotal-discount+shipping)};
}
