export const productionStatusLabels: Record<string, string> = {
  draft: "Borrador",
  in_progress: "En preparación",
  curing: "En curación",
  ready_to_release: "Listo para Liberar",
  released: "Liberado",
  finished: "Terminado",
  cancelled: "Cancelado",
};

export function productionStatus(batch: {
  state?: string;
  finalized_at?: string | null;
  available_on?: string | null;
}, date: string) {
  if (batch.finalized_at) return "finished";
  if (batch.state === "curing" && batch.available_on && batch.available_on <= date) return "ready_to_release";
  return batch.state || "";
}

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");

export function productionMatches(query: string, document: string, product: unknown, formula: unknown) {
  const text = [document, product, formula].map(normalize).join(" ");
  return normalize(query).trim().split(/\s+/).every(term => text.includes(term));
}

export function productionDate(value: unknown) {
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(String(value ?? ""));
  return date ? `${date[3]}/${date[2]}/${date[1]}` : "—";
}
