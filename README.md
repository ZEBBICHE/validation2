# Plateforme de validation de méthode analytique

Laboratoire Central de Biologie & Toxicologie — Hôpital Ali Aït Idir, Alger

---

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | L'application complète (saisie, calculs, figures, exports Word) |
| `api/auth.js` | Connexion, déconnexion, session, mot de passe |
| `api/users.js` | Gestion des comptes — réservée à l'administrateur |
| `api/projects.js` | Enregistrement et ouverture des projets |
| `api/logs.js` | Journal des actions et état du service |
| `api/ai.js` | Relais vers le service d'IA — **porte la clé, qui n'atteint jamais le navigateur** |
| `api/_lib/store.js` | Couche de stockage (Redis ou Blob, détecté automatiquement) |
| `api/_lib/auth.js` | Mots de passe, sessions signées, niveaux d'accès |
| `manifest.webmanifest`, `service-worker.js`, `icone-*.png` | Installation de l'application sur les appareils |
| `vercel.json`, `package.json`, `.env.example` | Configuration du déploiement |

---

## 1. Déployer

### Par GitHub (recommandé)

1. Déposer ce dossier dans un dépôt GitHub, **en conservant l'arborescence** :
   `api/auth.js`, `api/users.js`, `api/projects.js`, `api/logs.js`, `api/ai.js`,
   `api/_lib/store.js`, `api/_lib/auth.js`.
   Aucun de ces fichiers ne doit se retrouver à la racine.
2. Sur **vercel.com** → *Add New* → *Project* → importer le dépôt.
3. Laisser tous les réglages par défaut (aucun *build* n'est nécessaire).
4. **Deploy**.

> Si le dépôt n'apparaît pas dans la liste Vercel : vérifier que le compte Vercel
> est bien celui qui possède le dépôt, puis *Adjust GitHub App Permissions* pour
> autoriser Vercel à voir ce dépôt.

### En ligne de commande

```
npm i -g vercel
vercel          # déploiement d'essai
vercel --prod   # mise en production
```

---

## 2. Installer le stockage — **indispensable**

Sans cette étape, les comptes et les projets **ne sont pas conservés** :
ils disparaissent dès que le serveur se met en veille. L'application le
signale dans *Administration → État du service*.

1. Sur Vercel : votre projet → onglet **Storage**
2. **Create Database** / **Browse Marketplace**
3. Choisir **Upstash for Redis** — offre gratuite suffisante pour ce laboratoire
   (ou **Blob**, de Vercel, si vous préférez)
4. **Connect to Project** : sélectionner ce projet, environnements *Production*,
   *Preview* et *Development*
5. **Redéployer** (*Deployments* → ⋯ → *Redeploy*)

Les identifiants d'accès sont ajoutés automatiquement aux variables
d'environnement. **Aucune clé n'est à écrire dans le code.**

Pour vérifier : se connecter, puis ⚙ **Administration → État du service** →
« Stockage durable : Oui ».

---

## 3. Première connexion

| | |
|---|---|
| Identifiant | `admin` |
| Mot de passe | `Validation2026` |

L'application **impose le changement de ce mot de passe** dès la première
connexion. Il est également possible de fixer d'autres valeurs initiales avant
le premier démarrage, avec les variables `ADMIN_USER` et `ADMIN_PASSWORD`.

Ensuite, depuis ⚙ **Administration → Comptes**, créer un compte par personne.

### Niveaux d'accès

| Niveau | Droits |
|---|---|
| **Lecteur** | Consulte les projets accessibles. Ne saisit rien. |
| **Rédacteur** | Crée et modifie ses projets, exporte, utilise la rédaction assistée. |
| **Valideur** | Idem, plus l'accès à **tous** les projets du laboratoire. |
| **Administrateur** | Idem, plus les comptes, le journal et la suppression de tout projet. |

Chaque projet appartient à son créateur. Il reste privé, sauf si celui-ci le
passe en projet d'équipe. Les valideurs et les administrateurs voient tout.

---

## 4. Installer l'application sur un appareil

Une fois le site déployé, il s'installe comme une application à partir de son
adresse, sans passer par un magasin d'applications.

- **Ordinateur (Chrome, Edge)** : icône d'installation à droite de la barre d'adresse,
  ou le bouton **⤓ Installer l'application** de la barre latérale
- **Android** : menu ⋮ → *Installer l'application*
- **iPhone, iPad (Safari)** : bouton Partager → *Sur l'écran d'accueil* → *Ajouter*

L'application s'ouvre alors dans sa propre fenêtre, avec son icône. Elle démarre
même sans connexion, mais la consultation et l'enregistrement des projets
nécessitent le réseau, comme il se doit pour des données partagées.

---

## 5. Clé d'IA (facultatif)

Sans clé, l'application fonctionne entièrement : saisie, calculs, figures,
rapports et articles Word avec la rédaction déterministe, et les propositions
de formulation construites à partir de vos données.

1. Obtenir une clé gratuite :
   - **Groq** — https://console.groq.com/keys
   - **Google Gemini** — https://aistudio.google.com/apikey
   - **Mistral** — https://console.mistral.ai/api-keys
2. Vercel → *Settings* → *Environment Variables* → par exemple
   `GROQ_API_KEY` = votre clé, pour les trois environnements
3. Redéployer

La rédaction assistée s'active alors seule, en mode « Serveur de
l'application ». Elle est réservée aux comptes connectés de niveau rédacteur
ou supérieur : l'adresse du site étant publique, la clé ne peut pas être
laissée à la disposition de tout visiteur.

---

## Ce qui est en place côté sécurité

- Mots de passe conservés en **empreinte PBKDF2-SHA512**, 210 000 itérations,
  sel aléatoire par compte. Ils ne peuvent être relus par personne,
  administrateur compris.
- Sessions par **cookie httpOnly signé** (HMAC-SHA256), valables douze heures.
  Le niveau d'accès est relu à chaque requête : une désactivation prend effet
  immédiatement.
- **Huit tentatives** de connexion échouées verrouillent l'identifiant pendant
  un quart d'heure.
- Le message d'échec est identique que le compte existe ou non.
- Pages d'administration protégées **côté serveur**, et non seulement masquées
  dans l'interface.
- **Journal des actions** : connexions, échecs, gestion des comptes, ouverture
  et enregistrement des projets.
- La plateforme refuse de laisser le dernier administrateur actif se
  rétrograder, se désactiver ou se supprimer.
- Aucune clé ni aucun secret dans le code source.

## Garde-fou numérique de la rédaction assistée

Inchangé : l'IA ne peut **jamais** modifier une valeur chiffrée. Chaque texte
produit est contrôlé ; tout nombre absent des calculs de l'application entraîne
le rejet du texte et le retour à la rédaction déterministe. Les rapports et
manuscrits portent une mention de traçabilité indiquant combien d'éléments ont
été rédigés par l'assistant.

---

## Le Google Sheet n'est plus utilisé

Les projets sont désormais conservés sur le serveur de la plateforme. Le script
Apps Script et le classeur associé peuvent être archivés. L'export et l'import
de fichiers `.json` restent disponibles dans la barre latérale, comme sauvegarde
hors ligne et comme moyen de récupérer les projets d'avant la migration :
*Sauvegarde locale (.json)* → **Importer une copie locale**, puis
**Enregistrer les données**.
