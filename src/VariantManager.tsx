import { priceCost } from "./price-cost";
import { confirmAction } from "./ConfirmDialog";
import { weightRangeError } from "./variant-weights";
import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from "react";
import { lazyWithRecovery as lazy } from "./lazy-module";
import { operation, mutate, useOperation, type Row } from "./operations";
import { request } from "./commerce";
import { usePriceRefresh, pricesChanged } from "./price-events";
import VariantSheet, { copyVariantRows } from "./VariantSheet";
import VariantCard, { variantEstimatedCost } from "./VariantCard";
import VariantForm, { standardVariantAttributes } from "./VariantForm";
import { SearchField } from "./PoolControls";
import SearchSelect from "./SearchSelect";
import { variantMatches } from "./variant-catalog-search";
import { compareCells } from "./table-sort";
import "./variant-manager.css";
import { variantLabel } from "./variant-label";
const BarcodeDialog = lazy(() => import("./BarcodeDialog"));
export default function VariantManager({
  company,
  product,
  onClose,
  onChanged,
}: {
  company: string;
  product: Row;
  onClose: () => void;
  onChanged?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row | null | undefined>(),
    [barcode, setBarcode] = useState<Row | null>(null),
    [baseName, setBaseName] = useState("");
  const [costData, setCostData] = useState<Row>({
    catalog: null,
    formulas: [],
  });
  const [sheet, setSheet] = useState<"edit" | "import" | null>(null);
  const [sheetDirty, setSheetDirty] = useState(false);
  const state = useOperation(company, "catalog");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState("");
  const catalogDialog = useRef<HTMLElement>(null);
  const savedPosition = useRef<{ top: number; trigger: HTMLElement | null } | null>(null);
  const attributeKeys = useMemo(() => [...new Set([
    ...standardVariantAttributes,
    ...rows.flatMap(row => Object.keys(row.attributes || {})),
  ])], [rows]);
  const estimates = useMemo(() => new Map(rows.map(row => [
    row.id, costData.catalog ? priceCost(row, costData.formulas, costData.catalog, row) : null,
  ])), [rows, costData]);
  const sortFields = [
    ["name", "Variante"], ["sku", "SKU"], ["barcode", "Código de barras"], ["weight_min", "Peso mínimo"],
    ["price", "Precio"], ["cost", "Costo estimado"], ["available", "Disponible"], ["blocked", "En curación"],
  ];
  const visibleRows = rows.filter(row => variantMatches(query, row));
  if (order) {
    const [field, direction] = order.split(":");
    function fieldValue(row: Row) {
      if (field === "name") return variantLabel(row);
      if (field === "cost") return variantEstimatedCost(estimates.get(row.id) ?? null);
      return row[field];
    }
    visibleRows.sort((a, b) => compareCells(fieldValue(a), fieldValue(b), direction === "desc" ? "desc" : "asc"));
  }
  useLayoutEffect(() => {
    if (edit !== undefined || state.busy || !savedPosition.current || !catalogDialog.current) return;
    const position = savedPosition.current;
    savedPosition.current = null;
    if (position.trigger?.isConnected) position.trigger.focus({ preventScroll: true });
    catalogDialog.current.scrollTop = position.top;
  }, [edit, state.busy]);

  function openEditor(row: Row | null) {
    const focus = document.activeElement;
    savedPosition.current = { top: catalogDialog.current?.scrollTop ?? 0, trigger: focus instanceof HTMLElement ? focus : null };
    state.setError("");
    setEdit(row);
  }
  function closeEditor() {
    state.setError("");
    setEdit(undefined);
  }
  async function load() {
    const [variants, base, catalog, formulas] = await Promise.all([
      operation(company, "variants", { product: product.id }),
      request("base_price_list", { p_company: company }),
      request("formula_catalog", { p_company: company }).catch(() => null),
      request("formula_command", {
        p_company: company,
        p_action: "list",
      }).catch(() => []),
    ]);
    setRows(variants);
    setCostData({ catalog, formulas });
    setBaseName(base?.name || "");
  }
  useEffect(() => {
    state.run(load);
  }, [company, product.id]);
  usePriceRefresh(company, () => {
    load().catch((e) => state.setError(e.message));
  });
  async function removeVariant(row: Row) {
    if (!(await confirmAction(
      `¿Eliminar la variante ${variantLabel(row)}? Esta acción es permanente.`,
      { title: "Eliminar variante", confirmText: "Eliminar" },
    ))) return;
    await state.run(async () => {
      await mutate(company, "variant_delete", { product: product.id, id: row.id });
      setRows((previous) => previous.filter((variant) => variant.id !== row.id));
      state.setNotice("Variante eliminada.");
      pricesChanged(company);
      await onChanged?.();
    });
  }
  function saveVariant(data: Row, attributes: Row) {
    const payload = {
      ...data,
      attributes,
      product: product.id,
      id: edit?.id || "",
      barcode_custom: data.custom === "on",
      published: data.published === "on",
      active: data.active === "on",
      trial_failed: data.trial_failed === "on",
      allow_preorder: data.allow_preorder === "on",
    };
    if (!String(data.name || "").trim() && !String(data.commercial_code || "").trim()) {
      state.setError("Indica un código comercial o un tamaño comercial.");
      return;
    }
    const rangeError = weightRangeError(rows.map(row => ({ ...row, id: row.id })), {
      ...payload,
      weight_min: String(data.weight_min || ""),
      weight_max: String(data.weight_max || ""),
    });
    if (rangeError) {
      state.setError(rangeError);
      return;
    }
    void state.run(async () => {
      await mutate(company, "variant_save", payload);
      setEdit(undefined);
      await load();
      await onChanged?.();
      pricesChanged(company);
      state.setNotice("Variante guardada");
    });
  }
  async function closeCatalog() {
    if (state.busy || catalogDialog.current?.querySelector('.variant-sheet[aria-busy="true"]')) return;
    if (sheetDirty && !(await confirmAction("¿Descartar los cambios de esta variante?"))) return;
    onClose();
  }

  return <>
    <div className="overlay compact-form-overlay variant-manager-overlay" hidden={edit !== undefined}>
      <section ref={catalogDialog} className="modal compact-form-dialog variant-catalog-dialog"
        role="dialog" aria-modal="true" aria-labelledby="variant-catalog-title">
        <div className="compact-form-header">
          <div><h2 id="variant-catalog-title">Variantes y existencias</h2><p>{product.name}</p></div>
          <AppButton type="button" className="secondary catalog-icon-button" iconKey="action.cancel"
            aria-label="Cerrar variantes y existencias" disabled={state.busy} onClick={() => void closeCatalog()} />
        </div>
        <div className="variant-catalog-body">
          {edit === undefined && state.error && <p className="error" role="alert"><AppIcon name="status.error" /> {state.error}</p>}
          {state.notice && <p role="status">{state.notice}</p>}
          {sheet ? (
            <VariantSheet key={company + product.id + sheet} company={company} product={product} existing={rows}
              importing={sheet === "import"} onDirty={setSheetDirty}
              onClose={() => { setSheet(null); setSheetDirty(false); }}
              onSaved={async () => {
                await load();
                await onChanged?.();
                pricesChanged(company);
                state.setNotice("Variantes guardadas");
              }} />
          ) : <>
            <div className="variant-catalog-actions">
              {state.canWrite && <>
                <AppButton type="button" iconKey="action.add" disabled={state.busy} onClick={() => openEditor(null)}>Nueva variante</AppButton>
                <AppButton type="button" className="secondary" iconKey="action.edit" disabled={state.busy} onClick={() => setSheet("edit")}>Editar catálogo en tabla</AppButton>
              </>}
              {state.canWrite && <AppButton type="button" className="secondary" iconKey="action.duplicate" disabled={state.busy} onClick={async () => {
                try {
                  await copyVariantRows(rows);
                  state.setError("");
                  state.setNotice("Tabla copiada.");
                } catch {
                  state.setError("No se pudo copiar. Revisa el permiso del portapapeles.");
                }
              }}>Copiar tabla</AppButton>}
              {state.canWrite && <AppButton type="button" className="secondary" iconKey="action.upload" disabled={state.busy}
                onClick={() => setSheet("import")}>Pegar desde Excel</AppButton>}
            </div>
            <div className="variant-search-tools">
              <SearchField aria-label="Buscar variantes" placeholder="Buscar por nombre, SKU o características…" value={query} onChange={event => setQuery(event.target.value)} />
              <SearchSelect aria-label="Ordenar variantes" value={order} onChange={event => setOrder(event.target.value)}>
                <option value="">Orden del catálogo</option>
                {sortFields.flatMap(([field, label]) => [
                  <option key={field + ":asc"} value={field + ":asc"}>{label} · ascendente</option>,
                  <option key={field + ":desc"} value={field + ":desc"}>{label} · descendente</option>,
                ])}
              </SearchSelect>
            </div>
            <div className="variant-cards">
              {visibleRows.map(row => <VariantCard key={row.id} variant={row} estimate={estimates.get(row.id) ?? null}
                priceList={baseName} onEdit={state.canWrite && !state.busy ? () => openEditor(row) : undefined}
                onBarcode={row.barcode ? () => setBarcode(row) : undefined}
                onDelete={state.canWrite && !state.busy ? () => void removeVariant(row) : undefined} />)}
            </div>
            {!visibleRows.length && <p className="empty" role="status">{state.busy ? "Consultando variantes…" : rows.length
              ? "No hay variantes que coincidan con la búsqueda."
              : "Agrega la primera variante para producir o vender este producto."}</p>}
          </>}
        </div>
      </section>
    </div>
    {edit !== undefined && <VariantForm key={edit?.id || "new"} productName={product.name} variant={edit}
      attributeKeys={attributeKeys} busy={state.busy} error={state.error} onClose={closeEditor} onSave={saveVariant} />}
    {barcode && (
      <Suspense fallback={<p>Preparando código…</p>}>
        <BarcodeDialog item={barcode as any} onClose={() => setBarcode(null)} />
      </Suspense>
    )}
  </>;
}
