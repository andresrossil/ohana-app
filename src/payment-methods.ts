// The same methods already supported by sales and checkout.
export const paymentMethods = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia bancaria" },
  { value: "cod", label: "Contra entrega" },
] as const;
