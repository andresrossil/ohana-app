import { DISCLOSURE_INITIALLY_OPEN } from "./disclosure-default";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "./client";
import { money } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import { AppButton, AppIcon } from "./AppIcon";
import { IconDetails, SearchField } from "./PoolControls";
import { settlementNumber } from "./courier-account";
import { lotCode } from "./BatchTrace";
import { curingCount, summarizeCuringProducts, useCuringProduction } from "./CuringProduction";
import "./dashboard.css";

type Quantity = number | string;
type Stock = { id: string; product: string; variant: string; available: Quantity;
  curing?: Quantity | null; estimated?: Quantity; unknown_lots?: number; general_price?: Quantity | null };
type Material = { id: string; sku: string | null; name: string; unit: string | null; minimum: Quantity; available: Quantity };
type DashboardData = Record<string, unknown> & {
  available_products?: Stock[];
  pending_settlements?: { id: string; number: number; date: string; courier: string; state: string; remaining: Quantity }[];
  suggested_production?: { id: string; name: string; minimum: Quantity; available: Quantity; suggested: Quantity }[];
  reorder_materials?: Material[];
  price_list?: string | null;
  suppliers?: number; customers?: number; drafts?: number; invoices?: number; active_customers?: number; reorder?: number;
};
type Panel = "stock" | "settlements" | "reorder" | "curing";
type Props = {
  company: string; currency: string; companyName?: string; corporationName?: string;
  materials?: number; products?: number; catalogRead?: boolean;
  onOpenSettlement?: (id: string) => void;
  onProduction?: (id?: string) => void;
  onDrafts?: () => void;
};
const order = new Intl.Collator("es-GT", { sensitivity: "base", numeric: true });
const month = new Intl.DateTimeFormat("es-GT", { month: "long", year: "numeric", timeZone: "America/Guatemala" });
const number = (value: Quantity | null | undefined) =>
  value == null ? "—" : Number(value).toLocaleString("es-GT", { maximumFractionDigits: 2 });
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  const searchable = normalize(fields.filter(Boolean).join(" "));
  return normalize(query.trim()).split(/\s+/).every(term => searchable.includes(term));
};
const dateLabel = (date: string | null) => date?.split("-").reverse().join("/") || "—";

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return <div className="dashboard-metric" data-tone={tone}>
    <span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}
  </div>;
}
function SectionHeading({ icon, children }: { icon: string; children: ReactNode }) {
  return <h2 className="dashboard-section-heading"><AppIcon name={icon} />{children}</h2>;
}
function DashboardPanel({ id, title, subtitle, icon, count, open, toggle, children }: {
  id: Panel; title: string; subtitle?: string; icon: string; count?: number; open: boolean;
  toggle: () => void; children: ReactNode;
}) {
  return <section className="dashboard-surface dashboard-panel" id={`dashboard-${id}`} aria-labelledby={`dashboard-${id}-label`}>
    <h2><button type="button" className="dashboard-panel-toggle" aria-expanded={open}
      aria-controls={`dashboard-${id}-content`} onClick={toggle}>
      <AppIcon name={icon} />
      <span><strong id={`dashboard-${id}-label`}>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
      {count != null && <span className="dashboard-count">{count}</span>}
      <ChevronDown size={18} aria-hidden="true" />
    </button></h2>
    <div id={`dashboard-${id}-content`} hidden={!open} className="dashboard-panel-content">{children}</div>
  </section>;
}
function Pending({ label, count, icon, onClick }: { label: string; count: number; icon: string; onClick?: () => void }) {
  const inside = <><AppIcon name={icon} /><span>{label}</span><strong>{count}</strong>{onClick && <ChevronRight size={16} aria-hidden="true" />}</>;
  return onClick ? <button type="button" className="dashboard-pending" data-pending={count > 0} onClick={onClick}>{inside}</button>
    : <div className="dashboard-pending" data-pending={count > 0}>{inside}</div>;
}
function BusinessCard({ icon, label, count, children }: { icon: string; label: string; count?: number; children?: ReactNode }) {
  return <article className="dashboard-surface dashboard-business-card">
    <h3><AppIcon name={icon} />{label}</h3><strong>{number(count)}</strong>{children}
  </article>;
}

export default function Dashboard({ company, currency, companyName, corporationName, materials, products,
  catalogRead, onOpenSettlement, onProduction, onDrafts }: Props) {
  const [data, setData] = useState<DashboardData>();
  const [failed, setFailed] = useState(false);
  const [skus, setSkus] = useState<Record<string, string>>({});
  const [opens, setOpens] = useState<Partial<Record<Panel, boolean>>>({});
  const [stockQuery, setStockQuery] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [curingQuery, setCuringQuery] = useState("");
  const [lotGroupOpens, setLotGroupOpens] = useState<Record<string, boolean>>({});
  const { batches, error: curingError, date } = useCuringProduction(onProduction ? company : null);
  useEffect(() => {
    let active = true;
    let latest = 0;
    async function load() {
      const sequence = ++latest;
      const { data, error } = await supabase.rpc("company_dashboard", { p_company: company });
      if (active && sequence === latest) {
        setFailed(Boolean(error));
        setData(error ? undefined : data);
      }
    }
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [company]);

  useEffect(() => {
    if (!catalogRead || !data?.available_products?.length) return;
    const ids = data.available_products.filter(row => !row.id.startsWith("unassigned-")).map(row => row.id);
    if (!ids.length) return;
    let active = true;
    async function loadSkus() {
      const pages = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
        supabase.from("product_variants").select("id,sku").eq("company_id", company).in("id", ids.slice(i * 100, (i + 1) * 100))));
      if (active) setSkus(Object.fromEntries(pages.flatMap(result =>
        (result.data ?? []).map(row => [row.id, row.sku]))));
    }
    void loadSkus();
    return () => { active = false; };
  }, [company, catalogRead, data?.available_products]);

  const stock = (data?.available_products ?? []).filter(row => matches(stockQuery, row.product, row.variant, skus[row.id]))
    .sort((a, b) => order.compare(a.product, b.product) || order.compare(a.variant, b.variant) || a.id.localeCompare(b.id));
  const reorder = (data?.reorder_materials ?? []).filter(row => matches(materialQuery, row.name, row.sku))
    .sort((a, b) => order.compare(a.name, b.name) || order.compare(a.sku || "", b.sku || ""));
  const curing = curingError ? [] : batches ?? [];
  const groups = summarizeCuringProducts(curing, true).filter(([, row]) => matches(curingQuery, row.name))
    .sort(([, a], [, b]) => order.compare(a.name, b.name) || (a.availableOn ?? "9999").localeCompare(b.availableOn ?? "9999"));
  const ready = curing.filter(batch => batch.available_on && batch.available_on <= date).length;
  const low = data?.reorder_materials?.length ?? data?.reorder;
  const settlements = data?.pending_settlements;
  const tally = (value: Quantity, unit?: string | null) => [number(value), unit].filter(Boolean).join(" ");
  const cash = (value: Quantity) => currency === "GTQ" ? "Q " + Number(value).toLocaleString("es-GT", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) : money(value, currency);
  const amount = (key: string) => data?.[key] == null ? "—" : cash(Number(data[key]));
  const missing = (key: string) => Number(data?.[key]) > 0 ? `Valor parcial · ${number(Number(data?.[key]))} sin precio o costo` : undefined;
  const previous = Number(data?.sales_previous);
  const variation = previous > 0 && data?.sales_current != null ? number((Number(data.sales_current) / previous - 1) * 100) + " %" : "—";
  const toggle = (id: Panel) => setOpens(current => ({ ...current, [id]: !(current[id] ?? DISCLOSURE_INITIALLY_OPEN) }));
  const reveal = (id: Panel) => {
    setOpens(current => ({ ...current, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`dashboard-${id}`)?.scrollIntoView({ block: "start" }));
  };
  const hasReorder = low != null || !!data?.suggested_production?.length;
  return <div className="ohana-home">
    <header className="dashboard-welcome">
      {corporationName && <span>{corporationName}</span>}
      <h1>Inicio</h1>
      <p>{companyName && <strong>{companyName}</strong>}<span>Tu negocio, en armonía</span></p>
    </header>
    {failed && <p className="error" role="alert">No se pudieron cargar los indicadores del dashboard.</p>}
    {!data && !failed && <p role="status">Cargando indicadores…</p>}
    <div className="dashboard-overview">
      <section className="dashboard-surface dashboard-alerts">
        <SectionHeading icon="status.warning">Pendientes y alertas</SectionHeading>
        <div className="dashboard-pending-list">
          {onProduction && <Pending label="Lotes listos" icon="status.pending" count={ready} onClick={() => reveal("curing")} />}
          {low != null && <Pending label="Materiales bajo mínimo" icon="module.materials" count={low} onClick={() => reveal("reorder")} />}
          {data?.drafts != null && <Pending label="Pedidos en borrador" icon="module.sales" count={data.drafts} onClick={onDrafts} />}
          {settlements && <Pending label="Liquidaciones pendientes" icon="module.settlements" count={settlements.length} onClick={() => reveal("settlements")} />}
          {!onProduction && low == null && data?.drafts == null && !settlements && data && <p>Sin indicadores disponibles.</p>}
        </div>
      </section>
      {data?.sales_current != null && <section className="dashboard-surface dashboard-sales">
        <SectionHeading icon="module.sales">Ventas y facturación</SectionHeading>
        <div className="dashboard-sales-main"><Metric label={`Ventas · ${month.format(new Date())}`} value={amount("sales_current")} /></div>
        <div className="dashboard-values dashboard-values-two">
          <Metric label="Mes anterior" value={amount("sales_previous")} />
          <Metric label="Variación mensual" value={variation} />
        </div>
        <div className="dashboard-values dashboard-values-three dashboard-sales-totals">
          <Metric label="Facturas" value={number(data.invoices)} />
          <Metric label="Clientes activos" value={number(data.active_customers)} />
          <Metric label="Promedio por factura" value={amount("drop_size")} />
        </div>
      </section>}
    </div>
    {(materials != null || products != null || data?.customers != null || data?.suppliers != null) && <section>
      <SectionHeading icon="module.inventory">Resumen del negocio</SectionHeading>
      <div className="dashboard-business">
        {materials != null && <BusinessCard icon="module.materials" label="Materiales" count={materials}>
          <Metric label="Valor de inventario" value={amount("material_value")} note={missing("material_missing")} />
        </BusinessCard>}
        {products != null && <BusinessCard icon="module.products" label="Productos" count={products}>
          <Metric label="Valor de productos" value={data?.price_list ? amount("product_value") : "—"}
            note={data?.price_list ? [`Lista ${data.price_list}`, missing("product_missing")].filter(Boolean).join(" · ")
              : data?.product_value != null ? "Sin lista General activa" : undefined} />
        </BusinessCard>}
        {data?.customers != null && <BusinessCard icon="module.customers" label="Clientes" count={data.customers} />}
        {data?.suppliers != null && <BusinessCard icon="module.suppliers" label="Proveedores" count={data.suppliers} />}
      </div>
    </section>}
    {data?.available_products && <DashboardPanel id="stock" title="Productos disponibles" subtitle="Inventario y curación/secado"
      icon="module.products" open={opens.stock ?? DISCLOSURE_INITIALLY_OPEN} toggle={() => toggle("stock")}>
      <SearchField aria-label="Filtrar productos" placeholder="Buscar producto, SKU o variante…" value={stockQuery}
        onChange={event => setStockQuery(event.target.value)} />
      {stock.length ? <ul className="dashboard-records">{stock.map(row => <li className="dashboard-record" key={row.id}>
        <div className="dashboard-record-name"><strong>{row.product}</strong>
          {skus[row.id] && <small>{skus[row.id]}</small>}{row.variant && <small>{row.variant}</small>}
        </div>
        <div className="dashboard-values dashboard-values-three">
          <Metric label="Disponible" value={tally(row.available, "ud")} tone={Number(row.available) > 0 ? "available" : "quiet"} />
          <Metric label="Curación/secado" value={row.curing == null ? "—" : tally(row.curing, "ud")}
            tone={Number(row.curing) > 0 ? "curing" : "quiet"}
            note={[Number(row.estimated) > 0 ? `${number(row.estimated)} estimadas` : "", row.unknown_lots
              ? `${row.unknown_lots} ${row.unknown_lots === 1 ? "lote sin cantidad" : "lotes sin cantidad"}` : ""].filter(Boolean).join(" · ")} />
          <Metric label="Precio general" value={row.general_price == null ? "Sin precio" : cash(row.general_price)} />
        </div>
      </li>)}</ul> : <p className="dashboard-empty">{stockQuery.trim() ? "No hay productos que coincidan con la búsqueda." : "No hay productos disponibles ni en curación/secado."}</p>}
    </DashboardPanel>}
    {settlements && <DashboardPanel id="settlements" title="Liquidaciones pendientes" icon="module.settlements"
      count={settlements.length} open={opens.settlements ?? DISCLOSURE_INITIALLY_OPEN} toggle={() => toggle("settlements")}>
      {settlements.length ? <ul className="dashboard-records">{settlements.map(row => <li className="dashboard-record dashboard-settlement" key={row.id}>
        <div className="dashboard-record-name"><strong>{settlementNumber(row.number)} · {row.courier}</strong>
          <small>{dateLabel(row.date)} · {row.state === "draft" ? "Borrador" : row.state === "partial" ? "Pago parcial" : "Pendiente"}</small>
        </div>
        <Metric label="Saldo pendiente" value={cash(Math.abs(Number(row.remaining)))}
          note={Number(row.remaining) > 0 ? "Por recibir de mensajería" : Number(row.remaining) < 0 ? "Por pagar a mensajería" : "Sin saldo"} />
        {onOpenSettlement && <AppButton className="secondary" type="button" onClick={() => onOpenSettlement(row.id)}
          aria-label={`Abrir liquidación ${settlementNumber(row.number)}`}>Abrir liquidación</AppButton>}
      </li>)}</ul> : <p className="dashboard-empty">No hay liquidaciones pendientes</p>}
    </DashboardPanel>}
    {hasReorder && <DashboardPanel id="reorder" title="Reorden de materiales" count={low} icon="status.warning"
      open={opens.reorder ?? DISCLOSURE_INITIALLY_OPEN} toggle={() => toggle("reorder")}>
      <SearchField aria-label="Filtrar materiales" placeholder="Buscar material o SKU…" value={materialQuery}
        onChange={event => setMaterialQuery(event.target.value)} />
      {reorder.length ? <ul className="dashboard-records">{reorder.map(row => {
        const available = Number(row.available), minimum = Number(row.minimum);
        const percentage = minimum > 0 && Number.isFinite(available) && Number.isFinite(minimum)
          ? Math.min(100, Math.max(0, available / minimum * 100)) : 0;
        return <li className="dashboard-record" key={row.id}>
          <div className="dashboard-record-name"><strong><AppIcon name="status.warning" /> {row.name}</strong>{row.sku && <small>{row.sku}</small>}</div>
          <div>
            <div className="dashboard-values dashboard-values-three">
              <Metric label="Disponible" value={tally(row.available, row.unit)} />
              <Metric label="Mínimo" value={tally(row.minimum, row.unit)} />
              <Metric label="Faltante" value={tally(Math.max(0, minimum - available), row.unit)} tone="curing" />
            </div>
            <div className="dashboard-progress"><progress value={percentage} max={100} aria-label={`Inventario mínimo de ${row.name}`} />
              <small>{Math.round(percentage)}% del mínimo</small></div>
          </div>
        </li>;
      })}</ul> : <p className="dashboard-empty">{materialQuery.trim() ? "No hay materiales que coincidan con la búsqueda." : "No hay materiales bajo el mínimo."}</p>}
      {!!data?.suggested_production?.length && <IconDetails className="dashboard-suggested">
        <summary>Producción sugerida</summary>
        <div className="table-wrap"><ResponsiveTable showAllMobileFields>
          <thead><tr><th>Producto</th><th>Disponible total</th><th>Mínimo</th><th>Unidades sugeridas</th></tr></thead>
          <tbody>{data.suggested_production.map(row => <tr key={row.id}>
            <td>{row.name}</td><td data-sort-value={row.available}>{number(row.available)}</td>
            <td data-sort-value={row.minimum}>{number(row.minimum)}</td><td data-sort-value={row.suggested}>{number(row.suggested)}</td>
          </tr>)}</tbody>
        </ResponsiveTable></div>
      </IconDetails>}
    </DashboardPanel>}
    {onProduction && <DashboardPanel id="curing" title="Lotes en curación" count={ready} icon="status.pending"
      open={opens.curing ?? DISCLOSURE_INITIALLY_OPEN} toggle={() => toggle("curing")}>
      <div className="dashboard-curing-notice" data-pending={ready > 0}>
        <Bell size={18} aria-hidden="true" /><span><strong>{ready === 1 ? "1 lote listo" : `${ready} lotes listos`}</strong>
          <small>Para confirmar o liberar</small></span>
        <AppButton type="button" onClick={() => onProduction()}>Ir a Producción</AppButton>
      </div>
      <SearchField aria-label="Filtrar lotes en curación" placeholder="Buscar producto…" value={curingQuery}
        onChange={event => setCuringQuery(event.target.value)} />
      {curingError ? <p className="error" role="alert">No se pudo consultar la producción en curación.</p>
        : batches == null ? <p role="status">Consultando lotes en curación…</p>
        : !groups.length ? <p className="dashboard-empty">{curingQuery.trim() ? "No hay lotes que coincidan con la búsqueda." : "No hay lotes en curación."}</p>
        : <ul className="dashboard-records">{groups.map(([id, row]) => {
          const group = curing.filter(batch => batch.product_id + ":" + (batch.available_on ?? "") === id);
          const isReady = !!row.availableOn && row.availableOn <= date;
          const confirmation = group.some(batch => batch.opening_stock && !batch.confirmed);
          const release = group.some(batch => !batch.opening_stock || batch.confirmed);
          const expanded = lotGroupOpens[id] ?? DISCLOSURE_INITIALLY_OPEN;
          return <li key={id}>
            <button type="button" className="dashboard-record dashboard-curing-row" data-pending={isReady}
              aria-expanded={expanded} onClick={() => setLotGroupOpens(current => ({ ...current, [id]: !(current[id] ?? DISCLOSURE_INITIALLY_OPEN) }))}>
              <span className="dashboard-record-name"><strong>{row.name}</strong><small>
                <AppIcon name={isReady ? "status.success" : "status.pending"} /> {isReady
                  ? [confirmation && "Listo para confirmar", release && "Listo para liberar"].filter(Boolean).join(" · ")
                  : "En curación"} · {dateLabel(row.availableOn)}</small></span>
              <span className="dashboard-curing-totals"><span><strong>{row.lots}</strong> {row.lots === 1 ? "lote" : "lotes"}</span>
                <span><strong>{row.known ? curingCount.format(row.total) : "—"}</strong> unidades teóricas{row.known && row.missing ? " · parcial" : ""}</span></span>
              <AppIcon name={expanded ? "action.collapse" : "action.expand"} />
            </button>
            {expanded && <ul className="dashboard-lot-links">{group.map(batch => <li key={batch.id}>
              <AppButton type="button" className="secondary" onClick={() => onProduction(batch.id)}>{lotCode(batch.batch_number)} · Ver documento</AppButton>
            </li>)}</ul>}
          </li>;
        })}</ul>}
    </DashboardPanel>}
  </div>;
}
