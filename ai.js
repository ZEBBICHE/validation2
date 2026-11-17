/* ============================================================
   /api/ai — relais vers le service d'IA
   ------------------------------------------------------------
   La clé n'est jamais envoyée au navigateur : elle est lue dans
   les variables d'environnement du projet Vercel.
   Configurez, selon le service retenu, l'une des variables :
     GROQ_API_KEY      (gratuit)
     GEMINI_API_KEY    (gratuit)
     MISTRAL_API_KEY   (offre gratuite)
     ANTHROPIC_API_KEY (payant)
     OPENAI_API_KEY    (payant)
   ============================================================ */

const SERVICES = {
  groq: {
    env: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    style: 'openai'
  },
  gemini: {
    env: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    model: 'gemini-2.0-flash',
    style: 'gemini'
  },
  mistral: {
    env: 'MISTRAL_API_KEY',
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    style: 'openai'
  },
  anthropic: {
    env: 'ANTHROPIC_API_KEY',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    style: 'anthropic'
  },
  openai: {
    env: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    style: 'openai'
  }
};

/* Service utilisé par défaut : le premier dont la clé est configurée */
function serviceParDefaut() {
  const ordre = ['groq', 'gemini', 'mistral', 'anthropic', 'openai'];
  return ordre.find(k => process.env[SERVICES[k].env]) || null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    /* Permet à l'interface de savoir quels services sont disponibles,
       sans jamais révéler la moindre clé. */
    const dispo = Object.keys(SERVICES).filter(k => !!process.env[SERVICES[k].env]);
    return res.status(200).json({
      ok: true,
      services: dispo,
      defaut: serviceParDefaut(),
      configure: dispo.length > 0
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const nom = body.provider || serviceParDefaut();

    if (!nom) {
      return res.status(200).json({
        ok: false,
        error: "Aucune clé d'IA configurée sur le serveur. Ajoutez GROQ_API_KEY (ou GEMINI_API_KEY) dans les variables d'environnement du projet Vercel, puis redéployez."
      });
    }

    const conf = SERVICES[nom];
    if (!conf) {
      return res.status(200).json({ ok: false, error: 'Service inconnu : ' + nom });
    }

    const cle = process.env[conf.env];
    if (!cle) {
      return res.status(200).json({
        ok: false,
        error: `La variable ${conf.env} n'est pas définie sur le serveur.`
      });
    }

    const modele = body.model || conf.model;
    const system = String(body.system || '');
    const user = String(body.user || '');
    if (!user) {
      return res.status(200).json({ ok: false, error: 'Requête vide.' });
    }

    let url = conf.url.replace('{model}', encodeURIComponent(modele));
    const headers = { 'content-type': 'application/json' };
    let payload;

    if (conf.style === 'anthropic') {
      headers['x-api-key'] = cle;
      headers['anthropic-version'] = '2023-06-01';
      payload = {
        model: modele,
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: user }]
      };
    } else if (conf.style === 'gemini') {
      url += '?key=' + encodeURIComponent(cle);
      payload = {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 1200, temperature: 0.4 }
      };
    } else {
      headers['authorization'] = 'Bearer ' + cle;
      payload = {
        model: modele,
        max_tokens: 1200,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      };
    }

    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(200).json({
        ok: false,
        error: 'Service ' + nom + ' : HTTP ' + r.status + ' — ' + detail.slice(0, 300)
      });
    }

    const data = await r.json();
    let texte = '';
    if (conf.style === 'anthropic') {
      texte = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    } else if (conf.style === 'gemini') {
      const cand = (data.candidates || [])[0];
      texte = cand && cand.content
        ? (cand.content.parts || []).map(p => p.text || '').join('\n')
        : '';
    } else {
      const ch = (data.choices || [])[0];
      texte = ch && ch.message ? ch.message.content : '';
    }

    return res.status(200).json({ ok: true, text: String(texte).trim(), provider: nom, model: modele });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
