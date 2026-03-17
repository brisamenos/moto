FROM node:20-alpine

# Dependências nativas para better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Instala dependências
COPY package.json ./
RUN npm install --production

# Copia todos os arquivos do projeto
COPY . .

# Volume para persistência do banco SQLite
RUN mkdir -p /data
ENV DB_PATH=/data/motostock.db

EXPOSE 3000

CMD ["node", "server.js"]
