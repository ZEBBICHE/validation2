/* ============================================================
   /api/auth — connexion, déconnexion, session, mot de passe
   Actions (POST { action: … }) :
     connexion       { identifiant, motDePasse }
     deconnexion     {}
     session         {}  → qui suis-je
     motDePasse      { ancien, nouveau }
   ============================================================ */

import {
  lireUtilisateur, ecrireUtilisateur, verifierMotDePasse, hacherMotDePasse,
  controlerRobustesse, creerJeton, poserCookie, effacerCookie,
  utilisateurCourant, sansSecret, assurerAdministrateur, tracer,
  normaliserIdentifiant, tentativesTropNombreuses, enregistrerEchec,
  reinitialiserEchecs, corpsJson, NIVEAUX
} from './_lib/auth.js';
import { modeStockage, stockagePersistant } from './_lib/store.js';

export default async function handler(req, res) {
  try {
    const amorce = await assurerAdministrateur();

    if (req.method === 'GET') {
      const u = await utilisateurCourant(req);
      return res.status(200).json({
        ok: true,
        connecte: !!u,
        utilisateur: u ? sansSecret(u) : null,
        stockage: modeStockage(),
        persistant: stockagePersistant(),
        niveaux: NIVEAUX,
        amorce: amorce && amorce.motDePasse ? amorce : null
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
    }

    const body = corpsJson(req);
    const action = String(body.action || '');

    /* ---------- Connexion ---------- */
    if (action === 'connexion') {
      const identifiant = normaliserIdentifiant(body.identifiant);
      const motDePasse = String(body.motDePasse || '');

      if (!identifiant || !motDePasse) {
        return res.status(200).json({ ok: false, error: 'Identifiant et mot de passe requis.' });
      }

      if (await tentativesTropNombreuses(identifiant)) {
        await tracer(null, 'connexion.bloquee', identifiant);
        return res.status(200).json({
          ok: false,
          error: 'Trop de tentatives. Veuillez patienter un quart d’heure ou contacter l’administrateur.'
        });
      }

      const u = await lireUtilisateur(identifiant);
      /* Message identique dans tous les cas d'échec : on ne révèle pas
         si l'identifiant existe. */
      const echec = { ok: false, error: 'Identifiant ou mot de passe incorrect.' };

      if (!u || !verifierMotDePasse(motDePasse, u.empreinte)) {
        await enregistrerEchec(identifiant);
        await tracer(null, 'connexion.echec', identifiant);
        return res.status(200).json(echec);
      }
      if (u.actif === false) {
        await tracer(u, 'connexion.inactif', '');
        return res.status(200).json({
          ok: false,
          error: 'Ce compte est désactivé. Contactez l’administrateur.'
        });
      }

      await reinitialiserEchecs(identifiant);
      u.derniereConnexion = new Date().toISOString();
      await ecrireUtilisateur(u);

      poserCookie(res, await creerJeton(u));
      await tracer(u, 'connexion', '');

      return res.status(200).json({
        ok: true,
        utilisateur: sansSecret(u),
        doitChanger: !!u.doitChanger,
        stockage: modeStockage(),
        persistant: stockagePersistant()
      });
    }

    /* ---------- Déconnexion ---------- */
    if (action === 'deconnexion') {
      const u = await utilisateurCourant(req);
      effacerCookie(res);
      if (u) await tracer(u, 'deconnexion', '');
      return res.status(200).json({ ok: true });
    }

    /* ---------- Session courante ---------- */
    if (action === 'session') {
      const u = await utilisateurCourant(req);
      return res.status(200).json({
        ok: true,
        connecte: !!u,
        utilisateur: u ? sansSecret(u) : null,
        stockage: modeStockage(),
        persistant: stockagePersistant()
      });
    }

    /* ---------- Changement de mot de passe par l'intéressé ---------- */
    if (action === 'motDePasse') {
      const u = await utilisateurCourant(req);
      if (!u) return res.status(401).json({ ok: false, error: 'Session absente ou expirée.' });

      const ancien = String(body.ancien || '');
      const nouveau = String(body.nouveau || '');

      if (!verifierMotDePasse(ancien, u.empreinte)) {
        await tracer(u, 'motdepasse.echec', '');
        return res.status(200).json({ ok: false, error: 'Mot de passe actuel incorrect.' });
      }
      const souci = controlerRobustesse(nouveau);
      if (souci) return res.status(200).json({ ok: false, error: souci });
      if (verifierMotDePasse(nouveau, u.empreinte)) {
        return res.status(200).json({ ok: false, error: 'Le nouveau mot de passe doit différer de l’actuel.' });
      }

      u.empreinte = hacherMotDePasse(nouveau);
      u.doitChanger = false;
      u.motDePasseModifieLe = new Date().toISOString();
      await ecrireUtilisateur(u);
      await tracer(u, 'motdepasse.change', '');

      return res.status(200).json({ ok: true, utilisateur: sansSecret(u) });
    }

    return res.status(200).json({ ok: false, error: 'Action inconnue : ' + action });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
