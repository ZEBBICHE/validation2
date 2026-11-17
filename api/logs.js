/* ============================================================
   /api/logs — journal des actions (réservé à l'administrateur)
   ============================================================ */

import { exiger, corpsJson } from './_lib/auth.js';
import { lireJournal, modeStockage, stockagePersistant, lister, lire } from './_lib/store.js';

export default async function handler(req, res) {
  try {
    const admin = await exiger(req, res, 'admin');
    if (!admin) return;

    const body = req.method === 'POST' ? corpsJson(req) : {};
    const limite = Math.min(parseInt(body.limite || 200, 10) || 200, 500);

    /* Quelques chiffres pour la page d'administration */
    const clesProjets = await lister('project:');
    let projets = 0, octets = 0;
    for (const c of clesProjets) {
      const p = await lire(c);
      if (p) { projets++; octets += JSON.stringify(p).length; }
    }
    const clesUtilisateurs = await lister('user:');

    return res.status(200).json({
      ok: true,
      journal: await lireJournal(limite),
      etat: {
        stockage: modeStockage(),
        persistant: stockagePersistant(),
        projets,
        utilisateurs: clesUtilisateurs.length,
        volumeKo: Math.round(octets / 1024)
      }
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
