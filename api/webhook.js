/**
 * WhatsApp Webhook - Vercel Serverless Function com Banco de Dados Neon
 * 
 * Este arquivo deve ser salvo em: /api/webhook.js
 * Certifique-se de instalar a biblioteca: npm install pg
 */

import { Pool } from 'pg';

// Configuração do Banco de Dados Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões seguras com o Neon
  }
});

export default async function handler(req, res) {
  // 1. Validação do Webhook (GET) - Token da Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
      } else {
        return res.status(403).end();
      }
    }
  }

  // 2. Recebimento de Mensagens (POST) - WhatsApp Cloud API
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      try {
        if (
          body.entry &&
          body.entry[0].changes &&
          body.entry[0].changes[0].value.messages &&
          body.entry[0].changes[0].value.messages[0]
        ) {
          const message = body.entry[0].changes[0].value.messages[0];
          const contact = body.entry[0].changes[0].value.contacts[0];

          // Extração dos dados
          const wa_id = contact.wa_id;       // Número do remetente
          const name = contact.profile.name; // Nome do perfil
          const textBody = message.text ? message.text.body : ''; // Texto da mensagem
          
          // Tenant ID fixo para o teste inicial (conforme solicitado)
          const FIXED_TENANT_ID = 'tenant_teste_001';

          console.log(`Nova mensagem de ${name} (${wa_id}): ${textBody}`);

          // LÓGICA DE INSERÇÃO NO BANCO DE DADOS NEON
          const query = `
            INSERT INTO messages (wa_id, contact_name, message_body, tenant_id, created_at)
            VALUES ($1, $2, $3, $4, NOW())
          `;
          const values = [wa_id, name, textBody, FIXED_TENANT_ID];

          await pool.query(query, values);
          console.log('Mensagem salva com sucesso no banco Neon!');

          return res.status(200).json({ status: 'success' });
        }
      } catch (error) {
        console.error('Erro ao processar ou salvar mensagem:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      
      return res.status(200).end();
    } else {
      return res.status(404).end();
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
