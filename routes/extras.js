// routes/extras.js  — notas_fiscais, agendamentos, catalogo
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════
// NOTAS FISCAIS
// ═══════════════════════════════════════════

router.get('/notas_fiscais', (req, res) => {
  const { loja_token } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  const rows = db.prepare('SELECT * FROM notas_fiscais WHERE loja_token = ? ORDER BY emissao DESC').all(loja_token);
  res.json({ data: rows, error: null });
});

router.post('/notas_fiscais', (req, res) => {
  const n = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO notas_fiscais (id, numero, tipo, natureza, destinatario, cpf_cnpj, produtos, valor, forma_pagamento, obs, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, n.numero || '', n.tipo || 'NF-e', n.natureza || '', n.destinatario || '',
        n.cpf_cnpj || '', n.produtos || '', Number(n.valor) || 0,
        n.forma_pagamento || '', n.obs || '', n.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

router.delete('/notas_fiscais/:id', (req, res) => {
  db.prepare('DELETE FROM notas_fiscais WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// ═══════════════════════════════════════════
// AGENDAMENTOS
// ═══════════════════════════════════════════

router.get('/agendamentos', (req, res) => {
  const { loja_token, status, data_gte, data_lte } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  let sql = 'SELECT * FROM agendamentos WHERE loja_token = ?';
  const params = [loja_token];
  if (status)   { sql += ' AND status = ?';     params.push(status); }
  if (data_gte) { sql += ' AND data_hora >= ?';  params.push(data_gte); }
  if (data_lte) { sql += ' AND data_hora <= ?';  params.push(data_lte); }
  sql += ' ORDER BY data_hora ASC';
  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

router.post('/agendamentos', (req, res) => {
  const a = req.body;
  if (!a.cliente_nome || !a.servico || !a.data_hora)
    return res.json({ data: null, error: { message: 'cliente_nome, servico e data_hora obrigatórios' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO agendamentos (id, cliente_nome, cliente_tel, servico, data_hora, duracao_min, valor, status, obs, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, a.cliente_nome, a.cliente_tel || '', a.servico, a.data_hora,
        Number(a.duracao_min) || 60, Number(a.valor) || 0, a.status || 'agendado',
        a.obs || '', a.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

router.put('/agendamentos/:id', (req, res) => {
  const a = req.body;
  const { id } = req.params;
  db.prepare(`UPDATE agendamentos SET cliente_nome=?, cliente_tel=?, servico=?, data_hora=?,
              duracao_min=?, valor=?, status=?, obs=? WHERE id=?`
  ).run(a.cliente_nome, a.cliente_tel || '', a.servico, a.data_hora,
        Number(a.duracao_min) || 60, Number(a.valor) || 0, a.status || 'agendado', a.obs || '', id);
  res.json({ data: { id }, error: null });
});

router.delete('/agendamentos/:id', (req, res) => {
  db.prepare('DELETE FROM agendamentos WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// ═══════════════════════════════════════════
// CATÁLOGO
// ═══════════════════════════════════════════

router.get('/catalogo', (req, res) => {
  const { loja_token } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  const rows = db.prepare('SELECT * FROM catalogo WHERE loja_token = ? ORDER BY nome').all(loja_token);
  res.json({ data: rows, error: null });
});

router.post('/catalogo', (req, res) => {
  const c = req.body;
  if (!c.nome) return res.json({ data: null, error: { message: 'nome obrigatório' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO catalogo (id, nome, categoria, sku, preco, preco_promo, descricao, imagem_url, visivel, mostrar_estoque, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, c.nome, c.categoria || 'Geral', c.sku || '', Number(c.preco) || 0,
        Number(c.preco_promo) || 0, c.descricao || '', c.imagem_url || '',
        c.visivel !== false ? 1 : 0, c.mostrar_estoque || 'nao', c.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM catalogo WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

router.put('/catalogo/:id', (req, res) => {
  const c = req.body;
  const { id } = req.params;
  db.prepare(`UPDATE catalogo SET nome=?, categoria=?, sku=?, preco=?, preco_promo=?,
              descricao=?, imagem_url=?, visivel=?, mostrar_estoque=? WHERE id=?`
  ).run(c.nome, c.categoria || 'Geral', c.sku || '', Number(c.preco) || 0,
        Number(c.preco_promo) || 0, c.descricao || '', c.imagem_url || '',
        c.visivel !== false ? 1 : 0, c.mostrar_estoque || 'nao', id);
  res.json({ data: { id }, error: null });
});

router.delete('/catalogo/:id', (req, res) => {
  db.prepare('DELETE FROM catalogo WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

module.exports = router;
