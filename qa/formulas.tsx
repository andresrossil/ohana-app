// Synthetic browser fixture. No requests reach the production database.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Formulas from "../src/Formulas";
import Sidebar from "../src/Sidebar";
import "../src/style.css";
import "../src/admin.css";
import "../src/admin-forms.css";
import "../src/configuration.css";
const units = [
  {
    id: "g",
    name: "Gramo",
    symbol: "g",
    dimension: "mass",
    base_factor: 1,
    active: true,
  },
  {
    id: "kg",
    name: "Kilogramo",
    symbol: "kg",
    dimension: "mass",
    base_factor: 1000,
    active: true,
  },
  {
    id: "ml",
    name: "Mililitro",
    symbol: "ml",
    dimension: "volume",
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
];
const materials = [
  {
    id: "a",
    name: "Aceite de prueba",
    sku: "M0001",
    unit_id: "g",
    classification: "Materia prima",
    unit_cost: 0.05,
    active: true,
  },
  {
    id: "b",
    name: "Manteca de prueba",
    sku: "M0002",
    unit_id: "g",
    classification: "Materia prima",
    unit_cost: 0.1,
    active: true,
  },
  {
    id: "water",
    name: "Agua de prueba",
    sku: "M0003",
    unit_id: "ml",
    classification: "Materia prima",
    unit_cost: null,
    active: true,
  },
  {
    id: "pack",
    name: "Caja de prueba",
    sku: "E0001",
    unit_id: "ud",
    classification: "Material de empaque",
    unit_cost: 2,
    active: true,
  },
];
const products = [
  { id: "p", name: "Jabón de prueba", active: true },
  { id: "p2", name: "Otro producto de prueba", active: true },
];
let writable = true;
let formulas: any[] = [
  {
    id: "f1",
    family_id: "family1",
    product_id: "p",
    product_name: products[0].name,
    code: "F0001",
    name: "Base de prueba",
    version: 1,
    state: "current",
    capture_mode: "percentage",
    total_quantity: 1000,
    total_unit_id: "g",
    loss_enabled: true,
    loss_percent: 5,
    ingredients: [
      {
        material_id: "a",
        name: materials[0].name,
        quantity: 600,
        unit_id: "g",
        unit: "g",
        percentage: 60,
        line_kind: "ingredient",
      },
      {
        material_id: "b",
        name: materials[1].name,
        quantity: 0.4,
        unit_id: "kg",
        unit: "kg",
        percentage: 40,
        line_kind: "ingredient",
      },
      {
        material_id: "pack",
        name: materials[3].name,
        quantity: 2,
        unit_id: "ud",
        unit: "ud",
        percentage: null,
        line_kind: "packaging",
      },
    ],
  },
];
window.fetch = async (url, init) => {
  const p = JSON.parse(String(init?.body || "{}")),
    d = p.p_data || {};
  let result: any = null;
  const u = String(url);
  if (u.includes("company_permission")) result = writable;
  if (u.includes("formula_catalog"))
    result = {
      units,
      materials,
      products,
      currency: "GTQ",
      next_code: "F000" + (formulas.length + 1),
    };
  if (u.includes("formula_command")) {
    if (p.p_action === "list") result = formulas;
    if (p.p_action === "state") {
      const row = formulas.find((f) => f.id === d.id);
      if (d.state === "current")
        formulas
          .filter((f) => f.family_id === row.family_id)
          .forEach((f) => (f.state = "inactive"));
      row.state = d.state;
      result = { id: row.id };
    }
    if (p.p_action === "save") {
      if (d.kind === "variation" && !d.confirm_duplicate)
        result = {
          duplicates: [
            { id: "f1", code: "F0001", version: 1, name: "Base de prueba" },
          ],
        };
      else {
        const source = formulas.find((f) => f.id === d.source),
          id = crypto.randomUUID(),
          family = d.kind === "version" ? source.family_id : id,
          version =
            d.kind === "version"
              ? Math.max(
                  ...formulas
                    .filter((f) => f.family_id === family)
                    .map((f) => f.version),
                ) + 1
              : 1;
        if (d.state === "current")
          formulas
            .filter((f) => f.family_id === family)
            .forEach((f) => (f.state = "inactive"));
        formulas.push({
          ...d,
          id,
          family_id: family,
          product_id: d.product,
          product_name: products.find((p) => p.id === d.product)?.name,
          version,
          total_unit_id: d.total_unit,
          ingredients: d.ingredients.map((i: any) => ({
            ...i,
            material_id: i.material,
            unit_id: i.unit,
            name: materials.find((m) => m.id === i.material)?.name,
            unit: units.find((u) => u.id === i.unit)?.symbol,
          })),
        });
        result = { id, version };
      }
    }
  }
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
};
function Fixture() {
  const [revision, setRevision] = useState(0);
  return (
    <div className="shell">
      <Sidebar
        section="formulas"
        company="fixture"
        companies={[{ id: "fixture", name: "Ohana · prueba local" }]}
        onCompany={() => {}}
        onNavigate={() => false}
        onLogout={() => {}}
      />
      <main>
        <header>FÓRMULAS · DATOS SIMULADOS</header>
        <button
          onClick={() => {
            writable = !writable;
            setRevision((n) => n + 1);
          }}
        >
          Cambiar permiso de prueba
        </button>
        <Formulas key={revision} company="fixture" onDirty={() => {}} />
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
