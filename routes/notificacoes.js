// routes/notificacoes.js — Central de Notificações MotoStock v2.3
// Telegram, resumo diário, alertas de estoque, plano, orçamentos

const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// ── Helpers ────────────────────────────────────────────────────────────────

function cfgGet(loja, chave) {
  const r = db.prepare('SELECT valor FROM configuracoes WHERE loja_token=? AND chave=?').get(loja, chave);
  return r ? r.valor : null;
}

function fmt(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Envia mensagem via Telegram Bot API
async function enviarTelegram(botToken, chatId, mensagem) {
  if (!botToken || !chatId) return { ok: false, error: 'Bot token ou chat_id não configurados' };
  const url  = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text: mensagem, parse_mode: 'HTML' });
  try {
    const https  = require('https');
    const urlObj = new URL(url);
    return await new Promise((resolve) => {
      const req = https.request({
        hostname: urlObj.hostname,
        path:     urlObj.pathname + urlObj.search,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { resolve({ ok: false, error: data }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.write(body);
      req.end();
    });
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// Monta resumo diário em texto rico
function montarResumoDiario(loja) {
  const hoje   = new Date().toISOString().split('T')[0];
  const mesIni = hoje.slice(0, 7) + '-01';
  const nomeLoja = cfgGet(loja, 'nome_loja') || 'MotoStock';

  const vendasHoje = db.prepare(`
    SELECT COUNT(*) as qtd, COALESCE(SUM(total),0) as total, COALESCE(SUM(desconto),0) as desc_total
    FROM vendas WHERE loja_token=? AND date(created_at)=? AND status='pago'
  `).get(loja, hoje);

  const vendasMes = db.prepare(`
    SELECT COUNT(*) as qtd, COALESCE(SUM(total),0) as total
    FROM vendas WHERE loja_token=? AND date(created_at)>=? AND status='pago'
  `).get(loja, mesIni);

  const caixaHoje = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) as entradas,
      COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END),0) as saidas
    FROM caixa_lancamentos WHERE loja_token=? AND data=?
  `).get(loja, hoje);

  const estoque = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN estoque=0 THEN 1 ELSE 0 END) as zerados,
           SUM(CASE WHEN estoque>0 AND estoque<=estoque_minimo THEN 1 ELSE 0 END) as criticos
    FROM produtos WHERE loja_token=?
  `).get(loja);

  const osAbertas = db.prepare(`
    SELECT COUNT(*) as c FROM ordens_servico WHERE loja_token=? AND status IN ('aberta','em_andamento')
  `).get(loja);

  const osAtrasadas = db.prepare(`
    SELECT COUNT(*) as c FROM ordens_servico
    WHERE loja_token=? AND status NOT IN ('concluida','entregue')
    AND previsao_entrega IS NOT NULL AND previsao_entrega < date('now')
  `).get(loja);

  const orcsAbertos = db.prepare(`
    SELECT COUNT(*) as c, COALESCE(SUM(total),0) as v
    FROM orcamentos WHERE loja_token=? AND status='aberto'
  `).get(loja);

  const saldo = (caixaHoje.entradas || 0) - (caixaHoje.saidas || 0);
  const dt    = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });

  let msg = `🏍️ <b>${nomeLoja} — Resumo Diário</b>\n`;
  msg    += `📅 ${dt}\n\n`;

  msg += `💰 <b>Vendas de Hoje</b>\n`;
  msg += `  • ${vendasHoje.qtd} vendas — ${fmt(vendasHoje.total)}\n`;
  if (vendasHoje.desc_total > 0) msg += `  • Descontos: ${fmt(vendasHoje.desc_total)}\n`;
  msg += `\n`;

  msg += `📊 <b>Acumulado do Mês</b>\n`;
  msg += `  • ${vendasMes.qtd} vendas — ${fmt(vendasMes.total)}\n\n`;

  msg += `💳 <b>Caixa Hoje</b>\n`;
  msg += `  • Entradas: ${fmt(caixaHoje.entradas)}\n`;
  msg += `  • Saídas:   ${fmt(caixaHoje.saidas)}\n`;
  msg += `  • Saldo:    <b>${fmt(saldo)}</b>\n\n`;

  if (estoque.zerados > 0 || estoque.criticos > 0) {
    msg += `📦 <b>Estoque — Alertas</b>\n`;
    if (estoque.zerados  > 0) msg += `  ⛔ ${estoque.zerados} produto(s) zerado(s)\n`;
    if (estoque.criticos > 0) msg += `  ⚠️ ${estoque.criticos} produto(s) crítico(s)\n`;
    msg += `\n`;
  }

  if (osAbertas.c > 0 || osAtrasadas.c > 0) {
    msg += `🔧 <b>Ordens de Serviço</b>\n`;
    msg += `  • Abertas/em andamento: ${osAbertas.c}\n`;
    if (osAtrasadas.c > 0) msg += `  ⏰ ${osAtrasadas.c} OS(s) em atraso!\n`;
    msg += `\n`;
  }

  if (orcsAbertos.c > 0) {
    msg += `📋 <b>Orçamentos em Aberto</b>: ${orcsAbertos.c} (${fmt(orcsAbertos.v)})\n\n`;
  }

  msg += `─────────────────────\n<i>MotoStock — enviado automaticamente</i>`;
  return msg;
}

// ── GET /api/notificacoes/alertas?loja_token ──────────────────────────────

router.get('/alertas', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const alertas = [];

  try {
    // 1. Estoque crítico / zerado
    const prods = db.prepare(`
      SELECT id, nome, sku, estoque, estoque_minimo
      FROM produtos WHERE loja_token=?
      AND (estoque = 0 OR estoque <= estoque_minimo)
      ORDER BY estoque ASC
      LIMIT 30
    `).all(loja);

    prods.forEach(p => {
      alertas.push({
        id:     'estoque_' + p.id,
        tipo:   p.estoque === 0 ? 'danger' : 'warning',
        icone:  p.estoque === 0 ? '⛔' : '⚠️',
        titulo: p.estoque === 0 ? 'Estoque zerado' : 'Estoque crítico',
        texto:  `${p.nome} — ${p.estoque} un restantes (mín: ${p.estoque_minimo})`,
        pagina: 'estoque',
        ts:     Date.now(),
      });
    });

    // 2. Orçamentos vencendo (nos próximos 2 dias ou já vencidos)
    const orcs = db.prepare(`
      SELECT id, numero, cliente, total, validade, created_at
      FROM orcamentos WHERE loja_token=? AND status='aberto'
      ORDER BY created_at ASC
    `).all(loja);

    const agora = new Date();
    orcs.forEach(o => {
      const criado = new Date(o.created_at);
      const dias   = parseInt((o.validade || '3 dias').split(' ')[0]) || 3;
      const venc   = new Date(criado.getTime() + dias * 86400000);
      const diff   = Math.ceil((venc - agora) / 86400000);
      if (diff <= 2) {
        alertas.push({
          id:     'orc_' + o.id,
          tipo:   diff < 0 ? 'danger' : 'warning',
          icone:  diff < 0 ? '📋' : '⏰',
          titulo: diff < 0 ? 'Orçamento vencido' : 'Orçamento vencendo',
          texto:  `Orc. #${o.numero} — ${o.cliente || 'Consumidor'} (${diff < 0 ? Math.abs(diff) + ' dia(s) atrasado' : 'vence em ' + diff + ' dia(s)'})`,
          pagina: 'pdv',
          ts:     Date.now(),
        });
      }
    });

    // 3. OS em atraso
    const osAtrasadas = db.prepare(`
      SELECT id, numero, placa, cliente_nome, previsao_entrega, status
      FROM ordens_servico
      WHERE loja_token=? AND status NOT IN ('concluida','entregue')
      AND previsao_entrega IS NOT NULL AND previsao_entrega < date('now')
      LIMIT 10
    `).all(loja);

    osAtrasadas.forEach(o => {
      alertas.push({
        id:     'os_' + o.id,
        tipo:   'danger',
        icone:  '🔧',
        titulo: 'OS em atraso',
        texto:  `OS #${o.numero} — ${o.placa} (${o.cliente_nome || 'sem cliente'})`,
        pagina: 'os',
        ts:     Date.now(),
      });
    });

    // 4. Plano expirando (próximos 7 dias) — para todos os usuários da loja
    const usuarios = db.prepare(`
      SELECT id, nome, email, plano_nome, plano_expiracao
      FROM usuarios WHERE loja_token=? AND ativo=1
      AND plano_expiracao IS NOT NULL
      AND julianday(plano_expiracao) - julianday('now') BETWEEN 0 AND 7
    `).all(loja);

    usuarios.forEach(u => {
      const dias = Math.ceil((new Date(u.plano_expiracao) - new Date()) / 86400000);
      alertas.push({
        id:     'plano_' + u.id,
        tipo:   dias <= 2 ? 'danger' : 'warning',
        icone:  '🎫',
        titulo: 'Plano expirando',
        texto:  `${u.nome} — plano ${u.plano_nome} expira em ${dias} dia(s) (${new Date(u.plano_expiracao).toLocaleDateString('pt-BR')})`,
        pagina: 'configuracoes',
        ts:     Date.now(),
      });
    });

    res.json({ data: alertas, error: null });
  } catch(e) {
    res.json({ data: [], error: { message: e.message } });
  }
});

// ── POST /api/notificacoes/telegram/teste  — Testa conexão ───────────────

router.post('/telegram/teste', async (req, res) => {
  const { bot_token, chat_id, loja_token } = req.body;
  const loja = loja_token || 'padrao';
  const nome = cfgGet(loja, 'nome_loja') || 'MotoStock';

  const r = await enviarTelegram(
    bot_token, chat_id,
    `✅ <b>Conexão confirmada!</b>\n\n🏍️ Loja: <b>${nome}</b>\nMotoStock está configurado para enviar alertas e resumos diários neste chat.\n\n<i>${new Date().toLocaleString('pt-BR')}</i>`
  );
  if (r.ok) {
    res.json({ data: { ok: true, message_id: r.result?.message_id }, error: null });
  } else {
    res.json({ data: null, error: { message: r.description || r.error || 'Erro desconhecido' } });
  }
});

// ── POST /api/notificacoes/telegram/resumo  — Envia resumo agora ─────────

router.post('/telegram/resumo', async (req, res) => {
  const loja  = req.body.loja_token || 'padrao';
  const token = cfgGet(loja, 'telegram_bot_token') || req.body.bot_token;
  const chat  = cfgGet(loja, 'telegram_chat_id')   || req.body.chat_id;

  if (!token || !chat) {
    return res.json({ data: null, error: { message: 'Configure o Bot Token e Chat ID primeiro.' } });
  }

  try {
    const msg = montarResumoDiario(loja);
    const r   = await enviarTelegram(token, chat, msg);
    if (r.ok) {
      // Registra último envio
      const now = new Date().toISOString();
      const upsert = db.prepare(`INSERT INTO configuracoes (id,chave,valor,loja_token,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(chave,loja_token) DO UPDATE SET valor=?,updated_at=?`);
      upsert.run(uuidv4(), 'telegram_ultimo_resumo', now, loja, now, now, now);
      res.json({ data: { ok: true }, error: null });
    } else {
      res.json({ data: null, error: { message: r.description || r.error || 'Erro ao enviar' } });
    }
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── POST /api/notificacoes/telegram/alerta  — Envia alerta específico ────

router.post('/telegram/alerta', async (req, res) => {
  const { loja_token, mensagem } = req.body;
  const loja  = loja_token || 'padrao';
  const token = cfgGet(loja, 'telegram_bot_token');
  const chat  = cfgGet(loja, 'telegram_chat_id');

  if (!token || !chat) return res.json({ data: null, error: { message: 'Telegram não configurado' } });

  const r = await enviarTelegram(token, chat, mensagem || '');
  res.json({ data: { ok: r.ok }, error: r.ok ? null : { message: r.description || r.error } });
});

// ── GET /api/notificacoes/config?loja_token ───────────────────────────────

router.get('/config', (req, res) => {
  const loja = req.query.loja_token || 'padrao';
  const chaves = ['telegram_bot_token','telegram_chat_id','telegram_ativo',
                  'alerta_estoque_ativo','alerta_orcamento_ativo','alerta_plano_ativo',
                  'resumo_horario','telegram_ultimo_resumo'];
  const cfg = {};
  chaves.forEach(c => { cfg[c] = cfgGet(loja, c) || ''; });
  res.json({ data: cfg, error: null });
});

// ── POST /api/notificacoes/config  — Salva configurações ─────────────────

router.post('/config', (req, res) => {
  const { loja_token, ...campos } = req.body;
  const loja = loja_token || 'padrao';
  const now  = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO configuracoes (id,chave,valor,loja_token,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(chave,loja_token) DO UPDATE SET valor=excluded.valor, updated_at=excluded.updated_at`);

  const salvar = db.transaction(() => {
    for (const [chave, valor] of Object.entries(campos)) {
      upsert.run(uuidv4(), chave, String(valor), loja, now);
    }
  });
  salvar();
  res.json({ data: { ok: true }, error: null });
});

// ── GET /api/notificacoes/cron  — Chamado pelo job agendado ──────────────
// Pode ser chamado por um cron externo (EasyPanel, crontab) para disparos automáticos

router.get('/cron', async (req, res) => {
  const secret = req.query.secret || '';
  // Segurança mínima: secret configurado nas env vars
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const lojas = db.prepare(`SELECT DISTINCT loja_token FROM usuarios WHERE ativo=1`).all();
  const results = [];

  for (const { loja_token: loja } of lojas) {
    try {
      const ativo   = cfgGet(loja, 'telegram_ativo');
      const token   = cfgGet(loja, 'telegram_bot_token');
      const chat    = cfgGet(loja, 'telegram_chat_id');
      const horario = cfgGet(loja, 'resumo_horario') || '20:00';

      if (ativo !== 'true' || !token || !chat) continue;

      // Verifica se está no horário certo (janela de 10 min)
      const agora  = new Date();
      const [hh, mm] = horario.split(':').map(Number);
      const alvo   = new Date(); alvo.setHours(hh, mm, 0, 0);
      const diff   = Math.abs(agora - alvo) / 60000;
      if (diff > 10) continue;

      // Verifica se já enviou hoje
      const ultimoEnvio = cfgGet(loja, 'telegram_ultimo_resumo');
      if (ultimoEnvio) {
        const ultimoDia = ultimoEnvio.split('T')[0];
        const hoje      = agora.toISOString().split('T')[0];
        if (ultimoDia === hoje) continue;
      }

      const msg = montarResumoDiario(loja);
      const r   = await enviarTelegram(token, chat, msg);
      if (r.ok) {
        const now    = new Date().toISOString();
        const upsert = db.prepare(`INSERT INTO configuracoes (id,chave,valor,loja_token,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(chave,loja_token) DO UPDATE SET valor=?,updated_at=?`);
        upsert.run(uuidv4(), 'telegram_ultimo_resumo', now, loja, now, now, now);
      }
      results.push({ loja, enviado: r.ok });

      // Verifica alertas críticos e envia
      const alertaEstoque = cfgGet(loja, 'alerta_estoque_ativo');
      if (alertaEstoque === 'true') {
        const zerados = db.prepare(`SELECT nome FROM produtos WHERE loja_token=? AND estoque=0 LIMIT 5`).all(loja);
        if (zerados.length > 0) {
          const msgAlerta = `⛔ <b>ALERTA DE ESTOQUE</b>\n\n` +
            zerados.map(p => `• ${p.nome}`).join('\n') + `\n\n` +
            `${zerados.length} produto(s) zerado(s). Acesse o sistema para repor.`;
          await enviarTelegram(token, chat, msgAlerta);
        }
      }
    } catch(e) {
      results.push({ loja, error: e.message });
    }
  }
  res.json({ data: { processadas: results.length, results }, error: null });
});

module.exports = router;
module.exports.montarResumoDiario = montarResumoDiario;
module.exports.enviarTelegram = enviarTelegram;
