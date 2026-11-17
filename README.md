# Plateforme de validation de méthode analytique

Laboratoire Central de Biologie & Toxicologie — Hôpital Ali Aït Idir, Alger

---

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | L'application complète (saisie, calculs, figures, exports Word) |
| `api/ai.js` | Fonction serveur relayant les appels à l'IA — **porte la clé, qui n'atteint jamais le navigateur** |
| `vercel.json` | En-têtes de sécurité et de cache |
| `package.json` | Identification du projet |
| `.env.example` | Liste des variables de clé possibles (modèle, à ne pas remplir ici) |

---

## Déploiement sur Vercel

### Option A — par glisser-déposer (sans compte GitHub)

1. Installer l'outil en ligne de commande : `npm i -g vercel`
2. Dans ce dossier : `vercel` puis suivre les questions
3. Pour la mise en production : `vercel --prod`

### Option B — par GitHub (recommandé pour les mises à jour)

1. Créer un dépôt GitHub et y déposer ce dossier
2. Sur **vercel.com** → *Add New* → *Project* → importer le dépôt
3. Laisser tous les réglages par défaut (aucun *build* n'est nécessaire)
4. Cliquer sur **Deploy**

L'application est alors accessible à une adresse du type
`https://nom-du-projet.vercel.app`

---

## Configurer la clé d'IA (facultatif)

Sans clé, l'application fonctionne entièrement : saisie, calculs, figures,
rapports et articles Word avec la rédaction déterministe, et les propositions
de formulation construites à partir de vos données.

Avec une clé, la rédaction assistée s'ajoute. La clé reste sur le serveur.

1. Obtenir une clé gratuite :
   - **Groq** — https://console.groq.com/keys
   - **Google Gemini** — https://aistudio.google.com/apikey
   - **Mistral** — https://console.mistral.ai/api-keys
2. Sur Vercel : *votre projet* → **Settings** → **Environment Variables**
3. Ajouter par exemple :
   - Name : `GROQ_API_KEY`
   - Value : votre clé
   - Environments : cocher *Production*, *Preview*, *Development*
4. **Redéployer** (*Deployments* → bouton ⋯ → *Redeploy*)

À la réouverture de l'application, la rédaction assistée s'active seule,
en mode « Serveur de l'application ». Aucune clé à saisir dans l'interface.

Pour vérifier : panneau **Rédaction assistée** → bouton **Tester**.

---

## Modes de connexion à l'IA

| Mode | Où vit la clé | Usage |
|---|---|---|
| **Serveur de l'application** | Variables Vercel | Déploiement — recommandé |
| Clé saisie sur ce poste | Navigateur de l'utilisateur | Essai rapide, poste unique |
| Via la base de données | Propriétés du script Apps Script | Si vous utilisez le backend Google Sheets |

---

## Garde-fou numérique

Quel que soit le mode, l'IA ne peut **jamais** modifier une valeur chiffrée.
Chaque texte produit est contrôlé : tout nombre absent des calculs de
l'application entraîne le rejet du texte et le retour à la rédaction
déterministe. Les rapports et manuscrits portent une mention de traçabilité
indiquant combien d'éléments ont été rédigés par l'assistant.

---

## Point de sécurité à connaître

Une adresse Vercel gratuite est **publique** : toute personne qui la connaît
peut ouvrir l'application et saisir des données.

Si cela pose problème :
- Vercel propose une protection par mot de passe (offre payante) ;
- ou nous ajoutons une authentification (identifiants, rôles admin/utilisateur,
  journal des actions) — l'architecture serveur mise en place ici le permet
  désormais proprement, ce qui n'était pas le cas avec un fichier HTML seul.
