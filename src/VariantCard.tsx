import CatalogBadge from "./CatalogBadge";
import { AppButton, AppIcon } from "./AppIcon";
import ProductActions from "./ProductActions";
import { DISCLOSURE_INITIALLY_OPEN } from "./disclosure-default";
import { money, type Row } from "./operations";
import type { priceCost } from "./price-cost";
import { variantLabel } from "./variant-label";
import { weightRangeLabel } from "./variant-weights";

type Estimate = ReturnType<typeof priceCost>;

export function variantEstimatedCost(estimate: Estimate | null) {
  return estimate?.manufacturingCost ?? estimate?.cost ?? null;
}

function Value({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export default function VariantCard({ variant, estimate, priceList, onEdit, onBarcode, onDelete }: {
  variant: Row;
  estimate: Estimate | null;
  priceList: string;
  onEdit?: () => void;
  onBarcode?: () => void;
  onDelete?: () => void;
}) {
  const name = [variant.commercial_code, variant.name].filter(Boolean).join(" · ") || variant.sku || "Variante";
  const attributes = Object.entries(variant.attributes || {}).filter(([, value]) => String(value ?? "").trim());
  const currency = variant.currency;
  const number = variantEstimatedCost(estimate);
  return <article className="dashboard-surface variant-card">
    <details open={DISCLOSURE_INITIALLY_OPEN}>
      <summary>
        <span className="variant-card-title">
          <strong>{name}</strong>
          <AppIcon name="action.expand" />
        </span>
        <span className="variant-card-meta"><span>SKU {variant.sku || "—"}</span><span>{weightRangeLabel({ ...variant, id: variant.id })}</span></span>
        {attributes.length > 0 && <span className="variant-card-attributes">{attributes.map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>}
        <span className="variant-card-price">
          <CatalogBadge active={variant.active} label={variant.active ? "Activa" : "Archivada"} />
          <span><strong>{variant.price == null ? "Pendiente de precio" : money(variant.price, currency)}</strong>
            <small>{priceList || "Lista base"}</small></span>
        </span>
        <span className="variant-metrics">
          <span><small>Disponible</small><strong>{variant.available ?? "—"}</strong></span>
          <span><small>En curación</small><strong>{variant.blocked ?? "—"}</strong></span>
          <span><small>Costo estimado</small><strong>{number == null ? "Pendiente" : money(number, currency)}</strong></span>
        </span>
      </summary>
      <dl className="variant-detail">
        <Value label="Código de barras">{variant.barcode || "Sin código de barras"}</Value>
        {estimate?.midpoint != null && <Value label="Peso de referencia">{Number(estimate.midpoint).toLocaleString("es-GT", { maximumFractionDigits: 4 })} g</Value>}
        {estimate?.costPerGram != null && <Value label="Costo por gramo">{money(estimate.costPerGram, currency)}</Value>}
        {estimate?.packagingUnit != null && <Value label="Empaque por unidad">{money(estimate.packagingUnit, currency)}</Value>}
        {estimate?.suppliesUnit != null && <Value label="Insumos por unidad">{money(estimate.suppliesUnit, currency)}</Value>}
        {estimate?.expenses != null && <Value label="Gastos por unidad">{money(estimate.expenses, currency)}</Value>}
        {estimate?.manufacturingCost != null && <Value label="Costo total con gastos">{money(estimate.cost, currency)}</Value>}
      </dl>
      {(!estimate || estimate.reason) && <p className="variant-card-warning">{estimate?.reason || "Sin información de fórmula o permiso de costos."}</p>}
    </details>
    {(onEdit || onBarcode || onDelete) && <div className="variant-card-actions">
      {onEdit && <AppButton type="button" className="secondary" iconKey="action.edit" onClick={onEdit}>Editar</AppButton>}
      {(onBarcode || onDelete) && <ProductActions name={variantLabel(variant)} onBarcode={onBarcode} onDelete={onDelete} />}
    </div>}
  </article>;
}
