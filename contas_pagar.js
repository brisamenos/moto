// routes/contas_pagar.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

const FREQ_VALIDAS = ['semanal', 'mensal', 'anual'];

function proximaData(dataStr, frequencia) {
  const d = new Date(dataStr + 'T00:00:00');
  if (frequencia === 'semanal') d.setDate(d.getDate() + 7);
  else if (frequencia === 'anual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // mensal (padrão)
  return d.toISOString().split('T')[0];
}

// GET /api/contas-pagar?loja_token=xxx&status=pendente
router.get('/', (req, res) => {
  const { loja_token, status } = req.query;
  if (!loja_token) return res.status(400).json({ data: null, error: { message: 'loja_token obrigatório' } });
  let sql = 'SELECT * FROM contas_pagar WHERE loja_token = ?';
  const params = [loja_token];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY vencimento ASC';
  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

// POST /api/contas-pagar
router.post('/', (req, res) => {
  const c = req.body || {};
  if (!c.descricao || !c.valor || !c.vencimento) {
    return res.json({ data: null, error: { message: 'Descrição, valor e vencimento são obrigatórios.' } });
  }
  const recorrente = c.recorrente ? 1 : 0;
  const frequencia = recorrente ? (FREQ_VALIDAS.includes(c.frequencia) ? c.frequencia : 'mensal') : null;
  const id = uuidv4();
  db.prepare(`INSERT INTO contas_pagar (id, descricao, categoria, valor, vencimento, recorrente, frequencia, status, loja_token)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`)
    .run(id, c.descricao, c.categoria || 'Outros', Number(c.valor), c.vencimento, recorrente, frequencia, c.loja_token || 'padrao');
  const row = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
  res.json({ data: row, error: null });
});

// DELETE /api/contas-pagar/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// POST /api/contas-pagar/:id/pagar — marca como paga, lança no caixa como saída
// e, se for recorrente, já cria a próxima ocorrência pendente.
router.post('/:id/pagar', (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  if (!conta) return res.json({ data: null, error: { message: 'Conta não encontrada.' } });
  if (conta.status === 'pago') return res.json({ data: null, error: { message: 'Esta conta já está paga.' } });

  const agora = new Date();
  const hora  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje  = agora.toISOString().split('T')[0];

  const transacao = db.transaction(() => {
    db.prepare(`UPDATE contas_pagar SET status='pago', pago_em=? WHERE id=?`).run(agora.toISOString(), conta.id);

    db.prepare(`INSERT INTO caixa_lancamentos (id, tipo, descricao, categoria, forma_pagamento, valor, data, hora, loja_token)
                VALUES (?, 'saida', ?, ?, 'dinheiro', ?, ?, ?, ?)`)
      .run(uuidv4(), conta.descricao, conta.categoria || 'Outros', conta.valor, hoje, hora, conta.loja_token);

    let proxima = null;
    if (conta.recorrente) {
      const novaData = proximaData(conta.vencimento, conta.frequencia);
      const novoId = uuidv4();
      db.prepare(`INSERT INTO contas_pagar (id, descricao, categoria, valor, vencimento, recorrente, frequencia, status, loja_token)
                  VALUES (?, ?, ?, ?, ?, 1, ?, 'pendente', ?)`)
        .run(novoId, conta.descricao, conta.categoria, conta.valor, novaData, conta.frequencia, conta.loja_token);
      proxima = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(novoId);
    }
    return proxima;
  });

  const proximaConta = transacao();
  const contaAtualizada = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(conta.id);
  res.json({ data: { conta: contaAtualizada, proxima: proximaConta }, error: null });
});

module.exports = router;
