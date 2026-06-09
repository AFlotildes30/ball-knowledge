module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ narrative: null });

  const { p1, p2, series } = req.body || {};
  if (!p1 || !p2 || !series) return res.status(400).json({ error: 'Missing fields' });

  const winner = series.p1Won ? 'Team 1' : 'Team 2';
  const winScore = series.p1Won ? series.p1W : series.p2W;
  const loseScore = series.p1Won ? series.p2W : series.p1W;
  const wRoster = series.p1Won ? p1 : p2;
  const lRoster = series.p1Won ? p2 : p1;
  const mvp = series.mvp;
  const modText = (series.modDetails || []).length
    ? ' Key factors: ' + series.modDetails.map(m => m.name + ' favored ' + (m.p1 ? 'Team 1' : 'Team 2')).join(', ') + '.'
    : '';
  const gameLog = (series.games || []).map(g => `Game ${g.game}: ${g.p1Won ? 'Team 1' : 'Team 2'} (series ${g.p1W}-${g.p2W})`).join('; ');
  const prompt = `You are an ESPN NBA analyst writing a punchy 3-4 sentence series recap. Be specific, name players, reference actual game results.

Series result: ${winner} wins ${winScore}-${loseScore}
Team 1: ${p1.map(p => p.name + ' (' + p.rT + ' ' + p.rE + ')').join(', ')}
Team 2: ${p2.map(p => p.name + ' (' + p.rT + ' ' + p.rE + ')').join(', ')}
Game log: ${gameLog}
Series MVP: ${mvp.name} (${mvp.rT} ${mvp.rE})${modText}

Write exactly 3-4 sentences. Sound like a broadcast analyst wrapping up a playoff series.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    const narrative = data?.content?.[0]?.text || null;
    res.status(200).json({ narrative });
  } catch (e) {
    res.status(200).json({ narrative: null });
  }
};
