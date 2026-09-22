// middleware/auth.js
// Autenticação por token de sessão + isolamento de dados por loja (multi-loja)
const crypto = require('crypto');
const { db } = require('../db');

// Rotas liberadas sem login
const PUBLICAS = [
  { metodo: 'POST', caminho: /^\/auth\/login\/?$/ },
  { metodo: 'GET',  caminho: /^\/publico\// },
  { metodo: 'GET',  caminho: /^\/health\/?$/ },
  { metodo: 'GET',  caminho: /^\/notificacoes\/cron\/?$/ }, // protegida por CRON_SECRET
];

function criarSessao(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token, usuario_id, created_at) VALUES (?, ?, ?)')
    .run(token, usuarioId, new Date().toISOString());
  return token;
}

function encerrarSessoesDoUsuario(usuarioId) {
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId);
}

function planoExpirado(user) {
  if (!user.plano_expiracao) return false;
  const exp = new Date(String(user.plano_expiracao).slice(0, 10) + 'T23:59:59-03:00');
  return exp < new Date();
}

function negar(res, msg) {
  return res.status(401).json({ data: null, error: { message: msg, auth: true } });
}

// Força o loja_token do usuário em query e body (impede acessar outra loja)
function forcarLoja(req, loja) {
  if (req.query && typeof req.query === 'object') req.query.loja_token = loja;
  const b = req.body;
  if (Array.isArray(b)) {
    b.forEach(item => { if (item && typeof item === 'object') item.loja_token = loja; });
  } else if (b && typeof b === 'object') {
    b.loja_token = loja;
    // itens aninhados (vendas, orçamentos, OS)
    Object.keys(b).forEach(k => {
      if (Array.isArray(b[k])) b[k].forEach(i => { if (i && typeof i === 'object' && 'loja_token' in i) i.loja_token = loja; });
    });
  }
}

function autenticar(req, res, next) {
  const livre = PUBLICAS.some(p => p.metodo === req.method && p.caminho.test(req.path));
  if (livre || req.method === 'OPTIONS') return next();

  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return negar(res, 'Faça login para continuar.');

  const user = db.prepare(`SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`).get(token);
  if (!user) return negar(res, 'Sessão expirada. Faça login novamente.');

  if (!user.ativo) {
    encerrarSessoesDoUsuario(user.id);
    return negar(res, 'Acesso bloqueado. Entre em contato com o suporte.');
  }
  if (user.perfil !== 'superadmin' && planoExpirado(user)) {
    encerrarSessoesDoUsuario(user.id);
    return negar(res, 'Seu plano venceu em ' + String(user.plano_expiracao).slice(0, 10).split('-').reverse().join('/') + '. Entre em contato para renovar.');
  }

  const superadmin = user.perfil === 'superadmin';

  // Área do super admin
  if ((/^\/admin(\/|$)/.test(req.path) || /^\/auth\/usuario\/?$/.test(req.path)) && !superadmin) {
    return res.status(403).json({ data: null, error: { message: 'Acesso restrito ao Super Admin.' } });
  }

  const { senha_hash, senha_texto, ...seguro } = user;
  req.usuario = seguro;
  req.token   = token;

  // Lojistas só enxergam a própria loja. O super admin pode operar qualquer loja.
  if (!superadmin) forcarLoja(req, user.loja_token);

  next();
}

module.exports = { autenticar, criarSessao, encerrarSessoesDoUsuario, planoExpirado };
