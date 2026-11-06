import { useState, type RefObject } from "react";
import { AppButton } from "./AppIcon";
import {
  collectReportTables,
  reportTSV,
  reportWorkbook,
} from "./report-export";
export default function ReportExport({
  target,
  title,
}: {
  target: RefObject<HTMLDivElement | null>;
  title: string;
}) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function run(excel: boolean) {
    setBusy(true);
    setNotice("");
    try {
      if (target.current?.querySelector('[aria-busy="true"]'))
        throw Error("Espera a que termine de cargar el reporte.");
      const tables = target.current ? collectReportTables(target.current) : [];
      if (!tables.length) throw Error("Carga primero un reporte con datos.");
      if (excel) {
        const bytes = await reportWorkbook(tables);
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `Ohana-${title.replace(/[^a-z0-9áéíóúñ]+/gi, "-")}.xlsx`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice("Excel generado con los datos de la vista actual.");
      } else {
        await navigator.clipboard.writeText(reportTSV(tables));
        setNotice("Datos copiados. Puedes pegarlos en Excel.");
      }
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="report-export">
      <div className="actions">
        <AppButton
          className="secondary"
          iconKey="action.duplicate"
          disabled={busy}
          onClick={() => run(false)}
        >
          Copiar vista
        </AppButton>
        <AppButton
          className="secondary"
          iconKey="action.download"
          disabled={busy}
          onClick={() => run(true)}
        >
          Exportar vista a Excel
        </AppButton>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
