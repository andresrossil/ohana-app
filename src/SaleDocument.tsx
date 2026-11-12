import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Clock3, CreditCard, Download, MapPin, Phone, Printer, Truck, UserRound } from "lucide-react";
import { supabase } from "./client";
import { deliveryZoneLabel } from "./delivery-address";
import { money, type Row } from "./operations";
import { paymentMethods } from "./payment-methods";
import { roundMoney, saleDiscountAmount, saleLineTotals } from "./sale-form-model";
import styles from "./sale-document.css?inline";

const documentDate = new Intl.DateTimeFormat("es-GT", {
  timeZone: "America/Guatemala",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const grams = new Intl.NumberFormat("es-GT", { maximumFractionDigits: 8 });
const productOrder = new Intl.Collator("es-GT", { sensitivity: "base", numeric: true });

export function saleDocumentLine(line: Row) {
  const [product, ...size] = String(line.description ?? "").split(" · ");
  const range = line.weight_min != null && line.weight_max != null
    ? `${grams.format(Number(line.weight_min))}–${grams.format(Number(line.weight_max))} g`
    : "";
  return { product, size: [size.join(" · "), range].filter(Boolean).join(" · ") || "—" };
}

export function openSaleDocument(source: Row | (() => Promise<Row>), format: "invoice" | "label" = "invoice") {
  const preview = window.open("", "_blank");
  if (!preview) return false;
  preview.opener = null;
  const doc = preview.document;
  doc.documentElement.lang = "es";
  const title = format === "label" ? "Etiqueta de envío" : "Resumen de pedido";
  doc.title = title;
  const viewport = doc.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  const stylesheet = doc.createElement("style");
  stylesheet.textContent = styles + (format === "label" ? "@page { size: 100mm 150mm; margin: 0; }" : "");
  doc.head.append(viewport, stylesheet);
  const container = doc.createElement("div");
  doc.body.replaceChildren(container);
  const root = createRoot(container);
  const show = (data: Row) => {
    if (preview.closed) return;
    doc.title = `${title} · #${data.order.number}`;
    root.render(<SaleDocument data={data} format={format} onPrint={() => preview.print()} />);
  };
  if (typeof source === "function") {
    root.render(<p className="print-controls" role="status">Cargando documento…</p>);
    void source().then(show, () => {
      if (!preview.closed) root.render(<p className="print-controls" role="alert">No se pudo cargar el documento. Cierra esta ventana y vuelve a intentarlo.</p>);
    });
  } else show(source);
  preview.addEventListener("pagehide", () => root.unmount(), { once: true });
  return true;
}

function SaleDocument({ data, format, onPrint }: { data: Row; format: "invoice" | "label"; onPrint: () => void }) {
  const { order, document_brand: brand } = data;
  const delivery = data.delivery ?? {};
  const customer = order.customer_snapshot ?? {};
  const lines: Row[] = data.lines ?? [];
  const documentLines = lines
    .map((line) => ({ line, product: saleDocumentLine(line).product }))
    .sort((a, b) => productOrder.compare(a.product, b.product) ||
      Number(a.line.unit_price) - Number(b.line.unit_price));
  const [logo, setLogo] = useState("");
  const [loadingLogo, setLoadingLogo] = useState(!!brand?.logo_path);
  const article = useRef<HTMLElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    if (!brand?.logo_path) return;
    let active = true;
    void supabase.storage.from("company-logos").createSignedUrl(brand.logo_path, 300)
      .then(({ data: asset }) => {
        if (!active) return;
        if (asset?.signedUrl) setLogo(asset.signedUrl);
        else setLoadingLogo(false);
      }, () => { if (active) setLoadingLogo(false); });
    return () => { active = false; };
  }, [brand?.logo_path]);

  const isDraft = order.fulfillment_stage === "draft";
  const closed = order.status === "cancelled" || order.status === "expired";
  const currency = order.currency;
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + saleLineTotals(line).gross, 0));
  const discount = saleDiscountAmount({ ...order, lines });
  const deliveryKind = delivery.kind ?? (order.delivery === "pickup" ? "pickup" : "own");
  const deliveryLabel = deliveryKind === "courier" ? "Mensajería" : deliveryKind === "own" ? "Entrega propia" : "Recoger pedido";
  const address = [delivery.address || customer.address, deliveryZoneLabel(delivery.zone), delivery.department]
    .filter(Boolean).join(" · ");
  const schedule = delivery.tariff_snapshot?.delivery_schedule;
  const isLabel = format === "label";
  const amountToCollect = closed || order.payment === "transfer" ? money(0, currency)
    : isDraft ? "Pendiente de confirmación"
    : money(data.summary?.balance, currency);
  const documentLogo = logo ? (
    <img src={logo} alt={brand?.name ?? "Logo de empresa"} onLoad={() => setLoadingLogo(false)}
      onError={() => { setLogo(""); setLoadingLogo(false); }} />
  ) : <p>{brand?.name ?? ""}</p>;

  async function downloadImage() {
    const documentNode = article.current;
    if (!documentNode || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { default: capture } = await import("html2canvas");
      const canvas = await capture(documentNode, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("No se generó la imagen");
      const url = URL.createObjectURL(blob);
      const link = documentNode.ownerDocument.createElement("a");
      link.href = url;
      link.download = `${isLabel ? "Etiqueta" : isDraft ? "Borrador" : "Factura"}-${String(order.number).padStart(6, "0")}.png`;
      documentNode.ownerDocument.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setExportError("No se pudo guardar la imagen. Intenta nuevamente.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="print-controls">
        <button type="button" disabled={loadingLogo || exporting} onClick={onPrint}><Printer size={16} aria-hidden="true" /> Imprimir / guardar PDF</button>
        <button type="button" disabled={loadingLogo || exporting} onClick={downloadImage}>
          <Download size={16} aria-hidden="true" /> {exporting ? "Preparando imagen…" : "Guardar imagen PNG"}
        </button>
        {exportError && <p role="alert">{exportError}</p>}
      </div>
      <article ref={article} className={isLabel ? "document shipping-label" : "document"}>
        {isLabel ? <>
          <header className="shipping-label-header">
            <div className="document-brand">{documentLogo}</div>
            <div className="shipping-label-guide"><span>Guía de envío</span><strong>{delivery.guide || "Sin guía"}</strong></div>
          </header>
          <dl className="shipping-label-fields">
            <div><dt>Cliente</dt><dd>{customer.name || "—"}</dd></div>
            <div><dt>Teléfono</dt><dd>{customer.phone || "—"}</dd></div>
            <div><dt>Dirección</dt><dd>{deliveryKind === "pickup" ? "Recoger pedido" : address || "—"}</dd></div>
            <div className="shipping-label-amount"><dt>Monto a cobrar</dt><dd>{amountToCollect}</dd></div>
          </dl>
        </> : <>
        <header className="document-heading">
          <div className="document-brand">{documentLogo}</div>
          <div className="document-title"><h1>Resumen de pedido</h1><span className="document-state">{isDraft ? "Borrador" : "Factura"}</span></div>
          <div className="document-number"><strong>No. {String(order.number).padStart(6, "0")}</strong><br />Fecha: {documentDate.format(new Date(order.created_at))}</div>
        </header>

        <div className="document-pair">
          <section className="document-card">
            <h2><UserRound aria-hidden="true" /> Cliente</h2>
            <p>{customer.name || "—"}</p>
            {customer.phone && <p><Phone aria-hidden="true" /> {customer.phone}</p>}
          </section>
          <section className="document-card">
            <h2><Truck aria-hidden="true" /> Entrega</h2>
            <p>{[deliveryLabel, delivery.courier_snapshot?.name].filter(Boolean).join(" · ")}</p>
            {deliveryKind !== "pickup" && address && <p><MapPin aria-hidden="true" /> {address}</p>}
            {deliveryKind === "courier" && schedule && <p><Clock3 aria-hidden="true" /> {schedule}</p>}
          </section>
        </div>

        <table aria-label="Productos del pedido">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Importe</th></tr></thead>
          <tbody>
            {documentLines.map(({ line, product }) => {
              const amounts = saleLineTotals(line);
              return <tr key={line.id}>
                <td>{product}{line.is_gift && <small>Regalo</small>}</td>
                <td>{line.quantity}</td>
                <td>{money(line.unit_price, currency)}</td>
                <td>{amounts.discount > 0 ? money(amounts.discount, currency) : "—"}</td>
                <td>{money(amounts.gross, currency)}</td>
              </tr>;
            })}
          </tbody>
        </table>

        <div className="document-pair document-closing">
          <section className="document-card">
            <h2><CreditCard aria-hidden="true" /> Forma de pago</h2>
            <p>{paymentMethods.find((method) => method.value === order.payment)?.label ?? "—"}</p>
          </section>
          <dl className="document-totals">
            <div><dt>Subtotal sin descuentos</dt><dd>{money(subtotal, currency)}</dd></div>
            <div className="document-discount"><dt>Descuento total</dt><dd>{discount > 0 ? "− " : ""}{money(discount, currency)}</dd></div>
            <div><dt>Envío</dt><dd>{money(order.shipping, currency)}</dd></div>
            <div className="document-total"><dt>{closed ? "Total del documento" : "Total a pagar"}</dt><dd>{money(order.total, currency)}</dd></div>
          </dl>
        </div>
        {closed ? (
          <p className="document-note">{order.status === "cancelled" ? "Pedido cancelado." : "Pedido vencido."}</p>
        ) : isDraft && <p className="document-note">Este documento es un resumen de pedido pendiente de confirmación.</p>}
        </>}
      </article>
    </>
  );
}
