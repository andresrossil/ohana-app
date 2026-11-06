import SearchSelect from "./SearchSelect";
import MoneyInput from "./MoneyInput";
import AutoTextarea from "./AutoTextarea";
import { deliveryStatus, tariffDestinations } from "./delivery-model";
import type { Row } from "./operations";
import { applyCourierChoice, applyDeliveryAddress, quoteDelivery } from "./delivery-address";

export default function DeliveryFields({value,options,onChange,currency="GTQ",customerId=""}:{value:Row;options:Row;onChange:(v:Row)=>void;currency?:string;customerId?:string}) {
  const courier=options.couriers?.find((c:Row)=>c.id===value.courier_id);
  const addresses=(options.addresses||[]).filter((a:Row)=>a.partner_id===customerId);
  function change(key:string,v:any){
    const next={...value,[key]:v};
    if(key==="kind" && v!=="courier") {next.courier_id="";next.destination="";next.shipping_cost="0";}
    if(key==="kind" && v==="pickup"){next.shipping_charged="0";next.payer="ohana";}
    if(key==="payer" && v==="customer")next.shipping_charged="0";
    if(key==="courier_id") Object.assign(next,applyCourierChoice(value,v,options));
    if(key==="destination") {
      if(courier?.mode==="department")next.department=v;
      Object.assign(next,quoteDelivery(next,options));
    }
    onChange(next);
  }
  return <fieldset className="settings-grid delivery-fields"><legend>Entrega</legend>
    <label>Tipo de entrega<SearchSelect value={value.kind} onChange={e=>change("kind",e.target.value)}><option value="pickup">Recoger pedido</option><option value="own">Entrega propia</option><option value="courier">Mensajería</option></SearchSelect></label>
    {value.kind==="courier"&&<>
      <label>Mensajería<SearchSelect required value={value.courier_id||""} onChange={e=>change("courier_id",e.target.value)}><option value="">Seleccionar mensajería</option>{options.couriers?.filter((c:Row)=>c.active||c.id===value.courier_id).map((c:Row)=><option key={c.id} value={c.id}>{c.name}{!c.active?" · Inactiva":""}</option>)}</SearchSelect></label>
      {courier&&courier.mode!=="general"&&<label>{courier.mode==="zone"?"Zona de Ciudad de Guatemala":"Departamento"}<SearchSelect value={value.destination} onChange={e=>change("destination",e.target.value)}><option value="">Seleccionar destino</option>{tariffDestinations(courier.mode).map(destination=><option key={destination} value={destination}>{courier.mode==="zone"?"Zona ":""}{destination}</option>)}</SearchSelect></label>}
    </>}
    {value.kind!=="pickup"&&<>
      {addresses.length>0&&<label className="form-wide">Dirección del cliente<SearchSelect value="" onChange={e=>{const a=addresses.find((a:Row)=>a.id===e.target.value);if(a)onChange(applyDeliveryAddress(value,a,options));}}><option value="">Usar una dirección guardada</option>{addresses.map((a:Row)=><option key={a.id} value={a.id}>{a.label}{a.is_primary?" · Principal":""}{a.department?` · ${a.department}`:""} · {a.address}</option>)}</SearchSelect></label>}
      <label className="form-wide">Dirección completa<AutoTextarea required value={value.address||""} maxLength={2000} onChange={e=>change("address",e.target.value)}/></label>
      <label>Costo real del envío<MoneyInput currency={currency} required min="0" value={value.shipping_cost??""} onChange={e=>change("shipping_cost",e.target.value)}/><small>{value.shipping_cost===""?"Sin tarifa disponible. Ingresa el costo manualmente.":"Tarifa sugerida editable; se conserva en este pedido."}</small></label>
      <label>Quién paga al transportista<SearchSelect value={value.payer} onChange={e=>change("payer",e.target.value)}><option value="ohana">Ohana</option><option value="customer">Cliente directamente</option></SearchSelect></label>
      <label>Envío cobrado al cliente por Ohana<MoneyInput currency={currency} required min="0" disabled={value.payer==="customer"} value={value.shipping_charged??"0"} onChange={e=>change("shipping_charged",e.target.value)}/><small>{value.payer==="customer"?"El pago directo al transportista no es ingreso ni deuda de Ohana.":"Puede ser diferente del costo real del transportista."}</small></label>
      <label>Número de guía · opcional<input value={value.guide||""} maxLength={120} onChange={e=>change("guide",e.target.value)}/></label>
    </>}
    <label>Estado de entrega<SearchSelect value={value.status} onChange={e=>change("status",e.target.value)}>{Object.entries(deliveryStatus).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SearchSelect></label>
    <label className="form-wide">Observaciones de entrega<AutoTextarea maxLength={2000} value={value.notes||""} onChange={e=>change("notes",e.target.value)}/></label>
  </fieldset>;
}
