/* ============================================================
   /api/projects — les projets de validation, stockés sur Vercel
   Remplace l'ancien enregistrement dans un Google Sheet.
   Actions (POST { action: … }) :
     liste      {}                        → projets visibles par l'appelant
     charger    { id }
     creer      { nom, donnees?, partage? }
     enregistrer{ id, nom?, donnees, partage? }
     renommer   { id, nom }
     partager   { id, partage }
     supprimer  { id }
   ------------------------------------------------------------
   Visibilité : chacun voit ses propres projets, ceux partagés avec
   l'équipe, et — pour un valideur ou un administrateur — la totalité.
   ============================================================ */

import { exiger, tracer, corpsJson, rang } from './_lib/auth.js';
import { lire, ecrire, supprimer, lister } from './_lib/store.js';

const CLE = id => 'project:' + id;

function nouvelIdentifiant() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function peutVoir(p, u) {
  if (!p) return false;
  if (p.proprietaire === u.identifiant) return true;
  if (p.partage) return true;
  return rang(u.niveau) >= rang('valideur');
}

function peutModifier(p, u) {
  if (!p) return false;
  if (rang(u.niveau) < rang('redacteur')) return false;      /* un lecteur ne modifie rien */
  if (p.proprietaire === u.identifiant) return true;
  if (rang(u.niveau) >= rang('valideur')) return true;
  return !!p.partage;                                        /* projet d'équipe : modifiable */
}

function peutSupprimer(p, u) {
  if (!p) return false;
  if (p.proprietaire === u.identifiant) return true;
  return rang(u.niveau) >= rang('admin');
}

function entete(p) {
  return {
    id: p.id,
    nom: p.nom,
    proprietaire: p.proprietaire,
    partage: !!p.partage,
    creeLe: p.creeLe,
    majLe: p.majLe,
    majPar: p.majPar
  };
}

export default async function handler(req, res) {
  try {
    const u = await exiger(req, res, 'lecteur');
    if (!u) return;

    /* GET → liste, pour un chargement simple au démarrage */
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, projets: await listeVisible(u) });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
    }

    const body = corpsJson(req);
    const action = String(body.action || '');

    /* ---------- Liste ---------- */
    if (action === 'liste') {
      return res.status(200).json({ ok: true, projets: await listeVisible(u) });
    }

    /* ---------- Chargement ---------- */
    if (action === 'charger') {
      const p = await lire(CLE(String(body.id || '')));
      if (!p) return res.status(200).json({ ok: false, error: 'Projet introuvable.' });
      if (!peutVoir(p, u)) {
        return res.status(403).json({ ok: false, error: "Vous n'avez pas accès à ce projet." });
      }
      await tracer(u, 'projet.ouverture', p.nom);
      return res.status(200).json({
        ok: true,
        projet: entete(p),
        donnees: p.donnees || null,
        modifiable: peutModifier(p, u)
      });
    }

    /* ---------- Création ---------- */
    if (action === 'creer') {
      if (rang(u.niveau) < rang('redacteur')) {
        return res.status(403).json({ ok: false, error: 'Votre niveau d’accès ne permet pas de créer un projet.' });
      }
      const nom = String(body.nom || '').trim();
      if (!nom) return res.status(200).json({ ok: false, error: 'Le nom du projet est requis.' });

      const maintenant = new Date().toISOString();
      const p = {
        id: nouvelIdentifiant(),
        nom,
        proprietaire: u.identifiant,
        partage: body.partage === true,
        donnees: body.donnees || null,
        creeLe: maintenant,
        creePar: u.identifiant,
        majLe: maintenant,
        majPar: u.identifiant
      };
      await ecrire(CLE(p.id), p);
      await tracer(u, 'projet.creation', nom);
      return res.status(200).json({ ok: true, projet: entete(p) });
    }

    /* ---------- Enregistrement ---------- */
    if (action === 'enregistrer') {
      const id = String(body.id || '');
      const p = await lire(CLE(id));
      if (!p) return res.status(200).json({ ok: false, error: 'Projet introuvable. Enregistrez-le comme nouveau projet.' });
      if (!peutModifier(p, u)) {
        return res.status(403).json({ ok: false, error: "Vous n'avez pas le droit de modifier ce projet." });
      }
      if (body.nom !== undefined && String(body.nom).trim()) p.nom = String(body.nom).trim();
      if (body.partage !== undefined && peutSupprimer(p, u)) p.partage = body.partage === true;
      p.donnees = body.donnees || null;
      p.majLe = new Date().toISOString();
      p.majPar = u.identifiant;
      await ecrire(CLE(id), p);
      await tracer(u, 'projet.enregistrement', p.nom);
      return res.status(200).json({ ok: true, projet: entete(p) });
    }

    /* ---------- Renommage ---------- */
    if (action === 'renommer') {
      const p = await lire(CLE(String(body.id || '')));
      if (!p) return res.status(200).json({ ok: false, error: 'Projet introuvable.' });
      if (!peutModifier(p, u)) {
        return res.status(403).json({ ok: false, error: "Vous n'avez pas le droit de modifier ce projet." });
      }
      const nom = String(body.nom || '').trim();
      if (!nom) return res.status(200).json({ ok: false, error: 'Le nouveau nom est requis.' });
      const ancien = p.nom;
      p.nom = nom;
      p.majLe = new Date().toISOString();
      p.majPar = u.identifiant;
      await ecrire(CLE(p.id), p);
      await tracer(u, 'projet.renommage', ancien + ' → ' + nom);
      return res.status(200).json({ ok: true, projet: entete(p) });
    }

    /* ---------- Partage avec l'équipe ---------- */
    if (action === 'partager') {
      const p = await lire(CLE(String(body.id || '')));
      if (!p) return res.status(200).json({ ok: false, error: 'Projet introuvable.' });
      if (!peutSupprimer(p, u)) {
        return res.status(403).json({ ok: false, error: 'Seul le propriétaire du projet peut changer son partage.' });
      }
      p.partage = body.partage === true;
      p.majLe = new Date().toISOString();
      p.majPar = u.identifiant;
      await ecrire(CLE(p.id), p);
      await tracer(u, 'projet.partage', p.nom + ' : ' + (p.partage ? 'équipe' : 'privé'));
      return res.status(200).json({ ok: true, projet: entete(p) });
    }

    /* ---------- Suppression ---------- */
    if (action === 'supprimer') {
      const p = await lire(CLE(String(body.id || '')));
      if (!p) return res.status(200).json({ ok: false, error: 'Projet introuvable.' });
      if (!peutSupprimer(p, u)) {
        return res.status(403).json({ ok: false, error: 'Seul le propriétaire du projet ou un administrateur peut le supprimer.' });
      }
      await supprimer(CLE(p.id));
      await tracer(u, 'projet.suppression', p.nom);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: false, error: 'Action inconnue : ' + action });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}

async function listeVisible(u) {
  const cles = await lister('project:');
  const sortie = [];
  for (const c of cles) {
    const p = await lire(c);
    if (p && peutVoir(p, u)) {
      sortie.push(Object.assign(entete(p), {
        modifiable: peutModifier(p, u),
        supprimable: peutSupprimer(p, u),
        amoi: p.proprietaire === u.identifiant
      }));
    }
  }
  sortie.sort((a, b) => String(b.majLe || '').localeCompare(String(a.majLe || '')));
  return sortie;
}
