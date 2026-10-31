import { AppButton, AppIcon } from "./AppIcon";
import { useEffect, useState } from "react";
import { sales } from "./commerce";
import { keyedRequest, money, useOperation, type Row } from "./operations";
export default function Sales({
  company,
  customersOnly = false,
  currency = "GTQ",
}: {
  company: string;
  customersOnly?: boolean;
  currency?: string;
}) {
  const state = useOperation(company, "sales"),
    [data, setData] = useState<Row>({
      orders: [],
      customers: [],
      variants: [],
    }),
    [mode, setMode] = useState<string | null>(null),
    [order, setOrder] = useState<Row | null>(null),
    [lines, setLines] = useState<Row[]>([
      { key: crypto.randomUUID(), variant: "", quantity: 1 },
    ]),
    [query, setQuery] = useState("");
  async function load() {
    setData(await sales(company));
  }
  useEffect(() => {
    state.run(load);
  }, [company]);
  const statusNames: Row = {
    pending: "Pendiente",
    dispatched: "Entregado",
    cancelled: "Cancelado",
    expired: "Vencido",
  };
  const orders = data.orders.filter((o: Row) =>
    [
      o.number,
      o.customer_snapshot.name,
      o.customer_snapshot.phone,
      statusNames[o.status],
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">CADA PEDIDO, EN SU EMPRESA</p>
          <h1>{customersOnly ? "Clientes" : "Ventas y pedidos"}</h1>
          <p>
            {customersOnly
              ? "Contactos registrados al realizar pedidos."
              : "Los pedidos reservan existencias; la entrega descuenta el inventario una sola vez."}
          </p>
        </div>
        <div className="actions">
          {state.canWrite && !customersOnly && (
            <AppButton
              onClick={() => {
                setLines([
                  { key: crypto.randomUUID(), variant: "", quantity: 1 },
                ]);
                setMode("create");
              }}
            >
              Registrar venta
            </AppButton>
          )}
          <AppButton
            className="secondary"
            disabled={state.busy}
            onClick={() => state.run(load)}
          >
            Actualizar
          </AppButton>
        </div>
      </section>
      {!mode && state.error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {mode && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Gestionar pedido"
          >
            <h2>
              {mode === "create"
                ? "Registrar venta"
                : mode === "paid"
                  ? "Confirmar pago"
                  : mode === "dispatch"
                    ? "Entregar pedido"
                    : "Cancelar pedido"}
            </h2>
            {state.error && (
              <p className="error" role="alert">
                <AppIcon name="status.error" />
                {state.error}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const payload =
                  mode === "create"
                    ? {
                        customer: {
                          name: f.get("name"),
                          phone: f.get("phone"),
                          email: f.get("email"),
                          address: "",
                        },
                        expected_total: lines.reduce(
                          (sum, l) =>
                            sum +
                            Number(
                              data.variants.find((v: Row) => v.id === l.variant)
                                ?.price || 0,
                            ) *
                              l.quantity,
                          0,
                        ),
                        items: lines.map((l) => ({
                          variant: l.variant,
                          quantity: l.quantity,
                        })),
                        delivery: "pickup",
                        payment: f.get("payment"),
                      }
                    : { order: order!.id };
                state.run(async () => {
                  await keyedRequest(company, "sales", payload, mode);
                  setMode(null);
                  state.setNotice("Pedido actualizado");
                  await load();
                });
              }}
            >
              {mode === "create" ? (
                <>
                  <div className="settings-grid">
                    <label>
                      Nombre
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Teléfono
                      <input name="phone" type="tel" required maxLength={25} />
                    </label>
                    <label>
                      Correo (opcional)
                      <input name="email" type="email" maxLength={254} />
                    </label>
                    <label>
                      Pago
                      <select name="payment">
                        <option value="cash">Efectivo</option>
                        <option value="transfer">Transferencia</option>
                        <option value="cod">Contra entrega</option>
                      </select>
                    </label>
                  </div>
                  <p>
                    Esta venta se registra con retiro, sin envío. Los precios se
                    confirman con la moneda vigente de la empresa ({currency}).
                  </p>
                  {lines.map((l) => (
                    <div key={l.key} className="ingredient-row">
                      <label>
                        Variante
                        <select
                          required
                          value={l.variant}
                          onChange={(e) =>
                            setLines((old) =>
                              old.map((x) =>
                                x.key === l.key
                                  ? { ...x, variant: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="">Seleccionar</option>
                          {data.variants
                            .filter((v: Row) => v.currency === currency)
                            .map((v: Row) => (
                              <option key={v.id} value={v.id}>
                                {v.sku} · {v.name} ·{" "}
                                {money(v.price, v.currency)} · {v.available}{" "}
                                disponibles
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Cantidad
                        <input
                          type="number"
                          required
                          min="1"
                          max="1000"
                          step="1"
                          value={l.quantity}
                          onChange={(e) =>
                            setLines((old) =>
                              old.map((x) =>
                                x.key === l.key
                                  ? { ...x, quantity: Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                      {lines.length > 1 && (
                        <AppButton
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setLines((old) =>
                              old.filter((x) => x.key !== l.key),
                            )
                          }
                        >
                          Quitar
                        </AppButton>
                      )}
                    </div>
                  ))}
                  <AppButton
                    type="button"
                    className="secondary"
                    disabled={lines.length >= 30}
                    onClick={() =>
                      setLines([
                        ...lines,
                        { key: crypto.randomUUID(), variant: "", quantity: 1 },
                      ])
                    }
                  >
                    Añadir variante
                  </AppButton>
                </>
              ) : (
                <>
                  <p>
                    Pedido #{order?.number} · {order?.customer_snapshot.name} ·{" "}
                    {money(order?.total, order?.currency)}
                  </p>
                  <p>
                    {mode === "paid"
                      ? "Registra el pago solo después de comprobar que fue recibido. La aplicación no procesa cobros."
                      : mode === "dispatch"
                        ? "Confirma que entregarás las unidades de este pedido. Se descontarán las existencias físicas."
                        : "Se liberarán las unidades reservadas. Si el pedido ya fue pagado, el reembolso quedará pendiente de gestionar."}
                  </p>
                  <label>
                    <input type="checkbox" required /> Confirmo esta operación
                  </label>
                </>
              )}
              <div className="form-actions">
                {mode === "create" && (
                  <strong>
                    Total:{" "}
                    {money(
                      lines.reduce(
                        (sum, l) =>
                          sum +
                          Number(
                            data.variants.find((v: Row) => v.id === l.variant)
                              ?.price || 0,
                          ) *
                            l.quantity,
                        0,
                      ),
                      currency,
                    )}
                  </strong>
                )}
                <AppButton disabled={state.busy}>Confirmar</AppButton>
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={() => setMode(null)}
                >
                  Volver
                </AppButton>
              </div>
            </form>
          </section>
        </div>
      )}
      <section className="catalog">
        <div className="toolbar">
          <h2>{customersOnly ? "Contactos" : "Pedidos recientes"}</h2>
          {!customersOnly && (
            <input
              aria-label="Buscar pedido"
              placeholder="Pedido, nombre, teléfono o estado"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
        <div className="table-wrap">
          {customersOnly ? (
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  <th>Dirección</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c: Row) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.phone}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.address || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Artículos vendidos</th>
                  <th>Total</th>
                  <th>Entrega / pago</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: Row) => (
                  <tr key={o.id}>
                    <td>
                      #{o.number}
                      <small>
                        {new Date(o.created_at).toLocaleString("es-GT")}
                      </small>
                    </td>
                    <td>
                      {o.customer_snapshot.name}
                      <small>{o.customer_snapshot.phone}</small>
                      <small>{o.customer_snapshot.email}</small>
                      <small>{o.customer_snapshot.address}</small>
                    </td>
                    <td>
                      {o.lines?.map((l: Row) => (
                        <small key={l.id}>
                          {l.quantity} × {l.description} ·{" "}
                          {money(l.unit_price, o.currency)} / ud
                        </small>
                      ))}
                      {o.gift && <small>Regalo: {o.gift}</small>}
                      {o.gift_message && (
                        <small>Mensaje: {o.gift_message}</small>
                      )}
                    </td>
                    <td>
                      {money(o.total, o.currency)}
                      <small>Descuento: {money(o.discount, o.currency)}</small>
                      <small>Envío: {money(o.shipping, o.currency)}</small>
                    </td>
                    <td>
                      {o.delivery === "delivery" ? "Domicilio" : "Retiro"}
                      <small>
                        {
                          {
                            cash: "Efectivo",
                            transfer: "Transferencia",
                            cod: "Contra entrega",
                          }[o.payment as string]
                        }
                      </small>
                      <small>
                        {o.paid_at ? "Pagado" : "Pendiente de pago"}
                      </small>
                      {o.refund_pending && (
                        <small className="error">Reembolso pendiente</small>
                      )}
                    </td>
                    <td>
                      <AppIcon
                        name={
                          o.status === "dispatched"
                            ? "status.success"
                            : o.status === "pending"
                              ? "status.pending"
                              : "status.info"
                        }
                      />
                      {statusNames[o.status]}
                      {o.status === "pending" && (
                        <small>
                          Vence:{" "}
                          {new Date(o.expires_at).toLocaleString("es-GT")}
                        </small>
                      )}
                    </td>
                    <td className="actions">
                      {state.canWrite &&
                        !["cancelled", "expired"].includes(o.status) &&
                        !o.paid_at && (
                          <AppButton
                            onClick={() => {
                              setOrder(o);
                              setMode("paid");
                            }}
                          >
                            Confirmar pago
                          </AppButton>
                        )}
                      {state.canWrite && o.status === "pending" && (
                        <>
                          <AppButton
                            onClick={() => {
                              setOrder(o);
                              setMode("dispatch");
                            }}
                          >
                            Entregar
                          </AppButton>
                          <AppButton
                            className="secondary"
                            onClick={() => {
                              setOrder(o);
                              setMode("cancel");
                            }}
                          >
                            Cancelar pedido
                          </AppButton>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!(customersOnly ? data.customers : orders).length && (
            <p className="empty">Todavía no hay registros.</p>
          )}
        </div>
      </section>
    </>
  );
}
