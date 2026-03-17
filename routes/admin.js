// routes/admin.js
// Rotas exclusivas do Super Admin (sem autenticação JWT — protegidas por senha local)
const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { v4: uuidv4 } = require('uuid');

// ── USUÁRIOS ─────────────────────────────────────────────────────────────────

// GET /api/admin/usuarios  — lista todos
router.get('/usuarios', (req, res) => {
  const rows = db.prepare(
    'SELECT id,nome,email,senha_texto,perfil,loja_token,plano_nome,plano_inicio,plano_expiracao,ativo,ultimo_acesso,created_at,obs FROM usuarios ORDER BY created_at DESC'
  ).all();
  // converte ativo (0/1) para booleano
  res.json({ data: rows.map(u => ({ ...u, ativo: !!u.ativo })), error: null });
});

// POST /api/admin/usuarios  — criar
router.post('/usuarios', (req, res) => {
  const u = req.body;
  if (!u.nome || !u.email || !u.senha_hash)
    return res.json({ data: null, error: { message: 'nome, email e senha_hash obrigatórios' } });

  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(u.email.toLowerCase().trim());
  if (existe) return res.json({ data: null, error: { message: 'E-mail já cadastrado.' } });

  const id = uuidv4();
  db.prepare(`INSERT INTO usuarios (id,nome,email,senha_hash,senha_texto,perfil,loja_token,plano_nome,plano_inicio,plano_expiracao,ativo,obs)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      id, u.nome, u.email.toLowerCase().trim(), u.senha_hash, u.senha_texto || null,
      u.perfil || 'cliente', u.loja_token || 'padrao',
      u.plano_nome || 'Mensal', u.plano_inicio || null, u.plano_expiracao || null,
      u.ativo !== false ? 1 : 0, u.obs || ''
    );
  res.json({ data: { id }, error: null });
});

// PUT /api/admin/usuarios/:id  — editar
router.put('/usuarios/:id', (req, res) => {
  const u  = req.body;
  const { id } = req.params;

  // Monta update dinâmico (senha só muda se veio senha_hash)
  const sets  = ['nome=?','email=?','perfil=?','loja_token=?','plano_nome=?','plano_inicio=?','plano_expiracao=?','ativo=?','obs=?'];
  const vals  = [
    u.nome, u.email.toLowerCase().trim(), u.perfil || 'cliente',
    u.loja_token || 'padrao', u.plano_nome || 'Mensal',
    u.plano_inicio || null, u.plano_expiracao || null,
    u.ativo ? 1 : 0, u.obs || ''
  ];

  if (u.senha_hash) { sets.push('senha_hash=?'); vals.push(u.senha_hash); sets.push('senha_texto=?'); vals.push(u.senha_texto || null); }
  vals.push(id);

  db.prepare('UPDATE usuarios SET ' + sets.join(',') + ' WHERE id=?').run(...vals);
  res.json({ data: { id }, error: null });
});

// DELETE /api/admin/usuarios/:id
router.delete('/usuarios/:id', (req, res) => {
  db.prepare('DELETE FROM usuarios WHERE id=?').run(req.params.id);
  res.json({ data: { id: req.params.id }, error: null });
});

// ── CLIENTES (todas as lojas) ────────────────────────────────────────────────

router.get('/clientes', (req, res) => {
  const rows = db.prepare('SELECT * FROM clientes ORDER BY nome').all();
  res.json({ data: rows, error: null });
});

// ── BACKUP (coleta tudo para envio ao Telegram) ──────────────────────────────

router.get('/backup', (req, res) => {
  const tipo = req.query.tipo || 'completo'; // completo | clientes | produtos | vendas | agendamentos | usuarios
  const loja = req.query.loja_token || null;

  function query(sql, params = []) {
    return db.prepare(sql).all(...params);
  }

  try {
    let data;
    if (tipo === 'clientes') {
      data = { tabela: 'clientes', dados: query(loja ? 'SELECT * FROM clientes WHERE loja_token=? ORDER BY nome' : 'SELECT * FROM clientes ORDER BY nome', loja ? [loja] : []) };
    } else if (tipo === 'produtos') {
      data = { tabela: 'produtos', dados: query(loja ? 'SELECT * FROM produtos WHERE loja_token=? ORDER BY nome' : 'SELECT * FROM produtos ORDER BY nome', loja ? [loja] : []) };
    } else if (tipo === 'vendas') {
      data = { tabela: 'vendas', dados: query(loja ? 'SELECT * FROM vendas WHERE loja_token=? ORDER BY created_at DESC LIMIT 500' : 'SELECT * FROM vendas ORDER BY created_at DESC LIMIT 500', loja ? [loja] : []) };
    } else if (tipo === 'agendamentos') {
      data = { tabela: 'agendamentos', dados: query(loja ? 'SELECT * FROM agendamentos WHERE loja_token=? ORDER BY data_hora DESC LIMIT 500' : 'SELECT * FROM agendamentos ORDER BY data_hora DESC LIMIT 500', loja ? [loja] : []) };
    } else if (tipo === 'usuarios') {
      data = { tabela: 'usuarios', dados: query('SELECT id,nome,email,perfil,plano_nome,plano_expiracao,ativo,ultimo_acesso,created_at FROM usuarios') };
    } else {
      // completo — filtra por loja se informado
      data = {
        gerado_em:    new Date().toISOString(),
        loja:         loja || 'todas',
        clientes:     query(loja ? 'SELECT * FROM clientes WHERE loja_token=? ORDER BY nome'                          : 'SELECT * FROM clientes ORDER BY nome',                          loja ? [loja] : []),
        produtos:     query(loja ? 'SELECT * FROM produtos WHERE loja_token=? ORDER BY nome'                          : 'SELECT * FROM produtos ORDER BY nome',                          loja ? [loja] : []),
        vendas:       query(loja ? 'SELECT * FROM vendas WHERE loja_token=? ORDER BY created_at DESC LIMIT 500'       : 'SELECT * FROM vendas ORDER BY created_at DESC LIMIT 500',       loja ? [loja] : []),
        venda_itens:  query(loja ? 'SELECT * FROM venda_itens WHERE loja_token=? ORDER BY created_at DESC LIMIT 2000' : 'SELECT * FROM venda_itens ORDER BY created_at DESC LIMIT 2000', loja ? [loja] : []),
        agendamentos: query(loja ? 'SELECT * FROM agendamentos WHERE loja_token=? ORDER BY data_hora DESC LIMIT 500'  : 'SELECT * FROM agendamentos ORDER BY data_hora DESC LIMIT 500',  loja ? [loja] : []),
        usuarios:     query('SELECT id,nome,email,perfil,loja_token,plano_nome,plano_expiracao,ativo,ultimo_acesso,created_at FROM usuarios' + (loja ? ' WHERE loja_token=?' : ''), loja ? [loja] : []),
      };
    }
    res.json({ data, error: null });
  } catch(e) {
    res.json({ data: null, error: { message: e.message } });
  }
});

module.exports = router;
