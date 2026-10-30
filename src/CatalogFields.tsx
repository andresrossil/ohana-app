import { useEffect, useRef, useState } from "react";
import { supabase as db } from "./client";
import { classifications } from "./sheet-model";
import type { CatalogRow } from "./sheet-model";
import { linkedBarcode, prefixFor } from "./catalog-model";

export default function CatalogFields({
  company,
  kind,
  item,
  origins,
  requestCodes = async (requests) => {
    const { data, error } = await db.rpc("suggest_catalog_skus", {
      p_company: company,
      p_requests: requests,
    });
    if (error) throw error;
    return data;
  },
}: {
  company: string;
  kind: "material" | "product";
  item?: CatalogRow | null;
  origins: CatalogRow[];
  requestCodes?: (
    requests: { key: string; prefix: string }[],
  ) => Promise<{ key: string; sku: string }[]>;
}) {
  const [sku, setSku] = useState(item?.sku || ""),
    [barcode, setBarcode] = useState(item?.barcode || ""),
    [custom, setCustom] = useState(!!item?.barcode_custom),
    [classification, setClassification] = useState(item?.classification || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const skuRef = useRef(sku),
    customRef = useRef(custom),
    pending = useRef<Promise<{ key: string; sku: string }[]> | null>(null),
    suggestionVersion = useRef(0);
  function changeSku(v: string) {
    skuRef.current = v;
    setSku(v);
    if (!customRef.current) setBarcode(linkedBarcode(v, "", false));
  }
  async function suggest(value = classification) {
    const prefix = prefixFor(kind, value);
    if (!prefix) {
      setError("Elige una clasificación para sugerir un SKU.");
      return;
    }
    const version = ++suggestionVersion.current;
    setBusy(true);
    setError("");
    try {
      const result = await requestCodes([{ key: "new", prefix }]);
      if (version === suggestionVersion.current && !skuRef.current)
        changeSku(result[0].sku);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (item || kind !== "product") return;
    let active = true;
    const version = suggestionVersion.current;
    setBusy(true);
    pending.current ??= requestCodes([{ key: "new", prefix: "P" }]);
    pending.current
      .then((result) => {
        if (active && version === suggestionVersion.current && !skuRef.current)
          changeSku(result[0].sku);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <fieldset className="catalog-fields">
      <legend>Identificación y organización</legend>
      {kind === "material" && (
        <label>
          Clasificación
          <select
            name="classification"
            value={classification}
            onChange={(e) => {
              suggestionVersion.current++;
              setClassification(e.target.value);
              if (!item && !skuRef.current && e.target.value)
                void suggest(e.target.value);
            }}
          >
            <option value="">Pendiente de clasificar</option>
            {classifications.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        SKU (opcional)
        <div className="sku-field">
          <input
            name="sku"
            maxLength={80}
            value={sku}
            onChange={(e) => {
              suggestionVersion.current++;
              changeSku(e.target.value);
            }}
          />
          <button
            type="button"
            className="secondary"
            disabled={busy || !!sku}
            onClick={() => void suggest()}
          >
            {busy ? "Sugiriendo…" : "Sugerir"}
          </button>
        </div>
      </label>
      <label>
        Origen
        <select name="origin_id" defaultValue={item?.origin_id || ""}>
          <option value="">Pendiente de definir</option>
          {origins
            .filter((o) => o.active || o.id === item?.origin_id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.active ? "" : " (inactivo)"}
              </option>
            ))}
        </select>
      </label>
      <label>
        Código de barras (opcional)
        <input
          name="barcode"
          maxLength={80}
          value={barcode}
          pattern="[\x20-\x7E]*"
          title="Hasta 80 letras sin acentos, números o signos ASCII compatibles con Code 128"
          onChange={(e) => {
            customRef.current = true;
            setCustom(true);
            setBarcode(e.target.value);
          }}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={!custom}
          onChange={(e) => {
            customRef.current = !e.target.checked;
            setCustom(!e.target.checked);
            if (e.target.checked) setBarcode(linkedBarcode(sku, "", false));
          }}
        />
        Usar el SKU como código de barras
      </label>
      <input type="hidden" name="barcode_custom" value={String(custom)} />
      <p className="muted">
        Puedes editar o dejar vacíos ambos códigos. Cambiar la clasificación
        conserva el SKU.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
