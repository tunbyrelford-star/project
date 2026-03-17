const mysql = require("mysql2/promise");

const resolvedPassword =
  process.env.DB_PASSWORD
  || process.env.MYSQL_PWD
  || "123456";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: resolvedPassword,
  database: process.env.DB_NAME || "sand_logistics",
  connectionLimit: 10,
  waitForConnections: true,
  decimalNumbers: true,
  timezone: "+08:00"
});

async function withTransaction(handler) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await handler(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  withTransaction
};
