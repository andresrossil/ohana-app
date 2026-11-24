import { useEffect, useId, useRef, useState } from "react";
import type { ComponentProps, FormEvent } from "react";
import { useCompactFormViewport } from "./compact-form-viewport";
import { AppButton, AppIcon } from "./AppIcon";
import CatalogFields from "./CatalogFields";
import { confirmAction } from "./ConfirmDialog";
import FormSection from "./FormSection";
import MaterialPhoto from "./MaterialPhoto";
import SearchSelect from "./SearchSelect";

type InvalidField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Props = Pick<ComponentProps<typeof CatalogFields>, "company" | "origins" | "requestCodes"> & {
  units: { id: string; [key: string]: any }[];
  busy: boolean;
  error: string;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onClose: () => void;
};

function reveal(field: HTMLElement) {
  for (let section = field.closest("details"); section; section = section.parentElement?.closest("details") ?? null) {
    section.open = true;
  }
}

export default function ProductCreateForm({ company, origins, units, requestCodes, busy, error, onSave, onClose }: Props) {
  const titleId = useId();
  const form = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useCompactFormViewport(body);
  const pendingFocus = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  function focusIssue(field: HTMLElement) {
    reveal(field);
    cancelAnimationFrame(pendingFocus.current);
    pendingFocus.current = requestAnimationFrame(() => {
      const target = field.hidden ? field.parentElement?.querySelector("button") : field;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  useEffect(() => () => cancelAnimationFrame(pendingFocus.current), []);
  const serverField = /barcode|código de barras/i.test(error) ? "barcode"
    : /\bsku\b|_sku/i.test(error) ? "sku"
    : /foto|imagen|imagebitmap/i.test(error) ? "photo"
    : /minimum_stock|stock mínimo/i.test(error) ? "minimum_stock"
    : /products_name|nombre/i.test(error) ? "name" : "";
  useEffect(() => {
    if (!error) return;
    const field = serverField ? form.current?.querySelector<HTMLElement>(`[name="${serverField}"]`) : null;
    if (field) focusIssue(field);
    else body.current?.scrollTo({ top: 0 });
  }, [error, serverField]);

  async function close() {
    if (busy) return;
    if (!dirty || await confirmAction("Tienes cambios sin guardar. ¿Deseas salir del formulario?", {
      cancelText: "Continuar editando",
      confirmText: "Descartar cambios",
    })) onClose();
  }

  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalid = Array.from(event.currentTarget.querySelectorAll<InvalidField>("input, select, textarea"))
      .filter(field => field.willValidate && !field.validity.valid);
    if (invalid.length) {
      invalid.forEach(reveal);
      setIssues(Object.fromEntries(invalid.map(field => [field.dataset.validationField || field.name, field.validationMessage])));
      focusIssue(invalid[0]);
      return;
    }
    setIssues({});
    void onSave(event);
  }

  function message(name: string) {
    const text = issues[name] || (serverField === name ? error : "");
    return text && <small className="compact-field-error" role="alert">{text}</small>;
  }
  function changed() {
    setDirty(true);
    if (Object.keys(issues).length) setIssues({});
  }

  return <div className="overlay compact-form-overlay">
    <section className="modal compact-form-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="compact-form-header">
        <div>
          <p className="eyebrow"><AppIcon name="module.products" /> Productos</p>
          <h2 id={titleId}>Nuevo producto</h2>
        </div>
        <AppButton type="button" className="secondary catalog-icon-button" iconKey="action.cancel"
          aria-label="Cerrar formulario" disabled={busy} onClick={() => void close()} />
      </div>
      <form ref={form} className="compact-form" data-dirty-managed data-navigation-dirty={dirty}
        aria-busy={busy} noValidate onChange={changed} onSubmit={validate}>
        <div ref={body} className="compact-form-body">
          {error && !serverField && <p className="error" role="alert">{error}</p>}
          <FormSection title="Información general" icon="status.info">
            <fieldset className="compact-form-grid" disabled={busy}>
              <label>Nombre del producto *<input name="name" maxLength={160} required />{message("name")}</label>
              <div className="product-form-photo">
                <MaterialPhoto compact noun="fotografía" onChange={changed} />
                {serverField === "photo" && <small className="compact-field-error" role="alert">{error}</small>}
              </div>
              <label className="form-wide">Notas internas<textarea name="notes" rows={2} /></label>
            </fieldset>
          </FormSection>
          <FormSection title="Identificación y organización" icon="action.barcode">
            <fieldset className="compact-form-grid" disabled={busy}>
              <CatalogFields company={company} kind="product" origins={origins} requestCodes={requestCodes}
                compact fieldMessage={message} />
            </fieldset>
          </FormSection>
          <FormSection title="Configuración comercial" icon="module.prices">
            <fieldset className="compact-form-grid" disabled={busy}>
              <label className="form-wide">Descripción pública<textarea name="description" rows={2} /></label>
              <label className="check-label">
                <input name="published" type="checkbox" />
                <span>Publicar producto en tienda<small>Visibilidad del producto en la tienda pública.</small></span>
              </label>
              <label className="check-label">
                <input name="available_for_sale" type="checkbox" defaultChecked />
                <span>Disponible para venta<small>Configuración de disponibilidad comercial del producto.</small></span>
              </label>
            </fieldset>
          </FormSection>
          <FormSection title="Inventario y producción" icon="module.inventory">
            <fieldset className="compact-form-grid" disabled={busy}>
              <label>Unidad de medida (opcional)
                <SearchSelect name="unit_id" wrapSelection data-validation-field="unit_id">
                  <option value="">Pendiente</option>
                  {units.filter(unit => unit.active).map(unit => <option value={unit.id} key={unit.id}>{unit.name}</option>)}
                </SearchSelect>
                {message("unit_id")}
              </label>
              <label>Stock mínimo del producto *
                <input name="minimum_stock" type="number" inputMode="decimal" min="0" step="any" required defaultValue={0} />
                <small>Se compara con la suma disponible de sus variantes. Cero desactiva la sugerencia.</small>
                {message("minimum_stock")}
              </label>
              <label className="check-label form-wide"><input name="is_intermediate" type="checkbox" /> Producto intermedio</label>
            </fieldset>
          </FormSection>
        </div>
        <div className="compact-form-actions">
          <AppButton type="button" className="secondary" iconKey="action.cancel" disabled={busy} onClick={() => void close()}>Cancelar</AppButton>
          <AppButton type="submit" iconKey="action.save" disabled={busy}>{busy ? "Guardando…" : "Guardar producto"}</AppButton>
        </div>
      </form>
    </section>
  </div>;
}
