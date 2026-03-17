// routes/ordens_servico.js  — Ordens de Serviço completo
const express = require('express');
const router  = express.Router();
const { db, proximoNumeroOS } = require('../db');
const { v4: uuidv4 } = require('uuid');

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcTotais(itens, maoObra, desconto) {
  const subtotalPecas = itens.reduce((s, i) => s + (Number(i.preco) * Number(i.quantidade)), 0);
  const total = subtotalPecas + Number(maoObra) - Number(desconto);
  return { subtotalPecas, total };
}

// ── GET /api/os?loja_token&status&placa&cliente_id&limit ──────────────────────

router.get('/', (req, res) => {
  const { loja_token, status, placa, cliente_id, limit } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });

  let sql = 'SELECT * FROM ordens_servico WHERE loja_token = ?';
  const params = [loja_token];

  if (status)     { sql += ' AND status = ?';            params.push(status); }
  if (placa)      { sql += ' AND placa LIKE ?';           params.push('%' + placa.toUpperCase() + '%'); }
  if (cliente_id) { sql += ' AND cliente_id = ?';         params.push(cliente_id); }

  sql += ' ORDER BY created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

// ── GET /api/os/stats?loja_token ─────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const { loja_token } = req.query;
  if (!loja_token) return res.status(400).json({ error: 'loja_token obrigatório' });

  const stats = {
    abertas:   db.prepare(`SELECT COUNT(*) as c FROM ordens_servico WHERE loja_token=? AND status='aberta'`).get(loja_token).c,
    andamento: db.prepare(`SELECT COUNT(*) as c FROM ordens_servico WHERE loja_token=? AND status='em_andamento'`).get(loja_token).c,
    aguardando:db.prepare(`SELECT COUNT(*) as c FROM ordens_servico WHERE loja_token=? AND status='aguardando_peca'`).get(loja_token).c,
    concluidas:db.prepare(`SELECT COUNT(*) as c FROM ordens_servico WHERE loja_token=? AND status='concluida'`).get(loja_token).c,
    entregues: db.prepare(`SELECT COUNT(*) as c FROM ordens_servico WHERE loja_token=? AND status='entregue'`).get(loja_token).c,
    faturamento_mes: db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM ordens_servico WHERE loja_token=? AND status IN ('concluida','entregue') AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')`).get(loja_token).v,
  };
  res.json({ data: stats, error: null });
});

// ── GET /api/os/historico/:placa ─────────────────────────────────────────────

router.get('/historico/:placa', (req, res) => {
  const placa = req.params.placa.toUpperCase();
  const { loja_token } = req.query;

  let sql = 'SELECT * FROM ordens_servico WHERE placa = ?';
  const params = [placa];
  if (loja_token) { sql += ' AND loja_token = ?'; params.push(loja_token); }
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  res.json({ data: rows, error: null });
});

// ── GET /api/os/:id  — OS + itens ────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(req.params.id);
  if (!os) return res.json({ data: null, error: { message: 'OS não encontrada' } });
  const itens = db.prepare('SELECT * FROM os_itens WHERE os_id = ? ORDER BY created_at').all(os.id);
  res.json({ data: { ...os, itens }, error: null });
});

// ── POST /api/os  — criar OS ──────────────────────────────────────────────────

router.post('/', (req, res) => {
  const o = req.body;
  if (!o.loja_token || !o.placa || !o.servico_descricao)
    return res.json({ data: null, error: { message: 'loja_token, placa e servico_descricao obrigatórios' } });

  const id     = uuidv4();
  const numero = proximoNumeroOS(o.loja_token);
  const now    = new Date().toISOString();
  const itens  = Array.isArray(o.itens) ? o.itens : [];
  const { subtotalPecas, total } = calcTotais(itens, o.valor_mao_obra || 0, o.desconto || 0);

  const criar = db.transaction(() => {
    db.prepare(`INSERT INTO ordens_servico
      (id, numero, cliente_nome, cliente_tel, cliente_id, placa, modelo_moto, ano_moto,
       km_entrada, defeito_relatado, servico_descricao, mecanico, status,
       valor_mao_obra, desconto, subtotal_pecas, total, obs, previsao_entrega,
       loja_token, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, numero,
        o.cliente_nome || '', o.cliente_tel || '', o.cliente_id || null,
        o.placa.toUpperCase().trim(), o.modelo_moto || '', o.ano_moto || '',
        Number(o.km_entrada) || 0,
        o.defeito_relatado || '', o.servico_descricao,
        o.mecanico || '', o.status || 'aberta',
        Number(o.valor_mao_obra) || 0, Number(o.desconto) || 0,
        subtotalPecas, total,
        o.obs || '', o.previsao_entrega || null,
        o.loja_token, now, now
      );

    for (const i of itens) {
      db.prepare(`INSERT INTO os_itens (id, os_id, produto_id, nome_produto, preco, quantidade, total, loja_token)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(uuidv4(), id, i.produto_id || null, i.nome_produto,
             Number(i.preco) || 0, Number(i.quantidade) || 1,
             Number(i.preco) * Number(i.quantidade), o.loja_token);
    }

    if (o.cliente_id) {
      db.prepare(`UPDATE clientes SET total_orcamentos = total_orcamentos + 1, ultimo_orcamento_at = ? WHERE id = ?`)
        .run(now, o.cliente_id);
    }
  });
  criar();

  const row   = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(id);
  const irows = db.prepare('SELECT * FROM os_itens WHERE os_id = ?').all(id);
  res.json({ data: { ...row, itens: irows }, error: null });
});

// ── PUT /api/os/:id  — atualizar OS ──────────────────────────────────────────

router.put('/:id', (req, res) => {
  const o   = req.body;
  const { id } = req.params;
  const now = new Date().toISOString();
  const itens = Array.isArray(o.itens) ? o.itens : null;

  const atualizar = db.transaction(() => {
    let subtotalPecas = 0, total = 0;

    if (itens !== null) {
      // Devolve estoque dos itens anteriores que já tiveram baixa
      const antigos = db.prepare('SELECT * FROM os_itens WHERE os_id = ? AND estoque_baixado = 1').all(id);
      for (const i of antigos) {
        if (i.produto_id) {
          db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?').run(i.quantidade, i.produto_id);
        }
      }
      db.prepare('DELETE FROM os_itens WHERE os_id = ?').run(id);

      for (const i of itens) {
        const tot = Number(i.preco) * Number(i.quantidade);
        subtotalPecas += tot;
        db.prepare(`INSERT INTO os_itens (id, os_id, produto_id, nome_produto, preco, quantidade, total, loja_token)
                    VALUES (?,?,?,?,?,?,?,?)`)
          .run(uuidv4(), id, i.produto_id || null, i.nome_produto,
               Number(i.preco) || 0, Number(i.quantidade) || 1, tot, o.loja_token || 'padrao');
      }
      total = subtotalPecas + Number(o.valor_mao_obra) - Number(o.desconto);
    } else {
      const cur = db.prepare('SELECT subtotal_pecas FROM ordens_servico WHERE id = ?').get(id);
      subtotalPecas = cur ? cur.subtotal_pecas : 0;
      total = subtotalPecas + Number(o.valor_mao_obra) - Number(o.desconto);
    }

    db.prepare(`UPDATE ordens_servico SET
      cliente_nome=?, cliente_tel=?, cliente_id=?, placa=?, modelo_moto=?, ano_moto=?,
      km_entrada=?, km_saida=?, defeito_relatado=?, servico_descricao=?, mecanico=?,
      status=?, valor_mao_obra=?, desconto=?, subtotal_pecas=?, total=?,
      obs=?, previsao_entrega=?, updated_at=? WHERE id=?`)
      .run(
        o.cliente_nome || '', o.cliente_tel || '', o.cliente_id || null,
        (o.placa || '').toUpperCase().trim(), o.modelo_moto || '', o.ano_moto || '',
        Number(o.km_entrada) || 0, Number(o.km_saida) || 0,
        o.defeito_relatado || '', o.servico_descricao || '', o.mecanico || '',
        o.status || 'aberta',
        Number(o.valor_mao_obra) || 0, Number(o.desconto) || 0,
        subtotalPecas, total,
        o.obs || '', o.previsao_entrega || null,
        now, id
      );
  });
  atualizar();
  res.json({ data: { id }, error: null });
});

// ── POST /api/os/:id/fechar  — conclui e baixa estoque ───────────────────────

router.post('/:id/fechar', (req, res) => {
  const { id } = req.params;
  const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(id);
  if (!os) return res.json({ data: null, error: { message: 'OS não encontrada' } });
  if (['concluida','entregue'].includes(os.status))
    return res.json({ data: null, error: { message: 'OS já foi concluída' } });

  const itens = db.prepare('SELECT * FROM os_itens WHERE os_id = ?').all(id);
  const now   = new Date().toISOString();

  const fechar = db.transaction(() => {
    for (const i of itens) {
      if (i.produto_id && !i.estoque_baixado) {
        db.prepare('UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE id = ?').run(i.quantidade, i.produto_id);
        db.prepare('UPDATE os_itens SET estoque_baixado = 1 WHERE id = ?').run(i.id);
      }
    }
    db.prepare(`UPDATE ordens_servico SET status='concluida', updated_at=? WHERE id=?`).run(now, id);
    if (os.cliente_id) {
      db.prepare('UPDATE clientes SET ultimo_servico_at = ? WHERE id = ?').run(now, os.cliente_id);
    }
  });
  fechar();

  res.json({ data: { id, status: 'concluida' }, error: null });
});

// ── POST /api/os/:id/entregar ─────────────────────────────────────────────────

router.post('/:id/entregar', (req, res) => {
  const { id } = req.params;
  const now = new Date().toISOString();
  const os = db.prepare('SELECT * FROM ordens_servico WHERE id=?').get(id);
  if (!os) return res.json({ data: null, error: { message: 'OS não encontrada' } });

  db.prepare(`UPDATE ordens_servico SET status='entregue', entrega_at=?, km_saida=?, updated_at=? WHERE id=?`)
    .run(now, Number(req.body.km_saida) || os.km_saida || 0, now, id);
  res.json({ data: { id, status: 'entregue' }, error: null });
});

// ── DELETE /api/os/:id ────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(req.params.id);
  // Devolve estoque se OS foi fechada
  if (os) {
    const itens = db.prepare('SELECT * FROM os_itens WHERE os_id = ? AND estoque_baixado = 1').all(os.id);
    for (const i of itens) {
      if (i.produto_id) db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?').run(i.quantidade, i.produto_id);
    }
  }
  db.prepare('DELETE FROM ordens_servico WHERE id = ?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

module.exports = router;
