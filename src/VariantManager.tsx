import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import CatalogBadge from "./CatalogBadge";
import { weightRangeError, weightRangeLabel } from "./variant-weights";
import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useState, lazy, Suspense } from "react";
import { operation, mutate, useOperation, money, type Row } from "./operations";
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
    [barcode, setBarcode] = useState<Row | null>(null);
  const state = useOperation(company, "catalog");
  async function load() {
    setRows(await operation(company, "variants", { product: product.id }));
  }
  useEffect(() => {
    state.run(load);
  }, [company, product.id]);
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
              if (
                edit !== undefined &&
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
          <AppButton onClick={() => setEdit(null)}>Agregar variante</AppButton>
        )}
        {edit !== undefined && (
          <form
            key={edit?.id || "new"}
            className="settings-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              let attributes: Row = {};
              for (const key of ["aroma", "color", "tipo"])
                if (String(data[key] || "").trim())
                  attributes[key] = String(data[key]).trim().toLowerCase();
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
              Nombre de variante
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={edit?.name}
              />
            </label>
            <label>
              SKU
              <input
                name="sku"
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
              Los precios de venta se administran en Configuración → Listas de
              precios.
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
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Variante</th>
                <th>SKU / barras</th>
                <th>Peso</th>
                <th>Precio</th>
                <th>Disponible / curación</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    <small>
                      {Object.entries(r.attributes)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}{" "}
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
