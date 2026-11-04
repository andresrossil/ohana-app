import SearchSelect from "./SearchSelect";
import { useEffect, useState, useRef } from "react";
import { AppButton, AppIcon } from "./AppIcon";
import ResponsiveTable from "./ResponsiveTable";
import { confirmAction } from "./ConfirmDialog";
import { keyedRequest, type Row } from "./operations";
import { parseTSV, formatTSV } from "./sheet-model";
import { weightRangeError, normalizedAttributes } from "./variant-weights";

const columns = [
  ["commercial_code", "Código comercial"],
  ["name", "Tamaño comercial"],
  ["barcode", "Código de barras"],
  ["barcode_custom", "Barras personalizadas"],
  ["aroma", "Aroma"],
  ["color", "Color"],
  ["tipo", "Tipo"],
  ["weight_min", "Peso mínimo (g)"],
  ["weight_max", "Peso máximo (g)"],
  ["active", "Activa"],
  ["published", "Publicar en tienda"],
  ["allow_preorder", "Pedidos anticipados"],
] as const;
const flags = new Set([
  "barcode_custom",
  "active",
  "published",
  "allow_preorder",
]);
const editable = (r: Row): Row =>
  Object.fromEntries([
    ...[
      "commercial_code",
      "name",
      "sku",
      "barcode",
      "weight_min",
      "weight_max",
    ].map((k) => [k, r[k] ?? ""]),
    ...[...flags].map((k) => [k, r[k] ?? k === "active"]),
    ["attributes", r.attributes || {}],
  ]);
const blank = (ordinal: number): Row => ({
  ordinal,
  key: crypto.randomUUID(),
  id: "",
  ...editable({}),
});
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export default function VariantSheet({
  company,
  product,
  existing,
  importing,
  onClose,
  onSaved,
  onDirty,
}: {
  company: string;
  product: Row;
  existing: Row[];
  importing: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    importing
      ? []
      : existing.map((r, index) => ({
          ordinal: index + 1,
          ...editable(r),
          id: r.id,
          key: r.id,
          expected: editable(r),
        })),
  );
  const ordinal = useRef(importing ? 0 : existing.length);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = rows.some(
    (r) => !r.id || JSON.stringify(editable(r)) !== JSON.stringify(r.expected),
  );
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);
  function cell(r: Row, k: string) {
    return ["aroma", "color", "tipo"].includes(k)
      ? r.attributes[k] || ""
      : r[k];
  }
  function assign(r: Row, k: string, value: any): Row {
    if (["aroma", "color", "tipo"].includes(k))
      return { ...r, attributes: { ...r.attributes, [k]: value } };
    return {
      ...r,
      [k]: value,
      ...(k === "barcode" ? { barcode_custom: true } : {}),
    };
  }
  function paste(text: string, start = rows.length, col = 0) {
    try {
      let grid = parseTSV(text).filter((r) => r.some((c) => c.trim()));
      let mapping: number[] | undefined;
      if (
        grid[0] &&
        [
          "nombredevariante",
          "codigocomercial",
          "tamanocomercial",
          "sku",
        ].includes(normalize(grid[0][0]))
      ) {
        mapping = grid
          .shift()!
          .map((h) =>
            normalize(h) === "sku"
              ? -2
              : columns.findIndex(
                  ([k, label]) =>
                    (k === "name" && normalize(h) === "nombredevariante") ||
                    normalize(label) === normalize(h) ||
                    normalize(k) === normalize(h),
                ),
          );
        if (mapping.some((i) => i === -1))
          throw Error(
            "Hay encabezados desconocidos. Usa Copiar tabla para obtener la plantilla.",
          );
      }
      if (start + grid.length > 500)
        throw Error("Guarda un máximo de 500 filas por carga.");
      if (
        grid.some((r) => r.length > (mapping?.length ?? columns.length - col))
      )
        throw Error("El texto contiene más columnas que la tabla.");
      const next: Row[] = rows.map((r) => ({
        ...r,
        attributes: { ...r.attributes },
      }));
      grid.forEach((values, i) => {
        while (next.length <= start + i) next.push(blank(++ordinal.current));
        values.forEach((value, j) => {
          // Ignore the automatic identifier in older, explicitly headed templates.
          if (mapping?.[j] === -2) return;
          const k = columns[mapping ? mapping[j] : col + j][0];
          let v: any = value.trim();
          if (flags.has(k)) {
            if (
              !/^(si|sí|no|true|false|1|0|activo|activa|inactivo|inactiva|archivado|archivada)?$/i.test(
                v,
              )
            )
              throw Error(`Fila ${start + i + 1}: ${k} debe ser Sí o No.`);
            v = /^(si|sí|true|1|activo|activa)$/i.test(v);
          }
          if (k === "weight_min" || k === "weight_max") v = v.replace(",", ".");
          next[start + i] = assign(next[start + i], k, v);
        });
      });
      setRows(next);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function save() {
    setError("");
    const changed = rows.filter(
      (r) =>
        !r.id || JSON.stringify(editable(r)) !== JSON.stringify(r.expected),
    );
    const all = [
      ...existing.filter((e) => !rows.some((r) => r.id === e.id)),
      ...rows,
    ];
    const identities = new Set<string>(),
      codes = new Set<string>();
    for (const r of all) {
      const attrs = normalizedAttributes(r.attributes);
      const identity = JSON.stringify([
        String(r.name || "")
          .trim()
          .toUpperCase(),
        attrs,
        r.weight_min === "" || r.weight_min == null
          ? null
          : Number(r.weight_min),
        r.weight_max === "" || r.weight_max == null
          ? null
          : Number(r.weight_max),
      ]);
      const code = String(r.commercial_code || "")
        .trim()
        .toUpperCase();
      const codeKey = JSON.stringify([code, attrs]);
      if (identities.has(identity) || (code && codes.has(codeKey))) {
        setError(
          "Hay variantes duplicadas: revisa el código comercial y la combinación de tamaño, atributos y rango de peso.",
        );
        return;
      }
      identities.add(identity);
      if (code) codes.add(codeKey);
    }
    for (const r of changed) {
      const issue =
        !r.name.trim() && !r.commercial_code.trim()
          ? "Indica un código comercial o un tamaño comercial."
          : r.id && !r.sku.trim()
            ? "El SKU existente no puede quedar vacío."
            : weightRangeError(
                all.map((x) => ({ ...x, id: x.id || x.key })),
                { ...r, id: r.id || r.key },
              );
      if (issue) {
        setError(`Fila ${r.ordinal}: ${issue}`);
        return;
      }
    }
    for (const k of ["sku", "barcode"]) {
      const seen = new Set<string>();
      for (const r of all) {
        const v = String(
          k === "barcode" && !r.barcode_custom ? r.sku : r[k] || "",
        )
          .trim()
          .toUpperCase();
        if (v && seen.has(v)) {
          setError(
            `Hay valores duplicados en ${k === "sku" ? "SKU" : "Código de barras"}: ${v}`,
          );
          return;
        }
        if (v) seen.add(v);
      }
    }
    if (
      !(await confirmAction(
        `¿Guardar ${changed.length} variantes? Si una fila no es válida, no se guardará ninguna.`,
      ))
    )
      return;
    setBusy(true);
    try {
      await keyedRequest(company, "variant_table_save", {
        product: product.id,
        rows: changed.map((r) => ({
          id: r.id,
          ...editable(r),
          expected: r.expected || null,
        })),
      });
      setRows([]);
      onDirty(false);
      try {
        await onSaved();
      } catch {
        throw Error(
          "Las variantes se guardaron. Cierra la tabla y vuelve a abrirla para actualizar el listado.",
        );
      }
      onClose();
    } catch (e: any) {
      setError(
        e.message ||
          "No se pudo guardar. Tus filas siguen disponibles para corregir o reintentar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="variant-sheet"
      aria-busy={busy}
      data-navigation-dirty={dirty ? "true" : undefined}
    >
      <div className="form-actions">
        <AppButton disabled={busy || !dirty} onClick={save}>
          Guardar cambios
        </AppButton>
        <AppButton
          className="secondary"
          disabled={busy}
          onClick={async () => {
            if (
              !dirty ||
              (await confirmAction(
                "¿Salir sin guardar los cambios de la tabla?",
              ))
            )
              onClose();
          }}
        >
          Cancelar
        </AppButton>
        <AppButton
          className="secondary"
          disabled={busy}
          onClick={() => setRows([...rows, blank(++ordinal.current)])}
        >
          Agregar fila
        </AppButton>
        <AppButton
          className="secondary"
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                formatTSV([
                  columns.map((c) => c[1]),
                  ...rows.map((r) =>
                    columns.map(([k]) =>
                      flags.has(k)
                        ? cell(r, k)
                          ? "Sí"
                          : "No"
                        : String(cell(r, k) ?? ""),
                    ),
                  ),
                ]),
              );
            } catch {
              setError(
                "No se pudo copiar. Revisa el permiso del portapapeles.",
              );
            }
          }}
        >
          Copiar tabla
        </AppButton>
      </div>
      <p className="muted">
        Edita directamente en cada celda. Pega desde Excel para crear las filas
        automáticamente. El SKU se genera al guardar y no forma parte de la
        carga; usa Código comercial para JT-1 y similares. Los precios se
        administran en Listas de precios.
      </p>
      {error && (
        <p className="error" role="alert">
          <AppIcon name="status.error" />
          {error}
        </p>
      )}
      <label className="variant-paste">
        Pegar filas desde Excel
        <textarea
          disabled={busy}
          rows={2}
          placeholder="Selecciona aquí y pega con Ctrl+V o la opción Pegar del celular. No necesitas crear filas antes."
          value=""
          onChange={(e) => {
            if (e.target.value) paste(e.target.value);
          }}
          onPaste={(e) => {
            e.preventDefault();
            paste(e.clipboardData.getData("text/plain"));
          }}
        />
      </label>
      <div className="table-wrap">
        <ResponsiveTable
          onSortRows={(indexes) => setRows(indexes.map((i) => rows[i]))}
        >
          <thead>
            <tr>
              <th>#</th>
              {columns.map(([k, l]) => (
                <th key={k}>{l}</th>
              ))}
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>{r.ordinal}</td>
                {columns.map(([k, label], j) => (
                  <td key={k}>
                    {flags.has(k) ? (
                      <SearchSelect
                        aria-label={`${label}, fila ${i + 1}`}
                        disabled={busy}
                        value={String(cell(r, k))}
                        onChange={(e) =>
                          setRows(
                            rows.map((x, n) =>
                              n === i
                                ? assign(x, k, e.target.value === "true")
                                : x,
                            ),
                          )
                        }
                        onPaste={(e) => {
                          e.preventDefault();
                          paste(e.clipboardData.getData("text/plain"), i, j);
                        }}
                      >
                        <option value="true">Sí</option>
                        <option value="false">No</option>
                      </SearchSelect>
                    ) : (
                      <input
                        aria-label={`${label}, fila ${i + 1}`}
                        disabled={busy}
                        value={cell(r, k)}
                        maxLength={
                          k === "commercial_code" || k === "barcode" ? 80 : 120
                        }
                        inputMode={k.startsWith("weight") ? "decimal" : "text"}
                        onChange={(e) =>
                          setRows(
                            rows.map((x, n) =>
                              n === i ? assign(x, k, e.target.value) : x,
                            ),
                          )
                        }
                        onPaste={(e) => {
                          const text = e.clipboardData.getData("text/plain");
                          if (/[\t\n\r]/.test(text)) {
                            e.preventDefault();
                            paste(text, i, j);
                          }
                        }}
                      />
                    )}
                  </td>
                ))}
                <td>
                  {!r.id && (
                    <AppButton
                      disabled={busy}
                      className="secondary"
                      onClick={() => setRows(rows.filter((_, n) => n !== i))}
                    >
                      Quitar fila
                    </AppButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      {!rows.length && (
        <p className="empty">
          La carga está vacía. Pega tus datos para comenzar.
        </p>
      )}
    </section>
  );
}
