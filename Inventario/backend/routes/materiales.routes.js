const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/materiales.controller');
const { requireAuth, requireAdmin, requireEscritura } = require('../middleware/auth');

router.use(requireAuth);

// Consulta: cualquiera con sesión, incluido el rol VISTA.
router.get('/', ctrl.listar);
router.get('/exportar.csv', ctrl.exportarCsv);
router.get('/:id', ctrl.obtener);

// Escritura: operador y admin. VISTA no pasa de aquí.
router.post('/', requireEscritura, ctrl.crear);
router.post('/importar', requireEscritura, ctrl.importar);
router.put('/:id', requireEscritura, ctrl.actualizar);

// Eliminar un material es solo de administradores.
router.delete('/:id', requireAdmin, ctrl.eliminar);

module.exports = router;
