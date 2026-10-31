export type IconEntry = {
  key: string;
  label: string;
  category: string;
  icon: string;
  locked?: boolean;
};
export const iconRegistry: IconEntry[] = [
  ...[
    ["dashboard", "Inicio", "house"],
    ["materials", "Materiales", "layers"],
    ["products", "Productos", "package"],
    ["purchases", "Compras", "shopping-cart"],
    ["formulas", "Fórmulas", "flask-conical"],
    ["production", "Producción", "factory"],
    ["inventory", "Inventario", "warehouse"],
    ["sales", "Ventas", "trending-up"],
    ["customers", "Socios de negocio", "users"],
    ["reports", "Reportes", "chart-column"],
    ["settings", "Configuración", "settings"],
  ].map(([key, label, icon]) => ({
    key: "module." + key,
    label,
    icon,
    category: "Módulos",
  })),
  ...[
    ["save", "Guardar", "save"],
    ["confirm", "Confirmar", "circle-check"],
    ["cancel", "Cancelar", "x"],
    ["edit", "Editar", "pencil"],
    ["delete", "Eliminar", "trash-2"],
    ["add", "Agregar", "plus"],
    ["duplicate", "Duplicar", "copy"],
    ["search", "Buscar", "search"],
    ["compare", "Comparación de precios", "git-compare-arrows"],
    ["history", "Historial", "history"],
    ["calculate", "Cálculos", "calculator"],
    ["download", "Descargar", "download"],
    ["upload", "Cargar", "upload"],
    ["print", "Imprimir", "printer"],
    ["barcode", "Código de barras", "barcode"],
    ["refresh", "Actualizar", "refresh-cw"],
    ["access", "Administrar accesos", "user-round-cog"],
    ["back", "Volver", "arrow-left"],
    ["expand", "Expandir", "chevron-right"],
    ["collapse", "Contraer", "chevron-down"],
  ].map(([key, label, icon]) => ({
    key: "action." + key,
    label,
    icon,
    category: "Acciones",
  })),
  {
    key: "status.success",
    label: "Éxito",
    category: "Estados",
    icon: "circle-check",
  },
  {
    key: "status.pending",
    label: "Pendiente",
    category: "Estados",
    icon: "clock",
  },
  {
    key: "status.info",
    label: "Información",
    category: "Estados",
    icon: "info",
  },
  {
    key: "status.warning",
    label: "Advertencia (fijo)",
    category: "Estados",
    icon: "triangle-alert",
    locked: true,
  },
  {
    key: "status.error",
    label: "Error (fijo)",
    category: "Estados",
    icon: "circle-alert",
    locked: true,
  },
];
export function actionIcon(text: string) {
  const s = text.toLocaleLowerCase();
  const rules: [RegExp, string][] = [
    [/guardar/, "save"],
    [/confirmar|liberar|finalizar|entregar/, "confirm"],
    [/cancelar|cerrar|descartar/, "cancel"],
    [/editar/, "edit"],
    [/eliminar|quitar|retirar/, "delete"],
    [/duplicar|copiar/, "duplicate"],
    [/buscar/, "search"],
    [/comparar|comparación/, "compare"],
    [/historial|precios/, "history"],
    [/calcular|sugerir/, "calculate"],
    [/descargar/, "download"],
    [/cargar|importar|recibir/, "upload"],
    [/imprimir/, "print"],
    [/barras/, "barcode"],
    [/actualizar/, "refresh"],
    [/accesos/, "access"],
    [/volver/, "back"],
    [/agregar|añadir|crear|nueva|nuevo|iniciar/, "add"],
  ];
  return rules.find(([r]) => r.test(s))?.[1];
}
