# OHANA 0.2.2

Liquidaciones de mensajería permite revisar el neto, elegir el método y la fecha del intercambio, y liquidar desde una sola ventana. Guardar borrador conserva el flujo independiente. La fecha del documento y la fecha del intercambio siguen separadas porque identifican movimientos distintos.

La migración `20261128090000_direct_courier_settlement.sql` agrega una RPC que ejecuta el guardado y la confirmación existentes en la misma transacción. Comprueba permiso, revisión, importes y vigencia de las facturas. El resultado se conserva por clave de operación para permitir reintentos sin repetir movimientos. Los errores revierten también el guardado interno. La operación conserva la validación existente de efectivo confirmado y no prepara facturas automáticamente.

Punto de restauración `eb587d4e3e8fa704177a11a44c421fa743756872` (etiqueta local `before-direct-settlement-0.2.1`). Revertir la aplicación restaura el flujo anterior. La RPC aditiva puede permanecer instalada o deshabilitarse revocando el permiso de ejecución. Las liquidaciones confirmadas se conservan y solo se revierten mediante la anulación del módulo.
