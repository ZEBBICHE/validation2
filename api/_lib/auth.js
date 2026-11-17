/* ============================================================
   Authentification, sessions et rôles
   ------------------------------------------------------------
   - Mots de passe : PBKDF2-SHA512, 210 000 itérations, sel aléatoire
     de 16 octets. Aucun mot de passe n'est jamais stocké en clair.
   - Sessions : cookie httpOnly signé (HMAC-SHA256), 12 heures.
     Le secret de signature vient des variables d'environnement ;
     à défaut, il est généré une fois et conservé dans le magasin.
   ============================================================ */

import crypto from 'node:crypto';
import { lire, ecrire, supprimer, lister, journaliser } from './store.js';

export const NIVEAUX = {
  admin: { rang: 100, libelle: 'Administrateur' },
  valideur: { rang: 60, libelle: 'Valideur' },
  redacteur: { rang: 40, libelle: 'Rédacteur' },
  lecteur: { rang: 10, libelle: 'Lecteur' }
};

export function rang(niveau) {
  return (NIVEAUX[niveau] || NIVEAUX.lecteur).rang;
}

/* ============================================================
   Mots de passe
   ============================================================ */

const ITERATIONS = 210000;
const LONGUEUR = 64;

export function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  const empreinte = crypto
    .pbkdf2Sync(String(motDePasse), sel, ITERATIONS, LONGUEUR, 'sha512')
    .toString('hex');
  return `pbkdf2$${ITERATIONS}$${sel}$${empreinte}`;
}

export function verifierMotDePasse(motDePasse, stocke) {
  try {
    const [algo, iter, sel, attendu] = String(stocke || '').split('$');
    if (algo !== 'pbkdf2' || !sel || !attendu) return false;
    const calcule = crypto
      .pbkdf2Sync(String(motDePasse), sel, parseInt(iter, 10), attendu.length / 2, 'sha512')
      .toString('hex');
    const a = Buffer.from(calcule, 'hex');
    const b = Buffer.from(attendu, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/* Règle de robustesse appliquée à la création et au changement */
export function controlerRobustesse(motDePasse) {
  const m = String(motDePasse || '');
  if (m.length < 8) return 'Le mot de passe doit comporter au moins 8 caractères.';
  if (!/[A-Za-z]/.test(m)) return 'Le mot de passe doit comporter au moins une lettre.';
  if (!/[0-9]/.test(m)) return 'Le mot de passe doit comporter au moins un chiffre.';
  return null;
}

/* ============================================================
   Secret de signature des sessions
   ============================================================ */

let SECRET_CACHE = null;

async function secretSession() {
  if (SECRET_CACHE) return SECRET_CACHE;
  const depuisEnv = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (depuisEnv && depuisEnv.length >= 16) {
    SECRET_CACHE = depuisEnv;
    return SECRET_CACHE;
  }
  let enregistre = await lire('config:secret');
  if (!enregistre) {
    enregistre = crypto.randomBytes(32).toString('hex');
    await ecrire('config:secret', enregistre);
  }
  SECRET_CACHE = enregistre;
  return SECRET_CACHE;
}

/* ============================================================
   Utilisateurs
   ============================================================ */

const CLE_UTILISATEUR = id => 'user:' + id;

export function normaliserIdentifiant(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

export async function lireUtilisateur(identifiant) {
  const id = normaliserIdentifiant(identifiant);
  if (!id) return null;
  return await lire(CLE_UTILISATEUR(id));
}

export async function ecrireUtilisateur(u) {
  await ecrire(CLE_UTILISATEUR(u.identifiant), u);
}

export async function supprimerUtilisateur(identifiant) {
  await supprimer(CLE_UTILISATEUR(normaliserIdentifiant(identifiant)));
}

export async function listerUtilisateurs() {
  const cles = await lister('user:');
  const sortie = [];
  for (const c of cles) {
    const u = await lire(c);
    if (u) sortie.push(sansSecret(u));
  }
  sortie.sort((a, b) => a.identifiant.localeCompare(b.identifiant));
  return sortie;
}

export function sansSecret(u) {
  if (!u) return null;
  const { empreinte, ...reste } = u;
  return reste;
}

/* Premier démarrage : crée le compte administrateur.
   Identifiant et mot de passe initial lus dans les variables
   d'environnement si présentes, sinon valeurs par défaut que
   l'application impose de changer à la première connexion. */
export async function assurerAdministrateur() {
  const deja = await lire('config:amorce');
  if (deja) return null;

  const identifiant = normaliserIdentifiant(process.env.ADMIN_USER || 'admin');
  const motDePasse = process.env.ADMIN_PASSWORD || 'Validation2026';

  const existant = await lireUtilisateur(identifiant);
  if (!existant) {
    await ecrireUtilisateur({
      identifiant,
      nom: 'ZEBBICHE',
      prenom: 'Younes',
      titre: 'Pr',
      niveau: 'admin',
      actif: true,
      empreinte: hacherMotDePasse(motDePasse),
      doitChanger: !process.env.ADMIN_PASSWORD,
      creeLe: new Date().toISOString(),
      creePar: 'système',
      derniereConnexion: null
    });
  }
  await ecrire('config:amorce', { fait: true, le: new Date().toISOString() });
  return { identifiant, motDePasse: existant ? null : motDePasse };
}

/* ============================================================
   Sessions
   ============================================================ */

const DUREE_MS = 12 * 60 * 60 * 1000;
const NOM_COOKIE = 'vmsession';

function signer(charge, secret) {
  return crypto.createHmac('sha256', secret).update(charge).digest('base64url');
}

export async function creerJeton(utilisateur) {
  const secret = await secretSession();
  const corps = {
    u: utilisateur.identifiant,
    n: utilisateur.niveau,
    exp: Date.now() + DUREE_MS
  };
  const charge = Buffer.from(JSON.stringify(corps)).toString('base64url');
  return charge + '.' + signer(charge, secret);
}

export async function verifierJeton(jeton) {
  try {
    const [charge, signature] = String(jeton || '').split('.');
    if (!charge || !signature) return null;
    const secret = await secretSession();
    const attendue = signer(charge, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(attendue);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const corps = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    if (!corps.exp || corps.exp < Date.now()) return null;
    return corps;
  } catch (e) {
    return null;
  }
}

export function poserCookie(res, jeton) {
  const morceaux = [
    `${NOM_COOKIE}=${jeton}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DUREE_MS / 1000)}`
  ];
  if (process.env.VERCEL) morceaux.push('Secure');
  res.setHeader('Set-Cookie', morceaux.join('; '));
}

export function effacerCookie(res) {
  const morceaux = [`${NOM_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.VERCEL) morceaux.push('Secure');
  res.setHeader('Set-Cookie', morceaux.join('; '));
}

function lireCookies(req) {
  const brut = req.headers.cookie || '';
  const sortie = {};
  brut.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) sortie[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return sortie;
}

/* Retourne l'utilisateur de la requête, ou null.
   Le niveau est relu depuis le magasin : une rétrogradation ou une
   désactivation prend effet immédiatement, sans attendre l'expiration. */
export async function utilisateurCourant(req) {
  const cookies = lireCookies(req);
  const corps = await verifierJeton(cookies[NOM_COOKIE]);
  if (!corps) return null;
  const u = await lireUtilisateur(corps.u);
  if (!u || u.actif === false) return null;
  return u;
}

/* Garde d'accès : renvoie l'utilisateur, ou répond et renvoie null */
export async function exiger(req, res, niveauMinimum = 'lecteur') {
  const u = await utilisateurCourant(req);
  if (!u) {
    res.status(401).json({ ok: false, error: 'Session absente ou expirée.', code: 'NONCONNECTE' });
    return null;
  }
  if (rang(u.niveau) < rang(niveauMinimum)) {
    res.status(403).json({ ok: false, error: "Vous n'avez pas les droits nécessaires.", code: 'INTERDIT' });
    return null;
  }
  return u;
}

/* ============================================================
   Journal des actions
   ============================================================ */

export async function tracer(utilisateur, action, detail) {
  try {
    await journaliser({
      le: new Date().toISOString(),
      qui: utilisateur ? utilisateur.identifiant : 'anonyme',
      action,
      detail: detail ? String(detail).slice(0, 300) : ''
    });
  } catch (e) {
    /* le journal ne doit jamais faire échouer une opération */
  }
}

/* Limitation des tentatives de connexion : 8 échecs par identifiant
   sur 15 minutes. Stockée dans le magasin, donc valable pour toutes
   les instances de la fonction. */
export async function tentativesTropNombreuses(identifiant) {
  const e = await lire('tentatives:' + identifiant);
  if (!e) return false;
  if (Date.now() - e.depuis > 15 * 60 * 1000) return false;
  return e.compte >= 8;
}

export async function enregistrerEchec(identifiant) {
  const cle = 'tentatives:' + identifiant;
  const e = await lire(cle);
  if (!e || Date.now() - e.depuis > 15 * 60 * 1000) {
    await ecrire(cle, { compte: 1, depuis: Date.now() });
  } else {
    await ecrire(cle, { compte: e.compte + 1, depuis: e.depuis });
  }
}

export async function reinitialiserEchecs(identifiant) {
  await supprimer('tentatives:' + identifiant);
}

/* Corps JSON tolérant (Vercel fournit déjà un objet, le local non) */
export function corpsJson(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body;
}
