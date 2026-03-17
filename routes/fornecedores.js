// routes/fornecedores.js
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET /api/fornecedores?loja_token=xxx
router.get('/', (req, res) => {
  const { loja_token } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  const rows = db.prepare('SELECT * FROM fornecedores WHERE loja_token = ? ORDER BY nome').all(loja_token);
  res.json({ data: rows, error: null });
});

// POST /api/fornecedores
router.post('/', (req, res) => {
  const f = req.body;
  if (!f.nome) return res.json({ data: null, error: { message: 'nome obrigatório' } });
  const id = uuidv4();
  db.prepare(`INSERT INTO fornecedores (id,nome,telefone,email,cnpj,endereco,obs,loja_token)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, f.nome, f.telefone||'', f.email||'', f.cnpj||'', f.endereco||'', f.obs||'', f.loja_token||'padrao');
  res.json({ data: db.prepare('SELECT * FROM fornecedores WHERE id=?').get(id), error: null });
});

// PUT /api/fornecedores/:id
router.put('/:id', (req, res) => {
  const f = req.body;
  db.prepare(`UPDATE fornecedores SET nome=?,telefone=?,email=?,cnpj=?,endereco=?,obs=? WHERE id=?`)
    .run(f.nome, f.telefone||'', f.email||'', f.cnpj||'', f.endereco||'', f.obs||'', req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// DELETE /api/fornecedores/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM fornecedores WHERE id=?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// ── ENTRADAS DE ESTOQUE ──────────────────────────────────────────────────────

// GET /api/fornecedores/entradas?loja_token=xxx&produto_id=xxx
router.get('/entradas', (req, res) => {
  const { loja_token, produto_id } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });
  let sql = `SELECT e.*, f.nome as fornecedor_nome, p.nome as produto_nome
             FROM entradas_estoque e
             LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
             LEFT JOIN produtos p ON p.id = e.produto_id
             WHERE e.loja_token = ?`;
  const params = [loja_token];
  if (produto_id) { sql += ' AND e.produto_id = ?'; params.push(produto_id); }
  sql += ' ORDER BY e.created_at DESC LIMIT 200';
  res.json({ data: db.prepare(sql).all(...params), error: null });
});

// POST /api/fornecedores/entradas — registra entrada e recalcula CMP
router.post('/entradas', (req, res) => {
  const e = req.body;
  if (!e.produto_id || !e.quantidade || !e.custo_unitario)
    return res.json({ data: null, error: { message: 'produto_id, quantidade e custo_unitario obrigatórios' } });

  const prod = db.prepare('SELECT * FROM produtos WHERE id = ?').get(e.produto_id);
  if (!prod) return res.json({ data: null, error: { message: 'Produto não encontrado' } });

  const qtdEntrada   = Number(e.quantidade);
  const custoEntrada = Number(e.custo_unitario);
  const estoqueAtual = Number(prod.estoque) || 0;
  const custoAtual   = Number(prod.custo)   || 0;

  // Custo Médio Ponderado
  const totalAtual   = estoqueAtual * custoAtual;
  const totalEntrada = qtdEntrada   * custoEntrada;
  const novoEstoque  = estoqueAtual + qtdEntrada;
  const novoCusto    = novoEstoque > 0 ? (totalAtual + totalEntrada) / novoEstoque : custoEntrada;

  const id  = uuidv4();
  const now = new Date().toISOString();

  const realizar = db.transaction(() => {
    // Salva a entrada
    db.prepare(`INSERT INTO entradas_estoque
                (id,produto_id,fornecedor_id,quantidade,custo_unitario,custo_total,
                 custo_medio_anterior,custo_medio_novo,estoque_anterior,estoque_novo,obs,loja_token,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, e.produto_id, e.fornecedor_id||null, qtdEntrada, custoEntrada,
           qtdEntrada * custoEntrada, custoAtual, novoCusto,
           estoqueAtual, novoEstoque, e.obs||'', e.loja_token||'padrao', now);

    // Atualiza produto: estoque + custo médio
    db.prepare('UPDATE produtos SET estoque=?, custo=? WHERE id=?')
      .run(novoEstoque, Math.round(novoCusto * 100) / 100, e.produto_id);
  });
  realizar();

  const entrada = db.prepare('SELECT * FROM entradas_estoque WHERE id=?').get(id);
  res.json({
    data: {
      entrada,
      produto: { id: e.produto_id, estoque: novoEstoque, custo_medio: Math.round(novoCusto * 100) / 100 }
    },
    error: null
  });
});

module.exports = router;
