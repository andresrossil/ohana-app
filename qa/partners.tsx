// Synthetic fixture. All requests are intercepted; no production data is used.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import BusinessPartners from "../src/BusinessPartners";
import Sidebar from "../src/Sidebar";
import "../src/style.css";
import "../src/admin.css";
import "../src/admin-forms.css";
import "../src/configuration.css";
let rows: any[] = [
  {
    id: "supplier-1",
    company_id: "fixture",
    code: "PR0001",
    partner_type: "supplier",
    name: "Proveedor de prueba",
    phone: "+502 5555-1111",
    active: true,
    addresses: [
      {
        id: "a1",
        label: "Bodega",
        address: "Dirección simulada",
        is_primary: true,
      },
    ],
  },
  {
    id: "customer-1",
    company_id: "fixture",
    code: "C0001",
    partner_type: "customer",
    name: "Cliente de prueba",
    phone: "+502 5555-2222",
    tax_id: "PRUEBA123",
    active: true,
    addresses: [],
  },
];
let admin = true;
window.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body || "{}")),
    d = body.p_data || {};
  let result: any = null;
  if (String(url).includes("/partners")) {
    if (body.p_action === "list") {
      let filtered = rows.filter(
        (r) =>
          (!d.type || r.partner_type === d.type) &&
          (!d.status || r.active === (d.status === "active")) &&
          [r.code, r.name, r.phone, r.tax_id]
            .join(" ")
            .toLowerCase()
            .includes((d.query || "").toLowerCase()),
      );
      filtered.sort(
        (a, b) =>
          String(a[d.sort]).localeCompare(String(b[d.sort]), "es", {
            numeric: true,
          }) * (d.direction === "desc" ? -1 : 1),
      );
      result = {
        rows: filtered.slice((d.page - 1) * 25, d.page * 25),
        total: filtered.length,
        canManage: admin,
        customerRead: true,
        supplierRead: true,
      };
    }
    if (body.p_action === "get") {
      const p = rows.find((r) => r.id === d.id);
      result = {
        partner: p,
        addresses: p.addresses || [],
        canChangeType: p.partner_type === "customer",
        related:
          p.partner_type === "supplier"
            ? {
                presentations: [
                  {
                    material: "Material simulado",
                    quantity: 100,
                    unit: "g",
                    active: true,
                  },
                ],
                prices: [],
                purchases: [],
              }
            : { orders: [] },
      };
    }
    if (body.p_action === "suggest")
      result = { code: d.type === "supplier" ? "PR0002" : "C0002" };
    if (body.p_action === "save") {
      const p = { ...d, id: d.id || crypto.randomUUID(), partner_type: d.type };
      rows = rows.filter((r) => r.id !== p.id);
      rows.push(p);
      result = { id: p.id };
    }
    if (body.p_action === "active") {
      rows.find((r) => r.id === d.id).active = d.active;
      result = { id: d.id };
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
        section="customers"
        company="fixture"
        companies={[{ id: "fixture", name: "Ohana · prueba local" }]}
        onCompany={() => {}}
        onNavigate={() => false}
        onLogout={() => {}}
      />
      <main>
        <header>DATOS SIMULADOS · SIN CONEXIÓN A PRODUCCIÓN</header>
        <button
          onClick={() => {
            admin = !admin;
            setRevision((n) => n + 1);
          }}
        >
          Cambiar permiso de prueba
        </button>
        <BusinessPartners
          key={revision}
          company="fixture"
          onDirty={() => {}}
          onSaved={async () => {}}
        />
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
