# Architecture

Document de référence pour comprendre la structure du projet et étendre les
outils plus tard.

## Vue d'ensemble

```
                    Internet (HTTPS)
                          │
            ┌─────────────┴─────────────┐
            │  Caddy (reverse proxy)    │  ← HTTPS auto Let's Encrypt
            └─────────────┬─────────────┘
                          │ http://mcp:3000
            ┌─────────────┴─────────────┐
            │  Fastify (Node 22 / TS)   │
            │   ├─ /mcp     (SSE+HTTP)  │  ← transport MCP
            │   ├─ /setup   (wizard)    │
            │   ├─ /oauth/* (OAuth)     │
            │   └─ /health              │
            └─────────────┬─────────────┘
                          │
                ┌─────────┴─────────┐
                │  axios LinkedIn   │
                │  + interceptors   │
                └───────────────────┘
                          │
                ┌─────────┴─────────┐
                │  /data (volume)   │
                │   token.json AES  │
                └───────────────────┘
```

## Couches

### 1. Configuration (`src/config.ts`)

Loader unique avec validation Zod fail-fast. Toutes les variables d'env
sont déclarées dans un schéma typé. Si une variable manque ou est invalide,
le serveur refuse de démarrer avec une erreur lisible.

### 2. Token store (`src/auth/token-store.ts`) + crypto (`src/utils/crypto.ts`)

Le token OAuth est stocké chiffré au repos (AES-256-GCM, IV aléatoire par
écriture, authTag GCM pour détecter toute corruption). Écriture atomique
via tmp-file + rename pour éviter la corruption en cas de crash en plein
write.

### 3. Token manager (`src/auth/token-manager.ts`)

API publique : `getValidToken()`. Vérifie l'expiry, déclenche un refresh si
le token expire dans < 5 min, sérialise les refreshes concurrents pour
éviter les races (LinkedIn rotate le refresh token à chaque refresh, donc
deux refreshes parallèles invalident l'un l'autre).

### 4. Client HTTP LinkedIn (`src/linkedin/client.ts`)

Instance axios avec une stack d'interceptors :

1. **`version-header`** : injecte `LinkedIn-Version: 202603` et
   `X-Restli-Protocol-Version: 2.0.0` sur chaque requête (oublier l'un des
   deux génère des 400 cryptiques).
2. **`auth-refresh`** : attache le Bearer token, et sur 401 force un refresh
   et rejoue la requête une seule fois.
3. **`axios-retry`** : backoff exponentiel sur 429 et 5xx, respect du
   `Retry-After`.

Tous les outils MCP passent par ce client — jamais d'`axios` direct ailleurs.

### 5. Helpers URN (`src/linkedin/urn.ts`)

LinkedIn utilise des URNs partout (`urn:li:sponsoredCampaign:123`). Les
helpers `buildUrn`, `parseUrn`, `encodeUrn`, `ensureUrn` normalisent leur
manipulation. `ensureUrn` accepte indifféremment un ID numérique brut ou un
URN complet, ce qui permet aux outils MCP de tolérer les deux formes côté
Claude.

### 6. Erreurs (`src/linkedin/errors.ts`)

`formatLinkedInError` traduit les erreurs HTTP LinkedIn en `LinkedInApiError`
avec un message rédigé pour être lu par Claude (suggestion d'action,
mention du scope manquant, etc.). Les outils ne propagent jamais d'erreurs
axios brutes.

### 7. Schémas Zod (`src/schemas/`)

Schémas partagés pour les types LinkedIn (`Status`, `Money`, `DateRange`,
`TargetingCriteria`, `CampaignCreate`, `Creative*`, `AnalyticsQuery`).
Chaque champ a un `.describe()` détaillé qui apparaît dans les schémas MCP
exposés à Claude — c'est ce qui permet à Claude de comprendre les
contraintes (formats URN, ranges, enums) sans devoir deviner.

### 8. Outils MCP (`src/tools/`)

Un fichier par domaine métier :

- `accounts.ts` — `list_ad_accounts`, `get_ad_account`
- `campaign-groups.ts` — list/create/update
- `campaigns.ts` — list/get/create/update + raccourci status
- `creatives.ts` — list/get/create (image, video, text) + status
- `targeting.ts` — facets, entities, audience count
- `analytics.ts` — campaign + account analytics avec export fichier
- `bulk.ts` — outils composites (`bulk_pause_campaigns`, `duplicate_campaign`)

Chaque outil :

- Valide ses inputs avec un schéma Zod (réutilisé depuis `src/schemas/`)
- Construit l'URL LinkedIn à partir des helpers URN
- Appelle `callLinkedIn(client, endpoint, config)` (helper qui catch les
  erreurs et les passe à `formatLinkedInError`)
- Retourne un `jsonResult(payload)` (helper qui emballe le payload dans le
  format MCP attendu)

`registerAllTools(server, client)` dans `src/tools/index.ts` enregistre
tout sur l'instance `McpServer`.

### 9. Serveur HTTP (`src/server/`)

Fastify + plugins (`@fastify/cookie`, `@fastify/cors`, `@fastify/helmet`).
Middlewares :

- `bearerAuth` (sur `/mcp`) — vérifie `Authorization: Bearer <MCP_API_TOKEN>`
- `cookieOrBearerAuth` (sur `/setup/*` et `/oauth/start`) — accepte aussi
  un cookie de session signé

Routes :

- `/health` — JSON state (status + OAuth status + uptime)
- `/mcp` — bridge le `StreamableHTTPServerTransport` du SDK MCP avec
  Fastify (`reply.hijack()` puis on passe les Node req/res au transport)
- `/setup` — page de login wizard (cookie session)
- `/setup/dashboard` — UI tableau de bord avec snippets de config
- `/setup/status` — JSON status pour le polling
- `/oauth/start` — redirige vers LinkedIn avec un `state` random
- `/oauth/callback` — échange le code, écrit le token

### 10. Wizard (`src/server/views/`)

Deux pages HTML statiques avec un peu de JS inline. Pas de framework JS,
pas de build front. Tient en 2 fichiers et zéro maintenance.

## Comment ajouter un nouvel outil

1. **Schéma** : si le payload est complexe, ajouter un schéma Zod dans
   `src/schemas/<domaine>.ts` avec des `.describe()` riches.
2. **Outil** : dans `src/tools/<domaine>.ts`, ajouter une fonction qui appelle
   `server.registerTool(name, { title, description, inputSchema }, handler)`.
   Réutiliser `callLinkedIn` et `jsonResult` du fichier `_helpers.ts`.
3. **Enregistrement** : si c'est un nouveau domaine, ajouter
   `registerXTools` dans `src/tools/index.ts`.
4. **Test** : un test unitaire dans `tests/unit/` couvrant la transformation
   des paramètres et la construction de l'URL (mock axios).
5. **Doc** : ajouter une entrée dans `docs/TOOLS.md`.

## Comment ajouter un nouveau scope LinkedIn

Si plus tard Sébastien obtient l'approbation pour Matched Audiences ou
Conversions API :

1. Ajouter le scope (`rw_dmp_segments` par ex.) dans la valeur par défaut
   de `LINKEDIN_SCOPES` dans `src/config.ts` ou via env var
2. Refaire le flow OAuth depuis `/setup` (l'ancien token n'aura pas le
   nouveau scope)
3. Ajouter les outils correspondants dans un nouveau fichier
   `src/tools/<domaine>.ts`
4. Les enregistrer dans `src/tools/index.ts`

## Stockage et persistance

- `${DATA_DIR}/token.json` — blob chiffré AES-GCM (le token OAuth + expiry)
- `${DATA_DIR}/exports/` — exports d'analytics qui dépassent 50 lignes
  (lus ensuite par Claude via le filesystem tool)

C'est la seule chose qui doit être persistée entre redémarrages. Tout le
reste est stateless.

## Sécurité

- TLS terminé par Caddy (HTTPS uniquement, HSTS forcé)
- `MCP_API_TOKEN` (32 bytes random) requis sur `/mcp` et `/setup`,
  comparaison constant-time
- `ENCRYPTION_KEY` (32 bytes random) chiffre le token store au repos
- Cookie de session httpOnly + secure + sameSite=lax
- Helmet pour les headers de sécurité du wizard
- Conteneur Docker tourne en USER non-root

## Limites connues

- **Single-process state** : le cache `state` OAuth (`oauth.ts`) est en
  mémoire — si on scale en multi-instance, il faut migrer vers Redis ou
  similaire.
- **Pas de rate limiting interne** : on ne limite pas le nombre de requêtes
  Claude → MCP. Pas un problème pour un usage individuel, à reconsidérer
  si plusieurs utilisateurs partagent le même déploiement.
- **adAnalytics 15k rows hard cap** : si une requête analytics dépasse 15
  000 lignes (LinkedIn ne pagine pas cet endpoint), on retourne tout ce que
  LinkedIn a renvoyé et on alerte Claude de narrow le dateRange. Pas de
  split automatique pour l'instant.
