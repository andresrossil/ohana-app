import { useEffect, useState } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import { lotCode } from "./BatchTrace";
import { request } from "./commerce";
import { today } from "./operations";
import ResponsiveTable from "./ResponsiveTable";

type CuringBatch = {
  id: string;
  batch_number: number;
  product_name: string;
  state: string;
  actual_quantity: number | null;
  available_on: string | null;
  opening_stock: boolean;
  confirmed: boolean;
};

const count = new Intl.NumberFormat("es-GT");

export default function CuringProduction({
  company,
  alerts = false,
  onProduction,
}: {
  company: string;
  alerts?: boolean;
  onProduction?: () => void;
}) {
  const [batches, setBatches] = useState<CuringBatch[] | null>(null);
  const [error, setError] = useState(false);
  const [date, setDate] = useState(today);

  useEffect(() => {
    let active = true;
    let requestNumber = 0;
    async function refresh() {
      const current = ++requestNumber;
      setDate(today());
      try {
        const rows: CuringBatch[] = await request("production_command", {
          p_company: company,
          p_action: "list",
        });
        if (active && current === requestNumber) {
          setBatches(rows.filter((row) => row.state === "curing"));
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
  }, [company]);

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
                <th>Unidades</th>
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
                    <td data-sort-value={batch.actual_quantity ?? undefined}>
                      {pendingWeight ? "Pendiente de pesaje" : batch.actual_quantity == null ? "—" : count.format(batch.actual_quantity)}
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
