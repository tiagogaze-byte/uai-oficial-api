/**
 * WhatsApp Webhook - Vercel Serverless Function
 * 
 * Este arquivo deve ser salvo em: /api/webhook.js
 */

export default async function handler(req, res) {
  // 1. Validação do Webhook (GET) - Token da Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Verifica se o modo e o token estão corretos
    // A variável process.env.VERIFY_TOKEN deve ser configurada na Vercel como: UAI_OFICIAL_2026
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

    // Verifica se é um evento da API do WhatsApp
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

          // Extração dos dados solicitados
          const wa_id = contact.wa_id;       // Número do remetente
          const name = contact.profile.name; // Nome do perfil
          const textBody = message.text ? message.text.body : ''; // Texto da mensagem

          console.log(`Nova mensagem de ${name} (${wa_id}): ${textBody}`);

          // ============================================================
          // ESPAÇO PARA A LÓGICA DO CLAUDINHO (BANCO DE DADOS)
          // TODO: Inserir aqui a chamada para salvar wa_id, name e textBody
          // Exemplo: await db.messages.create({ data: { wa_id, name, textBody } });
          // ============================================================

          return res.status(200).json({ status: 'success' });
        }
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      
      // Retornar 200 para outros eventos (como status de entrega) para evitar retentativas da Meta
      return res.status(200).end();
    } else {
      return res.status(404).end();
    }
  }

  // Método não permitido
  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
