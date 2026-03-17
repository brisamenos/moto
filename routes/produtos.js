// routes/produtos.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET /api/produtos?loja_token=xxx
router.get('/', (req, res) => {
  const { loja_token } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  const rows = db.prepare('SELECT * FROM produtos WHERE loja_token = ? ORDER BY nome').all(loja_token);
  res.json({ data: rows, error: null });
});

// POST /api/produtos
router.post('/', (req, res) => {
  const p = req.body;
  if (!p.nome || !p.sku) return res.json({ data: null, error: { message: 'nome e sku obrigatórios' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO produtos (id, sku, nome, categoria, marca, custo, preco_venda, estoque, estoque_minimo, imagem_url, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, p.sku, p.nome, p.categoria || 'Geral', p.marca || '', Number(p.custo) || 0,
        Number(p.preco_venda) || 0, Number(p.estoque) || 0, Number(p.estoque_minimo) || 5,
        p.imagem_url || null, p.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

// PUT /api/produtos/:id
router.put('/:id', (req, res) => {
  const p = req.body;
  const { id } = req.params;
  db.prepare(`UPDATE produtos SET sku=?, nome=?, categoria=?, marca=?, custo=?, preco_venda=?,
              estoque=?, estoque_minimo=?, imagem_url=? WHERE id=?`
  ).run(p.sku, p.nome, p.categoria || 'Geral', p.marca || '', Number(p.custo) || 0,
        Number(p.preco_venda) || 0, Number(p.estoque) || 0, Number(p.estoque_minimo) || 5,
        p.imagem_url || null, id);
  res.json({ data: { id }, error: null });
});

// PATCH /api/produtos/:id  (atualização parcial — ex: só estoque)
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const allowed = ['sku','nome','categoria','marca','custo','preco_venda','estoque','estoque_minimo','imagem_url'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(k + ' = ?'); vals.push(fields[k]); }
  }
  if (!sets.length) return res.json({ data: null, error: { message: 'Nada para atualizar' } });
  vals.push(id);
  db.prepare('UPDATE produtos SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  res.json({ data: { id }, error: null });
});

// DELETE /api/produtos/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM produtos WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

module.exports = router;
