// routes/caixa.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// Categorias válidas para entrada
const CATS_ENTRADA = ['Vendas','Serviços','Aluguel','Empréstimo','Outros'];
// Categorias válidas para saída
const CATS_SAIDA   = ['Fornecedor','Retirada','Despesa Fixa','Despesa Variável','Funcionários','Outros'];

// GET /api/caixa/lancamentos?loja_token=xxx&data=2024-01-15&categoria=Vendas
router.get('/lancamentos', (req, res) => {
  const { loja_token, data, categoria } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  let sql = 'SELECT * FROM caixa_lancamentos WHERE loja_token = ?';
  const params = [loja_token];
  if (data)      { sql += ' AND data = ?';       params.push(data); }
  if (categoria) { sql += ' AND categoria = ?';  params.push(categoria); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

// POST /api/caixa/lancamentos
router.post('/lancamentos', (req, res) => {
  const l = req.body;
  if (!l.tipo || !l.valor) return res.json({ data: null, error: { message: 'tipo e valor obrigatórios' } });
  const id  = uuidv4();
  const now = new Date();
  const hora = l.hora || now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const data = l.data || now.toISOString().split('T')[0];
  const cat  = l.categoria || 'Geral';
  db.prepare(`INSERT INTO caixa_lancamentos (id, tipo, descricao, categoria, forma_pagamento, valor, data, hora, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, l.tipo, l.descricao || '', cat, l.forma_pagamento || 'dinheiro',
         Number(l.valor), data, hora, l.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM caixa_lancamentos WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

// DELETE /api/caixa/lancamentos/:id
router.delete('/lancamentos/:id', (req, res) => {
  db.prepare('DELETE FROM caixa_lancamentos WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// GET categorias disponíveis
router.get('/categorias', (req, res) => {
  res.json({ data: { entrada: CATS_ENTRADA, saida: CATS_SAIDA }, error: null });
});

// ── SESSÕES ──────────────────────────────────────────────────────────────────

router.get('/sessoes', (req, res) => {
  const { loja_token, limit } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  let sql = 'SELECT * FROM caixa_sessoes WHERE loja_token = ? ORDER BY updated_at DESC';
  const params = [loja_token];
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

router.post('/sessoes', (req, res) => {
  const s  = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO caixa_sessoes (id, status, valor_abertura, operador, abertura_at, fechamento_at, loja_token, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.status || 'fechado', Number(s.valor_abertura) || 0, s.operador || 'Admin',
         s.abertura_at || null, s.fechamento_at || null, s.loja_token || 'padrao', new Date().toISOString());
  const row = db.prepare('SELECT * FROM caixa_sessoes WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

router.put('/sessoes/:id', (req, res) => {
  const s = req.body;
  const { id } = req.params;
  db.prepare(`UPDATE caixa_sessoes SET status=?, valor_abertura=?, abertura_at=?, fechamento_at=?, updated_at=? WHERE id=?`)
    .run(s.status, Number(s.valor_abertura) || 0, s.abertura_at || null, s.fechamento_at || null, new Date().toISOString(), id);
  res.json({ data: { id }, error: null });
});

module.exports = router;
