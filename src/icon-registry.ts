export type IconEntry = {
  key: string;
  label: string;
  category: string;
  icon: string;
  locked?: boolean;
};
export const iconRegistry: IconEntry[] = [
  {
    key: "navigation.menu",
    label: "Abrir menú",
    category: "Navegación",
    icon: "menu",
  },
  {
    key: "navigation.close",
    label: "Cerrar menú",
    category: "Navegación",
    icon: "panel-left-close",
  },
  {
    key: "control.sort",
    label: "Ordenar columnas",
    category: "Controles",
    icon: "arrow-up-down",
  },
  {
    key: "control.filter",
    label: "Filtrar catálogo",
    category: "Controles",
    icon: "list-filter",
  },

  ...[
    ["active", "Activo", "circle-check"],
    ["archived", "Archivado", "archive"],
    ["purchased", "Comprado", "shopping-cart"],
    ["manufactured", "Fabricado", "factory"],
  ].map(([key, label, icon]) => ({
    key: "status." + key,
    label,
    icon,
    category: "Estado y origen de catálogo",
  })),
  ...[
    ["dashboard", "Inicio", "house"],
    ["materials", "Materiales", "layers"],
    ["products", "Productos", "package"],
    ["purchases", "Compras", "shopping-cart"],
    ["formulas", "Fórmulas", "flask-conical"],
    ["production", "Producción", "factory"],
    ["inventory", "Inventario", "warehouse"],
    ["sales", "Ventas", "trending-up"],
    ["customers", "Clientes", "users"],
    ["suppliers", "Proveedores", "truck"],
    ["prices", "Listas de precios", "tags"],
    ["expenses", "Gastos", "receipt"],
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
    label: "Advertencia",
    category: "Estados",
    icon: "triangle-alert",
  },
  {
    key: "status.error",
    label: "Error",
    category: "Estados",
    icon: "circle-alert",
  },
];
export function actionIcon(text: string) {
  const s = text.toLocaleLowerCase();
  const rules: [RegExp, string][] = [
    [/cerrar sesi[oó]n|salir|anterior/, "back"],
    [/restaurar|reiniciar/, "refresh"],
    [/permanecer|^\s*[×✕✖]\s*$/, "cancel"],
    [/guardar|guardando/, "save"],
    [/confirmar|liberar|finalizar|entregar/, "confirm"],
    [/cancelar|cerrar|descartar/, "cancel"],
    [/editar|renombrar/, "edit"],
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
    [/agregar|añadir|crear|nueva|nuevo|iniciar|registrar/, "add"],
    [/seleccionar|elegir|aplicar|aceptar/, "confirm"],
    [
      /mostrar|consultar|\bver\b|detalle|abrir|siguiente|continuar|variantes y existencias/,
      "expand",
    ],
    [/preparar|generar|producir|ajustar|f[oó]rmula/, "calculate"],
  ];
  return rules.find(([r]) => r.test(s))?.[1];
}
