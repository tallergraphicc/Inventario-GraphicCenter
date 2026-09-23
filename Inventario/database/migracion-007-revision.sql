-- ============================================================================
-- Migración 007 — Revisión del 22 de septiembre
--
-- Tres cosas, todas seguras de correr más de una vez:
--
--   1. Las dos llaves foráneas de la anulación de movimientos, que en las
--      bases que vienen de la migración 002 nunca se crearon (en una
--      instalación nueva sí existen). Sirven para que no quede una anulación
--      apuntando a un movimiento o a un usuario que ya no existe.
--
--   2. Arregla los acentos rotos ("LÃ¡mina" en vez de "Lámina"), que
--      aparecen si algún archivo .sql se cargó con la terminal en otro
--      idioma. Solo toca los textos que tienen esos símbolos raros.
--
--   3. Marca la contraseña del usuario admin como provisional SOLO si
--      todavía es la que venía de fábrica, para que el sistema pida
--      cambiarla. (Si ya la cambiaste, no hace nada.)
--
-- Cómo correrla en la VM (desde la carpeta Inventario):
--   sudo mysqldump graphic_center_inventario > ~/respaldo-antes-007.sql
--   sudo mysql --default-character-set=utf8mb4 graphic_center_inventario < database/migracion-007-revision.sql
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------------------------------------------------------
-- 1. Llaves foráneas de la anulación
-- ----------------------------------------------------------------------------

-- Primero se revisa que no haya filas "huérfanas" (deben salir 0 filas)
SELECT mv.id AS anulacion_sin_movimiento
FROM movimientos mv LEFT JOIN movimientos o ON o.id = mv.anula_movimiento_id
WHERE mv.anula_movimiento_id IS NOT NULL AND o.id IS NULL;

SELECT mv.id AS anulado_por_usuario_inexistente
FROM movimientos mv LEFT JOIN usuarios u ON u.id = mv.anulado_por_usuario_id
WHERE mv.anulado_por_usuario_id IS NOT NULL AND u.id IS NULL;

SET @huerfanos := (SELECT COUNT(*) FROM movimientos mv
                    LEFT JOIN movimientos o ON o.id = mv.anula_movimiento_id
                   WHERE mv.anula_movimiento_id IS NOT NULL AND o.id IS NULL);
SET @ya := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos'
               AND COLUMN_NAME = 'anula_movimiento_id' AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @sql := IF(@ya = 0 AND @huerfanos = 0,
  'ALTER TABLE movimientos ADD CONSTRAINT fk_mov_anula FOREIGN KEY (anula_movimiento_id) REFERENCES movimientos(id)',
  'SELECT "llave de anulación: ya existe o hay huérfanos" AS nota');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @huerfanos := (SELECT COUNT(*) FROM movimientos mv
                    LEFT JOIN usuarios u ON u.id = mv.anulado_por_usuario_id
                   WHERE mv.anulado_por_usuario_id IS NOT NULL AND u.id IS NULL);
SET @ya := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos'
               AND COLUMN_NAME = 'anulado_por_usuario_id' AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @sql := IF(@ya = 0 AND @huerfanos = 0,
  'ALTER TABLE movimientos ADD CONSTRAINT fk_mov_anulado_por FOREIGN KEY (anulado_por_usuario_id) REFERENCES usuarios(id)',
  'SELECT "llave de quién anuló: ya existe o hay huérfanos" AS nota');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- ----------------------------------------------------------------------------
-- 2. Acentos rotos (mojibake). Solo toca lo que tiene los símbolos Ã / Â.
-- ----------------------------------------------------------------------------
UPDATE unidades_medida SET nombre = CONVERT(CAST(CONVERT(nombre USING latin1) AS BINARY) USING utf8mb4)
 WHERE nombre REGEXP 'Ã|Â';
UPDATE categorias SET nombre = CONVERT(CAST(CONVERT(nombre USING latin1) AS BINARY) USING utf8mb4)
 WHERE nombre REGEXP 'Ã|Â';
UPDATE subcategorias SET nombre = CONVERT(CAST(CONVERT(nombre USING latin1) AS BINARY) USING utf8mb4)
 WHERE nombre REGEXP 'Ã|Â';
UPDATE bodegas SET nombre = CONVERT(CAST(CONVERT(nombre USING latin1) AS BINARY) USING utf8mb4)
 WHERE nombre REGEXP 'Ã|Â';
UPDATE areas SET nombre = CONVERT(CAST(CONVERT(nombre USING latin1) AS BINARY) USING utf8mb4)
 WHERE nombre REGEXP 'Ã|Â';
UPDATE materiales SET descripcion = CONVERT(CAST(CONVERT(descripcion USING latin1) AS BINARY) USING utf8mb4)
 WHERE descripcion REGEXP 'Ã|Â';
UPDATE materiales SET observaciones = CONVERT(CAST(CONVERT(observaciones USING latin1) AS BINARY) USING utf8mb4)
 WHERE observaciones REGEXP 'Ã|Â';

-- ----------------------------------------------------------------------------
-- 3. Contraseña de fábrica del admin: queda marcada como provisional
-- ----------------------------------------------------------------------------
UPDATE usuarios SET debe_cambiar_password = TRUE
 WHERE usuario = 'admin'
   AND password_hash = '$2b$10$U6llx3B/uQvba5U3wHHERe7ILWHTjc4gpUnMvCiCgex28I6taE61q';

-- Verificación
SELECT CONSTRAINT_NAME AS llave, COLUMN_NAME AS columna
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos'
  AND COLUMN_NAME IN ('anula_movimiento_id', 'anulado_por_usuario_id');

SELECT usuario, rol, debe_cambiar_password AS debe_cambiar_contrasena FROM usuarios ORDER BY usuario;
