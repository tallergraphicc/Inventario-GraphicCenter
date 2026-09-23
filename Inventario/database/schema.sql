-- ============================================================================
-- Graphic Center — Sistema de Inventario
-- Esquema de base de datos (MariaDB 10.4+ / MySQL 8+)
-- ============================================================================

-- Los acentos se guardan bien aunque la terminal esté en otro idioma
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS graphic_center_inventario
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE graphic_center_inventario;

-- ---------------------------------------------------------------------------
-- Catálogos base
-- ---------------------------------------------------------------------------

CREATE TABLE categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE subcategorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoria_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_subcat (categoria_id, nombre),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE unidades_medida (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(60) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE bodegas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE areas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- A quién se le compra. Se administra en Configuración.
CREATE TABLE proveedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Usuarios (login básico)
-- ---------------------------------------------------------------------------

CREATE TABLE usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(40) NOT NULL UNIQUE,              -- con esto se entra (no correo)
  nombre VARCHAR(100) NOT NULL,                     -- el nombre que se ve en pantalla
  email VARCHAR(150) NULL UNIQUE,                   -- opcional, para avisos a futuro
  password_hash VARCHAR(255) NOT NULL,
  -- ADMIN    = todo, incluye anular movimientos y eliminar
  -- OPERADOR = registra movimientos y edita, pero no elimina ni anula
  -- VISTA    = solo consulta, no puede escribir nada
  rol ENUM('ADMIN','OPERADOR','VISTA') NOT NULL DEFAULT 'OPERADOR',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE,
  ultimo_acceso TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Materiales
-- ---------------------------------------------------------------------------

CREATE TABLE materiales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL,
  categoria_id INT NOT NULL,
  subcategoria_id INT NULL,
  unidad_id INT NOT NULL,
  bodega_id INT NULL,
  ubicacion VARCHAR(100) NULL,
  espesor_mm DECIMAL(6,2) NULL,                   -- láminas: el espesor en milímetros
  inventario_inicial DECIMAL(12,4) NULL,          -- NULL = "por confirmar", NUNCA 0 por defecto
  precision_inicial ENUM('EXACTO','ESTIMADO','POR_CONFIRMAR') NOT NULL DEFAULT 'POR_CONFIRMAR',
  stock_minimo DECIMAL(12,4) NULL,
  costo DECIMAL(12,4) NULL,
  observaciones TEXT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id),
  FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id),
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Rollos (viniles, banners, lonas por pie/metro lineal)
-- ---------------------------------------------------------------------------

CREATE TABLE rollos (
  id VARCHAR(60) PRIMARY KEY,                      -- ej. "VIN-BRI-001-R01"
  material_id INT NOT NULL,
  ancho DECIMAL(10,2) NULL,                        -- pulgadas: 2 decimales alcanzan
  largo DECIMAL(12,4) NULL,                        -- misma precisión que movimientos.cantidad; el restante SIEMPRE se calcula
  estado ENUM('SELLADO','ABIERTO','AGOTADO','POR_CONFIRMAR') NOT NULL DEFAULT 'POR_CONFIRMAR',
  precision_medida ENUM('EXACTO','ESTIMADO','POR_CONFIRMAR') NOT NULL DEFAULT 'POR_CONFIRMAR',
  bodega_id INT NULL,
  ubicacion VARCHAR(100) NULL,
  origen VARCHAR(30) NULL,                          -- 'inicial' | 'entrada'
  activo BOOLEAN NOT NULL DEFAULT TRUE,             -- eliminar un rollo lo desactiva, nunca borra la fila
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materiales(id),
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  INDEX idx_rollos_material (material_id, activo),
  INDEX idx_rollos_ancho (ancho)        -- para buscar "¿tengo un rollo de 60 pulgadas?"
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Láminas (acrílico, MDF, coroplast, caucho, foam board, PVC espumoso)
--
-- Cada lámina de 4x8 pies, una por una. La existencia del material se lleva
-- en láminas equivalentes: 1 = una lámina de 48x96 pulg. (32 pies²).
-- ---------------------------------------------------------------------------

CREATE TABLE laminas (
  id VARCHAR(60) PRIMARY KEY,                      -- ej. "ACR-NEG-3MM-L01"
  material_id INT NOT NULL,
  tamano DECIMAL(12,4) NOT NULL,                   -- láminas equivalentes al registrarla; lo que queda se calcula
  ancho DECIMAL(10,2) NULL,                        -- pulgadas
  alto DECIMAL(10,2) NULL,                         -- pulgadas
  terminada BOOLEAN NOT NULL DEFAULT FALSE,        -- ya solo le quedan retazos (< 12x12 pulg.)
  bodega_id INT NULL,
  ubicacion VARCHAR(100) NULL,
  origen VARCHAR(30) NULL,                         -- 'entrada' | 'existente' | 'conteo'
  movimiento_origen_id BIGINT NULL,                -- la entrada o el ajuste que la creó
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materiales(id),
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  INDEX idx_laminas_material (material_id, activo),
  INDEX idx_laminas_origen (movimiento_origen_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Movimientos — histórico, nunca se sobrescribe
-- ---------------------------------------------------------------------------

CREATE TABLE movimientos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  tipo ENUM('ENTRADA','SALIDA','MERMA','AJUSTE') NOT NULL,
  cantidad DECIMAL(12,4) NOT NULL,
  unidad_id INT NOT NULL,
  fecha DATE NOT NULL,
  rollo_id VARCHAR(60) NULL,
  lamina_id VARCHAR(60) NULL,                       -- de qué lámina salió el corte
  medidas VARCHAR(200) NULL,                        -- lo cortado, ej. "2 × 12×18 pulg."
  movimiento_detalle VARCHAR(60) NULL,              -- ej. COMPRA, PRODUCCION, TRASLADO...
  ot VARCHAR(40) NULL,
  cotizacion VARCHAR(40) NULL,
  cliente VARCHAR(120) NULL,
  proyecto VARCHAR(120) NULL,
  area_id INT NULL,
  bodega_id INT NULL,
  proveedor_id INT NULL,                            -- entradas: a quién se le compró
  documento_tipo VARCHAR(20) NULL,                  -- FACTURA | COTIZACION | OTRO
  documento_numero VARCHAR(60) NULL,                -- N° de la factura o cotización
  motivo VARCHAR(120) NULL,
  costo_unitario DECIMAL(12,4) NULL,
  descuenta BOOLEAN NOT NULL DEFAULT TRUE,           -- para casos especiales (reservado a futuro: retazos)
  quien VARCHAR(100) NULL,
  entrega VARCHAR(100) NULL,
  autoriza VARCHAR(100) NULL,
  forzado_negativo BOOLEAN NOT NULL DEFAULT FALSE,
  observaciones TEXT NULL,
  usuario_id INT NULL,
  -- Anulación: nunca se borra un movimiento. El original queda marcado y se
  -- crea un contra-movimiento que apunta a él. Los dos quedan a la vista.
  anulado BOOLEAN NOT NULL DEFAULT FALSE,
  anula_movimiento_id BIGINT NULL,                  -- si este movimiento anula a otro
  anulado_por_usuario_id INT NULL,
  anulado_en TIMESTAMP NULL,
  motivo_anulacion VARCHAR(200) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materiales(id),
  FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id),
  FOREIGN KEY (rollo_id) REFERENCES rollos(id),
  CONSTRAINT fk_mov_lamina FOREIGN KEY (lamina_id) REFERENCES laminas(id),
  FOREIGN KEY (area_id) REFERENCES areas(id),
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  CONSTRAINT fk_mov_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (anula_movimiento_id) REFERENCES movimientos(id),
  FOREIGN KEY (anulado_por_usuario_id) REFERENCES usuarios(id),
  INDEX idx_mov_material (material_id, fecha),
  INDEX idx_mov_rollo (rollo_id),
  INDEX idx_mov_lamina (lamina_id),
  INDEX idx_mov_tipo (tipo),
  INDEX idx_mov_fecha (fecha),                      -- filtro global por rango de fechas
  INDEX idx_mov_ot (ot),                            -- consumo por orden de trabajo
  INDEX idx_mov_proveedor (proveedor_id, fecha),    -- compras por proveedor y mes
  INDEX idx_mov_anulado (anulado)
) ENGINE=InnoDB;
