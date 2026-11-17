/* ============================================================
   Couche de stockage — Upstash Redis (REST) ou Vercel Blob
   ------------------------------------------------------------
   L'application détecte automatiquement ce qui est provisionné :
     1. Redis   — variables KV_REST_API_URL / KV_REST_API_TOKEN
                  ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
     2. Blob    — variable BLOB_READ_WRITE_TOKEN
     3. Aucun   — mode mémoire (perdu à chaque redémarrage),
                  signalé clairement à l'administrateur.
   ============================================================ */

const REDIS_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_URL || null;

const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_TOKEN || null;

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null;

export function modeStockage() {
  if (REDIS_URL && REDIS_TOKEN) return 'redis';
  if (BLOB_TOKEN) return 'blob';
  return 'memoire';
}

export function stockagePersistant() {
  return modeStockage() !== 'memoire';
}

/* ---------- Mode mémoire (développement / non provisionné) ---------- */
const MEM = globalThis.__memStore || (globalThis.__memStore = new Map());

/* ---------- Redis via API REST ---------- */
async function redisCmd(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + REDIS_TOKEN,
      'content-type': 'application/json'
    },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 160));
  const d = await r.json();
  if (d && d.error) throw new Error('Redis : ' + d.error);
  return d ? d.result : null;
}

/* ---------- Blob ---------- */
async function blobChemin(cle) {
  return 'donnees/' + encodeURIComponent(cle) + '.json';
}
async function blobLire(cle) {
  const { list } = await import('@vercel/blob');
  const chemin = await blobChemin(cle);
  const { blobs } = await list({ prefix: chemin, token: BLOB_TOKEN, limit: 1 });
  const trouve = blobs.find(b => b.pathname === chemin);
  if (!trouve) return null;
  const r = await fetch(trouve.url, { cache: 'no-store' });
  if (!r.ok) return null;
  return await r.text();
}
async function blobEcrire(cle, valeur) {
  const { put } = await import('@vercel/blob');
  await put(await blobChemin(cle), valeur, {
    access: 'public',
    token: BLOB_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}
async function blobSupprimer(cle) {
  const { del } = await import('@vercel/blob');
  try { await del(await blobChemin(cle), { token: BLOB_TOKEN }); } catch (e) { /* déjà absent */ }
}
async function blobLister(prefixe) {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: 'donnees/' + encodeURIComponent(prefixe), token: BLOB_TOKEN });
  return blobs.map(b =>
    decodeURIComponent(b.pathname.replace(/^donnees\//, '').replace(/\.json$/, ''))
  );
}

/* ============================================================
   API publique du magasin
   ============================================================ */

export async function lire(cle) {
  const mode = modeStockage();
  let brut = null;
  if (mode === 'redis') brut = await redisCmd(['GET', cle]);
  else if (mode === 'blob') brut = await blobLire(cle);
  else brut = MEM.has(cle) ? MEM.get(cle) : null;

  if (brut === null || brut === undefined) return null;
  try { return typeof brut === 'string' ? JSON.parse(brut) : brut; }
  catch (e) { return null; }
}

export async function ecrire(cle, valeur) {
  const mode = modeStockage();
  const brut = JSON.stringify(valeur);
  if (mode === 'redis') await redisCmd(['SET', cle, brut]);
  else if (mode === 'blob') await blobEcrire(cle, brut);
  else MEM.set(cle, brut);
}

export async function supprimer(cle) {
  const mode = modeStockage();
  if (mode === 'redis') await redisCmd(['DEL', cle]);
  else if (mode === 'blob') await blobSupprimer(cle);
  else MEM.delete(cle);
}

export async function lister(prefixe) {
  const mode = modeStockage();
  if (mode === 'redis') {
    const cles = [];
    let curseur = '0';
    do {
      const r = await redisCmd(['SCAN', curseur, 'MATCH', prefixe + '*', 'COUNT', '200']);
      curseur = r[0];
      cles.push(...r[1]);
    } while (curseur !== '0');
    return cles;
  }
  if (mode === 'blob') return await blobLister(prefixe);
  return [...MEM.keys()].filter(k => k.startsWith(prefixe));
}

/* Ajout en tête d'une liste bornée (journal des actions) */
export async function journaliser(entree, maximum = 500) {
  const mode = modeStockage();
  if (mode === 'redis') {
    await redisCmd(['LPUSH', 'logs', JSON.stringify(entree)]);
    await redisCmd(['LTRIM', 'logs', '0', String(maximum - 1)]);
    return;
  }
  const actuels = (await lire('logs')) || [];
  actuels.unshift(entree);
  await ecrire('logs', actuels.slice(0, maximum));
}

export async function lireJournal(limite = 200) {
  const mode = modeStockage();
  if (mode === 'redis') {
    const r = await redisCmd(['LRANGE', 'logs', '0', String(limite - 1)]);
    return (r || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
  }
  const actuels = (await lire('logs')) || [];
  return actuels.slice(0, limite);
}
