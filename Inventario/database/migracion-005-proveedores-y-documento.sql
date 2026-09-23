-- ============================================================================
-- Migración 005 — Proveedores y documento de respaldo en los movimientos
--
-- Qué agrega:
--   1. La tabla "proveedores" (se administra en Configuración, igual que
--      bodegas y áreas).
--   2. En cada movimiento:
--        proveedor_id      → a quién se le compró (en las entradas)
--        documento_tipo    → FACTURA, COTIZACION u OTRO
--        documento_numero  → el número de la factura o cotización
--
-- No borra nada. Los movimientos viejos quedan sin proveedor ni documento;
-- se les puede agregar después desde el detalle del movimiento
-- ("Agregar proveedor y factura").
--
-- Además da de baja los rollos que quedaron vivos aunque la entrada que los
-- creó se anuló (ver el bloque "Arreglo" más abajo).
--
-- Se puede correr más de una vez sin problema: todo lleva IF NOT EXISTS.
--
-- Cómo correrla en la VM (desde la carpeta Inventario):
--   sudo mysqldump graphic_center_inventario > respaldo-antes-005.sql
--   sudo mysql graphic_center_inventario < database/migracion-005-proveedores-y-documento.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS proveedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE
) ENGINE=InnoDB;

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS proveedor_id INT NULL AFTER bodega_id,
  ADD COLUMN IF NOT EXISTS documento_tipo VARCHAR(20) NULL AFTER proveedor_id,
  ADD COLUMN IF NOT EXISTS documento_numero VARCHAR(60) NULL AFTER documento_tipo;

-- La llave foránea impide borrar un proveedor que ya tiene compras registradas
ALTER TABLE movimientos
  ADD CONSTRAINT fk_mov_proveedor FOREIGN KEY IF NOT EXISTS (proveedor_id) REFERENCES proveedores(id);

-- Para filtrar rápido "compras de este proveedor en este mes"
ALTER TABLE movimientos
  ADD INDEX IF NOT EXISTS idx_mov_proveedor (proveedor_id, fecha);

-- ----------------------------------------------------------------------------
-- Arreglo: rollos que quedaron vivos aunque la entrada que los creó se anuló.
--
-- Hasta ahora, anular una entrada que había creado un rollo bajaba la
-- existencia pero dejaba el rollo con todo su largo. El código nuevo ya lo da
-- de baja solo; esto limpia los que hayan quedado de antes.
-- Solo toca rollos SIN ningún otro movimiento vigente (ni salidas, ni mermas,
-- ni medidas corregidas). No borra nada: los marca como eliminados.
-- ----------------------------------------------------------------------------
UPDATE rollos r
   SET r.activo = FALSE
 WHERE r.activo = TRUE
   AND EXISTS (SELECT 1 FROM movimientos e
                WHERE e.rollo_id = r.id AND e.tipo = 'ENTRADA' AND e.anulado = TRUE)
   AND NOT EXISTS (SELECT 1 FROM movimientos o
                    WHERE o.rollo_id = r.id AND o.anulado = FALSE AND o.anula_movimiento_id IS NULL);

-- Los que tienen su entrada anulada pero SÍ se usaron después: esos no se
-- tocan solos. Si sale alguno aquí, hay que revisarlo a mano (anular sus
-- movimientos o eliminar el rollo desde la pantalla Rollos).
SELECT r.id AS rollo_para_revisar, m.codigo AS material
FROM rollos r
JOIN materiales m ON m.id = r.material_id
WHERE r.activo = TRUE
  AND EXISTS (SELECT 1 FROM movimientos e
               WHERE e.rollo_id = r.id AND e.tipo = 'ENTRADA' AND e.anulado = TRUE)
  AND NOT EXISTS (SELECT 1 FROM movimientos e2
                   WHERE e2.rollo_id = r.id AND e2.tipo = 'ENTRADA'
                     AND e2.anulado = FALSE AND e2.anula_movimiento_id IS NULL);

-- Verificación: debe mostrar las tres columnas nuevas
SELECT COLUMN_NAME AS columna_nueva
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'movimientos'
  AND COLUMN_NAME IN ('proveedor_id', 'documento_tipo', 'documento_numero');
