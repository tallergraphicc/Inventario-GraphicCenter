-- ============================================================================
-- Graphic Center — Inventario
-- Migración 004 — el largo de los rollos con 4 decimales
--
--     sudo mysql graphic_center_inventario < database/migracion-004-precision-rollos.sql
--
-- El largo del rollo se guardaba con 2 decimales y los movimientos con 4.
-- Un rollo de 50 metros son 164.042 pies: el movimiento guardaba 164.042 y el
-- rollo 164.04. Esos 0.002 que se perdían dejaban una diferencia permanente
-- entre la existencia del material y lo que suman sus rollos.
--
-- Esto solo amplía la columna. No cambia ningún dato: los rollos que ya se
-- guardaron con 2 decimales se quedan como están (ese último decimal no se
-- puede recuperar). Los que se registren desde ahora guardan los 4.
--
-- Es seguro correrla más de una vez.
-- ============================================================================

USE graphic_center_inventario;

ALTER TABLE rollos
  MODIFY COLUMN largo DECIMAL(12,4) NULL;

SELECT COLUMN_NAME, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'rollos'
   AND COLUMN_NAME = 'largo';

-- Listo. Reinicia el backend (npm start).
