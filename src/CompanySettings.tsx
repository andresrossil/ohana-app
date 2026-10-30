import AdminAppearance from "./AdminAppearance";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase as db } from "./client";
import type { CatalogRow } from "./sheet-model";
import CompanyLogo, { defaultTheme } from "./CompanyBrand";
const networks = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["whatsapp", "WhatsApp Business"],
  ["website", "Página web"],
];
const palettes = {
  Ohana: defaultTheme,
  Bosque: {
    ...defaultTheme,
    background: "#eef3ec",
    primary: "#345343",
    text: "#26392e",
    accent: "#c9ddbd",
  },
  Rosa: {
    ...defaultTheme,
    background: "#fff1f0",
    primary: "#7d4552",
    text: "#4b3038",
    accent: "#edc8cc",
  },
};
export default function CompanySettings(
  props: Parameters<typeof CompanyProfile>[0],
) {
  return props.appearance ? (
    <AdminAppearance
      company={props.company as any}
      canManage={props.canManage}
      onDirty={props.onDirty}
      onSaved={props.onSaved}
    />
  ) : (
    <CompanyProfile {...props} />
  );
}
function CompanyProfile({
  company,
  canManage,
  appearance = false,
  onSaved,
  onDirty,
  initialData,
}: {
  company: CatalogRow;
  canManage: boolean;
  appearance?: boolean;
  onSaved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  initialData?: {
    details: Record<string, any>;
    appearance: Record<string, string>;
    countries: CatalogRow[];
    currencies: CatalogRow[];
  };
}) {
  const [details, setDetails] = useState<Record<string, any>>({}),
    [theme, setTheme] = useState<Record<string, string>>(defaultTheme),
    [name, setName] = useState(company.name),
    [currency, setCurrency] = useState(company.currency || "GTQ"),
    [countries, setCountries] = useState<CatalogRow[]>([]),
    [currencies, setCurrencies] = useState<CatalogRow[]>([]),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (initialData) {
      setDetails(initialData.details);
      setTheme({ ...defaultTheme, ...initialData.appearance });
      setCountries(initialData.countries);
      setCurrencies(initialData.currencies);
      setLoading(false);
      return;
    }
    void Promise.all([
      db
        .from("company_settings")
        .select("*")
        .eq("company_id", company.id)
        .maybeSingle(),
      db.from("countries").select("*").eq("active", true).order("name"),
      db.from("currencies").select("*").eq("active", true).order("code"),
    ]).then(([s, c, m]) => {
      if (!live) return;
      const err = s.error || c.error || m.error;
      if (err) setError(err.message);
      else {
        setDetails(s.data?.details || {});
        setTheme({ ...defaultTheme, ...s.data?.appearance });
        setCountries((c.data || []).map((x) => ({ ...x, id: x.code })));
        setCurrencies((m.data || []).map((x) => ({ ...x, id: x.code })));
      }
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [company.id]);
  useEffect(() => {
    onDirty(dirty);
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      onDirty(false);
    };
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const update = (key: string, value: unknown) => {
    setDetails((old) => ({ ...old, [key]: value }));
    setDirty(true);
    setNotice("");
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError("");
    setNotice("");
    let uploaded: string | null = null;
    try {
      if (!appearance && !details.country)
        throw Error("Selecciona el país de la empresa.");
      for (const link of Object.values(details.social || {}) as any[]) {
        if (link.url) {
          const u = new URL(link.url);
          if (
            !["https:", "http:"].includes(u.protocol) ||
            u.username ||
            u.password ||
            !u.hostname.includes(".")
          )
            throw Error("Revisa los enlaces de redes sociales y página web.");
        }
      }
      let path = company.logo_path || null;
      if (file) {
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 3145728
        )
          throw Error("Usa un logo PNG, JPG o WebP de hasta 3 MB.");
        const image = await createImageBitmap(file);
        image.close();
        uploaded =
          company.id +
          "/" +
          crypto.randomUUID() +
          "." +
          (file.type === "image/png"
            ? "png"
            : file.type === "image/webp"
              ? "webp"
              : "jpg");
        const { error } = await db.storage
          .from("company-logos")
          .upload(uploaded, file, { contentType: file.type });
        if (error) throw error;
        path = uploaded;
      }
      const { error } = await db.rpc("save_company_settings", {
        p_company: company.id,
        p_name: name,
        p_currency: currency,
        p_details: details,
        p_appearance: theme,
        p_logo: path,
      });
      if (error) throw error;
      uploaded = null;
      setDirty(false);
      setFile(null);
      await onSaved();
      window.dispatchEvent(new Event("ohana-settings-saved"));
      setNotice("Cambios guardados para todos los usuarios de esta empresa.");
    } catch (e: any) {
      if (uploaded) await db.storage.from("company-logos").remove([uploaded]);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const field = (key: string, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        maxLength={key === "address" ? 500 : 200}
        value={details[key] || ""}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  if (loading)
    return <p role="status">Cargando configuración de la empresa…</p>;
  return (
    <form className="company-settings" onSubmit={save}>
      <h2>{appearance ? "Apariencia de la empresa" : "Datos de empresa"}</h2>
      {!canManage && (
        <p className="sheet-notice">
          Configuración de solo lectura. Solo los administradores autorizados
          pueden modificarla.
        </p>
      )}
      <fieldset disabled={!canManage || busy}>
        {appearance ? (
          <section className="settings-block">
            <h3>Colores y tipografía</h3>
            <p className="muted">
              Se aplican a todos los usuarios de {company.name} al guardar. No
              cambian la apariencia de otras empresas.
            </p>
            <div className="palette-buttons">
              {Object.entries(palettes).map(([key, value]) => (
                <button
                  type="button"
                  className="secondary"
                  key={key}
                  onClick={() => {
                    setTheme(value);
                    setDirty(true);
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="settings-grid">
              {[
                ["background", "Fondo"],
                ["surface", "Superficies"],
                ["primary", "Botones y navegación"],
                ["text", "Texto"],
                ["accent", "Acento"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="color"
                    value={theme[key]}
                    onChange={(e) => {
                      setTheme({ ...theme, [key]: e.target.value });
                      setDirty(true);
                    }}
                  />
                </label>
              ))}
              <label>
                Tipografía
                <select
                  value={theme.font}
                  onChange={(e) => {
                    setTheme({ ...theme, font: e.target.value });
                    setDirty(true);
                  }}
                >
                  {["DM Sans", "Arial", "Georgia", "Verdana"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="theme-preview"
              style={{
                background: theme.background,
                color: theme.text,
                fontFamily: theme.font,
              }}
            >
              <h3>Así se verá tu empresa</h3>
              <div
                style={{
                  background: theme.surface,
                  padding: 20,
                  borderRadius: 8,
                }}
              >
                Pequeños detalles, grandes creaciones.
                <p style={{ marginTop: 14 }}>
                  <span
                    style={{
                      background: theme.primary,
                      color: theme.surface,
                      padding: 10,
                      borderRadius: 6,
                    }}
                  >
                    Botón de ejemplo
                  </span>
                </p>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="settings-block">
              <h3>Identidad de empresa</h3>
              {preview ? (
                <img
                  className="logo-preview"
                  src={preview}
                  alt="Vista previa del nuevo logo"
                />
              ) : (
                <CompanyLogo company={company} />
              )}
              <label>
                Logo de empresa
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setDirty(true);
                  }}
                />
                <small>PNG, JPG o WebP · máximo 3 MB</small>
              </label>
              <label>
                Nombre comercial *
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </section>
            <section className="settings-block">
              <h3>Información fiscal y regional</h3>
              <div className="settings-grid">
                {field("legal_name", "Razón social")}
                {field("tax_id", "NIT / identificación fiscal")}
                <label>
                  País *
                  <select
                    required
                    value={details.country || ""}
                    onChange={(e) => update("country", e.target.value)}
                  >
                    <option value="">Seleccionar país</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Moneda *
                  <select
                    required
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setDirty(true);
                    }}
                  >
                    {currencies.map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                Cambiar la moneda de la empresa no convierte ni modifica los
                precios históricos.
              </p>
            </section>
            <section className="settings-block">
              <h3>Información de contacto</h3>
              <div className="settings-grid">
                {field("phone", "Teléfono principal", "tel")}
                {field("whatsapp", "WhatsApp de contacto", "tel")}
                {field("email", "Correo electrónico comercial", "email")}
                {field("address", "Dirección comercial")}
              </div>
            </section>
            <section className="settings-block">
              <h3>Redes sociales y presencia digital</h3>
              {networks.map(([key, label]) => (
                <div className="social-entry" key={key}>
                  <label>
                    {label}
                    <input
                      type="url"
                      placeholder="https://…"
                      maxLength={2048}
                      value={details.social?.[key]?.url || ""}
                      onChange={(e) =>
                        update("social", {
                          ...details.social,
                          [key]: {
                            ...details.social?.[key],
                            url: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!details.social?.[key]?.visible}
                      onChange={(e) =>
                        update("social", {
                          ...details.social,
                          [key]: {
                            ...details.social?.[key],
                            visible: e.target.checked,
                          },
                        })
                      }
                    />
                    Mostrar en tienda pública
                  </label>
                </div>
              ))}
              <p className="muted">
                La tienda utilizará únicamente enlaces válidos, no vacíos y
                activados cuando esté disponible.
              </p>
            </section>
          </>
        )}
      </fieldset>
      {dirty && (
        <p className="sheet-warning" role="status">
          Tienes cambios sin guardar.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="sheet-notice" role="status">
          {notice}
        </p>
      )}
      {canManage && (
        <button disabled={busy || !dirty}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
      )}
    </form>
  );
}
