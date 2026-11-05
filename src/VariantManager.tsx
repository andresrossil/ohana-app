import { priceCost } from "./price-cost";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import CatalogBadge from "./CatalogBadge";
import { weightRangeError, weightRangeLabel } from "./variant-weights";
import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useState, lazy, Suspense } from "react";
import { operation, mutate, useOperation, money, type Row } from "./operations";
import { request } from "./commerce";
import { usePriceRefresh } from "./price-events";
import VariantSheet from "./VariantSheet";
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
  return (
    <div className="overlay">
      <section
        className="modal operations-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Variantes del producto"
      >
        <header>
          <div>
            <p className="eyebrow">VARIANTES</p>
            <h2>{product.name}</h2>
          </div>
          <AppButton
            disabled={state.busy}
            className="secondary"
            onClick={async () => {
              if (document.querySelector('.variant-sheet[aria-busy="true"]'))
                return;
              if (
                (edit !== undefined || sheetDirty) &&
                !(await confirmAction(
                  "¿Descartar los cambios de esta variante?",
                ))
              )
                return;
              onClose();
            }}
          >
            Cerrar
          </AppButton>
        </header>
        <p>
          El peso mínimo está incluido y el máximo no. Ejemplo: 80–90 g
          corresponde a pesos desde 80 g hasta menos de 90 g.
        </p>
        {state.error && (
          <p className="error" role="alert">
            <AppIcon name="status.error" />
            {state.error}
          </p>
        )}
        {state.notice && <p role="status">{state.notice}</p>}
        {state.canWrite && edit === undefined && (
          <div className="form-actions">
            {!sheet && (
              <>
                <AppButton onClick={() => setEdit(null)}>
                  Agregar variante individual
                </AppButton>
                <AppButton
                  className="secondary"
                  onClick={() => setSheet("edit")}
                >
                  Editar catálogo en tabla
                </AppButton>
                <AppButton
                  className="secondary"
                  onClick={() => setSheet("import")}
                >
                  Copiar de Tabla
                </AppButton>
              </>
            )}
          </div>
        )}
        {sheet && (
          <VariantSheet
            key={company + product.id + sheet}
            company={company}
            product={product}
            existing={rows}
            importing={sheet === "import"}
            onDirty={setSheetDirty}
            onClose={() => {
              setSheet(null);
              setSheetDirty(false);
            }}
            onSaved={async () => {
              await load();
              await onChanged?.();
              state.setNotice("Variantes guardadas");
            }}
          />
        )}
        {edit !== undefined && (
          <form
            key={edit?.id || "new"}
            className="settings-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              let attributes: Row = { ...edit?.attributes };
              for (const key of ["aroma", "color", "tipo"])
                if (String(data[key] || "").trim())
                  attributes[key] = String(data[key]).trim().toLowerCase();
                else delete attributes[key];
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
              if (
                !String(data.name || "").trim() &&
                !String(data.commercial_code || "").trim()
              ) {
                state.setError(
                  "Indica un código comercial o un tamaño comercial.",
                );
                return;
              }
              const rangeError = weightRangeError(
                rows.map((r) => ({ ...r, id: r.id })),
                {
                  ...payload,
                  id: edit?.id || "",
                  weight_min: String(data.weight_min || ""),
                  weight_max: String(data.weight_max || ""),
                },
              );
              if (rangeError) {
                state.setError(rangeError);
                return;
              }
              state.run(async () => {
                await mutate(company, "variant_save", payload);
                setEdit(undefined);
                await load();
                await onChanged?.();
                state.setNotice("Variante guardada");
              });
            }}
          >
            <label>
              Código comercial
              <input
                name="commercial_code"
                maxLength={80}
                placeholder="JT-1, JT-2…"
                defaultValue={edit?.commercial_code}
              />
            </label>
            <label>
              Tamaño comercial
              <input
                name="name"
                maxLength={120}
                placeholder="PEQUEÑO, MEDIANO… Puede repetirse."
                defaultValue={edit?.name}
              />
            </label>
            <label>
              SKU
              <input
                name="sku"
                readOnly
                maxLength={80}
                required={!!edit}
                placeholder="Se genera al guardar, por ejemplo P0001-01"
                defaultValue={edit?.sku}
              />
            </label>
            <label>
              Código de barras personalizado
              <input
                name="barcode"
                maxLength={80}
                defaultValue={edit?.barcode}
              />
              <span>
                <input
                  type="checkbox"
                  name="custom"
                  defaultChecked={edit?.barcode_custom}
                />{" "}
                Conservar este código, incluso vacío
              </span>
              <small>Sin personalizar, se utiliza el SKU.</small>
            </label>
            {["aroma", "color", "tipo"].map((k) => (
              <label key={k}>
                {k}
                <input
                  name={k}
                  maxLength={120}
                  defaultValue={edit?.attributes?.[k]}
                />
              </label>
            ))}
            <label>
              Peso mínimo (g)
              <input
                name="weight_min"
                type="number"
                min="0.0001"
                step="0.0001"
                defaultValue={edit?.weight_min}
              />
            </label>
            <label>
              Peso máximo (g)
              <input
                name="weight_max"
                type="number"
                min="0.0001"
                step="0.0001"
                defaultValue={edit?.weight_max}
              />
            </label>
            <p className="form-wide muted">
              Los precios de venta se administran en el menú Listas de precios.
            </p>
            <label>
              <input
                name="active"
                type="checkbox"
                defaultChecked={edit?.active ?? true}
              />{" "}
              Activa
            </label>
            <label>
              <input
                name="published"
                type="checkbox"
                defaultChecked={edit?.published ?? false}
              />{" "}
              Publicar en tienda
            </label>
            <label>
              <input
                name="allow_preorder"
                type="checkbox"
                defaultChecked={edit?.allow_preorder ?? false}
              />{" "}
              Permitir pedidos anticipados
            </label>
            <div className="form-actions">
              <AppButton disabled={state.busy}>Guardar variante</AppButton>
              <AppButton
                type="button"
                className="secondary"
                onClick={() => setEdit(undefined)}
              >
                Cancelar
              </AppButton>
            </div>
          </form>
        )}
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
                {rows.map((r) => (
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
            {!rows.length && (
              <p className="empty">
                Agrega la primera variante para producir o vender este producto.
              </p>
            )}
          </div>
        )}
        {barcode && (
          <Suspense fallback={<p>Preparando código…</p>}>
            <BarcodeDialog
              item={barcode as any}
              onClose={() => setBarcode(null)}
            />
          </Suspense>
        )}
      </section>
    </div>
  );
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
      {estimate.packagingUnit != null && <small>Empaque por unidad: {money(estimate.packagingUnit,variant.currency)} · Insumos por unidad: {money(estimate.suppliesUnit,variant.currency)}</small>}
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
