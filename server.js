// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOTOSTOCK — server.js
// API REST completa + serve index.html estático
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// Inicializa banco (cria tabelas + seed se necessário)
require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Helper: resolve rota de routes/ ou raiz ──────────────────────────────────
function route(name) {
  try { return require('./routes/' + name); }
  catch(e) { return require('./' + name); }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve index.html na raiz da mesma pasta
app.use(express.static(__dirname));

// ── Rotas API ─────────────────────────────────────────────────────────────────
app.use('/api/auth',           route('auth'));
app.use('/api/produtos',       route('produtos'));
app.use('/api/vendas',         route('vendas'));
app.use('/api/caixa',          route('caixa'));
app.use('/api/clientes',       route('clientes'));
app.use('/api/configuracoes',  route('configuracoes'));
app.use('/api/admin',          route('admin'));
app.use('/api',                route('extras'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.1', engine: 'SQLite' });
});

// ── Fallback: qualquer rota não-API serve o index.html ───────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MotoStock rodando na porta ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});
