import type { Row } from "./operations";

export default function CustomerCommercialInfo({ info }: { info?: Row | null }) {
  if (!info?.commercial_notes?.trim() && !info?.delivery_instructions?.trim()) return null;
  return (
    <section className="order-delivery-readonly customer-commercial-info">
      <h3>Información comercial del cliente</h3>
      <dl>
        {info.commercial_notes?.trim() && <div className="form-wide">
          <dt>Observaciones comerciales</dt>
          <dd>{info.commercial_notes}</dd>
        </div>}
        {info.delivery_instructions?.trim() && <div className="form-wide">
          <dt>Indicaciones habituales de entrega</dt>
          <dd>{info.delivery_instructions}</dd>
        </div>}
      </dl>
    </section>
  );
}
