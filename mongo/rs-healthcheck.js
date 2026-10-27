// Healthcheck + auto-inicialização do replica set (single node) necessário para transações.
try {
  rs.status();
} catch (e) {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
}
quit(db.hello().isWritablePrimary ? 0 : 1);
