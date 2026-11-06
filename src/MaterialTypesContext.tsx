import { onIdleRefresh } from "./idle-refresh";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase as db } from "./client";
import {
  defaultMaterialTypes,
  type MaterialType,
} from "./material-types-model";
const Context = createContext<MaterialType[]>(defaultMaterialTypes);
export const useMaterialTypes = () => useContext(Context);
export function MaterialTypesProvider({
  company,
  children,
}: {
  company: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<{
    company: string;
    types: MaterialType[];
  }>({ company: "", types: defaultMaterialTypes });
  useEffect(() => {
    let live = true;
    async function load() {
      if (!company) return;
      const r = await db
        .from("material_types")
        .select("*")
        .eq("company_id", company)
        .order("name");
      if (live && !r.error) setState({ company, types: r.data || [] });
    }
    const changed = (e: Event) => {
      if (!(e instanceof CustomEvent) || e.detail === company) void load();
    };
    void load();
    const cancelIdle = onIdleRefresh(load);
    window.addEventListener("ohana-material-types-saved", changed);
    return () => {
      live = false;
      cancelIdle();
      window.removeEventListener("ohana-material-types-saved", changed);
    };
  }, [company]);
  return (
    <Context.Provider
      value={state.company === company ? state.types : company ? [] : defaultMaterialTypes}
    >
      {children}
    </Context.Provider>
  );
}

export function MaterialTypeLabel({
  typeKey,
}: {
  typeKey: string | null | undefined;
}) {
  const types = useMaterialTypes();
  return (
    <>{types.find((t) => t.key === typeKey)?.name || typeKey || "Pendiente"}</>
  );
}
