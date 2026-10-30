// Synthetic browser fixture, excluded from production. Never confirm database saves here.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Sidebar from "../src/Sidebar";
import type { Section } from "../src/Sidebar";
import MaterialSheet from "../src/MaterialSheet";
import ImportMaterials from "../src/ImportMaterials";
import ProductsCatalog from "../src/ProductsCatalog";
import OriginsSettings from "../src/OriginsSettings";
import CatalogOverview from "../src/CatalogOverview";
import BarcodeDialog from "../src/BarcodeDialog";
import type { CatalogRow } from "../src/sheet-model";
import "../src/style.css";
const company = "fixture";
const catalog = {
  units: [
    {
      id: "g",
      name: "Gramo",
      symbol: "g",
      dimension: "mass",
      base_factor: 1,
      active: true,
    },
    {
      id: "ud",
      name: "Unidad",
      symbol: "ud",
      dimension: "count",
      base_factor: 1,
      active: true,
    },
  ],
  suppliers: [],
  raw_materials: [
    {
      id: "m1",
      name: "Aceite de prueba",
      unit_id: "g",
      sku: "M0001",
      barcode: "CUSTOM-OIL",
      barcode_custom: true,
      classification: "Materia prima",
      origin_id: "o1",
      active: true,
    },
    {
      id: "m2",
      name: "Caja de prueba",
      unit_id: "ud",
      sku: "E0001",
      barcode: "E0001",
      barcode_custom: false,
      classification: "Material de empaque",
      origin_id: "o2",
      active: true,
    },
    {
      id: "m3",
      name: "Tapa de prueba",
      unit_id: "ud",
      sku: null,
      barcode: null,
      classification: null,
      origin_id: null,
      active: true,
    },
  ],
  presentations: [
    {
      id: "p1",
      raw_material_id: "m1",
      quantity: 100,
      unit_id: "g",
      supplier_id: null,
      active: true,
    },
    {
      id: "p2",
      raw_material_id: "m2",
      quantity: 20,
      unit_id: "ud",
      supplier_id: null,
      active: true,
    },
    {
      id: "p3",
      raw_material_id: "m3",
      quantity: 10,
      unit_id: "ud",
      supplier_id: null,
      active: true,
    },
  ],
  catalog_origins: [
    { id: "o1", name: "Comprado", active: true },
    { id: "o2", name: "Fabricado", active: true },
    { id: "o3", name: "Origen histórico", active: false },
  ],
  products: [
    {
      id: "finished1",
      name: "Jabón de prueba",
      sku: "P0001",
      barcode: "SOAP-123456",
      barcode_custom: true,
      origin_id: "o2",
      notes: "Registro de prueba",
      active: true,
    },
  ],
};
const history = [
  {
    id: "h1",
    presentation_id: "p1",
    amount: 10,
    currency: "GTQ",
    effective_on: "2026-07-03",
    created_at: "2026-07-03T12:00:00Z",
  },
  {
    id: "h2",
    presentation_id: "p1",
    amount: 8,
    currency: "GTQ",
    effective_on: "2026-07-04",
    created_at: "2026-07-04T12:00:00Z",
  },
  {
    id: "h3",
    presentation_id: "p2",
    amount: 30,
    currency: "GTQ",
    effective_on: "2026-07-03",
    created_at: "2026-07-03T12:00:00Z",
  },
  {
    id: "h4",
    presentation_id: "p2",
    amount: 40,
    currency: "GTQ",
    effective_on: "2026-07-04",
    created_at: "2026-07-04T12:00:00Z",
  },
];
const readSnapshot = async () => ({
  sheet: catalog.presentations.map((p, i) => ({
    ...p,
    company_id: company,
    material_name: catalog.raw_materials[i].name,
    alternative_name: "",
    capacity: "",
    comment: "",
    unit_symbol: i === 0 ? "g" : "ud",
    amount: i === 0 ? 8 : i === 1 ? 40 : null,
    effective_on: i < 2 ? "2026-07-04" : null,
    price_id: i === 0 ? "h2" : i === 1 ? "h4" : null,
  })),
  history,
});
const counters: Record<string, number> = { M: 100, E: 100, P: 100 };
const requestCodes = async (requests: { key: string; prefix: string }[]) =>
  requests.map((r) => ({
    key: r.key,
    sku: r.prefix + String(++counters[r.prefix]).padStart(4, "0"),
  }));
function Fixture() {
  const [section, setSection] = useState<Section>("materials"),
    [importing, setImporting] = useState(false),
    [barcode, setBarcode] = useState<CatalogRow | null>(null),
    [dirty, setDirty] = useState(false);
  return (
    <div className="shell">
      <Sidebar
        section={section}
        onNavigate={(value) => {
          if (dirty && !confirm("Descartar prueba sin guardar?")) return false;
          setSection(value);
          return true;
        }}
        company={company}
        companies={[{ id: company, name: "Ohana · prueba local" }]}
        onCompany={() => {}}
        onLogout={() => {}}
      />
      <main>
        <header>
          <span>PRUEBA LOCAL · DATOS SINTÉTICOS</span>
          <span className="badge">Acceso de edición</span>
        </header>
        {section === "materials" ? (
          <>
            <section className="intro">
              <div>
                <p className="eyebrow">LA BASE DE CADA CREACIÓN</p>
                <h1>Materiales</h1>
                <p>Conoce lo que compras. Cuida lo que creas.</p>
              </div>
              <button onClick={() => setImporting(true)}>
                Copiar de Tabla
              </button>
            </section>
            <MaterialSheet
              company={company}
              canWrite={true}
              catalog={catalog}
              onSaved={async () => {}}
              onDirty={setDirty}
              readSnapshot={readSnapshot}
              onBarcode={setBarcode}
              suggestCodes={requestCodes}
            />
          </>
        ) : section === "products" ? (
          <ProductsCatalog
            company={company}
            products={catalog.products}
            origins={catalog.catalog_origins}
            units={catalog.units}
            canWrite={true}
            onSaved={async () => {}}
            onBarcode={setBarcode}
            requestCodes={requestCodes}
          />
        ) : section === "settings" ? (
          <>
            <section className="intro">
              <h1>Configuración</h1>
            </section>
            <OriginsSettings
              company={company}
              origins={catalog.catalog_origins}
              canWrite={true}
              onSaved={async () => {}}
            />
          </>
        ) : section === "inventory" || section === "reports" ? (
          <CatalogOverview
            materials={catalog.raw_materials}
            products={catalog.products}
            origins={catalog.catalog_origins}
            report={section === "reports"}
          />
        ) : (
          <section className="empty">
            <h1>Próximamente</h1>
          </section>
        )}
      </main>
      {importing && (
        <ImportMaterials
          company={company}
          canWrite={true}
          catalog={catalog}
          onSaved={async () => {}}
          onDirty={() => {}}
          readSnapshot={readSnapshot}
          onCancel={() => setImporting(false)}
          onBarcode={setBarcode}
          suggestCodes={requestCodes}
        />
      )}{" "}
      {barcode && (
        <BarcodeDialog item={barcode} onClose={() => setBarcode(null)} />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
