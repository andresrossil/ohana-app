import { useEffect, useState } from "react";
import { supabase as db, confirmationRedirect } from "./client";
import { request } from "./commerce";
import { useOperation, type Row } from "./operations";
import { AppButton, AppIcon } from "./AppIcon";
import { confirmAction } from "./ConfirmDialog";
import ResponsiveTable from "./ResponsiveTable";
import { Members } from "./OrganizationAdmin";
import { IconDetails } from "./PoolControls";

function UserAvatar({ path, name }: { path?: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    setUrl("");
    if (path)
      void db.storage
        .from("user-avatars")
        .createSignedUrl(path, 3600)
        .then(({ data }) => {
          if (live) setUrl(data?.signedUrl || "");
        });
    return () => {
      live = false;
    };
  }, [path]);
  return url ? (
    <img
      className="user-avatar"
      src={url}
      alt={name}
      onError={() => setUrl("")}
    />
  ) : (
    <span className="user-avatar user-avatar-empty" aria-label="Sin fotografía">
      <AppIcon name="module.settings" />
    </span>
  );
}

export function PasswordChange({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  return (
    <form
      className="settings-grid"
      aria-busy={busy}
      data-navigation-dirty={dirty}
      onChange={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = new FormData(form);
        const password = String(f.get("password"));
        setError("");
        setNotice("");
        if (password !== String(f.get("repeat"))) {
          setError("Las contraseñas no coinciden.");
          return;
        }
        setBusy(true);
        try {
          const { error } = await db.auth.updateUser({ password });
          if (error) throw error;
          form.reset();
          setDirty(false);
          setNotice("Contraseña actualizada.");
          onDone?.();
        } catch (err: any) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Nueva contraseña
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={busy}
        />
      </label>
      <label>
        Confirmar contraseña
        <input
          name="repeat"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={busy}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="actions">
        <AppButton disabled={busy} iconKey="action.save">
          Guardar contraseña
        </AppButton>
      </div>
    </form>
  );
}

export function PasswordRecovery({ onDone }: { onDone: () => void }) {
  return (
    <main className="auth">
      <section className="confirmation">
        <h1>Establecer contraseña</h1>
        <p>Escribe y confirma tu nueva contraseña.</p>
        <PasswordChange onDone={onDone} />
      </section>
    </main>
  );
}

export default function UserSettings({
  company,
  onDirty,
}: {
  company: string;
  onDirty: (value: boolean) => void;
}) {
  const state = useOperation(company, "identity"),
    [users, setUsers] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row | null>(null),
    [dirty, setDirty] = useState(false);
  const load = async () =>
    setUsers(
      await request("user_settings", { p_company: company, p_action: "list" }),
    );
  useEffect(() => {
    state.run(load);
  }, [company]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  async function close() {
    if (
      !state.busy &&
      (!dirty ||
        (await confirmAction("Hay cambios sin guardar. ¿Salir sin guardar?")))
    ) {
      setEdit(null);
      setDirty(false);
    }
  }
  return (
    <section className="company-settings">
      <h2>Usuarios</h2>
      <p>
        Administra los perfiles de las cuentas con acceso a esta empresa. Los
        nombres y las fotos pertenecen a la cuenta.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      <div className="table-wrap">
        <ResponsiveTable>
          <thead>
            <tr>
              {["Foto", "Nombre", "Correo", "Acceso", "Acciones"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td data-sort-value={u.display_name}>
                  <UserAvatar
                    path={u.avatar_path}
                    name={u.display_name || "Usuario"}
                  />
                </td>
                <td>
                  {u.display_name || "Sin nombre registrado"}
                  {u.self && <small>Tu cuenta</small>}
                </td>
                <td>{u.email}</td>
                <td>
                  {u.role === "corporation_admin"
                    ? "Administrador de corporación"
                    : u.role === "admin"
                      ? "Administrador de empresa"
                      : "Usuario operativo"}
                </td>
                <td>
                  <div className="actions">
                    {u.can_edit && (
                      <>
                        <AppButton
                          className="secondary"
                          iconKey="action.edit"
                          disabled={state.busy}
                          onClick={() => {
                            setEdit(u);
                            setDirty(false);
                          }}
                        >
                          Editar perfil
                        </AppButton>
                        <AppButton
                          className="secondary"
                          iconKey="action.refresh"
                          disabled={state.busy}
                          onClick={() =>
                            state.run(async () => {
                              if (
                                !(await confirmAction(
                                  `Se enviará un enlace a ${u.email} para establecer una nueva contraseña.`,
                                  {
                                    title: "Restablecer contraseña",
                                    iconKey: "status.warning",
                                  },
                                ))
                              )
                                return;
                              const { error } =
                                await db.auth.resetPasswordForEmail(u.email, {
                                  redirectTo: confirmationRedirect,
                                });
                              if (error) throw error;
                              state.setNotice(
                                "Enlace de restablecimiento solicitado. Revisa el correo de la cuenta.",
                              );
                            })
                          }
                        >
                          Restablecer contraseña
                        </AppButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <IconDetails className="formula-disclosure">
        <summary>Accesos y permisos</summary>
        <Members company={company} onChanged={load} />
      </IconDetails>
      <IconDetails className="formula-disclosure">
        <summary>Cambiar mi contraseña</summary>
        <PasswordChange />
      </IconDetails>
      {edit && (
        <div className="overlay">
          <section
            className="modal operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Editar usuario"
            data-navigation-dirty={dirty}
            aria-busy={state.busy}
          >
            <header className="catalog-head">
              <h2>Editar usuario</h2>
              <AppButton
                className="secondary"
                disabled={state.busy}
                onClick={close}
              >
                Cerrar
              </AppButton>
            </header>
            <UserAvatar
              path={edit.avatar_path}
              name={edit.display_name || "Usuario"}
            />
            <form
              onChange={() => setDirty(true)}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                state.run(async () => {
                  let path = f.has("remove_photo") ? null : edit.avatar_path,
                    uploaded = "";
                  const file = f.get("photo");
                  try {
                    if (file instanceof File && file.size) {
                      const ext: Record<string, string> = {
                        "image/png": "png",
                        "image/jpeg": "jpg",
                        "image/webp": "webp",
                      };
                      if (!ext[file.type] || file.size > 3 * 1024 * 1024)
                        throw Error(
                          "Usa una imagen PNG, JPG o WebP de hasta 3 MB.",
                        );
                      uploaded = `${company}/${edit.id}/${crypto.randomUUID()}.${ext[file.type]}`;
                      const { error } = await db.storage
                        .from("user-avatars")
                        .upload(uploaded, file, {
                          contentType: file.type,
                          upsert: false,
                        });
                      if (error) throw error;
                      path = uploaded;
                    }
                    await request("user_settings", {
                      p_company: company,
                      p_action: "save",
                      p_data: {
                        user_id: edit.id,
                        display_name: f.get("display_name"),
                        avatar_path: path,
                      },
                    });
                  } catch (err) {
                    if (uploaded)
                      await db.storage.from("user-avatars").remove([uploaded]);
                    throw err;
                  }
                  setEdit(null);
                  setDirty(false);
                  state.setNotice(
                    "Perfil actualizado. El nombre se reflejará en el Kardex.",
                  );
                  await load();
                });
              }}
            >
              <label>
                Nombre
                <input
                  name="display_name"
                  required
                  maxLength={120}
                  defaultValue={edit.display_name}
                  disabled={state.busy}
                />
              </label>
              <label>
                Correo
                <input type="email" value={edit.email} readOnly />
              </label>
              <label>
                Fotografía
                <input
                  name="photo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={state.busy}
                />
              </label>
              {edit.avatar_path && (
                <label className="check">
                  <input
                    name="remove_photo"
                    type="checkbox"
                    disabled={state.busy}
                  />
                  Quitar fotografía
                </label>
              )}
              {state.error && (
                <p className="error" role="alert">
                  {state.error}
                </p>
              )}
              <div className="actions">
                <AppButton disabled={state.busy}>Guardar cambios</AppButton>
                <AppButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={close}
                >
                  Cancelar
                </AppButton>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
