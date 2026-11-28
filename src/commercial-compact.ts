import { money } from "./operations";
export const compactMoney = (amount: number | string, currency = "GTQ") =>
  amount == null ? "Pendiente" : currency === "GTQ" ? "Q" + new Intl.NumberFormat("en-GT", {minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(amount)) : money(amount,currency);
export const preparationComplete = (stage: string) => ["finished","courier","delivered"].includes(stage);
export function settlementResult(amount: number, state: string) {
  if (!amount) return "Sin diferencia";
  const label = state === "settled" ? (amount > 0 ? "Recibido del mensajero" : "Pagado al mensajero")
    : state === "cancelled" ? (amount > 0 ? "Ingreso original" : "Egreso original")
    : amount > 0 ? "Por recibir" : "Por pagar";
  return label + " " + compactMoney(Math.abs(amount));
}

export function settlementTone(amount: number, state: string) {
  if (!amount || state === "cancelled") return "neutral";
  if (state === "settled") return "settled";
  return amount > 0 ? "due" : "payable";
}
