// routes/clientes.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET /api/clientes?loja_token=xxx
router.get('/', (req, res) => {
  const { loja_token } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  const rows = db.prepare('SELECT * FROM clientes WHERE loja_token = ? ORDER BY nome').all(loja_token);
  res.json({ data: rows, error: null });
});

// POST /api/clientes
router.post('/', (req, res) => {
  const c = req.body;
  if (!c.nome) return res.json({ data: null, error: { message: 'nome obrigatório' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO clientes (id, nome, telefone, cpf_cnpj, email, endereco, cidade, obs, total_compras, total_gasto, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, c.nome, c.telefone || '', c.cpf_cnpj || '', c.email || '', c.endereco || '',
        c.cidade || '', c.obs || '', Number(c.total_compras) || 0, Number(c.total_gasto) || 0, c.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

// PUT /api/clientes/:id
router.put('/:id', (req, res) => {
  const c = req.body;
  const { id } = req.params;
  db.prepare(`UPDATE clientes SET nome=?, telefone=?, cpf_cnpj=?, email=?, endereco=?, cidade=?, obs=?,
              total_compras=?, total_gasto=? WHERE id=?`
  ).run(c.nome, c.telefone || '', c.cpf_cnpj || '', c.email || '', c.endereco || '',
        c.cidade || '', c.obs || '', Number(c.total_compras) || 0, Number(c.total_gasto) || 0, id);
  res.json({ data: { id }, error: null });
});

// DELETE /api/clientes/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

module.exports = router;
