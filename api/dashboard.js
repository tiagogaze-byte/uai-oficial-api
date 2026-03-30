import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // Apenas permite buscar dados (GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const client = await pool.connect();
    try {
      // 1. Conta o total de Leads únicos
      const leadsCount = await client.query('SELECT COUNT(*) FROM leads');
      
      // 2. Conta o total de mensagens no log
      const msgsCount = await client.query('SELECT COUNT(*) FROM messages_log');
      
      // 3. Pega as últimas 10 mensagens com o nome do eleitor
      const recentMsgs = await client.query(`
        SELECT 
          l.name AS nome_eleitor, 
          m.content AS mensagem, 
          m.created_at AS horario
        FROM messages_log m
        JOIN leads l ON m.lead_id = l.id
        ORDER BY m.created_at DESC
        LIMIT 10
      `);

      // 4. Envia o "pacote" completo para o Dashboard
      return res.status(200).json({
        totalLeads: leadsCount.rows[0].count,
        totalMessages: msgsCount.rows[0].count,
        recentMessages: recentMsgs.rows[0] ? recentMsgs.rows : []
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erro no Dashboard:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
}
