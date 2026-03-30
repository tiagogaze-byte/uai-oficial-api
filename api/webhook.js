import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

    // A Meta sempre envia este campo — é a nossa porta de entrada
    if (body.object !== 'whatsapp_business_account') {
      return res.status(200).end();
    }

    // Respondemos 200 IMEDIATAMENTE para a Meta não reenviar
    res.status(200).json({ status: 'received' });

    // Processamento assíncrono (não bloqueia a resposta)
    processMessage(body).catch(err =>
      console.error('[WEBHOOK] Erro no processamento:', err.message)
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

  // Ignora eventos que não sejam mensagens (ex: status de entrega)
  if (!message || !contact) {
    console.log('[WEBHOOK] Evento ignorado (sem mensagem/contato).');
    return;
  }

  // ── ROTEAMENTO REAL: identifica o cliente pelo phone_number_id ──
  // Este é o coração do multi-tenant:
  // cada número de WhatsApp cadastrado pertence a um cliente (tenant)
  const phoneNumberId = change?.metadata?.phone_number_id;

  const wa_id    = contact.wa_id;
  const name     = contact.profile?.name || 'Sem nome';
  const textBody = message.text?.body || '';
  const msgType  = message.type || 'text';

  console.log(`[WEBHOOK] Mensagem de ${name} (${wa_id}) via instância ${phoneNumberId}: "${textBody}"`);

  const client = await pool.connect();
  try {
    // 1. Busca a instância pelo phone_number_id real da Meta
    const instanceRes = await client.query(
      `SELECT id, tenant_id FROM whatsapp_instances WHERE phone_number_id = $1 LIMIT 1`,
      [phoneNumberId]
    );

    if (instanceRes.rows.length === 0) {
      // Instância não cadastrada — loga e ignora (não vai estourar erro)
      console.warn(`[WEBHOOK] Instância não encontrada para phone_number_id: ${phoneNumberId}`);
      return;
    }

    const instanceId = instanceRes.rows[0].id;
    const tenantId   = instanceRes.rows[0].tenant_id;

    // 2. Upsert no Lead (cria se novo, atualiza nome se mudou)
    const leadRes = await client.query(
      `INSERT INTO leads (phone_number, name, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, phone_number) DO UPDATE SET name = $2
       RETURNING id`,
      [wa_id, name, tenantId]
    );
    const leadId = leadRes.rows[0].id;

    // 3. Grava a mensagem no log
    await client.query(
      `INSERT INTO messages_log (lead_id, content, direction, instance_id, raw_payload)
       VALUES ($1, $2, 'inbound', $3, $4)`,
      [leadId, textBody, instanceId, JSON.stringify(body)]
    );

    console.log(`[WEBHOOK] ✓ Mensagem salva — Lead: ${leadId} | Tenant: ${tenantId}`);

  } finally {
    client.release();
  }
}
