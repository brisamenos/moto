// routes/orcamentos.js
const express = require('express');
const router  = express.Router();
const { db, proximoNumeroOrcamento, proximoNumeroVenda } = require('./db');
const { v4: uuidv4 } = require('uuid');

// GET /api/orcamentos?loja_token=xxx&status=aberto
router.get('/', (req, res) => {
  const { loja_token, status } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  let sql = 'SELECT * FROM orcamentos WHERE loja_token = ?';
  const params = [loja_token];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

// GET /api/orcamentos/:id  — orçamento com itens
router.get('/:id', (req, res) => {
  const orc = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(req.params.id);
  if (!orc) return res.json({ data: null, error: { message: 'Não encontrado' } });
  const itens = db.prepare('SELECT * FROM orcamento_itens WHERE orcamento_id = ? ORDER BY created_at').all(orc.id);
  res.json({ data: { ...orc, itens }, error: null });
});

// POST /api/orcamentos  — criar orçamento completo (cabeçalho + itens)
router.post('/', (req, res) => {
  const o = req.body;
  if (!o.loja_token) return res.json({ data: null, error: { message: 'loja_token obrigatório' } });
  const id     = uuidv4();
  const numero = proximoNumeroOrcamento(o.loja_token);
  const now    = new Date().toISOString();

  const criar = db.transaction(() => {
    db.prepare(`INSERT INTO orcamentos (id, numero, cliente, cliente_id, validade, desconto, subtotal, total, obs, status, loja_token, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?, ?)`)
      .run(id, numero, o.cliente || '', o.cliente_id || null, o.validade || '3 dias',
           Number(o.desconto) || 0, Number(o.subtotal) || 0, Number(o.total) || 0,
           o.obs || '', o.loja_token, now, now);

    const itens = Array.isArray(o.itens) ? o.itens : [];
    for (const i of itens) {
      db.prepare(`INSERT INTO orcamento_itens (id, orcamento_id, produto_id, nome_produto, preco, quantidade, total, loja_token)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), id, i.produto_id || null, i.nome_produto, Number(i.preco) || 0,
             Number(i.quantidade) || 1, Number(i.total) || 0, o.loja_token);
    }

    // Atualiza histórico do cliente se informado
    if (o.cliente_id) {
      db.prepare(`UPDATE clientes SET total_orcamentos = total_orcamentos + 1, ultimo_orcamento_at = ? WHERE id = ?`)
        .run(now, o.cliente_id);
    }
  });
  criar();

  const row = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
  const itensRow = db.prepare('SELECT * FROM orcamento_itens WHERE orcamento_id = ?').all(id);
  res.json({ data: { ...row, itens: itensRow }, error: null });
});

// PUT /api/orcamentos/:id  — atualizar orçamento (cabeçalho + itens)
router.put('/:id', (req, res) => {
  const o   = req.body;
  const { id } = req.params;
  const now = new Date().toISOString();

  const atualizar = db.transaction(() => {
    db.prepare(`UPDATE orcamentos SET cliente=?, cliente_id=?, validade=?, desconto=?, subtotal=?, total=?, obs=?, status=?, updated_at=? WHERE id=?`)
      .run(o.cliente || '', o.cliente_id || null, o.validade || '3 dias',
           Number(o.desconto) || 0, Number(o.subtotal) || 0, Number(o.total) || 0,
           o.obs || '', o.status || 'aberto', now, id);

    if (Array.isArray(o.itens)) {
      db.prepare('DELETE FROM orcamento_itens WHERE orcamento_id = ?').run(id);
      for (const i of o.itens) {
        db.prepare(`INSERT INTO orcamento_itens (id, orcamento_id, produto_id, nome_produto, preco, quantidade, total, loja_token)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uuidv4(), id, i.produto_id || null, i.nome_produto, Number(i.preco) || 0,
               Number(i.quantidade) || 1, Number(i.total) || 0, o.loja_token || 'padrao');
      }
    }
  });
  atualizar();
  res.json({ data: { id }, error: null });
});

// POST /api/orcamentos/:id/converter  — converte orçamento em venda
router.post('/:id/converter', (req, res) => {
  const { id } = req.params;
  const extra   = req.body; // { forma_pagamento, recebido }
  const orc     = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
  if (!orc)    return res.json({ data: null, error: { message: 'Orçamento não encontrado' } });
  if (orc.status !== 'aberto') return res.json({ data: null, error: { message: 'Orçamento já foi convertido ou cancelado' } });

  const itens    = db.prepare('SELECT * FROM orcamento_itens WHERE orcamento_id = ?').all(id);
  const vendaId  = uuidv4();
  const numero   = proximoNumeroVenda(orc.loja_token);
  const now      = new Date().toISOString();
  const forma    = extra.forma_pagamento || 'dinheiro';

  const converter = db.transaction(() => {
    // Cria a venda
    db.prepare(`INSERT INTO vendas (id, numero, cliente, total, desconto, forma_pagamento, status, orcamento_id, loja_token)
                VALUES (?, ?, ?, ?, ?, ?, 'pago', ?, ?)`)
      .run(vendaId, numero, orc.cliente || 'Consumidor', orc.total, orc.desconto, forma, id, orc.loja_token);

    // Insere itens da venda e debita estoque
    for (const i of itens) {
      db.prepare(`INSERT INTO venda_itens (id, venda_id, produto_id, nome_produto, preco, quantidade, total, loja_token)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), vendaId, i.produto_id || null, i.nome_produto, i.preco, i.quantidade, i.total, orc.loja_token);

      if (i.produto_id) {
        db.prepare('UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE id = ?')
          .run(i.quantidade, i.produto_id);
      }
    }

    // Lançamento no caixa
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    db.prepare(`INSERT INTO caixa_lancamentos (id, tipo, descricao, categoria, forma_pagamento, valor, data, hora, loja_token)
                VALUES (?, 'entrada', ?, 'Vendas', ?, ?, date('now'), ?, ?)`)
      .run(uuidv4(), `Venda #${numero} (Orc. #${orc.numero}) — ${orc.cliente || 'Consumidor'}`,
           forma, orc.total, hora, orc.loja_token);

    // Fecha o orçamento e vincula à venda
    db.prepare(`UPDATE orcamentos SET status='convertido', venda_id=?, updated_at=? WHERE id=?`)
      .run(vendaId, now, id);

    // Atualiza histórico do cliente
    if (orc.cliente_id) {
      db.prepare(`UPDATE clientes SET total_compras = total_compras + 1, total_gasto = total_gasto + ?, ultimo_servico_at = ? WHERE id = ?`)
        .run(orc.total, now, orc.cliente_id);
    }
  });
  converter();

  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId);
  const vendaItens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(vendaId);
  res.json({ data: { venda, itens: vendaItens }, error: null });
});

// DELETE /api/orcamentos/:id
router.delete('/:id', (req, res) => {
  const orc = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(req.params.id);
  if (orc && orc.cliente_id) {
    db.prepare(`UPDATE clientes SET total_orcamentos = MAX(0, total_orcamentos - 1) WHERE id = ?`)
      .run(orc.cliente_id);
  }
  db.prepare('DELETE FROM orcamentos WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

module.exports = router;
