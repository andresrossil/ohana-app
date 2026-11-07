import { useEffect, useState } from "react";
import { confirmAction } from "./ConfirmDialog";
import ResponsiveTable from "./ResponsiveTable";
import { SaleUnits } from "./PhysicalUnits";
import { SearchField } from "./PoolControls";
import { AppButton, AppIcon } from "./AppIcon";
import { sales } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
import OrderDeliveryDialog from "./OrderDeliveryDialog";
import SaleEditor from "./SaleEditor";
import OrderPreparationDialog, { fulfillmentLabels } from "./OrderPreparationDialog";
import { deliveryStatus } from "./delivery-model";
import "./couriers.css";
export default function Sales({company,customersOnly=false,currency="GTQ"}:{company:string;customersOnly?:boolean;currency?:string}) {
 const state=useOperation(company,"sales");
 const [data,setData]=useState<Row>({orders:[],customers:[],variants:[]}),[mode,setMode]=useState<string|null>(null),[order,setOrder]=useState<Row|null>(null),[query,setQuery]=useState(""),[managedOrder,setManagedOrder]=useState<string|null>(null),[editor,setEditor]=useState<Row|null|undefined>(),[preparing,setPreparing]=useState<string|null>(null);
 const load=async()=>setData(await sales(company));
 useEffect(()=>{void state.run(load);},[company]);
 const statusNames:Row={pending:"Pendiente",dispatched:"Entregado",cancelled:"Cancelado",expired:"Vencido"};
 const orderStage=(o:Row)=>["cancelled","expired"].includes(o.status)?statusNames[o.status]:o.status==="dispatched"&&o.fulfillment_stage==="invoiced"?"Entregado":fulfillmentLabels[o.fulfillment_stage||"invoiced"];
 const invoiceBalance=(o:Row)=>o.payment_summary?.paid!=null?Math.max(0,Number(o.total)-Number(o.payment_summary.paid)):null;
 const orders=data.orders.filter((o:Row)=>[o.number,o.customer_snapshot.name,o.customer_snapshot.phone,orderStage(o)].join(" ").toLowerCase().includes(query.toLowerCase()));
 return <>
  <section className="intro"><div><p className="eyebrow">CADA PEDIDO, EN SU EMPRESA</p><h1>{customersOnly?"Clientes":"Ventas y pedidos"}</h1><p>Pedidos, facturas, entregas y pagos de tu empresa.</p></div><div className="actions">{state.canWrite&&!customersOnly&&<AppButton onClick={()=>setEditor(null)}>Ingresar factura</AppButton>}<AppButton className="secondary" disabled={state.busy} onClick={()=>state.run(load)}>Actualizar</AppButton></div></section>
  {state.error&&!mode&&<p className="error" role="alert"><AppIcon name="status.error"/>{state.error}</p>}{state.notice&&<p role="status">{state.notice}</p>}
  {editor!==undefined&&<SaleEditor company={company} orderId={editor?.id} currency={editor?.currency||currency} onClose={()=>setEditor(undefined)} onSaved={load}/>}
  {mode&&order&&<div className="overlay"><section className="modal operations-dialog" role="dialog" aria-modal="true" aria-label="Confirmar operación de venta"><h2>{mode==="dispatch"?"Entregar pedido":"Cancelar pedido"}</h2>{state.error&&<p className="error">{state.error}</p>}<p>Pedido #{order.number} · {order.customer_snapshot.name} · {money(order.total,order.currency)}</p><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void state.run(async()=>{await keyedRequest(company,"sales",{order:order.id,...(mode==="cancel"?{reason:f.get("reason")}:{})},mode);setMode(null);await load();});}}>
   <p>{mode==="dispatch"?"Se descontarán las existencias de las unidades entregadas.":"Se liberarán las reservas. Los pagos y saldos aplicados deben revertirse antes de cancelar."}</p>{mode==="cancel"&&<label>Motivo de cancelación<input name="reason" required minLength={5} maxLength={500}/></label>}<label><input type="checkbox" required/> Confirmo esta operación</label><div className="form-actions"><AppButton disabled={state.busy}>Confirmar</AppButton><AppButton type="button" className="secondary" disabled={state.busy} onClick={()=>setMode(null)}>Volver</AppButton></div>
  </form></section></div>}
      <section className="catalog">
        <div className="toolbar">
          <h2>{customersOnly ? "Contactos" : "Pedidos recientes"}</h2>
          {!customersOnly && (
            <SearchField
              aria-label="Buscar pedido"
              placeholder="Pedido, nombre, teléfono o estado"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
        <div className="table-wrap">
          {customersOnly ? (
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  <th>Dirección</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c: Row) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.phone}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.address || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          ) : (
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Artículos vendidos</th>
                  <th>Total</th>
                  <th>Saldo de factura</th>
                  <th>Entrega / pago</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: Row) => (
                  <tr key={o.id}>
                    <td>
                      #{o.number}
                      <small>
                        {new Date(o.created_at).toLocaleString("es-GT")}
                      </small>
                    </td>
                    <td>
                      {o.customer_snapshot.name}
                      <small>{o.customer_snapshot.phone}</small>
                      <small>{o.customer_snapshot.email}</small>
                      <small>{o.customer_snapshot.address}</small>
                    </td>
                    <td>
                      {o.lines?.map((l: Row) => (
                        <div key={l.id} className="sale-line">
                          {l.quantity} × {l.description} ·{" "}
                          {money(l.unit_price, o.currency)} / ud
                          {l.is_gift && <strong className="sale-gift-label"> · Regalo</strong>}
                          <SaleUnits units={l.physical_units || []} />
                        </div>
                      ))}
                      {o.gift && <small>Regalo: {o.gift}</small>}
                      {o.gift_message && (
                        <small>Mensaje: {o.gift_message}</small>
                      )}
                    </td>
                    <td>
                      {money(o.total, o.currency)}
                      <small>Descuento: {money(o.discount, o.currency)}</small>
                      <small>Envío: {money(o.shipping, o.currency)}</small>
                    </td>
                    <td data-sort-value={invoiceBalance(o)}>
                      <strong className={Number(invoiceBalance(o))>0?"balance-debt":"balance-zero"}>{money(invoiceBalance(o),o.currency)}</strong>
                      {Number(o.payment_summary?.excess)>0&&<small className="balance-credit">A favor disponible: {money(o.payment_summary.excess,o.currency)}</small>}
                    </td>
                    <td>
                      {o.delivery_info?.courier_snapshot?.name || (o.delivery === "delivery" ? "Domicilio" : "Retiro")}
                      {o.delivery_info&&<small>{deliveryStatus[o.delivery_info.status]} · Costo real: {money(o.delivery_info.shipping_cost,o.currency)}{o.delivery_info.payer==="customer"?" · Pagado directamente al transportista":""}</small>}
                      <small>
                        {
                          {
                            cash: "Efectivo",
                            transfer: "Transferencia",
                            cod: "Contra entrega",
                          }[o.payment as string]
                        }
                      </small>
                      <small>
                        {o.paid_at ? "Pagado por el cliente" : "Pendiente de pago"}
                      </small>
                      {o.payment_summary&&<small>En mensajero, pendiente de liquidar: {money(o.payment_summary.courier_pending,o.currency)}</small>}
                      {Number(o.payment_summary?.pending_confirmation)>0&&<small>Transferencia por confirmar: {money(o.payment_summary.pending_confirmation,o.currency)}</small>}{o.refund_pending && (
                        <small className="error">Reembolso pendiente</small>
                      )}
                    </td>
                    <td>
                      <AppIcon
                        name={
                          o.status === "dispatched"
                            ? "status.success"
                            : o.status === "pending"
                              ? "status.pending"
                              : "status.info"
                        }
                      />
                      {orderStage(o)}
                      {o.status === "pending" && o.fulfillment_stage==="invoiced" && (
                        <small>
                          Vence:{" "}
                          {new Date(o.expires_at).toLocaleString("es-GT")}
                        </small>
                      )}
                    </td>
                    <td className="actions">{state.canWrite&&!["cancelled","expired"].includes(o.status)&&!o.settled&&<AppButton className="secondary" onClick={()=>setEditor(o)}>Editar factura</AppButton>}{o.settled&&<small>Liquidada por mensajería</small>}
                      <AppButton className="secondary" onClick={()=>setManagedOrder(o.id)}>{invoiceBalance(o)!==null&&Number(invoiceBalance(o))>0?"Pagar factura":"Ver pagos"}</AppButton>
                      {state.canWrite && o.status === "pending" && (
                        <>
                          <AppButton iconKey="action.edit" disabled={state.busy} onClick={()=>setPreparing(o.id)}>{o.fulfillment_stage==="preparing"?"Ver preparación":o.fulfillment_stage==="finished"?"Ver pedido terminado":"Preparar pedido"}</AppButton>
                          {["preparing","finished"].includes(o.fulfillment_stage)&&<AppButton iconKey="action.confirm" disabled={state.busy} onClick={()=>state.run(async()=>{
                            const action=o.fulfillment_stage==="preparing"?"finish":"handoff";
                            if(!(await confirmAction(action==="finish"?"¿Confirmas que el pedido está terminado?":"¿Confirmas la entrega? Se descontarán las existencias de los productos.")))return;
                            await keyedRequest(company,"sales_fulfillment",{order:o.id,expected_stage:o.fulfillment_stage},action);await load();
                          })}>{o.fulfillment_stage==="preparing"?"Pedido terminado":o.delivery_info?.kind==="courier"?"Entregado a mensajería":"Entregar al cliente"}</AppButton>}
                          <AppButton
                            className="secondary"
                            onClick={() => {
                              setOrder(o);
                              setMode("cancel");
                            }}
                          >
                            Cancelar pedido
                          </AppButton>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          )}
          {!(customersOnly ? data.customers : orders).length && (
            <p className="empty">Todavía no hay registros.</p>
          )}
        </div>
      </section>

  {preparing&&<OrderPreparationDialog company={company} orderId={preparing} onClose={()=>setPreparing(null)} onSaved={load}/>}
  {managedOrder&&<OrderDeliveryDialog company={company} orderId={managedOrder} onClose={()=>setManagedOrder(null)} onSaved={load}/>}
 </>;
}
