const path = require('path');
// El .env vive en la carpeta Inventario: se carga con su ruta exacta para que
// el servidor arranque igual desde cualquier carpeta.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Hora de Panamá para TODO el sistema (fechas de movimientos, nombres de los
// archivos de bitácora). Sin esto, corriendo como servicio, lo que se
// registraba después de las 7 de la noche quedaba con la fecha de mañana.
process.env.TZ = process.env.TZ || 'America/Panama';

const express = require('express');

const { errorHandler } = require('./middleware/errorHandler');

const log = require('./config/log');

const authRoutes = require('./routes/auth.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const materialesRoutes = require('./routes/materiales.routes');
const movimientosRoutes = require('./routes/movimientos.routes');
const rollosRoutes = require('./routes/rollos.routes');
const laminasRoutes = require('./routes/laminas.routes');
const catalogosRoutes = require('./routes/catalogos.routes');

const app = express();

// No se anuncia con qué está hecho el servidor
app.disable('x-powered-by');

// Cabeceras de seguridad básicas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Antes estaba abierto a cualquier sitio web (cors()): una página cualquiera
// que abriera un empleado podía hablarle a este servidor desde su navegador.
// La pantalla del inventario se sirve desde aquí mismo, así que no hace falta.
app.use(express.json({ limit: '1mb' }));

// Los formularios mandan textos, números y sí/no. Un objeto o una lista donde
// va un texto (ej. observaciones: {...}) se guardaba como "[object Object]"
// o tumbaba el servidor. Las únicas listas que se esperan son las piezas de
// un corte de lámina y las filas de una importación de materiales.
const LISTAS_PERMITIDAS = new Set(['piezas', 'materiales']);
app.use((req, res, next) => {
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    for (const [campo, valor] of Object.entries(b)) {
      if (valor !== null && typeof valor === 'object' && !LISTAS_PERMITIDAS.has(campo)) {
        return res.status(400).json({ error: `El dato "${campo.slice(0, 40)}" no tiene un formato válido.` });
      }
    }
  } else if (Array.isArray(b)) {
    return res.status(400).json({ error: 'La solicitud no es válida.' });
  }
  next();
});


// =====================================================
// API
// =====================================================

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/materiales', materialesRoutes);
app.use('/api/movimientos', movimientosRoutes);
app.use('/api/rollos', rollosRoutes);
app.use('/api/laminas', laminasRoutes);
app.use('/api/catalogos', catalogosRoutes);


// =====================================================
// RUTAS DE CARPETAS
// =====================================================

// /home/graphic-center-plus/Documentos/GCPlus/Inventario/frontend
const frontendPath = path.join(__dirname, '..', 'frontend');

// /home/graphic-center-plus/Documentos/GCPlus/css
const cssPath = path.join(__dirname, '..', '..', 'css');

// /home/graphic-center-plus/Documentos/GCPlus/assets
const assetsPath = path.join(__dirname, '..', '..', 'assets');


// =====================================================
// ARCHIVOS ESTÁTICOS
// =====================================================

// dotfiles: 'deny' → nunca se sirven archivos ocultos (.env, .git...)
const opcionesEstaticas = { dotfiles: 'deny' };

// Frontend del inventario
app.use(express.static(frontendPath, opcionesEstaticas));

// CSS compartido de Graphic Center
app.use('/css', express.static(cssPath, opcionesEstaticas));

// Imágenes y otros recursos compartidos
app.use('/assets', express.static(assetsPath, opcionesEstaticas));


// =====================================================
// FRONTEND DEL INVENTARIO
// =====================================================

// Cualquier ruta de API que no exista devuelve JSON, no la página del frontend
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta de API no encontrada.' });
});

app.get('*', (req, res) => {
  // El archivo se llama index.html — antes aquí decía 'inventario-index.html',
  // que no existe: recargar la página en cualquier ruta que no fuera la raíz
  // terminaba en un error de servidor.
  res.sendFile(path.join(frontendPath, 'index.html'));
});


// =====================================================
// MANEJO DE ERRORES
// =====================================================

app.use(errorHandler);


// =====================================================
// SERVIDOR
// =====================================================

const PORT = process.env.PORT || 4000;

// Sin estos datos el sistema arranca pero nadie puede entrar y no se ve por
// qué. Mejor decirlo de una vez y no arrancar.
const faltan = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'].filter((v) => !process.env[v]);
if (faltan.length) {
  console.error(`\nFalta configurar en el archivo Inventario/.env: ${faltan.join(', ')}.\n`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  log.aviso('la clave JWT_SECRET es corta; conviene una de al menos 32 caracteres (openssl rand -hex 32)');
}

log.limpiarViejos();
// Y una vez al día, para que un servidor que no se apaga nunca igual limpie
setInterval(log.limpiarViejos, 24 * 60 * 60 * 1000).unref();

app.listen(PORT, '0.0.0.0', () => {
  log.info('servidor iniciado', { puerto: PORT, logs: log.CARPETA });
  console.log(`Graphic Center — Inventario corriendo en el puerto ${PORT}`);
  console.log(`Bitácora en ${log.CARPETA}`);
});
