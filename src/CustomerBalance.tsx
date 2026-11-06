import { money, type Row } from "./operations";
import "./sales-compact.css";
export default function CustomerBalance({accounts,currency="GTQ"}:{accounts:Row[];currency?:string}) {
 const rows=accounts.length?accounts:[{currency,balance:0,pending:0,credit:0}];
 return <aside className="customer-balance" aria-label="Saldo del cliente, solo lectura"><strong>Saldo del cliente</strong>{rows.map(a=><div key={a.currency}>
  <output className={Number(a.balance)>0?"balance-debt":Number(a.balance)<0?"balance-credit":"balance-zero"}>{money(Math.abs(Number(a.balance)),a.currency)}{Number(a.balance)>0?" · Pendiente":Number(a.balance)<0?" · A favor":""}</output>
  {(Number(a.pending)>0||Number(a.credit)>0)&&<small>Pendiente: {money(a.pending,a.currency)} · A favor disponible: {money(a.credit,a.currency)}</small>}
 </div>)}</aside>;
}
