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
    const load = () =>
      request("company_icons", { p_company: company })
        .then((icons) => {
          if (live) setState({ company, icons: icons || {} });
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("ohana-icons-saved", load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("ohana-icons-saved", load);
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
  const selected = entry.locked
    ? entry.icon
    : override || saved[name] || entry.icon;
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
export function AppButton({
  children,
  iconKey,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { iconKey?: string }) {
  const action = actionIcon(textOf(children));
  const key = iconKey || (action ? "action." + action : "");
  return (
    <button {...props}>
      {key && <AppIcon name={key} />}
      <span>{children}</span>
    </button>
  );
}
