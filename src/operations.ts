import { supabase as db } from "./client";
import { useEffect, useState } from "react";
export type Row = Record<string, any>;
export const today = () => new Date().toLocaleDateString("en-CA");
export const money = (n: any, c = "GTQ") =>
  n == null
    ? "Pendiente"
    : new Intl.NumberFormat("es-GT", {
        style: "currency",
        currency: c,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(n));
export async function operation(
  company: string,
  action: string,
  data: Row = {},
  key?: string,
): Promise<any> {
  const r = await db.rpc("operations", {
    p_company: company,
    p_action: action,
    p_data: data,
    p_key: key || null,
  });
  if (r.error) throw r.error;
  return r.data;
}
const pending = new Map<string, string>();
function canonical(value: any): string {
  return value && typeof value === "object"
    ? Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}"
    : JSON.stringify(value);
}
export async function keyedRequest(
  company: string,
  endpoint: string,
  data: Row,
  action?: string,
) {
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(data)),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const id = `ohana.pending.${company}.${endpoint}.${action || ""}.${hash}`;
  let key = pending.get(id);
  try {
    key = key || sessionStorage.getItem(id) || undefined;
  } catch {}
  key = key || crypto.randomUUID();
  pending.set(id, key);
  try {
    sessionStorage.setItem(id, key);
  } catch {}
  const response = await db.rpc(endpoint, {
    p_company: company,
    p_key: key,
    p_data: data,
    ...(action ? { p_action: action } : {}),
  });
  if (response.error) throw response.error;
  const result = response.data;
  pending.delete(id);
  try {
    sessionStorage.removeItem(id);
  } catch {}
  return result;
}
export const mutate = (company: string, action: string, data: Row) =>
  keyedRequest(company, "operations", data, action);
export function useOperation(company: string, module: string) {
  const [canWrite, setWrite] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    db.rpc("company_permission", {
      p_company: company,
      p_action: "write",
      p_module: module,
    }).then((r) => {
      if (live) setWrite(!r.error && r.data === true);
    });
    return () => {
      live = false;
    };
  }, [company, module]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e: any) {
      setError(e.message || "No se pudo completar la operación");
    } finally {
      setBusy(false);
    }
  }
  return { canWrite, error, setError, busy, notice, setNotice, run };
}
