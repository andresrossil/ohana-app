# Levantamiento físico Wall to Wall

OHANA 0.2.0 incorpora «Levantamiento físico» en Inventario. Registra capturas repetidas por artículo o variante, admite unidades compatibles y permite pegar desde Excel en el orden artículo, cantidad, unidad, ubicación y observaciones.

El consolidado compara el total contado contra la existencia física del Kardex. La confirmación advierte cuando un artículo con existencia quedó sin captura y se ajustará a cero. El cierre registra las diferencias en un documento de Kardex, con una transacción e idempotencia. El motor vigente consume los lotes elegibles en su orden habitual. Cada sobrante genera un lote «Ajuste WTW» sin fechas de producción ni curación inventadas. Un costo desconocido queda pendiente.

Las reservas son informativas en la diferencia física. La confirmación completa se detiene si la salida requiere consumir unidades reservadas o bloqueadas. El conteo debe revisarse si hubo movimientos físicos posteriores a la captura. El ajuste tradicional conserva su flujo.

Migración aditiva: `20261128070000_wall_to_wall.sql`. El punto previo de restauración es `02c87cc`. Para suspender la función, revertir la aplicación y retirar acceso a la RPC mediante una migración adicional si hace falta. Para corregir existencias, usar la reversión del documento de Kardex. Conservar capturas y movimientos para auditoría.
