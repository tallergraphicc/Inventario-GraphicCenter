const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/usuarios.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);

// Cualquiera con sesión: necesita la lista de admins para el campo "Autoriza".
router.get('/autorizadores', ctrl.autorizadores);

// El resto es solo de administradores.
router.get('/', requireAdmin, ctrl.listar);
router.post('/', requireAdmin, ctrl.crear);
router.put('/:id', requireAdmin, ctrl.actualizar);
router.put('/:id/password', requireAdmin, ctrl.restablecerPassword);
router.delete('/:id', requireAdmin, ctrl.desactivar);

module.exports = router;
