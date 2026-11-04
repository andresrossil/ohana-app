export type IconPool = { options: string[]; active: string };
export type IconPools = Record<string, IconPool>;
export const defaultIconPools: IconPools = {
  "module.prices": {
    options: ["tags", "tag", "badge-dollar-sign", "coins", "list-ordered"],
    active: "tags",
  },
  "module.expenses": {
    options: ["receipt", "wallet", "calculator", "banknote", "credit-card"],
    active: "receipt",
  },
  "navigation.menu": {
    options: ["menu", "align-justify", "panel-left", "square-menu", "list"],
    active: "menu",
  },
  "navigation.close": {
    options: [
      "panel-left-close",
      "panel-left",
      "x",
      "chevrons-left",
      "panel-right-close",
    ],
    active: "panel-left-close",
  },
  "control.sort": {
    options: [
      "arrow-up-down",
      "arrow-down-up",
      "list-ordered",
      "arrow-up-wide-narrow",
      "arrow-down-wide-narrow",
    ],
    active: "arrow-up-down",
  },
  "control.filter": {
    options: [
      "list-filter",
      "filter",
      "funnel",
      "sliders-horizontal",
      "list-filter-plus",
    ],
    active: "list-filter",
  },
  "status.active": {
    options: [
      "circle-check",
      "check",
      "check-check",
      "square-check",
      "badge-check",
    ],
    active: "circle-check",
  },
  "status.archived": {
    options: [
      "archive",
      "archive-x",
      "archive-restore",
      "package-x",
      "circle-off",
    ],
    active: "archive",
  },
  "status.purchased": {
    options: [
      "shopping-cart",
      "shopping-bag",
      "shopping-basket",
      "store",
      "receipt",
    ],
    active: "shopping-cart",
  },
  "status.manufactured": {
    options: ["factory", "workflow", "cog", "settings-2", "hammer"],
    active: "factory",
  },
  "module.dashboard": {
    options: ["house", "layout-dashboard", "home", "building-2", "house-plus"],
    active: "house",
  },
  "module.materials": {
    options: ["layers", "layers-2", "boxes", "component", "shapes"],
    active: "layers",
  },
  "module.products": {
    options: ["package", "package-2", "box", "package-open", "boxes"],
    active: "package",
  },
  "module.purchases": {
    options: [
      "shopping-cart",
      "shopping-bag",
      "shopping-basket",
      "store",
      "receipt",
    ],
    active: "shopping-cart",
  },
  "module.formulas": {
    options: [
      "flask-conical",
      "flask-round",
      "test-tubes",
      "beaker",
      "test-tube",
    ],
    active: "flask-conical",
  },
  "module.production": {
    options: ["factory", "workflow", "cog", "settings-2", "hammer"],
    active: "factory",
  },
  "module.inventory": {
    options: [
      "warehouse",
      "boxes",
      "package-search",
      "container",
      "clipboard-list",
    ],
    active: "warehouse",
  },
  "module.sales": {
    options: [
      "trending-up",
      "chart-no-axes-combined",
      "receipt",
      "badge-dollar-sign",
      "store",
    ],
    active: "trending-up",
  },
  "module.customers": {
    options: ["users", "users-round", "contact", "handshake", "user-round"],
    active: "users",
  },
  "module.reports": {
    options: [
      "chart-column",
      "chart-line",
      "chart-pie",
      "chart-area",
      "chart-bar",
    ],
    active: "chart-column",
  },
  "module.settings": {
    options: [
      "settings",
      "settings-2",
      "sliders-horizontal",
      "sliders-vertical",
      "wrench",
    ],
    active: "settings",
  },
  "action.save": {
    options: [
      "save",
      "save-all",
      "save-check",
      "save-pen",
      "hard-drive-download",
    ],
    active: "save",
  },
  "action.confirm": {
    options: [
      "circle-check",
      "check",
      "check-check",
      "square-check",
      "badge-check",
    ],
    active: "circle-check",
  },
  "action.cancel": {
    options: ["x", "circle-x", "square-x", "ban", "undo-2"],
    active: "x",
  },
  "action.edit": {
    options: ["pencil", "pen", "square-pen", "pencil-line", "file-pen"],
    active: "pencil",
  },
  "action.delete": {
    options: ["trash-2", "trash", "shredder", "eraser", "delete"],
    active: "trash-2",
  },
  "action.add": {
    options: ["plus", "circle-plus", "square-plus", "list-plus", "file-plus"],
    active: "plus",
  },
  "action.duplicate": {
    options: ["copy", "copy-plus", "files", "clipboard-copy", "layers-2"],
    active: "copy",
  },
  "action.search": {
    options: [
      "search",
      "search-check",
      "scan-search",
      "list-filter",
      "file-search",
    ],
    active: "search",
  },
  "action.compare": {
    options: [
      "git-compare-arrows",
      "git-compare",
      "columns-2",
      "arrow-left-right",
      "scale",
    ],
    active: "git-compare-arrows",
  },
  "action.history": {
    options: ["history", "clock", "calendar-clock", "timer", "list-ordered"],
    active: "history",
  },
  "action.calculate": {
    options: ["calculator", "sigma", "square-function", "percent", "divide"],
    active: "calculator",
  },
  "action.download": {
    options: [
      "download",
      "cloud-download",
      "folder-down",
      "file-down",
      "arrow-down-to-line",
    ],
    active: "download",
  },
  "action.upload": {
    options: [
      "upload",
      "cloud-upload",
      "folder-up",
      "file-up",
      "arrow-up-from-line",
    ],
    active: "upload",
  },
  "action.print": {
    options: [
      "printer",
      "printer-check",
      "file-text",
      "receipt-text",
      "scan-line",
    ],
    active: "printer",
  },
  "action.barcode": {
    options: [
      "barcode",
      "scan-barcode",
      "qr-code",
      "scan-line",
      "scan-qr-code",
    ],
    active: "barcode",
  },
  "action.refresh": {
    options: [
      "refresh-cw",
      "refresh-ccw",
      "rotate-cw",
      "repeat",
      "refresh-ccw-dot",
    ],
    active: "refresh-cw",
  },
  "action.access": {
    options: [
      "user-round-cog",
      "user-cog",
      "user-key",
      "shield-user",
      "key-round",
    ],
    active: "user-round-cog",
  },
  "action.back": {
    options: [
      "arrow-left",
      "chevron-left",
      "corner-up-left",
      "undo",
      "move-left",
    ],
    active: "arrow-left",
  },
  "action.expand": {
    options: [
      "chevron-right",
      "chevrons-right",
      "arrow-right",
      "circle-chevron-right",
      "panel-left-open",
    ],
    active: "chevron-right",
  },
  "action.collapse": {
    options: [
      "chevron-down",
      "chevrons-down",
      "arrow-down",
      "circle-chevron-down",
      "fold-vertical",
    ],
    active: "chevron-down",
  },
  "status.success": {
    options: [
      "circle-check",
      "check",
      "check-check",
      "square-check",
      "badge-check",
    ],
    active: "circle-check",
  },
  "status.pending": {
    options: ["clock", "hourglass", "timer", "calendar-clock", "circle-dashed"],
    active: "clock",
  },
  "status.info": {
    options: [
      "info",
      "circle-help",
      "message-circle",
      "badge-info",
      "circle-ellipsis",
    ],
    active: "info",
  },
  "status.warning": {
    options: [
      "triangle-alert",
      "circle-alert",
      "badge-alert",
      "octagon-alert",
      "bell-ring",
    ],
    active: "triangle-alert",
  },
  "status.error": {
    options: ["circle-alert", "circle-x", "octagon-x", "shield-x", "ban"],
    active: "circle-alert",
  },
};
