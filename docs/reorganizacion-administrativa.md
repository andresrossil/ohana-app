# Reorganización administrativa de OHANA

## Alcance y diseño

El documento conserva su identidad al pasar de pedido interno a factura. Las reservas se toman al facturar y el movimiento físico ocurre en la confirmación de preparación. Ventas, Preparación y Liquidaciones comparten ese diálogo y la función de salida existente. Regalos e insumos conservan las referencias y costos actuales. El pago y la liquidación no invocan movimientos de inventario.

| Módulo | Cambio | Dependencia conservada |
|---|---|---|
| Ventas | Pedido y factura en la misma lista, filtros rápidos, conversión y preparación directa, indicadores de pago y ruta. | Reserva al convertir, edición con revisión, cancelación auditable. |
| Preparación | Confirmación directa desde tres pantallas. Los pasos manuales de iniciar, entregar o poner en tránsito salen del flujo habitual. | Despacho, lotes, costos, regalos, empaque, checklist y reversión existentes. |
| Pagos | Importe sugerido, pago confirmado por efectivo o transferencia, selección múltiple y lote transaccional de hasta 50 facturas. | RPC individual, validación de saldo, permisos, trazabilidad y tratamiento de comprobantes históricos. |
| Liquidaciones | Selección de facturas aún por preparar, confirmación explícita en el diálogo, validación de preparación, diferencia y neto en servidor. | Borrador editable, cuenta del mensajero, abonos históricos y contrapartidas. |
| Inicio | Señales de pedidos por confirmar, facturas por preparar y cobrar, borradores de ruta y liquidaciones por finalizar. | Indicadores de inventario, producción y ventas existentes. |
| Clientes y Proveedores | Búsqueda por dirección, menú de acciones, lista compacta y navegación de ficha. | Campos, identificadores, precios, historial y permisos. |
| Fondos | Triggers existentes se ejecutan al registrar pagos o liquidar. | Fórmulas, exclusión de regalos, saldos, contabilidad de reversos. |

Compras, reglas de inventario, producción, configuración de Mensajería y checkout público quedan con las definiciones anteriores. Las etiquetas mantienen su contenido comercial y los regalos capturados en preparación conservan el tratamiento de impresión establecido.

## Cambios de base

La migración `20261127000000_admin_commercial_workflow.sql` redefine las funciones instaladas `sales_fulfillment`, `sales_worklist`, `courier_pending`, `settlement_engine`, `company_dashboard` y `partners`. Agrega `register_admin_payments` como función de invocador autenticado con permiso de escritura en Ventas. El lote ordena los documentos antes de delegar a la operación de pago existente. El saldo se revalida en la escritura, las llaves por factura distinguen reintentos y los errores revierten la transacción completa.

La migración no contiene DDL de tablas, escrituras de registros comerciales ni conversiones históricas. Se verificó su compilación de forma transaccional contra las definiciones de producción y se hizo rollback de esa comprobación. No se capturaron ventas o movimientos de prueba en producción.

## Verificación

- Compilación TypeScript/Vite y 51 pruebas de Node.
- `supabase/tests/admin_commercial_workflow.sql`, en PostgreSQL embebido desechable con el historial completo de migraciones y datos sintéticos. Valida pedidos sin reserva, conversión, ajuste de reserva, cancelación, salida con regalo, lote idempotente, pagos parciales, separación entre empresas, saldo y reversiones de fondos, preparación exigida en liquidación, guardado sin salida, cobro de ruta, anulación, devolución, traslado de una factura entre borradores, neto mixto calculado y saldo a favor de mensajería. Prueba de regresión pública con precio, repetición idempotente y reserva de checkout.
- Verificación visual con Chromium a 360, 390, 430, 768 y 1440 px en un entorno con operaciones simuladas. Se probaron la apertura de preparación desde Ventas, la selección de facturas y el formulario de pagos.
- El guion histórico `supabase/tests/orders.sql` aún usa un fixture de producción que no especifica las unidades estimadas requeridas por la fórmula actual. El nuevo guion no depende de esa producción histórica.
- Quedan fuera de la validación física la impresora, el teclado nativo y la navegación en un celular real.

## Restauración

Punto de restauración del frontend: `972c32ba9aa8473d27fb20ff792dabe5ea09c7c1`. Para revertir este despliegue, crear un commit de reversión de la publicación sobre `main` y comprobar que GitHub Pages sirva el frontend anterior. Después, ejecutar `supabase/rollback/20261127000000_admin_commercial_workflow.sql` como una migración correctiva nueva, revisando que ninguna de las seis funciones tenga cambios posteriores que deban preservarse. El script restaura las funciones capturadas antes de la intervención y revoca la entrada nueva de pagos masivos. No borra los cobros, facturas ni movimientos legítimos generados después del despliegue. Cualquier corrección de una operación comercial se hace con sus acciones de anulación y reversión.

## Archivos

- Ventas: `src/Sales.tsx`, `src/SaleEditor.tsx`, `src/SaleDocument.tsx`.
- Preparación y liquidaciones: `src/OrderPreparation.tsx`, `src/OrderPreparationDialog.tsx`, `src/CourierSettlements.tsx`.
- Cobros: `src/OrderDeliveryDialog.tsx`, `src/AdminBatchPayments.tsx`.
- Maestros e Inicio: `src/BusinessPartners.tsx`, `src/partners.css`, `src/Dashboard.tsx`, `src/main.tsx`.
- Supabase: `supabase/migrations/20261127000000_admin_commercial_workflow.sql`, `supabase/tests/admin_commercial_workflow.sql`, `supabase/rollback/20261127000000_admin_commercial_workflow.sql`.
