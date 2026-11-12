import { supabase as db } from "./client";
export async function request(name: string, params: Record<string, any>) {
  const r = await db.rpc(name, params);
  if (r.error) throw r.error;
  return r.data;
}
export const sales = (company: string) =>
  request("sales", { p_company: company, p_action: "list", p_data: { catalog_only: true } });
export const salesWorklist = (company: string, action: string, filters = {}) =>
  request("sales_fulfillment", { p_company: company, p_action: action, p_data: filters });

const salesDateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Guatemala" });
export function salesTodayRange() {
  const date = salesDateFormat.format(new Date());
  return { from: date, to: date };
}
export const storeLink = (company: string) =>
  new URL(`${import.meta.env.BASE_URL}?shop=${company}`, location.origin).href;
