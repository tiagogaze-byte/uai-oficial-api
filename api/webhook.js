import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      try {
        const entry = body.entry?.[0];
        const change = entry?.changes?.[0]?.value;
        const message = change?.messages?.[0];
        const contact = change?.contacts?.[0];

        if (message && contact) {
          const wa_id = contact.wa_id;
          const name = contact.profile.name;
          const textBody = message.text?.body || '';

          // 1. Registrar o Lead (ou atualizar se já existir)
          // Usamos um ID fixo de tenant para este teste inicial
          const upsertLead = `
            INSERT INTO leads (phone_number, name, tenant_id)
            VALUES ($1, $2, (SELECT id FROM tenants LIMIT 1))
            ON CONFLICT (tenant_id, phone_number) DO UPDATE SET name = $2
            RETURNING id;
          `;
          
          const leadRes = await pool.query(upsertLead, [wa_id, name]);
          const leadId = leadRes.rows[0].id;

          // 2. Salvar a Mensagem no Log do Claudinho
          const insertMsg = `
            INSERT INTO messages_log (lead_id, content, direction, instance_id)
            VALUES ($1, $2, 'inbound', (SELECT id FROM whatsapp_instances LIMIT 1));
          `;
          
          await pool.query(insertMsg, [leadId, textBody]);
          console.log(`Sucesso! Mensagem de ${name} salva.`);
        }
        return res.status(200).json({ status: 'success' });
      } catch (error) {
        console.error('Erro no banco:', error);
        return res.status(200).end(); // Respondemos 200 para a Meta não ficar tentando de novo
      }
    }
  }
  res.status(405).end();
}
