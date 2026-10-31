import { AppButton, AppIcon } from "./AppIcon";
import { lazy, Suspense } from "react";
const IconSettings = lazy(() => import("./IconSettings"));
import { useEffect, useState, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { request } from "./commerce";
import {
  adminDefault,
  themes,
  fonts,
  normalizeAdminTheme,
  adminVariables,
  contrastIssues,
  type AdminTheme,
} from "./admin-theme";
export default function AdminAppearance({
  company,
  canManage,
  onDirty,
  onSaved,
}: {
  company: { id: string; name: string };
  canManage: boolean;
  onDirty: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [view, setView] = useState("theme");
  const savedTheme = useRef(adminDefault);
  const iconDirty = useRef(false);
  const reportIconDirty = useCallback(
    (value: boolean) => {
      iconDirty.current = value;
      onDirty(value);
    },
    [onDirty],
  );
  const [theme, setTheme] = useState(adminDefault),
    [dirty, setDirty] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    request("company_admin_theme", { p_company: company.id })
      .then((data) => {
        if (live) {
          savedTheme.current = normalizeAdminTheme(data || {});
          setTheme(savedTheme.current);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [company.id]);
  useEffect(() => {
    onDirty(dirty);
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
      onDirty(false);
    };
  }, [dirty, onDirty]);
  const issues = contrastIssues(theme);
  function change(next: AdminTheme) {
    setTheme(next);
    setDirty(true);
    setNotice("");
  }
  if (loading) return <p role="status">Cargando apariencia…</p>;
  return (
    <>
      <nav className="settings-tabs" aria-label="Personalización de apariencia">
        <AppButton
          type="button"
          className={view === "theme" ? "selected" : "secondary"}
          onClick={() => {
            if (
              iconDirty.current &&
              !confirm("Hay cambios de íconos sin guardar. ¿Descartarlos?")
            )
              return;
            if (view !== "theme") setView("theme");
          }}
        >
          Colores y tipografía
        </AppButton>
        <AppButton
          type="button"
          className={view === "icons" ? "selected" : "secondary"}
          onClick={() => {
            if (
              dirty &&
              !confirm("Hay cambios de tema sin guardar. ¿Descartarlos?")
            )
              return;
            setTheme(savedTheme.current);
            setDirty(false);
            setView("icons");
          }}
        >
          Íconos
        </AppButton>
      </nav>
      {view === "icons" ? (
        <Suspense fallback={<p>Cargando biblioteca…</p>}>
          <IconSettings
            company={company.id}
            canManage={canManage}
            onDirty={reportIconDirty}
          />
        </Suspense>
      ) : (
        <form
          className="company-settings admin-appearance"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canManage || issues.length) return;
            setBusy(true);
            setError("");
            setNotice("");
            request("save_admin_theme", {
              p_company: company.id,
              p_theme: theme,
            })
              .then(async () => {
                savedTheme.current = theme;
                setDirty(false);
                window.dispatchEvent(new Event("ohana-settings-saved"));
                await onSaved();
                setNotice(
                  "Tema guardado para todos los usuarios de esta empresa.",
                );
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="appearance-intro">
            <span className="eyebrow">PERSONALIZA TU ESPACIO</span>
            <h2>Apariencia de {company.name}</h2>
            <p>
              Colores y tipografía compartidos por tu equipo. La tienda pública
              conserva su diseño independiente.
            </p>
          </div>
          <fieldset disabled={!canManage || busy}>
            <section className="settings-block">
              <h3>Elige un tema</h3>
              <div className="theme-options">
                {Object.entries(themes).map(([name, t]) => (
                  <AppButton
                    type="button"
                    key={name}
                    className="theme-option secondary"
                    aria-pressed={JSON.stringify(theme) === JSON.stringify(t)}
                    onClick={() => change({ ...t })}
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {[t.background, t.secondary, t.primary, t.heading].map(
                        (c, i) => (
                          <i key={i} style={{ background: c }} />
                        ),
                      )}
                    </span>
                    {name}
                  </AppButton>
                ))}
              </div>
            </section>
            <section className="settings-block">
              <h3>Ajusta los detalles</h3>
              <div className="settings-grid">
                {Object.entries({
                  primary: "Botones y elementos activos",
                  heading: "Títulos",
                  background: "Fondo principal",
                  secondary: "Fondo secundario",
                  surface: "Superficies y tarjetas",
                  text: "Texto principal",
                  muted: "Texto secundario",
                  border: "Bordes",
                }).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <div className="color-control">
                      <input
                        aria-label={label}
                        type="color"
                        value={theme[key as keyof AdminTheme]}
                        onChange={(e) =>
                          change({ ...theme, [key]: e.target.value })
                        }
                      />
                      <code>
                        {theme[key as keyof AdminTheme].toUpperCase()}
                      </code>
                    </div>
                  </label>
                ))}
                <label>
                  Tipografía
                  <select
                    value={theme.font}
                    onChange={(e) => change({ ...theme, font: e.target.value })}
                  >
                    {fonts.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
              </div>
              <AppButton
                className="secondary"
                type="button"
                onClick={() => change({ ...adminDefault })}
              >
                Restaurar tema predeterminado
              </AppButton>
            </section>
          </fieldset>
          <section
            className="admin-preview"
            style={adminVariables(theme) as CSSProperties}
            aria-label="Vista previa del tema"
          >
            <p className="eyebrow">VISTA PREVIA · SIN GUARDAR</p>
            <h3>Todo tu negocio, en un lugar</h3>
            <p className="preview-muted">
              Así se verán los textos, superficies y controles.
            </p>
            <div className="preview-card">
              <strong>Resumen de tu empresa</strong>
              <p>Información clara para tu equipo.</p>
              <label>
                Campo de ejemplo
                <input readOnly value="Vista previa" />
              </label>
              <div className="form-actions">
                <AppButton type="button">Botón principal</AppButton>
                <AppButton className="secondary" type="button">
                  Botón secundario
                </AppButton>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Elemento</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Tabla de ejemplo</td>
                    <td>Disponible</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          {issues.length > 0 ? (
            <p className="error" role="alert">
              <AppIcon name="status.error" />
              Ajusta el contraste antes de guardar: {issues.join(", ")}. Se
              requiere una relación mínima de 4.5:1 para los textos.
            </p>
          ) : (
            <p className="contrast-ok">
              Contraste de textos verificado: mínimo 4.5:1. El texto de los
              botones se adapta automáticamente.
            </p>
          )}
          {!canManage && (
            <p>Solo los administradores autorizados pueden editar este tema.</p>
          )}
          {dirty && <p role="status">Tienes cambios sin guardar.</p>}
          {error && (
            <p role="alert" className="error">
              <AppIcon name="status.error" />
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {canManage && (
            <AppButton disabled={busy || !dirty || issues.length > 0}>
              {busy ? "Guardando…" : "Guardar tema"}
            </AppButton>
          )}
        </form>
      )}
    </>
  );
}
