// routes/vendas.js
const express = require('express');
const router  = express.Router();
const { db, proximoNumeroVenda } = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET /api/vendas?loja_token=xxx&gte=2024-01-01T00:00:00&lte=...&limit=100
router.get('/', (req, res) => {
  const { loja_token, gte, lte, limit } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });

  let sql = 'SELECT * FROM vendas WHERE loja_token = ?';
  const params = [loja_token];

  if (gte) { sql += ' AND created_at >= ?'; params.push(gte); }
  if (lte) { sql += ' AND created_at <= ?'; params.push(lte); }
  sql += ' ORDER BY created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

// POST /api/vendas  (cria venda + itens em transação)
router.post('/', (req, res) => {
  const v = req.body;
  if (!v.loja_token) return res.json({ data: null, error: { message: 'loja_token obrigatório' } });

  const id = uuidv4();
  const numero = proximoNumeroVenda(v.loja_token);

  const inserir = db.transaction(() => {
    db.prepare(`INSERT INTO vendas (id, numero, cliente, total, desconto, forma_pagamento, status, loja_token)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, numero, v.cliente || 'Consumidor', Number(v.total) || 0, Number(v.desconto) || 0,
          v.forma_pagamento || 'dinheiro', v.status || 'pago', v.loja_token);
    return db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  });

  const row = inserir();
  res.json({ data: row, error: null });
});

// GET /api/venda_itens?loja_token=xxx
router.get('/itens', (req, res) => {
  const { loja_token } = req.query;
  const rows = db.prepare('SELECT * FROM venda_itens WHERE loja_token = ? ORDER BY created_at DESC').all(loja_token || 'padrao');
  res.json({ data: rows, error: null });
});

// POST /api/venda_itens  (batch insert)
router.post('/itens', (req, res) => {
  const itens = Array.isArray(req.body) ? req.body : [req.body];
  const inserirItens = db.transaction((lista) => {
    for (const i of lista) {
      db.prepare(`INSERT INTO venda_itens (id, venda_id, produto_id, nome_produto, preco, quantidade, total, loja_token)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), i.venda_id, i.produto_id || null, i.nome_produto, Number(i.preco) || 0,
            Number(i.quantidade) || 1, Number(i.total) || 0, i.loja_token || 'padrao');
    }
  });
  inserirItens(itens);
  res.json({ data: itens, error: null });
});

module.exports = router;
