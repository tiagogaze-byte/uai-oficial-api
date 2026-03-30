import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const client = await pool.connect();
    try {
      // Busca o total de leads e mensagens
      const leads = await client.query('SELECT COUNT(*) FROM leads');
      const msgs = await client.query('SELECT COUNT(*) FROM messages_log');
      
      // Busca as últimas 10 interações para a tabela
      const recent = await client.query(`
        SELECT l.name as nome_eleitor, m.content as mensagem, m.created_at as horario
        FROM messages_log m
        JOIN leads l ON m.lead_id = l.id
        ORDER BY m.created_at DESC LIMIT 10
      `);

      return res.status(200).json({
        totalLeads: leads.rows[0].count,
        totalMessages: msgs.rows[0].count,
        recentMessages: recent.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
