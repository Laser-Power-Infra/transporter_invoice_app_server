import mysql from 'mysql2/promise';

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'Minmoy@1234@',
  database: 'invoice_db'
};

function cleanMySQLRows(rows) {
  return rows.map(row => {
    const cleaned = { ...row };
    delete cleaned.id;
    return cleaned;
  });
}

async function test() {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [tables] = await conn.query('SHOW TABLES');
    console.log('Tables query output:', tables);
    const tableNames = tables.map(t => Object.values(t)[0]);
    console.log('Extracted tableNames:', tableNames);
    
    let invoices = [];
    if (tableNames.includes('Item Details')) {
      const [rows] = await conn.query('SELECT * FROM `Item Details`');
      invoices = cleanMySQLRows(rows);
    }
    
    let purchases = [];
    if (tableNames.includes('Invoice Details')) {
      const [rows] = await conn.query('SELECT * FROM `Invoice Details`');
      purchases = cleanMySQLRows(rows);
    }

    console.log('Loaded from MySQL - Invoices count:', invoices.length);
    console.log('Loaded from MySQL - Purchases count:', purchases.length);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (conn) await conn.end();
  }
}
test();
