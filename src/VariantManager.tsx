import { priceCost } from "./price-cost";
import { confirmAction } from "./ConfirmDialog";
import { weightRangeError } from "./variant-weights";
import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from "react";
import { lazyWithRecovery as lazy } from "./lazy-module";
import { operation, mutate, useOperation, money, type Row } from "./operations";
import { request } from "./commerce";
import { usePriceRefresh, pricesChanged } from "./price-events";
import VariantSheet, { copyVariantRows } from "./VariantSheet";

import VariantForm, { standardVariantAttributes } from "./VariantForm";
import { SearchField } from "./PoolControls";
import { variantMatches } from "./variant-catalog-search";
import ResponsiveTable from "./ResponsiveTable";
import CatalogBadge from "./CatalogBadge";
import { weightRangeLabel } from "./variant-weights";
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
  const catalogDialog = useRef<HTMLElement>(null);
  const savedPosition = useRef<{ top: number; trigger: HTMLElement | null } | null>(null);
  const attributeKeys = useMemo(() => [...new Set([
    ...standardVariantAttributes,
    ...rows.flatMap(row => Object.keys(row.attributes || {})),
  ])], [rows]);
  const visibleRows = rows.filter(row => variantMatches(query, row));
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
            </div>
        {!sheet && (
          <div className="table-wrap">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Variante</th>
                  <th>SKU / barras</th>
                  <th>Peso</th>
                  <th className="base-price-heading">
                    {baseName ? "PRECIO · " + baseName : "PRECIO DE LISTA BASE"}
                  </th>
                  <th>Costo estimado por variante</th>
                  <th>Disponible / curación</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="admin-name">{variantLabel(r)}</span>
                      <small>
                        <CatalogBadge
                          active={r.active}
                          label={r.active ? "Activa" : "Archivada"}
                        />
                      </small>
                    </td>
                    <td>
                      {r.sku}
                      <small>{r.barcode || "Sin código de barras"}</small>
                    </td>
                    <td>{weightRangeLabel({ ...r, id: r.id })}</td>
                    <td>
                      {r.price == null
                        ? "Pendiente de precio"
                        : money(r.price, r.currency)}
                    </td>
                    <td>
                      <VariantEstimate variant={r} data={costData} />
                    </td>
                    <td>
                      {r.available} / {r.blocked}
                    </td>
                    <td className="actions">
                      {state.canWrite && (
                        <AppButton onClick={() => setEdit(r)}>Editar</AppButton>
                      )}
                      {r.barcode && (
                        <AppButton onClick={() => setBarcode(r)}>
                          Barras
                        </AppButton>
                      )}
                      {state.canWrite && edit === undefined && (
                        <AppButton className="danger" iconKey="action.delete" disabled={state.busy}
                          onClick={() => void removeVariant(r)}>Eliminar</AppButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
            {!visibleRows.length && <p className="empty" role="status">{state.busy ? "Consultando variantes…" : rows.length
              ? "No hay variantes que coincidan con la búsqueda."
              : "Agrega la primera variante para producir o vender este producto."}</p>}
          </div>
        )}
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

function VariantEstimate({ variant, data }: { variant: Row; data: Row }) {
  if (!data.catalog)
    return (
      <>
        Pendiente<small>Sin información de fórmula o permiso de costos.</small>
      </>
    );
  const estimate = priceCost(variant, data.formulas, data.catalog, variant);
  return (
    <>
      <strong>
        {estimate.manufacturingCost == null
          ? estimate.cost == null
            ? "Pendiente"
            : money(estimate.cost, variant.currency)
          : money(estimate.manufacturingCost, variant.currency)}
      </strong>
      {estimate.costPerGram != null && (
        <small>
          {Number(estimate.midpoint).toLocaleString("es-GT", {
            maximumFractionDigits: 2,
          })}{" "}
          g × {money(estimate.costPerGram, variant.currency)} / g
        </small>
      )}
      {estimate.packagingUnit != null && (
        <small>
          Empaque por unidad: {money(estimate.packagingUnit, variant.currency)}{" "}
          · Insumos por unidad: {money(estimate.suppliesUnit, variant.currency)}
        </small>
      )}
      {estimate.manufacturingCost != null && (
        <small>
          Costo total con gastos: {money(estimate.cost, variant.currency)}
        </small>
      )}
      {estimate.expenses != null && (
        <small>
          Gastos por unidad: {money(estimate.expenses, variant.currency)}
        </small>
      )}
      <small>{estimate.reason}</small>
    </>
  );
}
