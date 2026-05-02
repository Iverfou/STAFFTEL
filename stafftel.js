// Vercel Serverless Function - api/stafftel.js
// Proxy Airtable + N8N — résout le CORS Airtable côté serveur

const AIRTABLE_TOKEN = process.env.AIRTABLE_STAFFTEL_TOKEN;
const AIRTABLE_BASE  = process.env.AIRTABLE_STAFFTEL_BASE || 'appGrgwkoEmYyWHLn';
const N8N_WEBHOOK    = process.env.N8N_STAFFTEL_WEBHOOK;

const TABLES = {
  staff:      'tblPmocIlPhl6yUtY',
  rooms:      'tblPZTC3cxUuMnhD8',
  planning:   'tbljr2yKOGVhPBlva',
};

// Helper : appel Airtable depuis le serveur (pas de CORS ici)
async function airtableFetch(tableId, params = '') {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}${params}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable ${r.status}: ${err}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { return res.status(405).json({ error: 'Method not allowed' }); }

  // ⚠️ Vercel ne parse pas req.body automatiquement
  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { action } = body;
  if (!action) return res.status(400).json({ error: 'Missing action' });

  try {

    // ─── LOAD : données initiales du dashboard ───────────────────────────────
    if (action === 'load_dashboard') {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      const [staffData, roomsData, planningData] = await Promise.all([
        airtableFetch(TABLES.staff),
        airtableFetch(TABLES.rooms),
        airtableFetch(TABLES.planning, `?filterByFormula=IS_SAME({Date},'${today}','day')`),
      ]);

      // Staff disponible = ceux dont Statut != 'Ausente'
      const staff = staffData.records.map(r => ({
        id: r.id,
        nombre: r.fields['Nombre'] || r.fields['Name'] || '',
        rol:    r.fields['Rol']    || r.fields['Role'] || '',
        statut: r.fields['Statut'] || r.fields['Status'] || 'Disponible',
      }));

      const rooms = roomsData.records.map(r => ({
        id:       r.id,
        numero:   r.fields['Numero'] || r.fields['Room'] || '',
        tipo:     r.fields['Tipo']   || '',
        statut:   r.fields['Statut'] || r.fields['Status'] || '',
      }));

      const planning = planningData.records.map(r => ({
        id:          r.id,
        staffNombre: r.fields['Staff']      || '',
        habitacion:  r.fields['Habitacion'] || '',
        horario:     r.fields['Horario']    || '',
        tarea:       r.fields['Tarea']      || '',
        statut:      r.fields['Statut']     || '',
      }));

      const staffDisponible = staff.filter(s =>
        s.statut !== 'Ausente' && s.statut !== 'Absent'
      ).length;

      const tiempoTotal = planning.reduce((acc, p) => {
        const match = String(p.horario).match(/(\d+)h?(\d+)?m?/);
        if (match) acc += parseInt(match[1] || 0) * 60 + parseInt(match[2] || 0);
        return acc;
      }, 0);

      const ocupacion = rooms.length
        ? Math.round((rooms.filter(r => r.statut === 'Ocupada').length / rooms.length) * 100)
        : 0;

      return res.status(200).json({
        success: true,
        data: { staff, rooms, planning, staffDisponible, tiempoTotal, ocupacion }
      });
    }

    // ─── REPORTAR AUSENCIA ───────────────────────────────────────────────────
    if (action === 'reportar_ausencia') {
      const { staffId, motivo } = body;
      if (!staffId) return res.status(400).json({ error: 'Missing staffId' });

      const r = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLES.staff}/${staffId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: { Statut: 'Ausente', Motivo: motivo || '' } })
        }
      );
      if (!r.ok) throw new Error(`Airtable PATCH ${r.status}`);
      return res.status(200).json({ success: true });
    }

    // ─── GENERAR PLANNING via N8N ─────────────────────────────────────────────
    if (action === 'generar_planning') {
      if (!N8N_WEBHOOK) return res.status(500).json({ error: 'N8N webhook not configured' });

      // Passe staff + rooms au webhook N8N pour qu'il génère le planning IA
      const [staffData, roomsData] = await Promise.all([
        airtableFetch(TABLES.staff),
        airtableFetch(TABLES.rooms),
      ]);

      const n8nRes = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generar_planning',
          timestamp: new Date().toISOString(),
          staff: staffData.records.map(r => ({
            id: r.id, nombre: r.fields['Nombre'] || '', rol: r.fields['Rol'] || '', statut: r.fields['Statut'] || 'Disponible'
          })),
          rooms: roomsData.records.map(r => ({
            id: r.id, numero: r.fields['Numero'] || '', tipo: r.fields['Tipo'] || '', statut: r.fields['Statut'] || ''
          })),
        })
      });

      const result = await n8nRes.json();
      return res.status(200).json({ success: true, data: result });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error) {
    console.error('StaffTel API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
