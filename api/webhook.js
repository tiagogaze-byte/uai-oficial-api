import { Pool } from 'pg';

// Configuração robusta para o Neon Serverless
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // O segredo para evitar o erro de SSL no Neon é esta configuração:
  ssl: {
    rejectUnauthorized: false
  },
  max: 1, // Como é Serverless, mantemos poucas conexões para não estourar o limite do Neon
});

export default async function handler(req, res) {
  // 1. Validação do Webhook (Handshake da Meta)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  // 2. Processamento da Mensagem (Recebimento do Zap)
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

          console.log(`Recebido de ${name}: ${textBody}`);

          // Lógica de Inserção usando o Schema do Claudinho
          // Buscamos o primeiro Tenant e Instância criados no seu SQL anterior
          const client = await pool.connect();
          try {
            // 1. Upsert no Lead (Cria ou atualiza nome)
            const upsertLead = `
              INSERT INTO leads (phone_number, name, tenant_id)
              VALUES ($1, $2, (SELECT id FROM tenants LIMIT 1))
              ON CONFLICT (tenant_id, phone_number) DO UPDATE SET name = $2
              RETURNING id;
            `;
            const leadRes = await client.query(upsertLead, [wa_id, name]);
            const leadId = leadRes.rows[0].id;

            // 2. Grava no Log de Mensagens
            const insertMsg = `
              INSERT INTO messages_log (lead_id, content, direction, instance_id, raw_payload)
              VALUES ($1, $2, 'inbound', (SELECT id FROM whatsapp_instances LIMIT 1), $3);
            `;
            await client.query(insertMsg, [leadId, textBody, JSON.stringify(body)]);
            
            console.log('Dados salvos no Neon com sucesso!');
          } finally {
            client.release(); // Libera a conexão de volta para o pool
          }
        }
        return res.status(200).json({ status: 'success' });
      } catch (error) {
        // Log detalhado para o seu painel da Vercel
        console.error('ERRO DE BANCO:', error.message);
        return res.status(200).end(); // Respondemos 200 para a Meta não reenviar o erro
      }
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
}
