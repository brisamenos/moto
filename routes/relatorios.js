// routes/relatorios.js  — Relatórios analíticos com dados reais
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');

// ── Helpers ───────────────────────────────────────────────────────────────────

function periodo(req) {
  const hoje   = new Date().toISOString().split('T')[0];
  const ini    = req.query.data_ini || (hoje.slice(0,7) + '-01');
  const fim    = req.query.data_fim || hoje;
  return { ini, fim };
}

// ── GET /api/relatorios/dre  — DRE Gerencial ─────────────────────────────────

router.get('/dre', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const { ini, fim } = periodo(req);

  try {
    // Receitas brutas de vendas
    const vendas = db.prepare(`
      SELECT COALESCE(SUM(total),0) as receita_bruta,
             COALESCE(SUM(desconto),0) as descontos,
             COUNT(*) as qtd_vendas
      FROM vendas WHERE loja_token=? AND date(created_at) BETWEEN ? AND ? AND status='pago'
    `).get(loja, ini, fim);

    // CMV (Custo da Mercadoria Vendida)
    const cmv = db.prepare(`
      SELECT COALESCE(SUM(p.custo * vi.quantidade), 0) as cmv
      FROM venda_itens vi
      JOIN produtos p ON p.id = vi.produto_id
      JOIN vendas v ON v.id = vi.venda_id
      WHERE v.loja_token=? AND date(v.created_at) BETWEEN ? AND ? AND v.status='pago'
    `).get(loja, ini, fim);

    // Receita de serviços (OS concluídas)
    const servicos = db.prepare(`
      SELECT COALESCE(SUM(valor_mao_obra),0) as receita_servicos,
             COALESCE(SUM(subtotal_pecas),0) as receita_pecas_os,
             COUNT(*) as qtd_os
      FROM ordens_servico
      WHERE loja_token=? AND date(created_at) BETWEEN ? AND ? AND status IN ('concluida','entregue')
    `).get(loja, ini, fim);

    // Saídas de caixa por categoria
    const saidas = db.prepare(`
      SELECT categoria, COALESCE(SUM(valor),0) as total
      FROM caixa_lancamentos
      WHERE loja_token=? AND tipo='saida' AND data BETWEEN ? AND ?
      GROUP BY categoria
      ORDER BY total DESC
    `).all(loja, ini, fim);

    const totalSaidas    = saidas.reduce((s, r) => s + r.total, 0);
    const receitaBruta   = vendas.receita_bruta + (servicos?.receita_servicos || 0);
    const receitaLiquida = receitaBruta - vendas.descontos;
    const lucroBruto     = receitaLiquida - (cmv.cmv || 0);
    const lucroOperacional = lucroBruto - totalSaidas;
    const margem           = receitaBruta > 0 ? (lucroOperacional / receitaBruta) * 100 : 0;

    res.json({
      data: {
        periodo: { ini, fim },
        receitas: {
          vendas_bruto:    vendas.receita_bruta,
          descontos:       vendas.descontos,
          receita_liquida: receitaLiquida,
          servicos_mao_obra: servicos?.receita_servicos || 0,
          receita_total:   receitaBruta,
        },
        cmv: cmv.cmv || 0,
        lucro_bruto: lucroBruto,
        despesas: saidas,
        total_despesas: totalSaidas,
        lucro_operacional: lucroOperacional,
        margem_pct: Number(margem.toFixed(2)),
        resumo: {
          qtd_vendas: vendas.qtd_vendas,
          qtd_os: servicos?.qtd_os || 0,
        }
      },
      error: null
    });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── GET /api/relatorios/margem  — Margem por produto ─────────────────────────

router.get('/margem', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const { ini, fim } = periodo(req);
  const limit = Number(req.query.limit) || 50;

  try {
    const rows = db.prepare(`
      SELECT
        p.id, p.sku, p.nome, p.categoria, p.marca,
        p.custo, p.preco_venda,
        COALESCE(SUM(vi.quantidade), 0) as qtd_vendida,
        COALESCE(SUM(vi.total), 0) as receita,
        COALESCE(SUM(p.custo * vi.quantidade), 0) as custo_total,
        COALESCE(SUM((vi.preco - p.custo) * vi.quantidade), 0) as margem_valor,
        CASE WHEN SUM(vi.total) > 0
             THEN ROUND((SUM((vi.preco - p.custo) * vi.quantidade) / SUM(vi.total)) * 100, 2)
             ELSE 0 END as margem_pct
      FROM produtos p
      LEFT JOIN venda_itens vi ON vi.produto_id = p.id
      LEFT JOIN vendas v ON v.id = vi.venda_id AND date(v.created_at) BETWEEN ? AND ? AND v.status='pago'
      WHERE p.loja_token = ?
      GROUP BY p.id
      ORDER BY margem_valor DESC
      LIMIT ?
    `).all(ini, fim, loja, limit);

    res.json({ data: { periodo: { ini, fim }, produtos: rows }, error: null });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── GET /api/relatorios/estoque  — Relatório de estoque ──────────────────────

router.get('/estoque', (req, res) => {
  const loja = req.query.loja_token || 'padrao';

  try {
    const produtos = db.prepare(`
      SELECT id, sku, nome, categoria, marca, custo, preco_venda,
             estoque, estoque_minimo,
             estoque * custo as valor_estoque,
             CASE WHEN estoque = 0 THEN 'zerado'
                  WHEN estoque <= estoque_minimo THEN 'critico'
                  ELSE 'ok' END as situacao
      FROM produtos WHERE loja_token = ?
      ORDER BY situacao DESC, nome ASC
    `).all(loja);

    // Giro — qtd vendida nos últimos 30 dias
    const giro = db.prepare(`
      SELECT vi.produto_id, COALESCE(SUM(vi.quantidade), 0) as qtd_30d
      FROM venda_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      WHERE v.loja_token=? AND v.created_at >= date('now','-30 days') AND v.status='pago'
      GROUP BY vi.produto_id
    `).all(loja);

    const giroMap = {};
    giro.forEach(g => { giroMap[g.produto_id] = g.qtd_30d; });

    const produtosComGiro = produtos.map(p => ({
      ...p,
      giro_30d: giroMap[p.id] || 0,
      cobertura_dias: giroMap[p.id] > 0 ? Math.round(p.estoque / (giroMap[p.id] / 30)) : null,
    }));

    const resumo = {
      total_itens:    produtos.length,
      valor_total:    produtos.reduce((s, p) => s + (p.valor_estoque || 0), 0),
      zerados:        produtos.filter(p => p.estoque === 0).length,
      criticos:       produtos.filter(p => p.estoque > 0 && p.estoque <= p.estoque_minimo).length,
      ok:             produtos.filter(p => p.estoque > p.estoque_minimo).length,
    };

    res.json({ data: { resumo, produtos: produtosComGiro }, error: null });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── GET /api/relatorios/abc  — Curva ABC ─────────────────────────────────────

router.get('/abc', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const { ini, fim } = periodo(req);

  try {
    const rows = db.prepare(`
      SELECT
        vi.produto_id as id,
        vi.nome_produto as nome,
        COALESCE(p.categoria,'Geral') as categoria,
        SUM(vi.quantidade) as qtd_vendida,
        SUM(vi.total) as receita,
        SUM((vi.preco - COALESCE(p.custo,0)) * vi.quantidade) as margem
      FROM venda_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      LEFT JOIN produtos p ON p.id = vi.produto_id
      WHERE v.loja_token=? AND date(v.created_at) BETWEEN ? AND ? AND v.status='pago'
      GROUP BY vi.produto_id, vi.nome_produto
      ORDER BY receita DESC
    `).all(loja, ini, fim);

    const totalReceita = rows.reduce((s, r) => s + r.receita, 0);
    let acumulado = 0;

    const comCurva = rows.map(r => {
      acumulado += r.receita;
      const pct = totalReceita > 0 ? (acumulado / totalReceita) * 100 : 0;
      const curva = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...r, pct_receita: Number(((r.receita / totalReceita) * 100).toFixed(2)), pct_acumulado: Number(pct.toFixed(2)), curva };
    });

    res.json({ data: { periodo: { ini, fim }, produtos: comCurva, total_receita: totalReceita }, error: null });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── GET /api/relatorios/vendas  — Relatório de vendas por período ─────────────

router.get('/vendas', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const { ini, fim } = periodo(req);

  try {
    const porDia = db.prepare(`
      SELECT date(created_at) as dia,
             COUNT(*) as qtd, SUM(total) as total, SUM(desconto) as descontos,
             AVG(total) as ticket_medio
      FROM vendas WHERE loja_token=? AND date(created_at) BETWEEN ? AND ? AND status='pago'
      GROUP BY dia ORDER BY dia
    `).all(loja, ini, fim);

    const porFormaPag = db.prepare(`
      SELECT forma_pagamento, COUNT(*) as qtd, SUM(total) as total
      FROM vendas WHERE loja_token=? AND date(created_at) BETWEEN ? AND ? AND status='pago'
      GROUP BY forma_pagamento ORDER BY total DESC
    `).all(loja, ini, fim);

    const topClientes = db.prepare(`
      SELECT cliente, COUNT(*) as qtd_compras, SUM(total) as total_gasto
      FROM vendas WHERE loja_token=? AND date(created_at) BETWEEN ? AND ? AND status='pago'
        AND cliente != 'Consumidor' AND cliente != ''
      GROUP BY cliente ORDER BY total_gasto DESC LIMIT 10
    `).all(loja, ini, fim);

    const resumo = db.prepare(`
      SELECT COUNT(*) as qtd, COALESCE(SUM(total),0) as total,
             COALESCE(SUM(desconto),0) as descontos, COALESCE(AVG(total),0) as ticket_medio
      FROM vendas WHERE loja_token=? AND date(created_at) BETWEEN ? AND ? AND status='pago'
    `).get(loja, ini, fim);

    res.json({
      data: { periodo: { ini, fim }, resumo, por_dia: porDia, por_forma_pag: porFormaPag, top_clientes: topClientes },
      error: null
    });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── GET /api/relatorios/caixa  — Fechamento de caixa por período ──────────────

router.get('/caixa', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const { ini, fim } = periodo(req);

  try {
    const porDia = db.prepare(`
      SELECT data,
             SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) as entradas,
             SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END) as saidas,
             SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END) as saldo
      FROM caixa_lancamentos WHERE loja_token=? AND data BETWEEN ? AND ?
      GROUP BY data ORDER BY data
    `).all(loja, ini, fim);

    const porCategoria = db.prepare(`
      SELECT tipo, categoria,
             COUNT(*) as qtd, SUM(valor) as total
      FROM caixa_lancamentos WHERE loja_token=? AND data BETWEEN ? AND ?
      GROUP BY tipo, categoria ORDER BY tipo, total DESC
    `).all(loja, ini, fim);

    const resumo = db.prepare(`
      SELECT
        SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) as total_entradas,
        SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END) as total_saidas,
        SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END) as saldo
      FROM caixa_lancamentos WHERE loja_token=? AND data BETWEEN ? AND ?
    `).get(loja, ini, fim);

    res.json({
      data: { periodo: { ini, fim }, resumo, por_dia: porDia, por_categoria: porCategoria },
      error: null
    });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── GET /api/relatorios/os  — Relatório de OS ────────────────────────────────

router.get('/os', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const { ini, fim } = periodo(req);

  try {
    const rows = db.prepare(`
      SELECT status,
             COUNT(*) as qtd,
             SUM(total) as faturamento,
             AVG(total) as ticket_medio,
             SUM(valor_mao_obra) as total_mao_obra,
             SUM(subtotal_pecas) as total_pecas
      FROM ordens_servico WHERE loja_token=? AND date(created_at) BETWEEN ? AND ?
      GROUP BY status
    `).all(loja, ini, fim);

    const topMecanicos = db.prepare(`
      SELECT mecanico, COUNT(*) as qtd, SUM(total) as faturamento
      FROM ordens_servico WHERE loja_token=? AND date(created_at) BETWEEN ? AND ?
        AND mecanico != ''
      GROUP BY mecanico ORDER BY faturamento DESC LIMIT 10
    `).all(loja, ini, fim);

    const porDia = db.prepare(`
      SELECT date(created_at) as dia, COUNT(*) as qtd, SUM(total) as faturamento
      FROM ordens_servico WHERE loja_token=? AND date(created_at) BETWEEN ? AND ?
      GROUP BY dia ORDER BY dia
    `).all(loja, ini, fim);

    res.json({
      data: { periodo: { ini, fim }, por_status: rows, top_mecanicos: topMecanicos, por_dia: porDia },
      error: null
    });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

module.exports = router;
