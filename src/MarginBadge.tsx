import { onIdleRefresh } from "./idle-refresh";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase as db } from "./client";
import { AppIcon } from "./AppIcon";
import { defaultMargins, marginRange, type MarginRange } from "./margins";
import "./margins.css";
const Context = createContext<MarginRange[]>(defaultMargins);
export function MarginProvider({
  company,
  children,
}: {
  company: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<{
    company: string;
    ranges: MarginRange[];
  }>({ company: "", ranges: defaultMargins });
  useEffect(() => {
    let live = true;
    async function load() {
      if (!company) return;
      const r = await db.rpc("margin_settings", { p_company: company });
      if (live && !r.error)
        setState({ company, ranges: r.data?.ranges || defaultMargins });
    }
    const changed = (e: Event) => {
      if (!(e instanceof CustomEvent) || e.detail === company) void load();
    };
    void load();
    const cancelIdle = onIdleRefresh(load);
    window.addEventListener("ohana-margins-saved", changed);
    return () => {
      live = false;
      cancelIdle();
      window.removeEventListener("ohana-margins-saved", changed);
    };
  }, [company]);
  return (
    <Context.Provider
      value={state.company === company ? state.ranges : defaultMargins}
    >
      {children}
    </Context.Provider>
  );
}
export function MarginBadge({ value }: { value: number | null }) {
  const ranges = useContext(Context),
    r = marginRange(value, ranges);
  if (!r) return <span className="muted">Pendiente</span>;
  return (
    <span
      className="margin-badge"
      style={{ color: r.color, borderColor: r.color }}
      title={r.label}
    >
      <AppIcon name={r.icon} />
      <span>
        {value!.toLocaleString("es-GT", { maximumFractionDigits: 2 })} % ·{" "}
        {r.label}
      </span>
    </span>
  );
}
