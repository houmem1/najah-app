# Ostedh IA — Frontend élève (PWA)

Application élève **100% gratuite**, installable (PWA), pour tous les niveaux tunisiens
(primaire → bac). Cours, exercices, devoirs, et **tuteur IA vocal en derja** (« Ostedh IA »).

- **Zéro build, zéro dépendance** : HTML/CSS/JS pur. Aucun `npm install`.
- **Backend existant** : Supabase (tables `edu_*`) + tuteur n8n (Mistral Large + RAG).
- **Bilingue** : français / arabe (RTL automatique selon la matière et le niveau).

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | Coquille de l'app + panneau tuteur |
| `styles.css` | Design mobile-first, coloré, RTL |
| `app.js` | Routeur, données Supabase, cours/exos/devoirs, chat, voix |
| `config.js` | URL + clés publiques (Supabase, webhook n8n, fonction STT) |
| `manifest.webmanifest`, `sw.js`, `icon*.svg` | PWA installable + hors-ligne |

## Fonctionnalités
- **Onboarding** : choix de la classe (et de la section au secondaire).
- **Matières → chapitres → cours** (lus depuis `edu_documents`).
- **Exercices** validés avec correction pas-à-pas + auto-évaluation (points ⭐, streak 🔥).
- **Devoirs** (contrôles/synthèses) avec chrono et corrigé.
- **Tuteur IA flottant, présent toute la session** : chat en streaming avec « Ostedh IA ».
- **Voix (derja)** :
  - **Écoute (TTS)** : Web Speech API (ar / fr).
  - **Parole (STT)** : fonction edge Supabase `stt-derja` → **Groq Whisper large-v3**
    (meilleure transcription du dialecte tunisien), avec **repli automatique** sur la
    reconnaissance vocale du navigateur si la clé n'est pas configurée.

## 🌐 Site EN LIGNE (déjà déployé)

**URL officielle (Netlify — expérience complète : PWA installable + micro 🎙️)** :
<https://curious-rolypoly-3fa043.netlify.app>

**Lien court à partager aux élèves** (redirige vers Netlify) :
<https://slhoumem.app.n8n.cloud/webhook/ostedh>

> 💡 Pour une URL plus jolie : Netlify → Domain management → rename (gratuit, ex. `ostedh.netlify.app` si dispo).
> Mise à jour du site : re-glisser le dossier `plateforme-eleve/` sur la zone « Production deploys » du dashboard Netlify.

Hébergement de secours (proxy n8n + bucket Supabase, limité : pas de micro ni d'installation PWA) :
`/webhook/64784dba-230c-4259-ae03-ce908a5b8db1/ostedh/index.html`

Architecture d'hébergement (100 % gratuite, déjà en place) :
- Les fichiers vivent dans le **bucket Supabase Storage public `ostedh`**.
- Le workflow n8n **« Hébergement PWA élève »** (`KTBMObc422CkaE7Y`) les sert avec les bons
  `Content-Type` (Supabase coerce le HTML en `text/plain` sur son domaine, d'où ce proxy).
- **Mettre à jour le site** = re-uploader les fichiers dans le bucket (voir ci-dessous) et
  incrémenter `?v=` dans `index.html` — rien à changer dans n8n.

```bash
# ré-uploader un fichier modifié (les politiques d'upload sont fermées par défaut :
# les rouvrir temporairement via SQL, puis les refermer — voir mémoire du projet)
curl -X POST "https://quhfiakafaixjrgsxhpf.supabase.co/storage/v1/object/ostedh/app.js" \
  -H "Authorization: Bearer <ANON_KEY>" -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/javascript; charset=utf-8" -H "x-upsert: true" \
  --data-binary @app.js
```

> ⚠️ **Limite connue de cet hébergement** : n8n sert les pages webhook dans un **sandbox CSP**
> (origine opaque). Conséquences : pas d'installation PWA/hors-ligne, progression non
> persistée entre visites (repli mémoire), et **micro bloqué** (la voix passe alors par
> l'écoute 🔊 uniquement). Le chat, les cours, exercices, devoirs et quiz fonctionnent.
> Pour l'expérience **complète** (PWA + micro), déployer les mêmes fichiers sur un hébergeur
> statique classique : glisser le dossier sur <https://app.netlify.com/drop> (2 min, compte
> gratuit requis — action à faire par un humain).

### Test en local (expérience complète)
```bash
# depuis le dossier plateforme-eleve/
python -m http.server 8080
# puis ouvrir http://localhost:8080
```

## Voix derja (Groq Whisper) — ACTIVE, rien à configurer
La transcription passe par le webhook n8n **`/webhook/stt-derja`** (workflow
`g0ZGvbnTGcgfEFrq`) qui utilise le **credential Groq déjà stocké dans n8n** : aucune clé
n'est exposée ni à copier. Testé : réponse 200 + transcription. Si le webhook échoue,
l'app bascule automatiquement sur la reconnaissance vocale du navigateur.

## Notes techniques
- Lecture publique (RLS) activée sur : niveaux, matières, sections, chapitres, compétences,
  **exercices validés**, **devoirs validés**, documents (cours).
- Aucune donnée sensible dans `config.js` : seule la **clé anon publique** y figure.
- Le tuteur garde le contexte via `sessionId` (mémoire de session n8n, fenêtre 10 messages).
- Progression élève stockée en **localStorage** (aucun compte requis → zéro friction).
