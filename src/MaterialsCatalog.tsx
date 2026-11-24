import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EllipsisVertical, Table2 } from "lucide-react";
import { AppButton, AppIcon } from "./AppIcon";
import CatalogBadge from "./CatalogBadge";
import CatalogFilters, { classificationMatches, originMatches } from "./CatalogFilters";
import { matchesCatalog } from "./catalog-model";
import { MaterialTypeLabel } from "./MaterialTypesContext";
import MaterialMinimums from "./MaterialMinimums";
import { SearchField } from "./PoolControls";
import ProductImage from "./ProductImage";
import ResponsiveTable from "./ResponsiveTable";
import type { CatalogRow } from "./sheet-model";
import "./materials-catalog.css";

type Material = CatalogRow & { active?: boolean };
const statusOptions = [
  ["all", "Todos"],
  ["active", "Activos"],
  ["archived", "Archivados"],
] as const;
const byName = new Intl.Collator("es-GT", { sensitivity: "base", numeric: true });

type Props = {
  company: string;
  rows: Material[];
  origins: CatalogRow[];
  units: CatalogRow[];
  costs: Record<string, CatalogRow>;
  activeSuppliers: number;
  pricedPresentations: number;
  canWrite: boolean;
  canViewPrices: boolean;
  loading: boolean;
  busy: boolean;
  sheetView: boolean;
  editing: boolean;
  sheet: ReactNode;
  formatMoney: (amount: number, currency?: string) => string;
  onCreate: () => void;
  onImport: () => void;
  onToggleSheet: () => void;
  onGenerateSkus: () => void;
  onSaved: () => Promise<void>;
  onSuppliers: () => void;
  onPrices: () => void;
  onEdit: (row: Material) => void;
  onBarcode: (row: Material) => void;
};

function CatalogAction({ label, icon, onClick }: {
  label: string;
  icon: string;
  onClick: (trigger: HTMLButtonElement) => void;
}) {
  return <AppButton type="button" className="secondary catalog-icon-button" iconKey={icon}
    aria-label={label} title={label} onClick={(event) => onClick(event.currentTarget)} />;
}

export default function MaterialsCatalog({
  company, rows, origins, units, costs, activeSuppliers, pricedPresentations,
  canWrite, canViewPrices, loading, busy, sheetView, editing, sheet, formatMoney,
  onCreate, onImport, onToggleSheet, onGenerateSkus, onSaved, onSuppliers,
  onPrices, onEdit, onBarcode,
}: Props) {
  const [query, setQuery] = useState("");
  const [classification, setClassification] = useState("");
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState<(typeof statusOptions)[number][0]>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const editPosition = useRef<{ scroll: number; trigger: HTMLButtonElement } | null>(null);
  const sorted = useMemo(() => [...rows].sort((a, b) => byName.compare(a.name, b.name)), [rows]);
  const results = useMemo(() => sorted.filter((row) =>
    matchesCatalog(row, query, true) &&
    classificationMatches(row.classification, classification) &&
    originMatches(row.origin_id, origin) &&
    (status === "all" || Boolean(row.active) === (status === "active"))
  ), [sorted, query, classification, origin, status]);
  const originNames = useMemo(() => new Map(origins.map((row) => [row.id, row.name])), [origins]);
  const unitNames = useMemo(() => new Map(units.map((row) => [row.id, row.name])), [units]);
  const filtersCount = Number(Boolean(classification)) + Number(Boolean(origin)) + Number(status !== "all");
  const filtered = Boolean(query.trim()) || filtersCount > 0;

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) {
        menu.current.open = false;
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (editing || !editPosition.current) return;
    const { scroll, trigger } = editPosition.current;
    editPosition.current = null;
    const focusTarget = trigger.isConnected ? trigger : search.current;
    focusTarget?.focus({ preventScroll: true });
    if (window.scrollY !== scroll) window.scrollTo({ top: scroll, behavior: "instant" });
  }, [editing]);

  function actions(minimumTrigger?: ReactNode) {
    return <details ref={menu} className="materials-actions">
      <summary className="catalog-icon-button" title="Acciones del catálogo" aria-label="Acciones del catálogo">
        <EllipsisVertical size={18} aria-hidden="true" />
      </summary>
      <div className="dashboard-surface materials-actions-menu" onClick={(event) => {
        if ((event.target as HTMLElement).closest("button") && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}>
        {minimumTrigger}
        {canWrite && <AppButton type="button" className="secondary" iconKey="action.barcode"
          disabled={busy} onClick={onGenerateSkus}>Generar SKU faltantes</AppButton>}
        <AppButton type="button" className="secondary" onClick={onToggleSheet}>
          <Table2 size={18} aria-hidden="true" />
          {canWrite ? "Editar catálogo en tabla" : "Ver catálogo en tabla"}
        </AppButton>
      </div>
    </details>;
  }

  return <div className="materials-home">
    <header className="dashboard-welcome materials-welcome">
      <span>La base de cada creación</span>
      <h1 className="module-title"><AppIcon name="module.materials" /> Materiales</h1>
      <p>Conoce lo que compras. Cuida lo que creas.</p>
    </header>
    {canWrite && <div className="materials-entry">
      <AppButton type="button" iconKey="action.add" disabled={loading} onClick={onCreate}>Nuevo material</AppButton>
      <AppButton type="button" className="secondary" iconKey="action.duplicate" disabled={loading} onClick={onImport}>Copiar de tabla</AppButton>
    </div>}
    <section className="dashboard-surface materials-stats" aria-label="Indicadores de Materiales">
      <MaterialMetric icon="module.materials" label="Materiales activos" count={rows.filter((row) => row.active).length} />
      <MaterialMetric icon="module.suppliers" label="Proveedores activos" count={activeSuppliers} onClick={onSuppliers} />
      <MaterialMetric icon="module.prices" label="Presentaciones con precio vigente" count={pricedPresentations}
        onClick={onPrices} disabled={!canViewPrices} />
    </section>

    {sheetView && <>
      <div className="materials-sheet-back">
        <AppButton type="button" className="secondary" iconKey="action.back" onClick={onToggleSheet}>Volver al catálogo</AppButton>
      </div>
      {sheet}
    </>}

    <section className="dashboard-surface materials-catalog" hidden={sheetView} aria-label="Tu catálogo">
      <div className="materials-catalog-heading">
        <h2 className="dashboard-section-heading">Tu catálogo</h2>
        <small role="status">{filtered ? `${results.length} de ` : ""}{rows.length} registros</small>
        {canWrite ? <MaterialMinimums company={company} onSaved={onSaved} renderTrigger={actions} /> : actions()}
      </div>
      <div className="materials-search-tools">
        <div className="materials-search-bar">
          <div className="materials-search">
            <SearchField ref={search} aria-label="Buscar en el catálogo" placeholder="Nombre, SKU o código de barras..."
              value={query} onChange={(event) => setQuery(event.target.value)} />
            {query && <CatalogAction label="Limpiar búsqueda" icon="action.cancel" onClick={() => {
              setQuery("");
              search.current?.focus();
            }} />}
          </div>
          <AppButton type="button" className="secondary materials-filter-toggle" iconKey="control.filter"
            aria-expanded={filtersOpen} aria-controls="materials-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}>
            Filtros{filtersCount > 0 ? ` (${filtersCount})` : ""}
          </AppButton>
        </div>
        <div className="materials-filters" id="materials-filters" data-open={filtersOpen}>
          <CatalogFilters classification={classification} onClassification={setClassification}
            origin={origin} onOrigin={setOrigin} origins={origins} wrapSelection />
          {filtersCount > 0 && <AppButton type="button" className="secondary materials-clear-filters" iconKey="action.cancel"
            onClick={() => { setClassification(""); setOrigin(""); setStatus("all"); }}>
            Limpiar filtros ({filtersCount})
          </AppButton>}
        </div>
      </div>
      <div className="materials-status-filter" role="group" aria-label="Estado del material">
        {statusOptions.map(([value, label]) => <button type="button" key={value} aria-pressed={status === value}
          onClick={() => setStatus(value)}>{label}</button>)}
      </div>
      <div className="materials-results" aria-busy={loading}>
        {loading && !rows.length ? <p className="materials-empty" role="status">Cargando catálogo…</p>
          : !rows.length ? <p className="materials-empty">Aún no hay materiales en el catálogo.</p>
          : <div className="table-wrap materials-table-wrap">
            <ResponsiveTable className="materials-table" compactRowActions hidden={!results.length}>
              <thead><tr>
                <th>Material</th><th>SKU</th><th>Estado</th><th>Clasificación</th><th>Origen</th>
                <th>Código de barras</th><th>Inventario mínimo</th><th>Unidad base</th><th>Costo actual</th><th>Acciones</th>
              </tr></thead>
              <tbody>{results.map((row) => {
                const cost = costs[row.id];
                const url = row.product_url || row.website_url;
                return <tr key={row.id}>
                  <td className="material-name" data-sort-value={row.name}>
                    <strong>{row.name}</strong>
                    <div className="material-mobile-identity">{row.sku || "—"} <CatalogBadge active={row.active} /></div>
                    <div className="material-extra">
                      {row.photo_path && <div className="material-photo"><ProductImage path={row.photo_path} name={row.name} /></div>}
                      {row.notes && <small>{row.notes}</small>}
                      {url && <a href={url} target="_blank" rel="noopener noreferrer"><AppIcon name="action.expand" /> Ver enlace</a>}
                      {!row.notes && !row.photo_path && !url && <small className="material-no-extra">Sin notas, foto ni enlace.</small>}
                    </div>
                  </td>
                  <td className="material-desktop-identity">{row.sku || "—"}</td>
                  <td className="material-desktop-identity"><CatalogBadge active={row.active} /></td>
                  <td><MaterialTypeLabel typeKey={row.classification} /></td>
                  <td><CatalogBadge origin={originNames.get(row.origin_id) || "Pendiente"} /></td>
                  <td>{row.barcode || "—"}</td>
                  <td data-sort-value={row.minimum_stock ?? ""}>{row.minimum_stock == null ? "—"
                    : Number(row.minimum_stock).toLocaleString("es-GT", { maximumFractionDigits: 8 })}</td>
                  <td>{unitNames.get(row.unit_id) || "—"}</td>
                  <td data-sort-value={cost?.unit_cost ?? ""}>{cost?.unit_cost == null ? "—"
                    : formatMoney(Number(cost.unit_cost), cost.currency)}</td>
                  <td className="actions material-row-actions">
                    {canWrite && <CatalogAction label={`Editar ${row.name}`} icon="action.edit" onClick={(trigger) => {
                      editPosition.current = { scroll: window.scrollY, trigger };
                      onEdit(row);
                    }} />}
                    {row.barcode && <CatalogAction label={`Código de barras de ${row.name}`} icon="action.barcode"
                      onClick={() => onBarcode(row)} />}
                  </td>
                </tr>;
              })}</tbody>
            </ResponsiveTable>
            {!results.length && <p className="materials-empty" role="status">No hay materiales que coincidan con la búsqueda y los filtros.</p>}
          </div>}
      </div>
    </section>
  </div>;
}

function MaterialMetric({ icon, count, label, onClick, disabled }: {
  icon: string;
  count: number;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const content = <><AppIcon name={icon} /><strong>{count.toString().padStart(2, "0")}</strong><span>{label}</span></>;
  return onClick
    ? <button type="button" className="dashboard-metric materials-metric" onClick={onClick} disabled={disabled}>{content}</button>
    : <div className="dashboard-metric materials-metric">{content}</div>;
}
