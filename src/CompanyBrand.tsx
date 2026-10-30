import {
  adminDefault,
  normalizeAdminTheme,
  adminVariables,
} from "./admin-theme";
import { useEffect, useState } from "react";
import { supabase as db } from "./client";
import type { CatalogRow } from "./sheet-model";
export const defaultTheme = {
  background: "#f5ebe0",
  surface: "#ffffff",
  primary: "#574334",
  text: "#463c32",
  accent: "#f4d7a3",
  font: "DM Sans",
};
export function useCompanyTheme(company: string) {
  useEffect(() => {
    let live = true;
    const root = document.documentElement;
    const apply = (theme: Record<string, string>) => {
      for (const [key, value] of Object.entries(
        adminVariables(normalizeAdminTheme(theme)),
      ))
        root.style.setProperty(key, value);
    };
    apply({});
    if (!company) return;
    const load = async () => {
      const { data, error } = await db.rpc("company_admin_theme", {
        p_company: company,
      });
      if (live && !error) apply(data || {});
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    const refresh = () => void load();
    window.addEventListener("ohana-settings-saved", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("ohana-settings-saved", refresh);
      apply({});
    };
  }, [company]);
}
export default function CompanyLogo({ company }: { company: CatalogRow }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    setUrl("");
    if (company.logo_path === "brand:ohana") {
      setUrl(import.meta.env.BASE_URL + "brand/ohana-logo.png");
      return;
    }
    if (!company.logo_path) return;
    const load = () => {
      void db.storage
        .from("company-logos")
        .createSignedUrl(company.logo_path, 3600)
        .then(({ data }) => {
          if (live) setUrl(data?.signedUrl || "");
        });
    };
    load();
    const timer = setInterval(load, 3000000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [company.id, company.logo_path]);
  return url ? (
    <div
      className={
        "company-logo " +
        (company.logo_path === "brand:ohana" ? "official-logo" : "")
      }
    >
      <img src={url} alt={`Logo de ${company.name}`} />
    </div>
  ) : (
    <div className="company-logo company-initial" aria-label={company.name}>
      {String(company.name || "?").slice(0, 1)}
    </div>
  );
}
