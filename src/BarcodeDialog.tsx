import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import type { CatalogRow } from "./sheet-model";

export default function BarcodeDialog({
  item,
  onClose,
}: {
  item: CatalogRow;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [copies, setCopies] = useState(1),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    try {
      if (!item.barcode)
        throw Error(
          "Este registro no tiene código de barras. Puedes agregarlo desde Editar.",
        );
      JsBarcode(svg.current!, item.barcode, {
        format: "CODE128",
        width: 2,
        height: 80,
        margin: 20,
        displayValue: true,
        font: "monospace",
        fontSize: 18,
      });
      setError("");
      setReady(true);
    } catch {
      setReady(false);
      setError(
        item.barcode
          ? "El código no es compatible con Code 128. Usa letras sin acentos, números o signos ASCII."
          : "Este registro no tiene código de barras. Puedes agregarlo desde Editar.",
      );
    }
  }, [item.barcode]);
  async function download() {
    if (!svg.current || !ready) return;
    setBusy(true);
    setError("");
    let url = "";
    try {
      url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg.current)], {
          type: "image/svg+xml;charset=utf-8",
        }),
      );
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("Tu navegador no permite descargar esta imagen.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(Error("No se pudo crear la imagen.")),
          "image/png",
        ),
      );
      const link = document.createElement("a"),
        png = URL.createObjectURL(blob);
      link.href = png;
      link.download = `ohana-${String(item.sku || item.barcode).replace(/[^\w-]/g, "_")}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(png), 1000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  }
  function print() {
    if (!ready || !svg.current) return;
    setError("");
    const win = window.open("", "_blank");
    if (!win) {
      setError(
        "Permite la ventana de impresión en tu navegador e inténtalo de nuevo.",
      );
      return;
    }
    // Only fixed markup is written. All catalog content is added as text or generated SVG.
    win.document.write(
      '<!doctype html><html lang="es"><head><title>Etiquetas Ohana</title><style>@page{margin:10mm}body{margin:0;font:12px sans-serif}.labels{display:flex;flex-wrap:wrap;gap:5mm}.label{break-inside:avoid;page-break-inside:avoid;max-width:100%;padding:3mm;border:1px dashed #aaa;text-align:center}.label svg{display:block;max-width:100%;height:auto}.label p{margin:0 0 2mm;overflow-wrap:anywhere}@media print{.label{border:0}button{display:none}}</style></head><body><button onclick="window.print()">Imprimir etiquetas</button><div class="labels"></div></body></html>',
    );
    win.document.close();
    const target = win.document.querySelector(".labels")!;
    for (let i = 0; i < copies; i++) {
      const label = win.document.createElement("section");
      label.className = "label";
      const title = win.document.createElement("p");
      title.textContent = item.name;
      label.append(title, win.document.importNode(svg.current, true));
      if (item.sku && item.sku !== item.barcode) {
        const sku = win.document.createElement("p");
        sku.textContent = `SKU: ${item.sku}`;
        label.append(sku);
      }
      target.append(label);
    }
    win.focus();
    setTimeout(() => win.print(), 250);
  }
  return (
    <dialog
      ref={dialog}
      className="barcode-dialog"
      onCancel={onClose}
      aria-label="Código de barras Code 128"
    >
      <button
        className="close"
        aria-label="Cerrar código de barras"
        onClick={onClose}
      >
        ×
      </button>
      <p className="eyebrow">ETIQUETAS · CODE 128</p>
      <h2>{item.name}</h2>
      <div className="barcode-image">
        <svg
          ref={svg}
          role="img"
          aria-label={`Código de barras ${item.barcode || "pendiente"}`}
        />
      </div>
      {item.sku && item.sku !== item.barcode && <p>SKU: {item.sku}</p>}
      {item.draft && (
        <p className="barcode-draft">
          Vista previa. Guarda los cambios del material antes de utilizar estas
          etiquetas.
        </p>
      )}
      <p className="muted">
        Identificador interno para lectores compatibles con Code 128. No es un
        código comercial EAN o UPC.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        Etiquetas para imprimir
        <input
          type="number"
          min="1"
          max="100"
          value={copies}
          onChange={(e) =>
            setCopies(
              Math.max(
                1,
                Math.min(100, Math.trunc(Number(e.target.value)) || 1),
              ),
            )
          }
        />
      </label>
      <div className="form-actions">
        <button disabled={!ready || busy} onClick={() => void download()}>
          {busy ? "Preparando…" : "Descargar PNG"}
        </button>
        <button className="secondary" disabled={!ready} onClick={print}>
          Imprimir etiquetas
        </button>
        <button className="secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </dialog>
  );
}
