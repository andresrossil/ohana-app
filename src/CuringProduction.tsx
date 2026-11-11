import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { lotCode } from "./BatchTrace";
import { request } from "./commerce";
import { today } from "./operations";
import ResponsiveTable from "./ResponsiveTable";
import { plannedProductionUnits } from "./formula-model";

type CuringBatch = {
  id: string;
  batch_number: number;
  product_name: string;
  product_id: string;
  formula_id: string | null;
  formula_scale: number;
  planned_quantity: number | null;
  theoreticalQuantity: number | null;
  state: string;
  actual_quantity: number | null;
  available_on: string | null;
  opening_stock: boolean;
  confirmed: boolean;
};

export const curingCount = new Intl.NumberFormat("es-GT", { maximumFractionDigits: 8 });

export function useCuringProduction(company: string | null, revision = 0) {
  const [batches, setBatches] = useState<CuringBatch[] | null>(null);
  const [error, setError] = useState(false);
  const [date, setDate] = useState(today);

  useEffect(() => {
    if (!company) return;
    const activeCompany = company;
    let active = true;
    let requestNumber = 0;
    async function refresh() {
      const current = ++requestNumber;
      setDate(today());
      try {
        const rows: CuringBatch[] = await request("production_command", {
          p_company: activeCompany,
          p_action: "list",
        });
        const curing = rows.filter((row) => row.state === "curing");
        const needsEstimate = curing.some((row) => row.opening_stock && row.planned_quantity == null && row.formula_id);
        const formulas: { id: string; estimated_units: number | null }[] = needsEstimate
          ? await request("formula_command", { p_company: activeCompany, p_action: "list" })
          : [];
        const yields = new Map(formulas.map((formula) => [formula.id, formula.estimated_units]));
        if (active && current === requestNumber) {
          setBatches(curing.map((row) => ({
            ...row,
            theoreticalQuantity: row.planned_quantity ?? (
              row.opening_stock && row.formula_id
                ? plannedProductionUnits(yields.get(row.formula_id), row.formula_scale)
                : null
            ),
          })));
          setError(false);
        }
      } catch {
        if (active && current === requestNumber) setError(true);
      }
    }

    void refresh();
    window.addEventListener("focus", refresh);
    const clock = window.setInterval(() => setDate(today()), 60_000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(clock);
    };
  }, [company, revision]);
  return { batches, error, date };
}

export default function CuringProduction({
  company,
  onProduction,
}: {
  company: string;
  onProduction: () => void;
}) {
  const state = useCuringProduction(company);
  return <CuringProductionTable state={state} alerts onProduction={onProduction} />;
}

export function CuringProductionTable({
  state: { batches, error, date },
  alerts = false,
  onProduction,
}: {
  state: ReturnType<typeof useCuringProduction>;
  alerts?: boolean;
  onProduction?: () => void;
}) {
  const rows = (batches ?? []).filter(
    (batch) => !alerts || (batch.available_on && batch.available_on <= date),
  );

  return (
    <>
      {error ? (
        <p className="error" role="alert">No se pudo consultar la producción en curación.</p>
      ) : batches === null ? (
        <p className="empty" role="status">Consultando producción en curación…</p>
      ) : rows.length === 0 ? (
        <p className="empty">{alerts ? "No hay producción pendiente de confirmar." : "No hay productos en curación."}</p>
      ) : (
        <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Lote</th>
                <th>Unidades teóricas</th>
                <th>Unidades registradas</th>
                <th>Disponibilidad</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((batch) => {
                const pendingWeight = batch.opening_stock && !batch.confirmed;
                const due = !!batch.available_on && batch.available_on <= date;
                return (
                  <tr key={batch.id}>
                    <td>{batch.product_name}</td>
                    <td data-sort-value={batch.batch_number}>{lotCode(batch.batch_number)}</td>
                    <td data-sort-value={batch.theoreticalQuantity ?? undefined}>
                      {batch.theoreticalQuantity == null ? "Sin estimación" : curingCount.format(batch.theoreticalQuantity)}
                    </td>
                    <td data-sort-value={batch.actual_quantity ?? undefined}>
                      {pendingWeight ? "Pendiente de pesaje" : batch.actual_quantity == null ? "—" : curingCount.format(batch.actual_quantity)}
                    </td>
                    <td>{batch.available_on ?? "—"}</td>
                    <td>
                      {due && <AppIcon name="status.warning" />}
                      {due ? pendingWeight ? "Pendiente de confirmar pesos y variantes" : "Pendiente de liberar" : "En curación"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </div>
      )}
      {!error && rows.length > 0 && onProduction && (
        <div className="toolbar">
          <AppButton className="secondary" onClick={onProduction}>Ir a Producción</AppButton>
        </div>
      )}
    </>
  );
}
