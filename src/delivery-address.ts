type Row = Record<string, any>;

export function syncShippingCost(value: Row): Row {
  return { ...value, single_shipping_cost: true,
    shipping_charged: value.payer === "customer" || value.kind === "pickup" ? "0" : value.shipping_cost ?? "" };
}

export function deliveryTariff(value: Row, options: Row): Row | undefined {
  const courier = options.couriers?.find((c: Row) => c.id === value.courier_id);
  return options.tariffs?.find((t: Row) =>
    t.courier_id === value.courier_id && t.mode === courier?.mode &&
    t.destination === (courier?.mode === "general" ? "general" : value.destination) && t.available);
}
export function quoteDelivery(value: Row, options: Row): Row {
  const tariff = deliveryTariff(value, options);
  return syncShippingCost({ ...value, shipping_cost: tariff?.amount ?? "" });
}

export function applyDeliveryAddress(value: Row, address: Row, options: Row): Row {
  const next = { ...value, address_id: address.id || "", address_label: address.label || "",
    address: address.address || "", department: address.department || "", zone: address.zone == null ? "" : String(address.zone) };
  const courier = options.couriers?.find((c: Row) => c.id === value.courier_id);
  return courier?.mode === "department" || courier?.mode === "zone"
    ? quoteDelivery({ ...next, destination: courier.mode === "zone" ? next.zone : next.department }, options)
    : next;
}

export function applyCourierChoice(value: Row, id: string, options: Row): Row {
  const courier = options.couriers?.find((c: Row) => c.id === id);
  return quoteDelivery({ ...value, courier_id: id,
    destination: courier?.mode === "department" ? value.department || "" : courier?.mode === "zone" ? String(value.zone ?? "") : "" }, options);
}
