-- ============================================================================
-- Graphic Center — Inventario
-- Migración 002 — usuarios, roles, anulación de movimientos e índices
--
-- Se corre UNA sola vez sobre la base que ya existe:
--     mysql -u root -p graphic_center_inventario < database/migracion-002-usuarios-y-anulacion.sql
--
-- Si creas la base desde cero con schema.sql + seed.sql, NO hace falta.
-- Haz respaldo antes:
--     mysqldump -u root -p graphic_center_inventario > respaldo-antes-migracion-002.sql
-- ============================================================================

USE graphic_center_inventario;

-- ---------------------------------------------------------------------------
-- 1) Usuarios: se entra con USUARIO, no con correo
-- ---------------------------------------------------------------------------

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS usuario VARCHAR(40) NULL AFTER id;

-- A los que ya existen se les arma un usuario a partir del correo
-- (admin@graphiccenterpa.com -> admin). Revisa el resultado antes de seguir.
UPDATE usuarios
   SET usuario = SUBSTRING_INDEX(email, '@', 1)
 WHERE usuario IS NULL AND email IS NOT NULL;

UPDATE usuarios SET usuario = CONCAT('usuario', id) WHERE usuario IS NULL;

ALTER TABLE usuarios
  MODIFY COLUMN usuario VARCHAR(40) NOT NULL;

-- El índice único solo se agrega si no existía ya
SET @existe := (SELECT COUNT(*) FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'
                  AND INDEX_NAME = 'uq_usuarios_usuario');
SET @sql := IF(@existe = 0,
  'ALTER TABLE usuarios ADD UNIQUE KEY uq_usuarios_usuario (usuario)',
  'SELECT "el índice único de usuario ya existía"');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- El correo pasa a ser opcional: ya no hay que inventar correos ficticios
ALTER TABLE usuarios
  MODIFY COLUMN email VARCHAR(150) NULL;

-- Rol nuevo: VISTA (solo consulta)
ALTER TABLE usuarios
  MODIFY COLUMN rol ENUM('ADMIN','OPERADOR','VISTA') NOT NULL DEFAULT 'OPERADOR';

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMP NULL;

-- ---------------------------------------------------------------------------
-- 2) Anulación de movimientos
--
-- Un movimiento nunca se borra. Se marca como anulado y se crea un
-- contra-movimiento que apunta a él; los dos quedan visibles pero ninguno
-- cuenta para la existencia.
-- ---------------------------------------------------------------------------

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anula_movimiento_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS anulado_por_usuario_id INT NULL,
  ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS motivo_anulacion VARCHAR(200) NULL;

-- ---------------------------------------------------------------------------
-- 3) Índices que faltaban
--
-- El filtro por rango de fechas recorría la tabla entera, y el consumo por
-- orden de trabajo no tenía por dónde buscar.
-- ---------------------------------------------------------------------------

ALTER TABLE movimientos
  ADD INDEX IF NOT EXISTS idx_mov_fecha (fecha),
  ADD INDEX IF NOT EXISTS idx_mov_ot (ot),
  ADD INDEX IF NOT EXISTS idx_mov_anulado (anulado);

ALTER TABLE rollos
  ADD INDEX IF NOT EXISTS idx_rollos_ancho (ancho);

-- ---------------------------------------------------------------------------
-- 4) Pulgada como unidad de medida
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO unidades_medida (codigo, nombre) VALUES ('PULGADA', 'Pulgada');

-- ---------------------------------------------------------------------------
-- 5) Traslados viejos que sí descontaron
--
-- Antes "Traslado entre bodegas" era una SALIDA y restaba existencia, aunque
-- el material no se hubiera consumido: solo había cambiado de lugar. Esto
-- muestra cuáles hay, si es que hay alguno. Revísalos y anúlalos desde la
-- aplicación (Movimientos → abrir el movimiento → Anular), que deja el
-- rastro correcto.
-- ---------------------------------------------------------------------------

SELECT mv.id, m.codigo, mv.cantidad, mv.fecha, mv.quien
  FROM movimientos mv
  JOIN materiales m ON m.id = mv.material_id
 WHERE mv.movimiento_detalle = 'TRASLADO_ENTRE_BODEGAS'
   AND mv.anulado = FALSE;

-- ---------------------------------------------------------------------------
-- 6) Comprobación final
-- ---------------------------------------------------------------------------

SELECT usuario, nombre, rol, activo FROM usuarios ORDER BY id;

-- Listo. Reinicia el backend (npm start) después de correr esto.
