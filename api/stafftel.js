// Vercel Serverless Function - api/stafftel.js
// FIX: req.body is undefined on Vercel — always parse manually

const N8N_WEBHOOK_URL = process.env.N8N_STAFFTEL_WEBHOOK;

export default async function handler(req, res) {
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
    // FIX #1: req.body undefined on Vercel — parse manually
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON body')); }
      });
      req.on('error', reject);
    });

    const { action, date } = body;

    if (!action) {
      return res.status(400).json({ error: 'Missing action' });
    }

    // FIX #2: Pass date to N8N so it can filter by the correct day
    // date defaults to today if not provided
    const targetDate = date || new Date().toISOString().split('T')[0];
    const jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const jourSemaine = jours[new Date(targetDate + 'T12:00:00').getDay()];

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        date: targetDate,
        jourSemaine,
        timestamp: new Date().toISOString(),
        ...body
      })
    });

    if (!response.ok) {
      throw new Error(`N8N responded ${response.status}`);
    }

    const result = await response.json();

    return res.status(200).json({
      success: true,
      action,
      date: targetDate,
      data: result
    });

  } catch (error) {
    console.error('StaffTel API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
