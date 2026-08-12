'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.db);

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query };
