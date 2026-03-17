# MotoStock v2.1 — SQLite + EasyPanel

Sistema de gestão de peças para motos. Banco SQLite local na VPS — sem Supabase.

## Estrutura (tudo na raiz)

```
/
├── server.js         ← API Express + serve o frontend
├── db.js             ← SQLite, cria tabelas automaticamente
├── package.json
├── Dockerfile
├── index.html        ← Painel completo
└── routes/
    ├── auth.js
    ├── produtos.js
    ├── vendas.js
    ├── caixa.js
    ├── clientes.js
    ├── configuracoes.js
    └── extras.js     ← NF, agendamentos, catálogo
```

## Deploy no EasyPanel

1. **GitHub:** suba esta pasta inteira num repositório
2. **EasyPanel → New App → GitHub:**
   - Build: `Dockerfile`
   - Porta: `3000`
   - Volume persistente: `/data`
   - Env vars: `PORT=3000` | `DB_PATH=/data/motostock.db`
3. Acesse e faça login:
   - Email: `admin@motostock.com`
   - Senha: `admin123`

## Backup do banco

```bash
cp /data/motostock.db /data/backup_$(date +%Y%m%d).db
```
