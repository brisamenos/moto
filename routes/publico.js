// routes/publico.js
// Rotas públicas (sem login) usadas pelo catálogo e pela tela de login.
// Retornam só dados seguros — nunca custo, tokens do Telegram etc.
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');

const CHAVES_PUBLICAS = ['nome_loja', 'slogan', 'logo_url', 'telefone', 'tema', 'endereco'];

// GET /api/publico/configuracoes?loja_token=xxx
router.get('/configuracoes', (req, res) => {
  const loja = String(req.query.loja_token || 'padrao');
  const marks = CHAVES_PUBLICAS.map(() => '?').join(',');
  const rows = db.prepare(`SELECT chave, valor FROM configuracoes WHERE loja_token = ? AND chave IN (${marks})`)
    .all(loja, ...CHAVES_PUBLICAS);
  res.json({ data: rows, error: null });
});

// GET /api/publico/produtos?loja_token=xxx
router.get('/produtos', (req, res) => {
  const loja = String(req.query.loja_token || 'padrao');
  const rows = db.prepare('SELECT * FROM produtos WHERE loja_token = ? ORDER BY nome').all(loja)
    .map(({ custo, fornecedor_id, ...p }) => p);
  res.json({ data: rows, error: null });
});

module.exports = router;
