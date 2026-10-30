import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { request } from "./commerce";
import { keyedRequest, money, type Row } from "./operations";
import CompanyLogo, { defaultTheme } from "./CompanyBrand";
import ProductImage from "./ProductImage";
function ProductCard({
  product,
  onAdd,
  currency,
}: {
  product: Row;
  onAdd: (v: Row, p: Row) => void;
  currency: string;
}) {
  const [selected, setSelected] = useState(product.variants[0]?.id || "");
  const variant = product.variants.find((v: Row) => v.id === selected);
  return (
    <article className="store-card">
      <ProductImage path={product.photo_path} name={product.name} />
      <div>
        <h2>{product.name}</h2>
        <p>{product.description}</p>
        {variant ? (
          <>
            <label>
              Selecciona tu opción
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {product.variants.map((v: Row) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.weight_min ? ` · ${v.weight_min}–${v.weight_max} g` : ""}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {Object.entries(variant.attributes || {})
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </p>
            {variant.weight_min && (
              <small>
                El peso es aproximado y corresponde al rango indicado.
              </small>
            )}
            <strong className="store-price">
              {money(variant.price, currency)}
            </strong>
            <p>
              {variant.available > 0
                ? `${variant.available} disponibles`
                : variant.allow_preorder
                  ? "Disponible por pedido anticipado"
                  : "Agotado"}
            </p>
            <button
              disabled={!variant.allow_preorder && variant.available <= 0}
              onClick={() => onAdd(variant, product)}
            >
              Agregar al carrito
            </button>
          </>
        ) : (
          <p>Sin opciones disponibles</p>
        )}
      </div>
    </article>
  );
}
export default function PublicStore({ company }: { company: string }) {
  const [store, setStore] = useState<Row | null | undefined>(),
    [cart, setCart] = useState<Row[]>(() => {
      try {
        const rows = JSON.parse(
          localStorage.getItem("ohana.cart." + company) || "[]",
        );
        return Array.isArray(rows)
          ? rows
              .filter(
                (r) =>
                  typeof r.id === "string" &&
                  Number.isInteger(r.quantity) &&
                  r.quantity >= 1 &&
                  r.quantity <= 1000,
              )
              .slice(0, 30)
          : [];
      } catch {
        return [];
      }
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [showCart, setShowCart] = useState(false),
    [delivery, setDelivery] = useState("pickup"),
    [code, setCode] = useState(""),
    [quote, setQuote] = useState<Row | null>(null),
    [receipt, setReceipt] = useState<Row | null>(null),
    [search, setSearch] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(
        "ohana.cart." + company,
        JSON.stringify(
          cart.map((l) => ({ id: l.id, quantity: l.quantity, name: l.name })),
        ),
      );
    } catch {}
  }, [cart, company]);
  async function load() {
    setStore(await request("storefront", { p_company: company }));
  }
  useEffect(() => {
    let live = true;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        company,
      )
    ) {
      setStore(null);
      return;
    }
    request("storefront", { p_company: company })
      .then((s) => {
        if (live) {
          setStore(s);
          if (!s?.policy?.pickup) setDelivery("delivery");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [company]);
  useEffect(() => setQuote(null), [cart, delivery, code]);
  const currentCart = cart.map((line) => {
    const p = store?.products.find((p: Row) =>
      p.variants.some((v: Row) => v.id === line.id),
    );
    const v = p?.variants.find((v: Row) => v.id === line.id);
    return {
      ...line,
      ...v,
      name: p
        ? `${p.name} · ${v?.name}`
        : line.name || "Variante no disponible",
      price: v?.price ?? 0,
      missing: !v,
    };
  });
  const items = cart.map((l) => ({ variant: l.id, quantity: l.quantity }));
  const subtotal = currentCart.reduce(
    (sum, l) => sum + Number(l.price) * l.quantity,
    0,
  );
  const theme = { ...defaultTheme, ...store?.appearance };
  const style = Object.fromEntries(
    Object.entries(theme).map(([k, v]) => ["--company-" + k, v]),
  ) as CSSProperties;
  Object.assign(style, {
    "--company-heading":
      theme.font === "DM Sans"
        ? "'Libre Caslon Display',Georgia,serif"
        : theme.font,
  });
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e: any) {
      setError(
        e.message || "No se pudo completar. Reintenta sin duplicar tu pedido.",
      );
    } finally {
      setBusy(false);
    }
  }
  function add(v: Row, p: Row) {
    setError("");
    setNotice("");
    const line = cart.find((l) => l.id === v.id);
    if (
      (line && line.quantity >= 1000) ||
      (!v.allow_preorder && (line?.quantity || 0) + 1 > v.available)
    ) {
      setError("No hay más unidades disponibles de esta opción");
      return;
    }
    if (!line && cart.length >= 30) {
      setError("El carrito admite hasta 30 variantes diferentes");
      return;
    }
    setCart((old) =>
      line
        ? old.map((l) =>
            l.id === v.id ? { ...l, quantity: l.quantity + 1 } : l,
          )
        : [...old, { ...v, name: p.name + " · " + v.name, quantity: 1 }],
    );
    setNotice("Producto agregado al carrito");
  }
  if (store === undefined)
    return (
      <main className="store-loading">{error || "Preparando la tienda…"}</main>
    );
  if (!store)
    return (
      <main className="store-loading">
        <h1>Tienda no disponible</h1>
        <p>Este negocio todavía no ha publicado su catálogo.</p>
      </main>
    );
  return (
    <div className="store-page" style={style}>
      <header className="store-header">
        <div className="store-identity">
          <CompanyLogo company={store as any} />
          <h1>{store.name}</h1>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setShowCart(!showCart);
            setReceipt(null);
            setError("");
          }}
        >
          {showCart
            ? "Volver al catálogo"
            : `Carrito (${cart.reduce((n, l) => n + l.quantity, 0)})`}
        </button>
      </header>
      <main className="store-main">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {receipt ? (
          <section className="store-confirmation">
            <p className="eyebrow">PEDIDO RECIBIDO</p>
            <h1>Gracias por elegir {store.name}</h1>
            <h2>Pedido #{receipt.number}</h2>
            <p>Total: {money(receipt.total, receipt.currency)}</p>
            <p>
              Reserva hasta{" "}
              {new Date(receipt.expires_at).toLocaleString("es-GT")}. Guarda
              esta referencia para coordinar con el negocio.
            </p>
            <p>
              {store.policy.payment_note ||
                "El negocio se comunicará contigo para coordinar el pago y la entrega."}
            </p>
            <button
              onClick={() => {
                setReceipt(null);
                setShowCart(false);
              }}
            >
              Seguir explorando
            </button>
          </section>
        ) : showCart ? (
          <section className="store-cart">
            <h1>Tu carrito</h1>
            {!cart.length ? (
              <p>Todavía no has elegido productos.</p>
            ) : (
              <>
                <div className="cart-lines">
                  {currentCart.map((l) => (
                    <article key={l.id}>
                      <div>
                        <strong>{l.name}</strong>
                        <p>{money(l.price, store.currency)} por unidad</p>
                        {l.missing && (
                          <p className="error">
                            Esta opción ya no está disponible. Retírala del
                            carrito.
                          </p>
                        )}
                        {l.allow_preorder && l.quantity > l.available && (
                          <p>
                            Pedido anticipado: hay unidades pendientes de
                            disponibilidad.
                          </p>
                        )}
                      </div>
                      <label>
                        Cantidad
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          value={l.quantity}
                          onChange={(e) => {
                            const q = Number(e.target.value);
                            if (Number.isInteger(q) && q >= 1 && q <= 1000)
                              setCart((old) =>
                                old.map((x) =>
                                  x.id === l.id ? { ...x, quantity: q } : x,
                                ),
                              );
                          }}
                        />
                      </label>
                      <strong>
                        {money(l.price * l.quantity, store.currency)}
                      </strong>
                      <button
                        className="secondary"
                        onClick={() =>
                          setCart((old) => old.filter((x) => x.id !== l.id))
                        }
                      >
                        Quitar
                      </button>
                    </article>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const customer = {
                      name: form.get("name"),
                      phone: form.get("phone"),
                      email: form.get("email"),
                      address: form.get("address"),
                    };
                    run(async () => {
                      if (!quote) throw Error("Primero revisa el total");
                      const result = await keyedRequest(company, "checkout", {
                        customer,
                        items,
                        delivery,
                        payment: form.get("payment"),
                        discount_code: code,
                        gift_message: form.get("gift_message"),
                        expected_total: quote.total,
                      });
                      setReceipt(result);
                      setCart([]);
                      setNotice("");
                      await load();
                    });
                  }}
                >
                  <fieldset disabled={busy}>
                    <h2>Datos y entrega</h2>
                    <div className="settings-grid">
                      <label>
                        Nombre
                        <input
                          name="name"
                          minLength={2}
                          maxLength={120}
                          required
                          autoComplete="name"
                        />
                      </label>
                      <label>
                        Teléfono / WhatsApp
                        <input
                          name="phone"
                          type="tel"
                          required
                          maxLength={25}
                          placeholder="+502…"
                          autoComplete="tel"
                        />
                      </label>
                      <label>
                        Correo (opcional)
                        <input
                          name="email"
                          type="email"
                          maxLength={254}
                          autoComplete="email"
                        />
                      </label>
                      <label>
                        Entrega
                        <select
                          value={delivery}
                          onChange={(e) => setDelivery(e.target.value)}
                        >
                          {store.policy.pickup !== false && (
                            <option value="pickup">Retiro</option>
                          )}
                          {store.policy.delivery &&
                            store.policy.shipping_fee != null &&
                            store.policy.currency === store.currency && (
                              <option value="delivery">
                                Entrega ·{" "}
                                {money(
                                  store.policy.shipping_fee,
                                  store.currency,
                                )}
                              </option>
                            )}
                        </select>
                      </label>
                      {delivery === "delivery" && (
                        <label>
                          Dirección
                          <input
                            name="address"
                            required
                            minLength={5}
                            maxLength={500}
                            autoComplete="street-address"
                          />
                        </label>
                      )}
                      <label>
                        Pago
                        <select name="payment">
                          <option value="transfer">
                            Transferencia bancaria
                          </option>
                          <option value="cash">Efectivo</option>
                          <option value="cod">Contra entrega</option>
                        </select>
                      </label>
                      <label>
                        Código promocional (opcional)
                        <input
                          maxLength={80}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      </label>
                      <label>
                        Mensaje para regalo (opcional)
                        <textarea name="gift_message" maxLength={500} />
                      </label>
                    </div>
                    <p>
                      {delivery === "pickup"
                        ? store.policy.pickup_note
                        : store.policy.payment_note}
                    </p>
                    <p>Subtotal vigente: {money(subtotal, store.currency)}</p>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || currentCart.some((l) => l.missing)}
                      onClick={() =>
                        run(async () => {
                          setQuote(
                            await request("checkout_quote", {
                              p_company: company,
                              p_data: { items, delivery, discount_code: code },
                            }),
                          );
                          setNotice(
                            "Total revisado. Ya puedes confirmar tu pedido.",
                          );
                        })
                      }
                    >
                      Revisar total
                    </button>
                    {quote && (
                      <div className="store-total">
                        <p>
                          Productos: {money(quote.subtotal, quote.currency)}
                        </p>
                        <p>
                          Descuento: −{money(quote.discount, quote.currency)}
                        </p>
                        <p>Envío: {money(quote.shipping, quote.currency)}</p>
                        <h2>Total: {money(quote.total, quote.currency)}</h2>
                      </div>
                    )}
                    <p>
                      Los pedidos sin pago confirmado se reservan durante 24
                      horas. La disponibilidad de los pedidos anticipados se
                      coordina con el negocio.
                    </p>
                    <button
                      disabled={
                        busy || !quote || currentCart.some((l) => l.missing)
                      }
                    >
                      {busy ? "Procesando…" : "Confirmar pedido"}
                    </button>
                  </fieldset>
                </form>
              </>
            )}
          </section>
        ) : (
          <>
            <section className="store-intro">
              <p className="eyebrow">PEQUEÑOS DETALLES, GRANDES CREACIONES</p>
              <h1>Encuentra tu favorito</h1>
              <p>Elige el tamaño, aroma y presentación que prefieras.</p>
              <input
                aria-label="Buscar productos en tienda"
                placeholder="Buscar producto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </section>
            <section className="store-grid">
              {store.products
                .filter(
                  (p: Row) =>
                    p.variants.length &&
                    p.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((p: Row) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    currency={store.currency}
                    onAdd={add}
                  />
                ))}
            </section>
            {!store.products.some((p: Row) => p.variants.length) && (
              <p className="empty">
                Pronto encontrarás nuestros productos aquí.
              </p>
            )}
          </>
        )}
      </main>
      <footer className="store-footer">
        <strong>{store.name}</strong>
        <nav aria-label="Redes y contacto">
          {Object.entries(store.social || {})
            .filter(
              ([, url]) => typeof url === "string" && /^https?:\/\//i.test(url),
            )
            .map(([name, url]) => (
              <a
                key={name}
                href={String(url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {{
                  instagram: "Instagram",
                  facebook: "Facebook",
                  tiktok: "TikTok",
                  whatsapp: "WhatsApp",
                  website: "Página web",
                }[name] || name}{" "}
                ↗
              </a>
            ))}
        </nav>
        <small>Creado con Ohana</small>
      </footer>
    </div>
  );
}
