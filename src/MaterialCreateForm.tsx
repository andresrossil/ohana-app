import { pricesChanged } from "./price-events";
import MoneyInput from "./MoneyInput";
import MaterialPhoto, { uploadMaterialPhoto } from "./MaterialPhoto";
import { useMaterialTypes } from "./MaterialTypesContext";
import SearchSelect, { SortedDatalist } from "./SearchSelect";
import { useEffect, useRef, useState } from "react";
import CatalogFields from "./CatalogFields";
import AutoTextarea from "./AutoTextarea";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import { supabase as db } from "./client";
import { money, useOperation } from "./operations";
import { identityPayload } from "./catalog-model";
import {
  blankRow,
  calculate,
  validateRow,
  incompleteWarnings,
  parseNumber,
  parseDate,
  normalize,
  type CatalogRow,
} from "./sheet-model";

export default function MaterialCreateForm({
  company,
  currency,
  catalog,
  onSaved,
  onClose,
  onDirty,
}: {
  company: string;
  currency: string;
  catalog: {
    units: CatalogRow[];
    suppliers: CatalogRow[];
    raw_materials: CatalogRow[];
    presentations: CatalogRow[];
    catalog_origins?: CatalogRow[];
  };
  onSaved: () => Promise<void>;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const types = useMaterialTypes();
  const state = useOperation(company, "catalog");
  const [row, setRow] = useState(() => ({ ...blankRow(), currency })),
    [basis, setBasis] = useState("unknown"),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false);
  const batch = useRef<{ payload: string; id: string } | null>(null);
  const computed = calculate(
    row,
    catalog.units,
    catalog.presentations,
    catalog.raw_materials,
    catalog.suppliers,
    [],
    true,
    basis,
  );
  const warnings = incompleteWarnings(row);
  useEffect(() => {
    onDirty(dirty || state.busy);
    return () => onDirty(false);
  }, [dirty, state.busy, onDirty]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (dirty || state.busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, state.busy]);
  function cell(index: number, value: string) {
    setRow((old) => ({
      ...old,
      cells: old.cells.map((v, i) => (i === index ? value : v)),
      ...(index === 10 ? { importedPrevious: value } : {}),
      ...(index === 11 ? { importedSupplier: value } : {}),
    }));
    setDirty(true);
    state.setError("");
  }
  async function close() {
    if (state.busy) return;
    if (
      !dirty ||
      (await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?"))
    )
      onClose();
  }
  const textField = (
    index: number,
    label: string,
    type = "text",
    required = false,
  ) => {
    if ([7, 10].includes(index))
      return (
        <label>
          {label}
          <MoneyInput
            currency={currency}
            name={"material_cell_" + index}
            value={row.cells[index]}
            min="0"
            required={required}
            onChange={(e) => cell(index, e.target.value)}
          />
        </label>
      );
    return (
      <label>
        {label}
        <input
          name={"material_cell_" + index}
          value={row.cells[index]}
          type={type}
          required={required}
          maxLength={type === "text" ? (index === 6 ? 2000 : 160) : undefined}
          min={
            type === "number" ? (index === 4 ? "0.00000001" : "0") : undefined
          }
          step={
            type === "number"
              ? index === 4
                ? "0.00000001"
                : "0.0001"
              : undefined
          }
          onChange={(e) => cell(index, e.target.value)}
        />
      </label>
    );
  };
  async function save(form: HTMLFormElement) {
    if (saved || state.busy || !state.canWrite) return;
    const data = new FormData(form),
      identity = identityPayload(data);
    const draft = {
      ...row,
      cells: [...row.cells],
      barcodeCustom: identity.barcode_custom,
    };
    draft.cells[13] = identity.sku || "";
    draft.cells[14] = identity.classification || "";
    draft.cells[15] =
      catalog.catalog_origins?.find((o) => o.id === identity.origin_id)?.name ||
      "";
    draft.cells[16] = identity.barcode || "";
    const issues = validateRow(
      draft,
      catalog.units,
      catalog.suppliers,
      catalog.raw_materials,
      types.map((t) => t.key),
    );
    if (issues.length) {
      state.setError(issues.join(" · "));
      return;
    }
    if (
      catalog.raw_materials.some(
        (m) => normalize(m.name) === normalize(draft.cells[2]),
      )
    ) {
      state.setError(
        "Este material ya existe. Ábrelo desde el catálogo para editarlo o agregar presentaciones.",
      );
      return;
    }
    await state.run(async () => {
      const file = data.get("photo");
      const photoPath = file instanceof File && file.size ? await uploadMaterialPhoto(file, company) : null;
      const payload = [
        {
          photoPath,
          createOnly: true,
          id: "",
          mode: "add",
          expectedPriceId: null,
          confirmedDuplicate: false,
          material: draft.cells[2].trim(),
          supplier: draft.cells[0].trim(),
          alternative: draft.cells[1].trim(),
          capacity: draft.cells[3].trim(),
          quantity: parseNumber(draft.cells[4]),
          unit: draft.cells[5],
          comment: draft.cells[6],
          price: parseNumber(draft.cells[7]),
          date: parseDate(draft.cells[12]),
          currency,
          previous: parseNumber(draft.cells[10]),
          previousSupplier: draft.cells[11].trim(),
          previousBasis: basis,
          sku: identity.sku || "",
          classification: identity.classification || "",
          origin: draft.cells[15],
          barcode: identity.barcode || "",
          barcodeCustom: identity.barcode_custom,
          notes: String(data.get("notes") || ""),
          minimumStock: String(data.get("minimum_stock") || ""),
          productUrl: String(data.get("product_url") || "").trim(),
        },
      ];
      const encoded = JSON.stringify(payload);
      if (batch.current?.payload !== encoded)
        batch.current = { payload: encoded, id: crypto.randomUUID() };
      const result = await db.rpc("save_material_sheet", {
        p_company: company,
        p_batch: batch.current!.id,
        p_rows: payload,
      });
      if (result.error) {
        if (photoPath) await db.storage.from("catalog-images").remove([photoPath]);
        throw result.error;
      }
      setSaved(true);
      setDirty(false);
      onDirty(false);
      try {
        await onSaved();
        pricesChanged(company);
        onClose();
      } catch {
        state.setNotice(
          "Material, presentación y precio guardados. Cierra esta ventana para actualizar el catálogo.",
        );
      }
    });
  }
  return (
    <div className="overlay">
      <section
        className="modal material-create-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Crear material individual"
      >
        <header>
          <div>
            <p className="eyebrow">MATERIALES</p>
            <h2>Agregar material individual</h2>
            <p className="muted">
              Los mismos campos de la tabla, en una sola ventana. Solo nombre,
              cantidad y unidad son obligatorios.
            </p>
          </div>
          <AppButton
            type="button"
            className="secondary"
            disabled={state.busy}
            onClick={close}
          >
            Cerrar
          </AppButton>
        </header>
        {state.error && (
          <p className="error" role="alert">
            <AppIcon name="status.error" />
            {state.error}
          </p>
        )}
        {state.notice && <p role="status">{state.notice}</p>}
        <form
          className="settings-grid"
          data-dirty-managed
          aria-busy={state.busy}
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <fieldset
            className="form-wide settings-grid"
            disabled={state.busy || saved}
          >
            <legend>Material e identificación</legend>
            <label className="form-wide">
              Nombre del material *
              <AutoTextarea
                name="name"
                maxLength={160}
                value={row.cells[2]}
                required
                onChange={(e) => cell(2, e.target.value)}
              />
            </label>
            {textField(1, "Otro nombre")}
            <MaterialPhoto />
            <label>Inventario mínimo · opcional<input name="minimum_stock" type="number" min="0" max="999999999999999" step="any"/><small>En la unidad de inventario del material.</small></label>
            <CatalogFields
              company={company}
              kind="material"
              origins={catalog.catalog_origins || []}
            />
            <label className="form-wide">
              Notas del material
              <AutoTextarea name="notes" maxLength={5000} />
            </label>
          </fieldset>
          <fieldset
            className="form-wide settings-grid"
            disabled={state.busy || saved}
          >
            <legend>Proveedor y presentación</legend>
            <label>
              Proveedor
              <input
                value={row.cells[0]}
                list="individual-material-suppliers"
                maxLength={160}
                onChange={(e) => cell(0, e.target.value)}
              />
              <SortedDatalist id="individual-material-suppliers">
                {catalog.suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
              </SortedDatalist>
              <small>
                Puedes elegir uno existente o escribir un proveedor nuevo.
              </small>
            </label>
            {textField(3, "Capacidad · informativa")}
            {textField(4, "Cantidad de la presentación *", "number", true)}
            <label>
              Unidad de medida *
              <SearchSelect
                required
                value={row.cells[5]}
                onChange={(e) => cell(5, e.target.value)}
              >
                <option value="">Seleccionar unidad</option>
                {catalog.units
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.symbol}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
              </SearchSelect>
              <small>Será también la unidad base del material nuevo.</small>
            </label>
            <label className="form-wide">
              Comentario de la presentación
              <AutoTextarea
                value={row.cells[6]}
                maxLength={2000}
                onChange={(e) => cell(6, e.target.value)}
              />
            </label>
            <label className="form-wide">
              Enlace de compra
              <input
                name="product_url"
                type="url"
                maxLength={2048}
                placeholder="https://…"
              />
            </label>
          </fieldset>
          <fieldset
            className="form-wide settings-grid"
            disabled={state.busy || saved}
          >
            <legend>Precio e historial · {currency}</legend>
            {textField(7, "Precio de la presentación", "number")}
            {textField(12, "Fecha de consulta", "date")}
            <label>
              Precio actual por unidad · automático
              <input readOnly value={money(computed.current, currency)} />
            </label>
            <label>
              Comparación VS · automática
              <div className="material-create-vs">
                {computed.variation != null && (
                  <AppIcon
                    name={
                      computed.variation < 0
                        ? "status.success"
                        : computed.variation > 0
                          ? "status.error"
                          : "action.compare"
                    }
                  />
                )}
                <span>
                  {computed.variation == null
                    ? "Sin precios comparables"
                    : computed.variation < 0
                      ? "Menor que el anterior"
                      : computed.variation > 0
                        ? "Mayor que el anterior"
                        : "Igual al anterior"}
                </span>
              </div>
            </label>
            {textField(10, "Precio anterior · referencia inicial", "number")}
            {textField(11, "Proveedor anterior")}
            <label className="form-wide">
              Interpretación del precio anterior
              <SearchSelect
                value={basis}
                onChange={(e) => {
                  setBasis(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="unknown">
                  Sin unidad conocida · conservar referencia sin comparar
                </option>
                <option value="presentation">
                  Por la misma presentación, cantidad y unidad
                </option>
                <option value="unit">Precio por unidad de medida</option>
              </SearchSelect>
              <small>
                El antecedente se conserva como referencia. Los precios
                posteriores mantienen su historial.
              </small>
            </label>
          </fieldset>
          {warnings.length > 0 && (
            <p className="sheet-warning form-wide">
              Hay datos opcionales pendientes. Puedes guardar y completarlos
              después.
            </p>
          )}
          <div className="form-actions form-wide">
            <AppButton disabled={state.busy || saved || !state.canWrite}>
              {state.busy ? "Guardando…" : "Guardar material"}
            </AppButton>
            <AppButton
              type="button"
              className="secondary"
              disabled={state.busy}
              onClick={close}
            >
              Cancelar
            </AppButton>
          </div>
        </form>
      </section>
    </div>
  );
}
