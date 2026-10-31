import { AppButton, AppIcon } from "./AppIcon";
import { useState } from "react";
import type { CatalogRow } from "./sheet-model";
import { formatTSV } from "./sheet-model";
import { matchesCatalog } from "./catalog-model";
import CatalogFilters, {
  classificationMatches,
  originMatches,
} from "./CatalogFilters";
export default function CatalogOverview({
  materials,
  products,
  origins,
  report = false,
}: {
  materials: CatalogRow[];
  products: CatalogRow[];
  origins: CatalogRow[];
  report?: boolean;
}) {
  const [classification, setClassification] = useState(""),
    [origin, setOrigin] = useState(""),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState("");
  const rows: CatalogRow[] = (
    [
      ...materials.map((m) => ({
        ...m,
        kind: "Material",
        classification: m.classification,
      })),
      ...products.map((p) => ({
        ...p,
        kind: "Producto",
        classification: "Producto terminado",
      })),
    ] as CatalogRow[]
  ).filter(
    (r) =>
      (!kind || r.kind === kind) &&
      matchesCatalog(r, query) &&
      (!classification ||
        (r.kind === "Material" &&
          classificationMatches(r.classification, classification))) &&
      originMatches(r.origin_id, origin),
  );
  function exportReport() {
    const tsv = formatTSV([
      [
        "TIPO",
        "SKU",
        "NOMBRE",
        "CLASIFICACIÓN",
        "ORIGEN",
        "CÓDIGO DE BARRAS",
        "ESTADO",
      ],
      ...rows.map((r) => [
        r.kind,
        r.sku || "",
        r.name,
        r.classification || "",
        origins.find((o) => o.id === r.origin_id)?.name || "",
        r.barcode || "",
        r.active ? "Activo" : "Archivado",
      ]),
    ]);
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + tsv], {
        type: "text/tab-separated-values;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ohana-catalogo.tsv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">TU CATÁLOGO EN ORDEN</p>
          <h1>{report ? "Reportes" : "Inventario"}</h1>
          <p>
            {report
              ? "Consulta y exporta tu catálogo por clasificación y origen."
              : "Consulta de materiales y productos del catálogo."}
          </p>
        </div>
        {report && (
          <AppButton onClick={exportReport}>Descargar catálogo</AppButton>
        )}
      </section>
      {!report && (
        <p className="sheet-notice">
          <AppIcon name="status.info" />
          La consulta muestra el catálogo. El registro de existencias y
          movimientos estará disponible al incorporar compras y producción.
        </p>
      )}
      <section className="catalog">
        <div className="toolbar">
          <h2>{rows.length} registros</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar catálogo consolidado"
            placeholder="Nombre, SKU o código de barras…"
          />
          <select
            aria-label="Tipo de registro"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Materiales y productos</option>
            <option>Material</option>
            <option>Producto</option>
          </select>
        </div>
        <CatalogFilters
          classification={classification}
          onClassification={setClassification}
          origin={origin}
          onOrigin={setOrigin}
          origins={origins}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Clasificación</th>
                <th>Origen</th>
                <th>Código de barras</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind + r.id}>
                  <td>{r.kind}</td>
                  <td>{r.sku || "—"}</td>
                  <td>
                    {r.name}
                    {!r.active && <small>Archivado</small>}
                  </td>
                  <td>{r.classification || "Pendiente"}</td>
                  <td>
                    {origins.find((o) => o.id === r.origin_id)?.name ||
                      "Pendiente"}
                  </td>
                  <td>{r.barcode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="empty">No hay registros para estos filtros.</p>
          )}
        </div>
      </section>
    </>
  );
}
