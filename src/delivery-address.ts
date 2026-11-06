type Row = Record<string, any>;

export function quoteDelivery(value: Row, options: Row): Row {
  const courier = options.couriers?.find((c: Row) => c.id === value.courier_id);
  const tariff = options.tariffs?.find((t: Row) =>
    t.courier_id === value.courier_id && t.mode === courier?.mode &&
    t.destination === (courier?.mode === "general" ? "general" : value.destination) && t.available);
  return { ...value, shipping_cost: tariff?.amount ?? "" };
}

export function applyDeliveryAddress(value: Row, address: Row, options: Row): Row {
  const next = { ...value, address: address.address || "", department: address.department || "" };
  const courier = options.couriers?.find((c: Row) => c.id === value.courier_id);
  return courier?.mode === "department"
    ? quoteDelivery({ ...next, destination: next.department }, options)
    : next;
}

export function applyCourierChoice(value: Row, id: string, options: Row): Row {
  const courier = options.couriers?.find((c: Row) => c.id === id);
  return quoteDelivery({ ...value, courier_id: id,
    destination: courier?.mode === "department" ? value.department || "" : "" }, options);
}
