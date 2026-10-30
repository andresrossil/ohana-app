import { supabase as db } from "./client";
export async function request(name: string, params: Record<string, any>) {
  const r = await db.rpc(name, params);
  if (r.error) throw r.error;
  return r.data;
}
export const sales = (company: string) =>
  request("sales", { p_company: company, p_action: "list" });
export const storeLink = (company: string) =>
  new URL(`${import.meta.env.BASE_URL}?shop=${company}`, location.origin).href;
