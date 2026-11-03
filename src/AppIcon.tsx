import {
  createContext,
  useContext,
  useEffect,
  useState,
  lazy,
  Suspense,
  isValidElement,
  Children,
} from "react";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import {
  House,
  Layers,
  Package,
  ShoppingCart,
  FlaskConical,
  Factory,
  Warehouse,
  TrendingUp,
  Users,
  ChartColumn,
  Settings,
  Save,
  CircleCheck,
  X,
  Pencil,
  Trash2,
  Plus,
  Copy,
  Search,
  GitCompareArrows,
  History,
  Calculator,
  Download,
  Upload,
  Printer,
  Barcode,
  RefreshCw,
  UserRoundCog,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Info,
  TriangleAlert,
  CircleAlert,
} from "lucide-react";
import { request } from "./commerce";
import { iconRegistry, actionIcon } from "./icon-registry";
const Dynamic = lazy(() => import("./LucideDynamic"));
const defaults: Record<string, any> = {
  house: House,
  layers: Layers,
  package: Package,
  "shopping-cart": ShoppingCart,
  "flask-conical": FlaskConical,
  factory: Factory,
  warehouse: Warehouse,
  "trending-up": TrendingUp,
  users: Users,
  "chart-column": ChartColumn,
  settings: Settings,
  save: Save,
  "circle-check": CircleCheck,
  x: X,
  pencil: Pencil,
  "trash-2": Trash2,
  plus: Plus,
  copy: Copy,
  search: Search,
  "git-compare-arrows": GitCompareArrows,
  history: History,
  calculator: Calculator,
  download: Download,
  upload: Upload,
  printer: Printer,
  barcode: Barcode,
  "refresh-cw": RefreshCw,
  "user-round-cog": UserRoundCog,
  "arrow-left": ArrowLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  clock: Clock,
  info: Info,
  "triangle-alert": TriangleAlert,
  "circle-alert": CircleAlert,
};
const Context = createContext<Record<string, string>>({});
export function notifyIconsChanged(company: string) {
  window.dispatchEvent(
    new CustomEvent("ohana-icons-saved", { detail: { company } }),
  );
  try {
    localStorage.setItem(
      "ohana-icons-refresh",
      JSON.stringify({ company, at: Date.now() }),
    );
  } catch {}
}
export function IconProvider({
  company,
  children,
}: {
  company: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<{
    company: string;
    icons: Record<string, string>;
  }>({ company: "", icons: {} });
  useEffect(() => {
    let live = true;
    setState({ company, icons: {} });
    if (!company) return;
    let revision = 0;
    const load = () => {
      const ticket = ++revision;
      return request("company_icons", { p_company: company })
        .then((icons) => {
          if (live && ticket === revision)
            setState({ company, icons: icons || {} });
        })
        .catch(() => {});
    };
    const changed = (e: Event) => {
      if (
        !(e instanceof CustomEvent) ||
        !e.detail?.company ||
        e.detail.company === company
      )
        void load();
    };
    const stored = (e: StorageEvent) => {
      if (e.key !== "ohana-icons-refresh" || !e.newValue) return;
      try {
        if (JSON.parse(e.newValue).company === company) void load();
      } catch {}
    };
    /* active names only: the option library stays lazy in Appearance */

    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("ohana-icons-saved", changed);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("ohana-icons-saved", changed);
      window.removeEventListener("storage", stored);
      window.removeEventListener("focus", load);
    };
  }, [company]);
  return (
    <Context.Provider value={state.company === company ? state.icons : {}}>
      {children}
    </Context.Provider>
  );
}
export function AppIcon({
  name,
  override,
}: {
  name: string;
  override?: string;
}) {
  const saved = useContext(Context),
    entry = iconRegistry.find((e) => e.key === name);
  if (!entry) return null;
  const selected = override || saved[name] || entry.icon;
  const Icon = defaults[selected];
  return (
    <span className="app-icon" aria-hidden="true">
      {Icon ? (
        <Icon size={18} strokeWidth={1.8} />
      ) : (
        <Suspense fallback={<span className="icon-placeholder" />}>
          <Dynamic name={selected} />
        </Suspense>
      )}
    </span>
  );
}
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((n) =>
      typeof n === "string" || typeof n === "number"
        ? String(n)
        : isValidElement<{ children?: ReactNode }>(n)
          ? textOf(n.props.children)
          : "",
    )
    .join(" ");
}
function containsIcon(node: ReactNode): boolean {
  return Children.toArray(node).some(
    (n) =>
      isValidElement<{ children?: ReactNode }>(n) &&
      (n.type === AppIcon ||
        n.type === "svg" ||
        containsIcon(n.props.children)),
  );
}
export function AppButton({
  children,
  iconKey,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { iconKey?: string }) {
  const label = props["aria-label"] || props.title || textOf(children);
  const action = actionIcon(label);
  const key =
    iconKey ||
    (/ordenar/i.test(label)
      ? "control.sort"
      : /filtrar/i.test(label)
        ? "control.filter"
        : /desactivar|archivar/i.test(label)
          ? "status.archived"
          : /reactivar|activar/i.test(label)
            ? "status.active"
            : action
              ? "action." + action
              : /configuraci[oó]n|colores|tipograf[ií]a|[ií]conos|administrar corporaciones/i.test(
                    label,
                  )
                ? "module.settings"
                : label.trim()
                  ? "action.expand"
                  : "");
  const addIcon = !!key && !containsIcon(children);
  const content = Children.map(children, (n) =>
    typeof n === "string" && addIcon
      ? /^[\s×✕✖▥↗]+$/.test(n)
        ? null
        : n.replace(/^\s*\+\s*(?=\S)/, "")
      : n,
  );
  return (
    <button
      {...props}
      className={
        [
          props.className,
          /eliminar|borrar|quitar|retirar|archivar|desactivar|cancelar pedido|salir sin guardar/i.test(
            label,
          )
            ? "danger"
            : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
      aria-label={
        props["aria-label"] ||
        (addIcon && /^[\s×✕✖▥]+$/.test(textOf(children)) ? label : undefined)
      }
    >
      {addIcon && <AppIcon name={key} />}
      <span>{content}</span>
    </button>
  );
}
