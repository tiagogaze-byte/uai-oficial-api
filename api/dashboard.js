import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const client = await pool.connect();
  try {

    // Total de leads únicos
    const leadsRes = await client.query(
      `SELECT COUNT(*) AS total FROM leads`
    );

    // Total de mensagens recebidas
    const msgsRes = await client.query(
      `SELECT COUNT(*) AS total FROM messages_log WHERE direction = 'inbound'`
    );

    // Últimas 10 interações com nome do lead e do tenant (cliente político)
    const recentRes = await client.query(
      `SELECT
         l.name          AS nome_eleitor,
         l.phone_number  AS telefone,
         m.content       AS mensagem,
         m.created_at    AS horario,
         t.name          AS cliente
       FROM messages_log m
       JOIN leads l ON m.lead_id = l.id
       JOIN tenants t ON l.tenant_id = t.id
       ORDER BY m.created_at DESC
       LIMIT 10`
    );

    // Leads por tenant (para futura view multi-cliente)
    const byTenantRes = await client.query(
      `SELECT
         t.name AS cliente,
         COUNT(l.id) AS total_leads,
         COUNT(m.id) AS total_mensagens
       FROM tenants t
       LEFT JOIN leads l ON l.tenant_id = t.id
       LEFT JOIN messages_log m ON m.lead_id = l.id
       GROUP BY t.id, t.name
       ORDER BY total_leads DESC`
    );

    return res.status(200).json({
      totalLeads:     parseInt(leadsRes.rows[0].total),
      totalMessages:  parseInt(msgsRes.rows[0].total),
      recentMessages: recentRes.rows,
      byTenant:       byTenantRes.rows,
    });

  } catch (error) {
    console.error('[DASHBOARD] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}
