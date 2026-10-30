import { useEffect, useState } from "react";
import { request, storeLink } from "./commerce";
import { useOperation, type Row } from "./operations";
export default function StoreSettings({
  company,
  currency,
  onDirty,
}: {
  company: string;
  currency: string;
  onDirty: (dirty: boolean) => void;
}) {
  const state = useOperation(company, "sales"),
    [config, setConfig] = useState<Row | null>(null),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    state.run(async () =>
      setConfig(await request("store_settings", { p_company: company })),
    );
    return () => onDirty(false);
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  return (
    <section className="catalog company-settings">
      <h2>Tienda y condiciones de venta</h2>
      <p>
        Publica únicamente los productos y variantes que marques para la tienda.
        Los datos administrativos continúan privados.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      <p>
        <a href={storeLink(company)} target="_blank" rel="noopener noreferrer">
          Abrir tienda de esta empresa ↗
        </a>
      </p>
      {config && (
        <form
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const data = {
              ...Object.fromEntries(f),
              published: f.has("published"),
              pickup: f.has("pickup"),
              delivery: f.has("delivery"),
            };
            state.run(async () => {
              setConfig(
                await request("store_settings", {
                  p_company: company,
                  p_data: data,
                }),
              );
              setDirty(false);
              state.setNotice("Condiciones de la tienda guardadas");
            });
          }}
        >
          <div className="settings-grid">
            <label>
              <input
                name="published"
                type="checkbox"
                defaultChecked={config.published ?? false}
              />{" "}
              Activar tienda pública
            </label>
            <label>
              <input
                name="pickup"
                type="checkbox"
                defaultChecked={config.pickup ?? true}
              />{" "}
              Permitir retiro
            </label>
            <label>
              <input
                name="delivery"
                type="checkbox"
                defaultChecked={config.delivery ?? false}
              />{" "}
              Permitir entrega a domicilio
            </label>
            <label>
              Envío ({currency})
              <input
                name="shipping_fee"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                defaultValue={config.shipping_fee ?? ""}
              />
              <small>Sin tarifa configurada no se ofrece entrega.</small>
            </label>
            <label>
              Instrucciones de retiro
              <textarea
                name="pickup_note"
                maxLength={1000}
                defaultValue={config.pickup_note}
              />
            </label>
            <label>
              Instrucciones de transferencia
              <textarea
                name="payment_note"
                maxLength={1000}
                defaultValue={config.payment_note}
              />
              <small>
                Este texto se mostrará públicamente. No ingreses contraseñas ni
                claves.
              </small>
            </label>
            <label>
              Código promocional
              <input
                name="discount_code"
                maxLength={80}
                defaultValue={config.discount_code}
              />
            </label>
            <label>
              Descuento (%)
              <input
                name="discount_percent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={config.discount_percent ?? 0}
              />
            </label>
            <label>
              Compra mínima para regalo ({currency})
              <input
                name="gift_threshold"
                type="number"
                min="0"
                step="0.01"
                defaultValue={config.gift_threshold ?? ""}
              />
            </label>
            <label>
              Regalo ofrecido
              <input name="gift" maxLength={250} defaultValue={config.gift} />
              <small>
                Se aplica después del descuento y antes del envío. Deja vacío
                para no ofrecer regalo.
              </small>
            </label>
          </div>
          {config.currency && config.currency !== currency && (
            <p className="error">
              Cambió la moneda de la empresa. Revisa y guarda las tarifas y
              promociones en {currency}.
            </p>
          )}
          <p>
            Los pedidos sin pago confirmado vencen a las 24 horas y liberan su
            reserva. No se realizan cargos automáticos.
          </p>
          <button disabled={state.busy || !dirty}>Guardar condiciones</button>
        </form>
      )}
    </section>
  );
}
