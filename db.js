// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOTOSTOCK — db.js
// Inicializa o banco SQLite e cria todas as tabelas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const Database = require('better-sqlite3');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'motostock.db');
const db = new Database(DB_PATH);

// Habilita WAL mode para melhor performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Criação das tabelas ──────────────────────────────────────────────────────

db.exec(`

CREATE TABLE IF NOT EXISTS usuarios (
  id           TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  senha_hash   TEXT NOT NULL,
  perfil       TEXT NOT NULL DEFAULT 'operador',
  ativo        INTEGER NOT NULL DEFAULT 1,
  loja_token   TEXT NOT NULL DEFAULT 'padrao',
  plano_nome       TEXT DEFAULT 'Mensal',
  plano_inicio     TEXT DEFAULT NULL,
  plano_expiracao  TEXT DEFAULT NULL,
  obs              TEXT DEFAULT '',
  ultimo_acesso    TEXT DEFAULT NULL,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produtos (
  id             TEXT PRIMARY KEY,
  sku            TEXT NOT NULL,
  nome           TEXT NOT NULL,
  categoria      TEXT DEFAULT 'Geral',
  marca          TEXT DEFAULT '',
  custo          REAL DEFAULT 0,
  preco_venda    REAL DEFAULT 0,
  estoque        INTEGER DEFAULT 0,
  estoque_minimo INTEGER DEFAULT 5,
  imagem_url     TEXT DEFAULT NULL,
  loja_token     TEXT NOT NULL DEFAULT 'padrao',
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendas (
  id              TEXT PRIMARY KEY,
  numero          INTEGER,
  cliente         TEXT DEFAULT 'Consumidor',
  total           REAL DEFAULT 0,
  desconto        REAL DEFAULT 0,
  forma_pagamento TEXT DEFAULT 'dinheiro',
  status          TEXT DEFAULT 'pago',
  loja_token      TEXT NOT NULL DEFAULT 'padrao',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venda_itens (
  id           TEXT PRIMARY KEY,
  venda_id     TEXT REFERENCES vendas(id) ON DELETE CASCADE,
  produto_id   TEXT,
  nome_produto TEXT,
  preco        REAL,
  quantidade   INTEGER,
  total        REAL,
  loja_token   TEXT DEFAULT 'padrao',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS caixa_lancamentos (
  id              TEXT PRIMARY KEY,
  tipo            TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
  descricao       TEXT,
  forma_pagamento TEXT DEFAULT 'dinheiro',
  valor           REAL NOT NULL,
  data            TEXT DEFAULT (date('now')),
  hora            TEXT,
  loja_token      TEXT NOT NULL DEFAULT 'padrao',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS caixa_sessoes (
  id             TEXT PRIMARY KEY,
  status         TEXT DEFAULT 'fechado',
  valor_abertura REAL DEFAULT 0,
  operador       TEXT DEFAULT 'Admin',
  abertura_at    TEXT DEFAULT NULL,
  fechamento_at  TEXT DEFAULT NULL,
  loja_token     TEXT NOT NULL DEFAULT 'padrao',
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracoes (
  id         TEXT PRIMARY KEY,
  chave      TEXT NOT NULL,
  valor      TEXT NOT NULL,
  loja_token TEXT NOT NULL DEFAULT 'padrao',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(chave, loja_token)
);

CREATE TABLE IF NOT EXISTS clientes (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  telefone      TEXT DEFAULT '',
  cpf_cnpj      TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  endereco      TEXT DEFAULT '',
  cidade        TEXT DEFAULT '',
  obs           TEXT DEFAULT '',
  total_compras INTEGER DEFAULT 0,
  total_gasto   REAL DEFAULT 0,
  loja_token    TEXT NOT NULL DEFAULT 'padrao',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notas_fiscais (
  id              TEXT PRIMARY KEY,
  numero          TEXT,
  tipo            TEXT DEFAULT 'NF-e',
  natureza        TEXT,
  destinatario    TEXT,
  cpf_cnpj        TEXT,
  produtos        TEXT,
  valor           REAL DEFAULT 0,
  forma_pagamento TEXT,
  obs             TEXT,
  loja_token      TEXT NOT NULL DEFAULT 'padrao',
  emissao         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id           TEXT PRIMARY KEY,
  cliente_nome TEXT NOT NULL,
  cliente_tel  TEXT DEFAULT '',
  servico      TEXT NOT NULL,
  data_hora    TEXT NOT NULL,
  duracao_min  INTEGER DEFAULT 60,
  valor        REAL DEFAULT 0,
  status       TEXT DEFAULT 'agendado',
  obs          TEXT DEFAULT '',
  loja_token   TEXT NOT NULL DEFAULT 'padrao',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalogo (
  id              TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  categoria       TEXT DEFAULT 'Geral',
  sku             TEXT DEFAULT '',
  preco           REAL DEFAULT 0,
  preco_promo     REAL DEFAULT 0,
  descricao       TEXT DEFAULT '',
  imagem_url      TEXT DEFAULT '',
  visivel         INTEGER DEFAULT 1,
  mostrar_estoque TEXT DEFAULT 'nao',
  loja_token      TEXT NOT NULL DEFAULT 'padrao',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendas_numero_seq (
  loja_token TEXT PRIMARY KEY,
  ultimo     INTEGER DEFAULT 0
);

`);

// ── Seed: usuário admin padrão (senha: admin123) ─────────────────────────────
// SHA-256 de "admin123"
const ADMIN_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

const adminExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get('admin@motostock.com');
if (!adminExiste) {
  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, ativo, loja_token)
              VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(uuidv4(), 'Administrador', 'admin@motostock.com', ADMIN_HASH, 'admin', 'padrao');
  console.log('✅ Usuário admin criado: admin@motostock.com / admin123');
}

// ── Seed: sessão de caixa inicial ─────────────────────────────────────────────
const sessaoExiste = db.prepare('SELECT id FROM caixa_sessoes WHERE loja_token = ?').get('padrao');
if (!sessaoExiste) {
  db.prepare(`INSERT INTO caixa_sessoes (id, status, valor_abertura, operador, loja_token)
              VALUES (?, 'fechado', 0, 'Admin', 'padrao')`
  ).run(uuidv4());
}

// ── Helper: próximo número de venda ──────────────────────────────────────────
function proximoNumeroVenda(loja_token) {
  const row = db.prepare('SELECT ultimo FROM vendas_numero_seq WHERE loja_token = ?').get(loja_token);
  const proximo = (row ? row.ultimo : 0) + 1;
  db.prepare(`INSERT INTO vendas_numero_seq (loja_token, ultimo) VALUES (?, ?)
              ON CONFLICT(loja_token) DO UPDATE SET ultimo = ?`
  ).run(loja_token, proximo, proximo);
  return proximo;
}

module.exports = { db, proximoNumeroVenda };
