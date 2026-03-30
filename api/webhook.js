import { Pool } from 'pg';

// Remove qualquer parâmetro de SSL da URL para evitar conflito
const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]ssl=[^&]*/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

export default async function handler(req, res) {

  // ── 1. HANDSHAKE DA META (GET) ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('[WEBHOOK] Verificado com sucesso.');
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  // ── 2. RECEBIMENTO DE MENSAGEM (POST) ──────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.status(200).end();
    }

    // Responde 200 IMEDIATAMENTE para a Meta não reenviar
    res.status(200).json({ status: 'received' });

    // Processamento assíncrono
    processMessage(body).catch(err =>
      console.error('[WEBHOOK] Erro no processamento:', err.message, err.stack)
    );

    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
}

// ── PROCESSAMENTO PRINCIPAL ──────────────────────────────────────────────────
async function processMessage(body) {
  const entry   = body.entry?.[0];
  const change  = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  const contact = change?.contacts?.[0];

  if (!message || !contact) {
    console.log('[WEBHOOK] Evento ignorado (sem mensagem/contato).');
    return;
  }

  const phoneNumberId = change?.metadata?.phone_number_id;
  const wa_id         = contact.wa_id;
  const name          = contact.profile?.name || 'Sem nome';
  const textBody      = message.text?.body || '';

  console.log(`[WEBHOOK] Mensagem de ${name} (${wa_id}) via instância ${phoneNumberId}: "${textBody}"`);
  console.log(`[WEBHOOK] Conectando ao banco...`);

  let client;
  try {
    client = await pool.connect();
    console.log(`[WEBHOOK] Conexão OK. Buscando instância ${phoneNumberId}...`);

    // 1. Busca instância pelo phone_number_id
    const instanceRes = await client.query(
      `SELECT id, tenant_id FROM whatsapp_instances WHERE phone_number_id = $1 LIMIT 1`,
      [phoneNumberId]
    );

    if (instanceRes.rows.length === 0) {
      console.warn(`[WEBHOOK] ⚠️ Instância não encontrada para phone_number_id: ${phoneNumberId}`);
      // Lista todas as instâncias para debug
      const allInstances = await client.query(`SELECT id, phone_number_id, label FROM whatsapp_instances`);
      console.log(`[WEBHOOK] Instâncias no banco:`, JSON.stringify(allInstances.rows));
      return;
    }

    const instanceId = instanceRes.rows[0].id;
    const tenantId   = instanceRes.rows[0].tenant_id;
    console.log(`[WEBHOOK] Instância encontrada: ${instanceId} | Tenant: ${tenantId}`);

    // 2. Upsert no Lead
    const leadRes = await client.query(
      `INSERT INTO leads (phone_number, name, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, phone_number) DO UPDATE SET name = $2
       RETURNING id`,
      [wa_id, name, tenantId]
    );
    const leadId = leadRes.rows[0].id;
    console.log(`[WEBHOOK] Lead upsert OK: ${leadId}`);

    // 3. Grava a mensagem
    await client.query(
      `INSERT INTO messages_log (lead_id, content, direction, instance_id, raw_payload)
       VALUES ($1, $2, 'inbound', $3, $4)`,
      [leadId, textBody, instanceId, JSON.stringify(body)]
    );

    console.log(`[WEBHOOK] ✓ Mensagem salva — Lead: ${leadId} | Tenant: ${tenantId}`);

  } catch (err) {
    console.error('[WEBHOOK] ERRO BANCO:', err.message);
    console.error('[WEBHOOK] STACK:', err.stack);
  } finally {
    if (client) client.release();
  }
}
