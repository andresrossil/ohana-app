import { money, type Row } from "./operations";
import { deliveryStatus } from "./delivery-model";
export default function OrderDeliverySummary({order,delivery}:{order:Row;delivery?:Row|null}){
 const d=delivery||{};
 return <section className="order-delivery-readonly"><h3>Entrega</h3><dl>
  <div><dt>Tipo de entrega</dt><dd>{d.kind==="courier"?"Mensajería":d.kind==="own"?"Entrega propia":"Recoger pedido"}</dd></div>
  {d.courier_snapshot?.name&&<div><dt>Mensajería</dt><dd>{d.courier_snapshot.name}</dd></div>}
  {d.guide&&<div><dt>Guía de envío</dt><dd>{d.guide}</dd></div>}
  <div><dt>Estado de entrega</dt><dd>{deliveryStatus[d.status]||"Pendiente"}</dd></div>
  {(d.address||order.customer_snapshot?.address)&&<div className="form-wide"><dt>{d.address_label||"Dirección"}</dt><dd>{d.address||order.customer_snapshot.address}{d.department?` · ${d.department}`:""}{d.zone?` · Zona ${d.zone}`:""}</dd></div>}
  <div><dt>Costo de envío</dt><dd>{money(d.shipping_cost??order.shipping,order.currency)}</dd></div>
  {d.notes&&<div className="form-wide"><dt>Observaciones de entrega</dt><dd>{d.notes}</dd></div>}
 </dl></section>;
}
