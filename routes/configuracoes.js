// routes/configuracoes.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET /api/configuracoes?loja_token=xxx
// GET /api/configuracoes?loja_token=xxx&chave=tema
// GET /api/configuracoes?loja_token=xxx&in=nome_loja,slogan,logo_url
router.get('/', (req, res) => {
  const { loja_token, chave, in: inParam } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });

  let rows;
  if (chave) {
    rows = db.prepare('SELECT * FROM configuracoes WHERE loja_token = ? AND chave = ?').all(loja_token, chave);
  } else if (inParam) {
    const chaves = inParam.split(',').map(c => c.trim());
    const placeholders = chaves.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM configuracoes WHERE loja_token = ? AND chave IN (${placeholders})`).all(loja_token, ...chaves);
  } else {
    rows = db.prepare('SELECT * FROM configuracoes WHERE loja_token = ?').all(loja_token);
  }
  res.json({ data: rows, error: null });
});

// POST /api/configuracoes/upsert  (upsert por chave+loja_token)
router.post('/upsert', (req, res) => {
  const { chave, valor, loja_token } = req.body;
  if (!chave || valor === undefined) return res.json({ data: null, error: { message: 'chave e valor obrigatórios' } });
  const token = loja_token || 'padrao';
  const now   = new Date().toISOString();

  const existe = db.prepare('SELECT id FROM configuracoes WHERE chave = ? AND loja_token = ?').get(chave, token);
  if (existe) {
    db.prepare('UPDATE configuracoes SET valor = ?, updated_at = ? WHERE chave = ? AND loja_token = ?').run(String(valor), now, chave, token);
  } else {
    db.prepare('INSERT INTO configuracoes (id, chave, valor, loja_token, updated_at) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), chave, String(valor), token, now);
  }
  res.json({ data: { chave, valor, loja_token: token }, error: null });
});

// POST /api/configuracoes/upsert-batch  (múltiplos upserts de uma vez)
router.post('/upsert-batch', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const now = new Date().toISOString();
  const upsertOne = db.transaction((lista) => {
    for (const { chave, valor, loja_token } of lista) {
      const token = loja_token || 'padrao';
      const existe = db.prepare('SELECT id FROM configuracoes WHERE chave = ? AND loja_token = ?').get(chave, token);
      if (existe) {
        db.prepare('UPDATE configuracoes SET valor = ?, updated_at = ? WHERE chave = ? AND loja_token = ?').run(String(valor), now, chave, token);
      } else {
        db.prepare('INSERT INTO configuracoes (id, chave, valor, loja_token, updated_at) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), chave, String(valor), token, now);
      }
    }
  });
  upsertOne(items);
  res.json({ data: items, error: null });
});

module.exports = router;
