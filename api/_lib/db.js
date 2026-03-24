const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL no está configurada todavía.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
