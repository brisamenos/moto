// routes/auth.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');
const { criarSessao, planoExpirado } = require('../middleware/auth');

function limpar(user) {
  const { senha_hash, senha_texto, ...rest } = user;
  return rest;
}

// POST /api/auth/login  (público)
router.post('/login', (req, res) => {
  const { email, senha_hash } = req.body || {};
  if (!email || !senha_hash) return res.status(400).json({ data: null, error: { message: 'Informe e-mail e senha.' } });

  const user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND senha_hash = ?')
    .get(String(email).toLowerCase().trim(), senha_hash);

  if (!user) return res.json({ data: null, error: { message: 'E-mail ou senha incorretos.' } });
  if (!user.ativo) return res.json({ data: null, error: { message: 'Acesso bloqueado. Entre em contato com o suporte.' } });

  if (user.perfil !== 'superadmin' && planoExpirado(user)) {
    const d = String(user.plano_expiracao).slice(0, 10).split('-').reverse().join('/');
    return res.json({ data: null, error: { message: 'Seu plano venceu em ' + d + '. Entre em contato para renovar.' } });
  }

  db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  const token = criarSessao(user.id);
  res.json({ data: { ...limpar(user), token }, error: null });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(req.token);
  res.json({ data: { ok: true }, error: null });
});

// GET /api/auth/me  e  /api/auth/me/:id  — devolve o usuário do token
router.get(['/me', '/me/:id'], (req, res) => {
  res.json({ data: req.usuario, error: null });
});

// POST /api/auth/usuario (apenas super admin — protegido no middleware)
router.post('/usuario', (req, res) => {
  const { nome, email, senha_hash, perfil, loja_token, plano_expiracao } = req.body;
  if (!nome || !email || !senha_hash) return res.status(400).json({ data: null, error: { message: 'Campos obrigatórios faltando' } });
  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  if (existe) return res.json({ data: null, error: { message: 'E-mail já cadastrado.' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, ativo, loja_token, plano_expiracao)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, nome, email.toLowerCase().trim(), senha_hash, perfil || 'operador', loja_token || 'padrao', plano_expiracao || null);
  res.json({ data: { id, nome, email, perfil, loja_token }, error: null });
});

module.exports = router;
