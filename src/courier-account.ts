import { money } from "./operations";
export const settlementNumber=(n:unknown)=>`LIQ-${String(n??"").padStart(4,"0")}`;
export const courierBalanceText=(value:number,name="El mensajero")=>value>0?`${name} debe entregar ${money(value)} a Ohana`:value<0?`Ohana debe pagar ${money(-value)} a ${name}`:"Sin saldo pendiente";
export const courierBalanceClass=(value:number)=>value>0?"balance-credit":value<0?"balance-debt":"balance-zero";
