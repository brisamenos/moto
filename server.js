// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOTOSTOCK — server.js v2.2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const cors    = require('cors');
const path    = require('path');

require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

function route(name) {
  try { return require('./routes/' + name); }
  catch(e) { return require('./' + name); }
}

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => /\.(db|db-wal|db-shm|sqlite)$/i.test(req.path) ? res.status(404).end() : next());
app.use(express.static(__dirname));

// Login obrigatório + isolamento por loja em toda a API
const { autenticar } = require('./middleware/auth');
app.use('/api', autenticar);
app.use('/api/publico',        route('publico'));

app.use('/api/auth',           route('auth'));
app.use('/api/produtos',       route('produtos'));
app.use('/api/vendas',         route('vendas'));
app.use('/api/caixa',          route('caixa'));
app.use('/api/clientes',       route('clientes'));
app.use('/api/configuracoes',  route('configuracoes'));
app.use('/api/admin',          route('admin'));
app.use('/api/orcamentos',     route('orcamentos'));
app.use('/api/os',             route('ordens_servico'));
app.use('/api/relatorios',     route('relatorios'));
app.use('/api/fornecedores',   route('fornecedores'));
app.use('/api/contas-pagar',   route('contas_pagar'));
app.use('/api/notificacoes',   route('notificacoes'));
app.use('/api',                route('extras'));

// ── Cron interno — disparo automático de resumos Telegram ─────────────────
// Roda a cada 5 minutos e verifica se alguma loja tem resumo agendado
setInterval(async function cronNotificacoes() {
  try {
    const { db } = require('./db');
    const { montarResumoDiario, enviarTelegram } = require('./notificacoes');
    const { v4: uuidv4 } = require('uuid');

    function cfgGet(loja, chave) {
      const r = db.prepare('SELECT valor FROM configuracoes WHERE loja_token=? AND chave=?').get(loja, chave);
      return r ? r.valor : null;
    }

    const lojas = db.prepare(`SELECT DISTINCT loja_token FROM usuarios WHERE ativo=1`).all();
    for (const { loja_token: loja } of lojas) {
      const ativo   = cfgGet(loja, 'telegram_ativo');
      const token   = cfgGet(loja, 'telegram_bot_token');
      const chat    = cfgGet(loja, 'telegram_chat_id');
      const horario = cfgGet(loja, 'resumo_horario') || '20:00';
      if (ativo !== 'true' || !token || !chat) continue;

      const agora = new Date();
      const [hh, mm] = horario.split(':').map(Number);
      const alvo  = new Date(); alvo.setHours(hh, mm, 0, 0);
      if (Math.abs(agora - alvo) / 60000 > 5) continue;

      const ultimoEnvio = cfgGet(loja, 'telegram_ultimo_resumo');
      if (ultimoEnvio && ultimoEnvio.split('T')[0] === agora.toISOString().split('T')[0]) continue;

      const msg = montarResumoDiario(loja);
      const r   = await enviarTelegram(token, chat, msg);
      if (r.ok) {
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO configuracoes (id,chave,valor,loja_token,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(chave,loja_token) DO UPDATE SET valor=?,updated_at=?`)
          .run(uuidv4(), 'telegram_ultimo_resumo', now, loja, now, now, now);
        console.log(`[cron] Resumo Telegram enviado → loja: ${loja}`);
      }

      // Alerta de estoque crítico
      const alertaEst = cfgGet(loja, 'alerta_estoque_ativo');
      if (alertaEst === 'true') {
        const zerados = db.prepare(`SELECT nome FROM produtos WHERE loja_token=? AND estoque=0 LIMIT 5`).all(loja);
        if (zerados.length > 0) {
          const msgZ = `⛔ <b>ESTOQUE ZERADO</b>\n` + zerados.map(p => `• ${p.nome}`).join('\n');
          await enviarTelegram(token, chat, msgZ);
        }
      }
    }
  } catch(e) {
    console.error('[cron] Erro:', e.message);
  }
}, 5 * 60 * 1000); // a cada 5 minutos

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.3', engine: 'SQLite' });
});

// ── Busca Global ──────────────────────────────────────────────────────────────
app.get('/api/busca', (req, res) => {
  const { db } = require('./db');
  const { q, loja_token } = req.query;
  if (!q || q.length < 2) return res.json({ data: { produtos: [], clientes: [], vendas: [], orcamentos: [], os: [] }, error: null });

  const loja  = loja_token || 'padrao';
  const termo = '%' + q + '%';

  try {
    const produtos   = db.prepare(`SELECT id,'produto' as tipo,nome as titulo,sku as sub,preco_venda as valor FROM produtos WHERE loja_token=? AND (nome LIKE ? OR sku LIKE ?) LIMIT 6`).all(loja, termo, termo);
    const clientes   = db.prepare(`SELECT id,'cliente' as tipo,nome as titulo,telefone as sub,total_gasto as valor FROM clientes WHERE loja_token=? AND (nome LIKE ? OR telefone LIKE ? OR cpf_cnpj LIKE ?) LIMIT 6`).all(loja, termo, termo, termo);
    const vendas     = db.prepare(`SELECT id,'venda' as tipo,'Venda #'||numero as titulo,cliente as sub,total as valor FROM vendas WHERE loja_token=? AND (cliente LIKE ? OR CAST(numero as TEXT) LIKE ?) ORDER BY created_at DESC LIMIT 6`).all(loja, termo, termo);
    const orcamentos = db.prepare(`SELECT id,'orcamento' as tipo,'Orçamento #'||numero as titulo,cliente as sub,total as valor FROM orcamentos WHERE loja_token=? AND (cliente LIKE ? OR CAST(numero as TEXT) LIKE ?) ORDER BY updated_at DESC LIMIT 6`).all(loja, termo, termo);
    const os         = db.prepare(`SELECT id,'os' as tipo,'OS #'||numero as titulo,placa||' — '||modelo_moto as sub,total as valor FROM ordens_servico WHERE loja_token=? AND (placa LIKE ? OR cliente_nome LIKE ? OR modelo_moto LIKE ?) ORDER BY created_at DESC LIMIT 6`).all(loja, termo, termo, termo);

    res.json({ data: { produtos, clientes, vendas, orcamentos, os }, error: null });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

// ── Dashboard stats endpoint ──────────────────────────────────────────────────
app.get('/api/dashboard/stats', (req, res) => {
  const { db } = require('./db');
  const loja   = req.query.loja_token || 'padrao';
  const hoje   = new Date().toISOString().split('T')[0];
  const mesIni = hoje.slice(0, 7) + '-01';

  try {
    const vendas_mes    = db.prepare(`SELECT COALESCE(SUM(total),0) as v, COUNT(*) as c FROM vendas WHERE loja_token=? AND created_at >= ?`).get(loja, mesIni);
    const vendas_hoje   = db.prepare(`SELECT COALESCE(SUM(total),0) as v, COUNT(*) as c FROM vendas WHERE loja_token=? AND date(created_at)=?`).get(loja, hoje);
    const caixa_hoje    = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) as ent, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) as sai FROM caixa_lancamentos WHERE loja_token=? AND data=?`).get(loja, hoje);
    const estoque       = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN estoque <= estoque_minimo THEN 1 ELSE 0 END) as rupturas, SUM(estoque*custo) as valor_estoque FROM produtos WHERE loja_token=?`).get(loja);
    const clientes_total= db.prepare(`SELECT COUNT(*) as c FROM clientes WHERE loja_token=?`).get(loja);
    const orc_abertos   = db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(total),0) as v FROM orcamentos WHERE loja_token=? AND status='aberto'`).get(loja);
    const ticket_medio  = db.prepare(`SELECT COALESCE(AVG(total),0) as v FROM vendas WHERE loja_token=? AND created_at >= ?`).get(loja, mesIni);
    const top_produtos  = db.prepare(`
      SELECT vi.nome_produto as nome, SUM(vi.quantidade) as qtd, SUM(vi.total) as receita
      FROM venda_itens vi JOIN vendas v ON v.id=vi.venda_id
      WHERE v.loja_token=? AND v.created_at >= ?
      GROUP BY vi.nome_produto ORDER BY qtd DESC LIMIT 5
    `).all(loja, mesIni);
    const vendas_7dias  = db.prepare(`
      SELECT date(created_at) as dia, COALESCE(SUM(total),0) as total, COUNT(*) as qtd
      FROM vendas WHERE loja_token=? AND date(created_at) >= date('now','-6 days')
      GROUP BY dia ORDER BY dia
    `).all(loja);
    const vendas_12m    = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as mes, COALESCE(SUM(total),0) as total, COUNT(*) as qtd
      FROM vendas WHERE loja_token=? AND created_at >= date('now','-12 months')
      GROUP BY mes ORDER BY mes
    `).all(loja);
    const ultimas_vendas = db.prepare(`SELECT * FROM vendas WHERE loja_token=? ORDER BY created_at DESC LIMIT 10`).all(loja);
    const margem_mes    = db.prepare(`
      SELECT COALESCE(SUM((vi.preco - p.custo)*vi.quantidade),0) as margem
      FROM venda_itens vi
      JOIN produtos p ON p.id=vi.produto_id
      JOIN vendas v ON v.id=vi.venda_id
      WHERE v.loja_token=? AND v.created_at >= ?
    `).get(loja, mesIni);

    res.json({
      data: {
        vendas_mes:      { total: vendas_mes.v,    qtd: vendas_mes.c },
        vendas_hoje:     { total: vendas_hoje.v,   qtd: vendas_hoje.c },
        caixa_hoje:      { entradas: caixa_hoje.ent, saidas: caixa_hoje.sai, saldo: caixa_hoje.ent - caixa_hoje.sai },
        estoque:         { total: estoque.total, rupturas: estoque.rupturas, valor: estoque.valor_estoque || 0 },
        clientes:        { total: clientes_total.c },
        orcamentos:      { abertos: orc_abertos.c, valor: orc_abertos.v },
        ticket_medio:    ticket_medio.v,
        margem_mes:      margem_mes.margem || 0,
        top_produtos,
        vendas_7dias,
        vendas_12m,
        ultimas_vendas,
      },
      error: null
    });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MotoStock v2.2 rodando na porta ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});
