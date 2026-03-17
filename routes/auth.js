// routes/auth.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, senha_hash } = req.body;
  if (!email || !senha_hash) return res.status(400).json({ error: 'email e senha_hash obrigatórios' });

  const user = db.prepare(
    'SELECT * FROM usuarios WHERE email = ? AND senha_hash = ? AND ativo = 1'
  ).get(email.toLowerCase().trim(), senha_hash);

  if (!user) return res.json({ data: null, error: { message: 'E-mail ou senha incorretos.' } });

  // Verifica expiração
  if (user.plano_expiracao) {
    const exp = new Date(user.plano_expiracao);
    exp.setHours(23, 59, 59);
    if (exp < new Date()) {
      return res.json({ data: null, error: { message: 'Plano expirado em ' + exp.toLocaleDateString('pt-BR') } });
    }
  }

  // Atualiza último acesso
  db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?')
    .run(new Date().toISOString(), user.id);

  // Remove senha antes de retornar
  const { senha_hash: _, ...userData } = user;
  res.json({ data: userData, error: null });
});

// GET /api/auth/me/:id
router.get('/me/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(req.params.id);
  if (!user) return res.json({ data: null, error: { message: 'Sessão inválida' } });
  if (user.plano_expiracao) {
    const exp = new Date(user.plano_expiracao);
    exp.setHours(23, 59, 59);
    if (exp < new Date()) return res.json({ data: null, error: { message: 'Plano expirado' } });
  }
  const { senha_hash: _, ...userData } = user;
  res.json({ data: userData, error: null });
});

// POST /api/auth/usuario (criar novo usuário — apenas admin)
router.post('/usuario', (req, res) => {
  const { nome, email, senha_hash, perfil, loja_token, plano_expiracao } = req.body;
  if (!nome || !email || !senha_hash) return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  if (existe) return res.json({ data: null, error: { message: 'E-mail já cadastrado.' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, ativo, loja_token, plano_expiracao)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, nome, email.toLowerCase().trim(), senha_hash, perfil || 'operador', loja_token || 'padrao', plano_expiracao || null);
  res.json({ data: { id, nome, email, perfil, loja_token }, error: null });
});

module.exports = router;
