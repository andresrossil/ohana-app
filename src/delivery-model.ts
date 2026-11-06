import { request } from "./commerce";
import type { Row } from "./operations";
export const departments = ["Alta Verapaz","Baja Verapaz","Chimaltenango","Chiquimula","El Progreso","Escuintla","Guatemala","Huehuetenango","Izabal","Jalapa","Jutiapa","Petén","Quetzaltenango","Quiché","Retalhuleu","Sacatepéquez","San Marcos","Santa Rosa","Sololá","Suchitepéquez","Totonicapán","Zacapa"];
export const deliveryStatus: Row = {pending:"Pendiente",in_transit:"En camino",delivered:"Entregado",cancelled:"Cancelado"};
export const tariffModes: Row = {general:"Tarifa general",zone:"Por zona",department:"Por departamento"};
export const courierRead = (company: string, action: string, data: Row = {}) => request("courier_operations",{p_company:company,p_action:action,p_data:data});
export const blankDelivery = (): Row => ({kind:"pickup",courier_id:"",address_id:"",address_label:"",address:"",department:"",zone:"",destination:"",shipping_cost:"",shipping_charged:"0",single_shipping_cost:true,payer:"ohana",guide:"",status:"pending",notes:""});
export const tariffDestinations = (mode: string) => mode === "zone" ? Array.from({length:21},(_,i)=>String(i+1)) : mode === "department" ? departments : ["general"];
