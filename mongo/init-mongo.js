// Executa apenas na PRIMEIRA criação do volume. Cria um usuário da aplicação
// com permissão só no banco da agenda (a API não usa o root).
const dbName = process.env.MONGO_INITDB_DATABASE;
db = db.getSiblingDB(dbName);
db.createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: dbName }],
});
