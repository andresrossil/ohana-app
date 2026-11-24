import { pricesChanged } from "./price-events";
import MoneyInput from "./MoneyInput";
import MaterialPhoto, { uploadMaterialPhoto } from "./MaterialPhoto";
import { useMaterialTypes } from "./MaterialTypesContext";
import SearchSelect, { SortedDatalist } from "./SearchSelect";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FormSection from "./FormSection";
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

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function validationField(issue: string) {
  if (/^MATERIAL|^Este material/.test(issue)) return "name";
  if (/^Proveedor|^PROVEEDOR/.test(issue)) return "supplier";
  if (/^OTRO NOMBRE/.test(issue)) return "material_cell_1";
  if (/^PRESENTACION/.test(issue)) return "material_cell_4";
  if (/^UNIDAD MEDIDA|^La unidad/.test(issue)) return "presentation-unit";
  if (/^PRECIO PRESENTACION/.test(issue)) return "material_cell_7";
  if (/^FECHA CONSULTA/.test(issue)) return "material_cell_12";
  if (/^PRECIO ANTERIOR/.test(issue)) return "material_cell_10";
  if (/^TIPO DE MATERIAL/.test(issue)) return "classification";
  if (/^SKU/.test(issue)) return "sku";
  if (/^CÓDIGO DE BARRAS/.test(issue)) return "barcode";
  return "";
}

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
  const [fieldErrors, setFieldErrors] = useState<Map<Field, string[]>>(new Map());
  const submitting = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.notice) body.current?.scrollTo({ top: 0 });
  }, [state.error, state.notice]);
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    function keepFocusedFieldVisible() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLElement) || !body.current?.contains(field)) return;
        const fieldRect = field.getBoundingClientRect();
        const bodyRect = body.current.getBoundingClientRect();
        if (fieldRect.bottom > bodyRect.bottom || fieldRect.top < bodyRect.top) {
          field.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
    }
    viewport?.addEventListener("resize", keepFocusedFieldVisible);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", keepFocusedFieldVisible);
    };
  }, []);
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
      (await confirmAction("Tienes cambios sin guardar. ¿Deseas salir del formulario?", {
        cancelText: "Continuar editando", confirmText: "Descartar cambios",
      }))
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
            data-validation-field={"material_cell_" + index}
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
          inputMode={type === "number" ? "decimal" : undefined}
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
    if (submitting.current || saved || state.busy || !state.canWrite) return;
    const fields = [...form.querySelectorAll<Field>("input, textarea, select")].filter((field) => field.willValidate);
    const errors = new Map<Field, string[]>();
    function addError(field: Field, message: string) {
      const messages = errors.get(field) || [];
      if (!messages.includes(message)) errors.set(field, [...messages, message]);
    }
    for (const field of fields) {
      if (!field.validity.valid) addError(field, field.validationMessage);
    }
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
    if (catalog.raw_materials.some((m) => normalize(m.name) === normalize(draft.cells[2]))) {
      issues.push("Este material ya existe. Ábrelo desde el catálogo para editarlo o agregar presentaciones.");
    }
    const unassigned: string[] = [];
    for (const issue of issues) {
      const key = validationField(issue);
      const field = fields.find((candidate) => key && (candidate.name === key || candidate.dataset.validationField === key));
      if (field) {
        if (field.validity.valid) addError(field, issue);
      } else unassigned.push(issue);
    }
    setFieldErrors(errors);
    state.setError(unassigned.join(" · "));
    if (errors.size || unassigned.length) {
      for (const field of errors.keys()) {
        for (let section = field.closest("details"); section; section = section.parentElement?.closest("details") ?? null) {
          section.open = true;
        }
      }
      const first = fields.find((field) => errors.has(field));
      requestAnimationFrame(() => {
        const target = first?.hidden ? first.parentElement?.querySelector("button") : first;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (!target) body.current?.scrollTo({ top: 0 });
      });
      return;
    }
    submitting.current = true;
    try {
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
            maximumStock: String(data.get("maximum_stock") || ""),
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
    } finally {
      submitting.current = false;
    }
  }
  const disabled = state.busy || saved;
  return (
    <div className="overlay compact-form-overlay">
      <section
        className="modal material-create-modal compact-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-material-title"
      >
        <div className="compact-form-header">
          <div>
            <p className="eyebrow"><AppIcon name="module.materials" /> Materiales</p>
            <h2 id="new-material-title">Nuevo material</h2>
          </div>
          <AppButton type="button" className="secondary catalog-icon-button" iconKey="action.cancel"
            aria-label="Cerrar formulario" title="Cerrar formulario" disabled={state.busy} onClick={close} />
        </div>
        <form className="compact-form" noValidate data-dirty-managed aria-busy={state.busy}
          onChange={(event) => {
            setDirty(true);
            const label = (event.target as HTMLElement).closest("label");
            setFieldErrors((previous) => {
              if (![...previous.keys()].some((field) => field.closest("label") === label)) return previous;
              return new Map([...previous].filter(([field]) => field.closest("label") !== label));
            });
          }}
          onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
          <div ref={body} className="compact-form-body">
        {state.error && (
          <p className="error" role="alert">
            <AppIcon name="status.error" />
            {state.error}
          </p>
        )}
        {state.notice && <p role="status">{state.notice}</p>}
          <FormSection title="Información general" icon="status.info" initiallyOpen>
          <fieldset className="compact-form-grid" disabled={disabled}>
            <label>
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
            <MaterialPhoto compact onChange={() => setDirty(true)} />
            <label className="form-wide">
              Notas del material
              <textarea name="notes" rows={2} maxLength={5000} />
            </label>
          </fieldset>
          </FormSection>
          <FormSection title="Identificación y organización" icon="action.barcode">
            <fieldset className="compact-form-grid" disabled={disabled}>
            <CatalogFields
              company={company}
              kind="material" compact
              origins={catalog.catalog_origins || []}
            />
            </fieldset>
          </FormSection>
          <FormSection title="Proveedor y presentación" icon="module.suppliers">
          <fieldset className="compact-form-grid" disabled={disabled}>
            <label>
              Proveedor
              <input
                name="supplier"
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
                data-validation-field="presentation-unit"
                wrapSelection
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
              <textarea
                rows={2}
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
          </FormSection>
          <FormSection title="Precio e historial" icon="module.prices">
          <fieldset className="compact-form-grid" disabled={disabled}>
            {textField(7, "Precio de la presentación", "number")}
            {textField(12, "Fecha de consulta", "date")}
            <div className="form-wide dashboard-surface compact-form-grid compact-price-summary" aria-live="polite">
              <div><small>Precio actual por unidad</small><strong>
                {computed.current == null ? "Pendiente" : money(computed.current, currency)}
                {computed.current != null && row.cells[5] ? ` / ${row.cells[5]}` : ""}
              </strong></div>
              <div><small>Comparación VS</small><div className="material-create-vs">
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
              </div></div>
            </div>
            <div className="form-wide">
            <FormSection title="Referencia de precio anterior" icon="action.history">
              <div className="compact-form-grid">
            {textField(10, "Precio anterior · referencia inicial", "number")}
            {textField(11, "Proveedor anterior")}
            <label className="form-wide">
              Interpretación del precio anterior
              <SearchSelect
                wrapSelection
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
              </div>
            </FormSection>
            </div>
          </fieldset>
          </FormSection>
          <FormSection title="Inventario" icon="module.inventory">
            <fieldset className="compact-form-grid" disabled={disabled}>
              <label>Inventario mínimo<input name="minimum_stock" type="number" inputMode="decimal" min="0" max="999999999999999" step="any" /></label>
              <label>Inventario máximo<input name="maximum_stock" type="number" inputMode="decimal" min="0" max="999999999999999" step="any" /></label>
              <small className="form-wide">
                {row.cells[5] ? `Unidad de inventario: ${row.cells[5]}. ` : "Cantidades en la unidad de inventario del material. "}
                Puedes dejar ambos campos vacíos.
              </small>
            </fieldset>
          </FormSection>
          {warnings.length > 0 && (
            <p className="sheet-warning form-wide">
              Hay datos opcionales pendientes. Puedes guardar y completarlos
              después.
            </p>
          )}
          {[...fieldErrors].map(([field, messages], index) => {
            const target = field.closest("label");
            return target && createPortal(<small className="compact-field-error" role="alert">{messages.join(" · ")}</small>, target, String(index));
          })}
          </div>
          <div className="compact-form-actions">
            <AppButton type="button" className="secondary" iconKey="action.cancel" disabled={state.busy} onClick={close}>Cancelar</AppButton>
            <AppButton type="submit" iconKey="action.save" disabled={disabled || !state.canWrite}>
              {state.busy ? "Guardando…" : "Guardar material"}
            </AppButton>
          </div>
        </form>
      </section>
    </div>
  );
}
