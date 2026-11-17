/* ============================================================
   /api/users — gestion des comptes (réservé à l'administrateur)
   Actions (POST { action: … }) :
     liste         {}
     creer         { identifiant, nom, prenom, titre, niveau, motDePasse, actif }
     modifier      { identifiant, nom, prenom, titre, niveau, actif }
     reinitialiser { identifiant, motDePasse }
     supprimer     { identifiant }
   ============================================================ */

import {
  exiger, lireUtilisateur, ecrireUtilisateur, supprimerUtilisateur,
  listerUtilisateurs, hacherMotDePasse, controlerRobustesse, sansSecret,
  normaliserIdentifiant, tracer, reinitialiserEchecs, corpsJson, NIVEAUX
} from './_lib/auth.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const admin = await exiger(req, res, 'admin');
      if (!admin) return;
      return res.status(200).json({ ok: true, utilisateurs: await listerUtilisateurs(), niveaux: NIVEAUX });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
    }

    const admin = await exiger(req, res, 'admin');
    if (!admin) return;

    const body = corpsJson(req);
    const action = String(body.action || '');

    /* ---------- Liste ---------- */
    if (action === 'liste') {
      return res.status(200).json({ ok: true, utilisateurs: await listerUtilisateurs(), niveaux: NIVEAUX });
    }

    /* ---------- Création ---------- */
    if (action === 'creer') {
      const saisi = String(body.identifiant || '').trim().toLowerCase();
      const identifiant = normaliserIdentifiant(body.identifiant);
      if (!identifiant || identifiant.length < 3) {
        return res.status(200).json({ ok: false, error: "L'identifiant doit comporter au moins 3 caractères." });
      }
      /* On contrôle la saisie telle quelle : un identifiant contenant un
         espace ou un accent est refusé, plutôt que corrigé en silence. */
      if (!/^[a-z0-9._-]+$/.test(saisi)) {
        return res.status(200).json({
          ok: false,
          error: "L'identifiant ne peut contenir que des lettres sans accent, des chiffres, un point, un tiret ou un souligné."
        });
      }
      if (await lireUtilisateur(identifiant)) {
        return res.status(200).json({ ok: false, error: 'Cet identifiant est déjà utilisé.' });
      }
      const niveau = NIVEAUX[body.niveau] ? body.niveau : 'redacteur';
      const souci = controlerRobustesse(body.motDePasse);
      if (souci) return res.status(200).json({ ok: false, error: souci });

      const u = {
        identifiant,
        nom: String(body.nom || '').trim(),
        prenom: String(body.prenom || '').trim(),
        titre: String(body.titre || '').trim(),
        niveau,
        actif: body.actif !== false,
        empreinte: hacherMotDePasse(body.motDePasse),
        doitChanger: true,
        creeLe: new Date().toISOString(),
        creePar: admin.identifiant,
        derniereConnexion: null
      };
      await ecrireUtilisateur(u);
      await tracer(admin, 'utilisateur.creation', identifiant + ' (' + niveau + ')');
      return res.status(200).json({ ok: true, utilisateur: sansSecret(u) });
    }

    /* ---------- Modification ---------- */
    if (action === 'modifier') {
      const identifiant = normaliserIdentifiant(body.identifiant);
      const u = await lireUtilisateur(identifiant);
      if (!u) return res.status(200).json({ ok: false, error: 'Compte introuvable.' });

      /* Un administrateur ne peut ni se rétrograder ni se désactiver lui-même :
         cela pourrait laisser la plateforme sans administrateur. */
      const seTouche = identifiant === admin.identifiant;
      if (seTouche && (body.niveau && body.niveau !== 'admin')) {
        return res.status(200).json({
          ok: false,
          error: 'Vous ne pouvez pas retirer vos propres droits d’administration. Demandez-le à un autre administrateur.'
        });
      }
      if (seTouche && body.actif === false) {
        return res.status(200).json({ ok: false, error: 'Vous ne pouvez pas désactiver votre propre compte.' });
      }

      if (body.nom !== undefined) u.nom = String(body.nom).trim();
      if (body.prenom !== undefined) u.prenom = String(body.prenom).trim();
      if (body.titre !== undefined) u.titre = String(body.titre).trim();
      if (body.niveau !== undefined && NIVEAUX[body.niveau]) u.niveau = body.niveau;
      if (body.actif !== undefined) u.actif = body.actif !== false;
      u.modifieLe = new Date().toISOString();
      u.modifiePar = admin.identifiant;

      /* Dernier garde-fou : il doit rester au moins un administrateur actif. */
      if (u.niveau !== 'admin' || u.actif === false) {
        const tous = await listerUtilisateurs();
        const admins = tous.filter(
          x => x.identifiant !== identifiant && x.niveau === 'admin' && x.actif !== false
        );
        if (admins.length === 0) {
          return res.status(200).json({
            ok: false,
            error: 'Opération refusée : la plateforme resterait sans administrateur actif.'
          });
        }
      }

      await ecrireUtilisateur(u);
      await tracer(admin, 'utilisateur.modification', identifiant);
      return res.status(200).json({ ok: true, utilisateur: sansSecret(u) });
    }

    /* ---------- Réinitialisation du mot de passe ---------- */
    if (action === 'reinitialiser') {
      const identifiant = normaliserIdentifiant(body.identifiant);
      const u = await lireUtilisateur(identifiant);
      if (!u) return res.status(200).json({ ok: false, error: 'Compte introuvable.' });

      const souci = controlerRobustesse(body.motDePasse);
      if (souci) return res.status(200).json({ ok: false, error: souci });

      u.empreinte = hacherMotDePasse(body.motDePasse);
      u.doitChanger = true;
      u.motDePasseModifieLe = new Date().toISOString();
      await ecrireUtilisateur(u);
      await reinitialiserEchecs(identifiant);
      await tracer(admin, 'utilisateur.reinitialisation', identifiant);
      return res.status(200).json({ ok: true });
    }

    /* ---------- Suppression ---------- */
    if (action === 'supprimer') {
      const identifiant = normaliserIdentifiant(body.identifiant);
      if (identifiant === admin.identifiant) {
        return res.status(200).json({ ok: false, error: 'Vous ne pouvez pas supprimer votre propre compte.' });
      }
      const u = await lireUtilisateur(identifiant);
      if (!u) return res.status(200).json({ ok: false, error: 'Compte introuvable.' });

      if (u.niveau === 'admin') {
        const tous = await listerUtilisateurs();
        const admins = tous.filter(
          x => x.identifiant !== identifiant && x.niveau === 'admin' && x.actif !== false
        );
        if (admins.length === 0) {
          return res.status(200).json({
            ok: false,
            error: 'Opération refusée : la plateforme resterait sans administrateur actif.'
          });
        }
      }

      await supprimerUtilisateur(identifiant);
      await tracer(admin, 'utilisateur.suppression', identifiant);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: false, error: 'Action inconnue : ' + action });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
