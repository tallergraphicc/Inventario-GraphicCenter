const express = require('express');
const router = express.Router();
const { login, yo, cambiarMiPassword } = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

router.post('/login', login);
router.get('/yo', requireAuth, yo);
router.put('/mi-password', requireAuth, cambiarMiPassword);

module.exports = router;
