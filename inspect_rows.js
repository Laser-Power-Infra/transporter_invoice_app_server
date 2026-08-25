import mysql from 'mysql2/promise';

async function test() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'Minmoy@1234@',
      database: 'invoice_db'
    });

    const [invoices] = await conn.query('SELECT COUNT(*) AS count FROM `Item Details`');
    const [purchases] = await conn.query('SELECT COUNT(*) AS count FROM `Invoice Details`');
    console.log('Invoices count in DB:', invoices[0].count);
    console.log('Purchases count in DB:', purchases[0].count);

    // Let's print the first row if there is one
    if (invoices[0].count > 0) {
      const [rows] = await conn.query('SELECT * FROM `Item Details` LIMIT 1');
      console.log('First Invoice row:', rows[0]);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (conn) await conn.end();
  }
}
test();
