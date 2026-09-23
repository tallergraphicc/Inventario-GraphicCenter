-- ============================================================================
-- Migración 006 — Láminas (acrílico, MDF, coroplast, caucho, foam, PVC/Sintra)
--
-- Qué agrega:
--   1. Tabla "laminas": cada lámina de 4x8 pies que hay en bodega, una por
--      una, igual que los rollos. De cada una se sabe cuánto le queda.
--   2. En los movimientos:
--        lamina_id → de qué lámina salió el corte
--        medidas   → lo que se cortó, ej. "2 × 12×18 pulg."
--   3. En los materiales: espesor_mm (el espesor de la lámina, en mm).
--   4. La unidad LAMINA, por si no existe.
--
-- Cómo se cuenta: la existencia de un material por láminas se lleva en
-- LÁMINAS EQUIVALENTES de 4x8 pies (48x96 pulg. = 32 pies²).
-- Un corte de 12x12 pulg. es 1 pie² = 0.0313 de lámina. La pantalla muestra
-- siempre las dos cosas: láminas y pies².
--
-- No borra ni cambia nada de lo que ya existe. Las láminas que ya tienes
-- contadas se registran desde la pestaña Láminas con el botón
-- "Crear las láminas" (un clic por material).
--
-- Se puede correr más de una vez sin problema.
--
-- Cómo correrla en la VM (desde la carpeta Inventario):
--   sudo mysqldump graphic_center_inventario > ~/respaldo-antes-006.sql
--   sudo mysql graphic_center_inventario < database/migracion-006-laminas.sql
-- ============================================================================

INSERT IGNORE INTO unidades_medida (codigo, nombre) VALUES ('LAMINA', 'Lámina');

ALTER TABLE materiales
  ADD COLUMN IF NOT EXISTS espesor_mm DECIMAL(6,2) NULL AFTER ubicacion;

CREATE TABLE IF NOT EXISTS laminas (
  id VARCHAR(60) PRIMARY KEY,                      -- ej. "ACR-NEG-3MM-L01"
  material_id INT NOT NULL,
  -- Cuánto era la lámina al registrarla, en láminas equivalentes:
  -- 1 = una lámina completa de 4x8. Un pedazo de 24x48 pulg. = 0.25.
  -- Lo que le queda NUNCA se guarda: se calcula (tamaño - cortes).
  tamano DECIMAL(12,4) NOT NULL,
  ancho DECIMAL(10,2) NULL,                        -- pulgadas (48 en una completa)
  alto DECIMAL(10,2) NULL,                         -- pulgadas (96 en una completa)
  -- "Terminada" = ya solo le quedan retazos (pedazos de menos de 12x12 pulg.).
  -- Lo que queda sigue contando en la existencia, pero aparte, como retazos.
  terminada BOOLEAN NOT NULL DEFAULT FALSE,
  bodega_id INT NULL,
  ubicacion VARCHAR(100) NULL,
  origen VARCHAR(30) NULL,                         -- 'entrada' | 'existente' | 'conteo'
  movimiento_origen_id BIGINT NULL,                -- la entrada o el ajuste que la creó
  activo BOOLEAN NOT NULL DEFAULT TRUE,            -- eliminar la desactiva, nunca borra la fila
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materiales(id),
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  INDEX idx_laminas_material (material_id, activo),
  INDEX idx_laminas_origen (movimiento_origen_id)
) ENGINE=InnoDB;

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS lamina_id VARCHAR(60) NULL AFTER rollo_id,
  ADD COLUMN IF NOT EXISTS medidas VARCHAR(200) NULL AFTER lamina_id;

ALTER TABLE movimientos
  ADD CONSTRAINT fk_mov_lamina FOREIGN KEY IF NOT EXISTS (lamina_id) REFERENCES laminas(id);

ALTER TABLE movimientos
  ADD INDEX IF NOT EXISTS idx_mov_lamina (lamina_id);

-- Verificación: tiene que mostrar la tabla laminas y las columnas nuevas
SELECT 'laminas' AS tabla_nueva, COUNT(*) AS filas FROM laminas;
SELECT COLUMN_NAME AS columna_nueva
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'movimientos' AND COLUMN_NAME IN ('lamina_id', 'medidas'))
    OR (TABLE_NAME = 'materiales' AND COLUMN_NAME = 'espesor_mm'));

-- Materiales que hoy están en la unidad LAMINA (son los que usan la pestaña Láminas)
SELECT m.codigo, m.descripcion
FROM materiales m JOIN unidades_medida u ON u.id = m.unidad_id
WHERE u.codigo = 'LAMINA' AND m.activo = TRUE
ORDER BY m.codigo;
