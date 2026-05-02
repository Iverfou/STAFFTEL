// Vercel Serverless Function - api/stafftel.js
// Purpose: Proxy N8N webhook calls from frontend dashboard

const N8N_WEBHOOK_URL = process.env.N8N_STAFFTEL_WEBHOOK;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const { action } = body;

    if (!action) {
      return res.status(400).json({ error: 'Missing action' });
    }

    // Forward to N8N
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        timestamp: new Date().toISOString(),
        ...body
      })
    });

    const result = await response.json();

    return res.status(200).json({
      success: true,
      action,
      data: result
    });

  } catch (error) {
    console.error('StaffTel API Error:', error);
    return res.status(500).json({
      error: error.message
    });
  }
}
