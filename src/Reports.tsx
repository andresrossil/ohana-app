import { useEffect, useState } from "react";
import { request } from "./commerce";
import { useOperation, money, type Row } from "./operations";
export default function Reports({ company }: { company: string }) {
  const state = useOperation(company, "reports"),
    [data, setData] = useState<Row | null>(null);
  async function load() {
    setData(await request("report_summary", { p_company: company }));
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">UNA EMPRESA A LA VEZ</p>
          <h1>Reportes</h1>
          <p>
            Resumen de la empresa seleccionada. Los importes se mantienen
            separados por moneda.
          </p>
        </div>
        <button disabled={state.busy} onClick={() => state.run(load)}>
          Actualizar
        </button>
      </section>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {data && (
        <>
          <section className="stats">
            {[
              ["Materiales", "materials"],
              ["Productos", "products"],
              ["Variantes", "variants"],
              ["Lotes", "batches"],
              ["Unidades disponibles", "units_available"],
              ["Unidades en curación", "units_curing"],
              ["Unidades reservadas", "units_reserved"],
              ["Pedidos pendientes", "orders_pending"],
            ].map(([title, key]) => (
              <div key={key}>
                <span>{title}</span>
                <strong>{Number(data[key])}</strong>
              </div>
            ))}
          </section>
          <section className="catalog">
            <h2>Ventas entregadas</h2>
            {data.sales.length ? (
              data.sales.map((r: Row) => (
                <p key={r.currency}>
                  {r.currency}: {r.orders} pedidos ·{" "}
                  {money(r.total, r.currency)} · pendiente de cobro:{" "}
                  {money(r.unpaid, r.currency)}
                </p>
              ))
            ) : (
              <p className="empty">No hay ventas entregadas.</p>
            )}
            <h2>Compras recibidas</h2>
            {data.purchases.length ? (
              data.purchases.map((r: Row) => (
                <p key={r.currency}>
                  {r.currency}: {r.receipts} compras ·{" "}
                  {money(r.total, r.currency)}
                </p>
              ))
            ) : (
              <p className="empty">No hay compras recibidas.</p>
            )}
            <h2>Valor conocido del inventario</h2>
            {data.stock_value.map((r: Row) => (
              <p key={r.currency}>
                {money(r.known_value, r.currency)} · {r.unknown_lots} lotes con
                costo pendiente
              </p>
            ))}
            <p className="muted">
              Los costos desconocidos no se consideran cero. Estos datos no
              representan un estado contable ni suman monedas distintas.
            </p>
          </section>
        </>
      )}
    </>
  );
}
