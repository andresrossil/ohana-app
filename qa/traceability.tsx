// Synthetic UI fixture. All network requests are intercepted.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Formulas from "../src/Formulas";
import Production from "../src/Production";
import Sidebar from "../src/Sidebar";
import "../src/style.css";
import "../src/admin.css";
import "../src/admin-forms.css";
import "../src/configuration.css";
const units = [
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
    id: "oil",
    name: "Aceite de prueba",
    unit_id: "ml",
    sku: "M0001",
    unit_cost: 0.1,
    active: true,
    classification: "Materia prima",
  },
  {
    id: "box",
    name: "Caja de prueba",
    unit_id: "ud",
    sku: "E0001",
    unit_cost: 2,
    active: true,
    classification: "Material de empaque",
  },
];
const products = [
    { id: "p1", name: "Producto de prueba", unit_id: "ml", active: true },
    { id: "p2", name: "Otro producto", unit_id: "ml", active: true },
  ],
  variants = [
    {
      id: "v1",
      product_id: "p1",
      name: "Presentación de prueba",
      active: true,
    },
  ];
let formulas: any[] = [
    {
      id: "f1",
      family_id: "ff1",
      product_id: "p1",
      product_name: products[0].name,
      name: "Receta de prueba",
      code: "F000001",
      version: 1,
      state: "current",
      capture_mode: "quantity",
      loss_enabled: true,
      loss_percent: 5,
      edit_revision: 1,
      admin_notes: "",
      ingredients: [
        {
          material_id: "oil",
          quantity: 230,
          unit_id: "ml",
          name: materials[0].name,
          unit: "ml",
          line_kind: "ingredient",
          percentage: 100,
        },
        {
          material_id: "box",
          quantity: 2,
          unit_id: "ud",
          name: materials[1].name,
          unit: "ud",
          line_kind: "packaging",
          percentage: null,
        },
      ],
    },
  ],
  batches: any[] = [];
window.fetch = async (url, init) => {
  const p = JSON.parse(String(init?.body || "{}")),
    d = p.p_data || {},
    u = String(url);
  let out: any = null;
  if (u.includes("company_permission")) out = true;
  if (u.includes("formula_catalog"))
    out = { materials, units, products, currency: "GTQ", next_code: "F000002" };
  if (u.includes("formula_command")) {
    if (p.p_action === "list")
      out = formulas.map((f) => ({
        ...f,
        locked: batches.some((b) => b.formula_id === f.id && b.confirmed),
        used_batches: batches.filter((b) => b.formula_id === f.id),
      }));
    if (p.p_action === "edit") {
      const f = formulas.find((f) => f.id === d.source);
      Object.assign(f, d, {
        id: f.id,
        version: f.version,
        edit_revision: f.edit_revision + 1,
        product_id: d.product,
        ingredients: d.ingredients.map((i: any) => ({
          ...i,
          material_id: i.material,
          unit_id: i.unit,
          name: materials.find((m) => m.id === i.material)?.name,
          unit: units.find((u) => u.id === i.unit)?.symbol,
        })),
      });
      out = { id: f.id, version: f.version };
    }
    if (p.p_action === "notes") {
      formulas.find((f) => f.id === d.id).admin_notes = d.admin_notes;
      out = { id: d.id };
    }
    if (p.p_action === "save") {
      const source = formulas.find((f) => f.id === d.source),
        f = {
          ...d,
          id: crypto.randomUUID(),
          family_id: source?.family_id || crypto.randomUUID(),
          product_id: d.product,
          product_name: products.find((x) => x.id === d.product)?.name,
          version: source ? source.version + 1 : 1,
          edit_revision: 1,
          ingredients: d.ingredients.map((i: any) => ({
            ...i,
            material_id: i.material,
            unit_id: i.unit,
            name: materials.find((m) => m.id === i.material)?.name,
            unit: units.find((u) => u.id === i.unit)?.symbol,
          })),
        };
      formulas.push(f);
      out = { id: f.id, version: f.version };
    }
  }
  if (u.includes("production_command")) {
    if (p.p_action === "list")
      out = batches.map((b) => ({
        ...b,
        product_name:
          b.recipe_snapshot?.product.name ||
          products.find((p) => p.id === b.product_id)?.name,
        formula_code: "F000001",
        formula_version: formulas.find((f) => f.id === b.formula_id)?.version,
      }));
    if (p.p_action === "detail") {
      const b = batches.find((b) => b.id === d.id);
      out = {
        batch: b,
        snapshot: b.recipe_snapshot,
        legacy_consumptions:
          b.id === "legacy"
            ? [{ material_id: "ID-conservado", base_quantity: 12, cost: null }]
            : [],
      };
    }
    if (p.p_action === "draft_save") {
      let b = batches.find((b) => b.id === d.id);
      if (!b) {
        b = {
          id: crypto.randomUUID(),
          batch_number: batches.length + 1,
          state: "draft",
          confirmed: false,
          currency: "GTQ",
          outputs: [],
        };
        batches.push(b);
      }
      Object.assign(b, d, {
        product_id: d.product,
        formula_id: d.formula || null,
        planned_quantity: d.quantity,
      });
      out = { id: b.id };
    }
    if (p.p_action === "start") {
      const b = batches.find((b) => b.id === d.id);
      if (!b.formula_id)
        return new Response(
          JSON.stringify({
            message: "Selecciona una versión válida antes de preparar el lote",
            code: "P0001",
          }),
          { status: 400 },
        );
      b.state = "in_progress";
      out = { id: b.id };
    }
  }
  if (u.includes("/operations")) {
    if (p.p_action === "production_catalog")
      out = { materials, units, products, variants };
    if (p.p_action === "batch_finish") {
      const b = batches.find((b) => b.id === d.batch),
        f = formulas.find((f) => f.id === b.formula_id);
      b.state = "curing";
      b.confirmed = true;
      b.confirmed_at = new Date().toISOString();
      b.actual_quantity = d.outputs.reduce(
        (n: number, r: any) => n + Number(r.quantity),
        0,
      );
      b.recipe_snapshot = {
        schema: 1,
        formula: { id: f.id, code: f.code, name: f.name, version: f.version },
        product: {
          id: f.product_id,
          name: products.find((p) => p.id === f.product_id)?.name,
        },
        scale: Number(b.formula_scale),
        loss: { enabled: f.loss_enabled, percent: f.loss_percent },
        currency: "GTQ",
        lines: f.ingredients.map((i: any) => {
          const actual = d.consumptions.find(
              (r: any) => r.material === i.material_id,
            ),
            q = Number(actual.quantity),
            unit = units.find((u) => u.id === i.unit_id),
            cost = Number(
              materials.find((m) => m.id === i.material_id)?.unit_cost,
            );
          return {
            material_id: i.material_id,
            material_name: i.name,
            material_sku: materials.find((m) => m.id === i.material_id)?.sku,
            line_kind: i.line_kind,
            percentage: i.percentage,
            planned_quantity: Number(i.quantity) * Number(b.formula_scale),
            planned_unit: unit,
            actual_quantity: q,
            actual_unit: unit,
            base_quantity: q,
            base_unit: unit,
            applied_unit_cost: cost,
            total_cost: q * cost,
          };
        }),
      };
      b.total_cost = b.recipe_snapshot.total_cost =
        b.recipe_snapshot.lines.reduce(
          (n: number, l: any) => n + l.total_cost,
          0,
        );
      out = { id: b.id };
    }
  }
  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json" },
  });
};
function Fixture() {
  const [section, setSection] = useState<"formulas" | "production">("formulas"),
    [dirty, setDirty] = useState(false);
  return (
    <div className="shell">
      <Sidebar
        section={section}
        company="fixture"
        companies={[{ id: "fixture", name: "Ohana · prueba" }]}
        onCompany={() => {}}
        onNavigate={(s) => {
          if (s === "formulas" || s === "production") {
            setSection(s);
            return true;
          }
          return false;
        }}
        onLogout={() => {}}
      />
      <main>
        <header>DATOS SIMULADOS · SIN CAMBIOS A PRODUCCIÓN</header>
        <button
          onClick={() => {
            batches.push({
              id: "legacy",
              batch_number: 99,
              product_id: "p1",
              formula_id: "f1",
              state: "released",
              confirmed: true,
              currency: "GTQ",
              production_date: "2026-01-01",
              available_on: "2026-01-01",
              outputs: [],
            });
            setSection("production");
          }}
        >
          Histórico parcial de prueba
        </button>
        <p>{dirty ? "Cambios pendientes" : ""}</p>
        {section === "formulas" ? (
          <Formulas company="fixture" onDirty={setDirty} />
        ) : (
          <Production company="fixture" manager onDirty={setDirty} />
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
