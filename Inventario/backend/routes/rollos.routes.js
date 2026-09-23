const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rollos.controller');
const { requireAuth, requireAdmin, requireEscritura } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', ctrl.listar);
router.get('/exportar.csv', ctrl.exportarCsv);
router.get('/siguiente-id', ctrl.siguienteId);

router.post('/', requireEscritura, ctrl.crear);
router.put('/:id', requireEscritura, ctrl.actualizar);

// Eliminar un rollo es solo de administradores.
router.delete('/:id', requireAdmin, ctrl.eliminar);

module.exports = router;
