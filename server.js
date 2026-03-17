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

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve index.html na raiz da mesma pasta
app.use(express.static(__dirname));

// ── Rotas API ─────────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/produtos',       require('./routes/produtos'));
app.use('/api/vendas',         require('./routes/vendas'));
app.use('/api/caixa',          require('./routes/caixa'));
app.use('/api/clientes',       require('./routes/clientes'));
app.use('/api/configuracoes',  require('./routes/configuracoes'));
app.use('/api/admin',          require('./routes/admin'));
app.use('/api',                require('./routes/extras'));

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
