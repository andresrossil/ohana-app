import { useEffect, useRef, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import FormSection from "./FormSection";
import { scrollCompactFormToStart, useCompactFormViewport } from "./compact-form-viewport";
import type { Row } from "./operations";

export const standardVariantAttributes = ["aroma", "color", "tipo"];

function attributeName(key: string) {
  return standardVariantAttributes.includes(key) ? key : "attribute:" + key;
}

export default function VariantForm({ productName, variant, attributeKeys, busy, error, onClose, onSave }: {
  productName: string;
  variant: Row | null;
  attributeKeys: string[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: Row, attributes: Row) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [fields] = useState(attributeKeys);
  useCompactFormViewport(body);
  useEffect(() => {
    if (error) scrollCompactFormToStart(body.current);
  }, [error]);

  async function cancel() {
    if (busy) return;
    if (dirty && !(await confirmAction("¿Descartar los cambios de esta variante?"))) return;
    onClose();
  }

  return <div className="overlay compact-form-overlay variant-manager-overlay">
    <section className="modal compact-form-dialog variant-form-dialog"
      role="dialog" aria-modal="true" aria-labelledby="variant-form-title">
      <div className="compact-form-header">
        <div><h2 id="variant-form-title">{variant ? "Editar variante" : "Nueva variante"}</h2><p>{productName}</p></div>
        <AppButton type="button" className="secondary catalog-icon-button" iconKey="action.cancel"
          aria-label="Cerrar formulario" disabled={busy} onClick={() => void cancel()} />
      </div>
      <form className="compact-form" data-dirty-managed data-navigation-dirty={dirty} aria-busy={busy}
        onChange={() => setDirty(true)}
        onSubmit={event => {
          event.preventDefault();
          if (busy) return;
          const data = Object.fromEntries(new FormData(event.currentTarget));
          const attributes: Row = { ...variant?.attributes };
          for (const key of fields) {
            const field = attributeName(key);
            const raw = String(data[field] ?? "");
            if (!standardVariantAttributes.includes(key)) {
              delete data[field];
              if (raw === String(variant?.attributes?.[key] ?? "")) continue;
            }
            if (raw.trim()) attributes[key] = raw.trim().toLowerCase();
            else delete attributes[key];
          }
          onSave(data, attributes);
        }}>
        <div ref={body} className="compact-form-body">
          {error && <p className="error" role="alert"><AppIcon name="status.error" /> {error}</p>}
          <fieldset className="variant-form-fields" disabled={busy}>
            <FormSection title="Identificación comercial" icon="action.barcode">
              <div className="compact-form-grid">
                <label>Código comercial<input name="commercial_code" maxLength={80} placeholder="JT-1, JT-2…" defaultValue={variant?.commercial_code} /></label>
                <label>Tamaño comercial<input name="name" maxLength={120} placeholder="Pequeño, mediano…" defaultValue={variant?.name} /></label>
                <label>SKU<input name="sku" readOnly maxLength={80} required={!!variant} placeholder="Automático al guardar" defaultValue={variant?.sku} /></label>
                <label>Código de barras personalizado<input name="barcode" maxLength={80} defaultValue={variant?.barcode} /></label>
                <label className="check-label form-wide"><input type="checkbox" name="custom" defaultChecked={variant?.barcode_custom} /> Conservar este código, incluso vacío</label>
                <small className="form-wide">El SKU se genera al guardar. Sin personalizar, el código de barras usa el SKU.</small>
              </div>
            </FormSection>
            <FormSection title="Características" icon="status.info">
              <div className="compact-form-grid">
                {fields.map(key => <label key={key} className="variant-attribute-field">{key}
                  <input name={attributeName(key)} maxLength={120} defaultValue={variant?.attributes?.[key]} />
                </label>)}
              </div>
            </FormSection>
            <FormSection title="Rango de peso" icon="module.inventory">
              <div className="compact-form-grid">
                <label>Peso mínimo (g)<input name="weight_min" type="number" inputMode="decimal" min="0.0001" step="0.0001" defaultValue={variant?.weight_min} /></label>
                <label>Peso máximo (g)<input name="weight_max" type="number" inputMode="decimal" min="0.0001" step="0.0001" defaultValue={variant?.weight_max} /></label>
                <small className="form-wide">El peso mínimo está incluido y el máximo está excluido.</small>
              </div>
            </FormSection>
            <FormSection title="Estado y comercialización" icon="module.prices">
              <div className="compact-form-grid">
                <label className="check-label"><input name="active" type="checkbox" defaultChecked={variant?.active ?? true} /> Activa</label>
                <label className="check-label"><input name="published" type="checkbox" defaultChecked={variant?.published ?? false} /> Publicar en tienda</label>
                <label className="check-label form-wide"><input name="allow_preorder" type="checkbox" defaultChecked={variant?.allow_preorder ?? false} /> Permitir pedidos anticipados</label>
                <small className="form-wide">Los precios de venta se administran desde Listas de precios.</small>
              </div>
            </FormSection>
          </fieldset>
        </div>
        <div className="compact-form-actions">
          <AppButton type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>Cancelar</AppButton>
          <AppButton type="submit" iconKey="action.save" disabled={busy}>Guardar variante</AppButton>
        </div>
      </form>
    </section>
  </div>;
}
