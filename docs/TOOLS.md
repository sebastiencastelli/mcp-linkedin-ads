# Outils MCP — référence

Liste des 21 outils exposés par le serveur, regroupés par domaine. Chaque
outil prend ses paramètres en JSON typé via Zod. Le paramètre `account_id`
accepte soit un ID numérique brut (`123456`), soit un URN complet
(`urn:li:sponsoredAccount:123456`).

## Workflow type

1. `list_ad_accounts` → trouver l'`account_id` du compte cible
2. Outil métier (list, create, update, analytics) en passant l'`account_id`

C'est le seul ordre. Tous les autres outils ont besoin de l'`account_id`
sauf `list_ad_accounts` lui-même.

## Comptes (2 outils)

### `list_ad_accounts`
Liste tous les Ad Accounts auxquels l'OAuth member a accès. **Toujours
appeler en premier**.

### `get_ad_account`
Détails d'un compte (paramètres, devise, type, statut).

## Campaign Groups (3 outils)

### `list_campaign_groups`
Liste les groupes de campagnes d'un compte, avec filtres status optionnels.

### `create_campaign_group`
Crée un nouveau groupe (nom, budget total, dates, status).

### `update_campaign_group`
Update partielle d'un groupe (nom, status, budget, dates).

## Campagnes (5 outils)

### `list_campaigns`
Liste les campagnes d'un compte, filtres : status, campaign_group_id.

### `get_campaign`
Détails complets d'une campagne (settings, targeting, schedule).

### `create_campaign`
Création complète d'une campagne en un appel : objectif, type, costType,
budget, ciblage, schedule, optimisation, locale. Schéma `CampaignCreateSchema`.

**Exemple typique** :

```json
{
  "account_id": 123456,
  "campaign": {
    "name": "Lead Gen — DSI France Q2",
    "campaignGroupId": 789,
    "type": "SPONSORED_UPDATES",
    "objectiveType": "LEAD_GENERATION",
    "costType": "CPC",
    "dailyBudget": { "currencyCode": "EUR", "amount": "100.00" },
    "runSchedule": { "start": 1712620800000 },
    "targetingCriteria": { /* construit via les outils targeting */ },
    "optimizationTargetType": "MAX_LEAD",
    "locale": { "country": "FR", "language": "fr" },
    "status": "DRAFT"
  }
}
```

### `update_campaign`
Update partielle. Inclure uniquement les champs à modifier.

### `update_campaign_status`
Raccourci pour pause / resume / archive : `{ status: "PAUSED" }`.

## Creatives (6 outils)

### `list_creatives`
Liste les creatives, filtres campaign_id et status.

### `get_creative`
Détails d'une creative.

### `create_image_creative`
Crée une creative Single Image en uploadant le fichier local et en
l'attachant à une campagne. Nécessite l'`organization_urn` (page
LinkedIn propriétaire).

### `create_video_creative`
Idem pour les vidéos. L'encodage côté LinkedIn peut prendre quelques
minutes — la creative est créée en DRAFT.

### `create_text_creative`
Text Ad simple (right-rail). Limites char : 25 headline / 75 description.

### `update_creative_status`
Pause / resume / archive d'une creative.

## Ciblage (3 outils)

### `get_targeting_facets`
Liste tous les facets disponibles (industries, seniorities, locations, etc.)
avec leur URN. À appeler en premier quand on construit un ciblage.

### `search_targeting_entities`
Recherche full-text dans un facet (ex : trouver l'URN du secteur
"Marketing and Advertising" ou de la séniorité "Director").

### `estimate_audience_size`
Estime la taille d'audience d'un targeting tree. Vérification obligatoire
avant `create_campaign` — LinkedIn impose un minimum de 300 membres.

## Analytics (2 outils)

### `get_campaign_analytics`
Reporting détaillé pour une ou plusieurs campagnes. Pivot, granularity,
fields, dateRange. Si la réponse fait > 50 lignes, elle est écrite dans
`${DATA_DIR}/exports/analytics-{ts}.json` et seul un aperçu + le chemin
sont retournés à Claude.

**Exemple** :

```json
{
  "account_id": 123456,
  "query": {
    "pivot": "CAMPAIGN",
    "timeGranularity": "DAILY",
    "dateRange": {
      "start": { "year": 2026, "month": 3, "day": 1 },
      "end":   { "year": 2026, "month": 3, "day": 31 }
    },
    "fields": ["impressions", "clicks", "costInLocalCurrency", "externalWebsiteConversions"]
  }
}
```

### `get_account_analytics`
Idem mais agrégé au niveau Ad Account.

## Composites (2 outils)

### `bulk_pause_campaigns`
Pause N campagnes en parallèle (max 50). Retourne un summary par campagne.
Idéal pour réagir à une analyse de perf.

### `duplicate_campaign`
Lit une campagne existante et la recrée avec un nom (et éventuellement un
budget / schedule) modifiés. Targeting et creatives ne sont **pas**
dupliqués automatiquement.

## Notes générales

- **Erreurs LinkedIn** : automatiquement traduites en messages exploitables
  par Claude (`formatLinkedInError`). Quand vous voyez "LinkedIn returned
  403 Forbidden — the authenticated member does not have the required role
  on this Ad Account", c'est un vrai 403 traduit, pas une fabulation.
- **Rate limits** : géré automatiquement par `axios-retry`, backoff
  exponentiel + respect du header `Retry-After`.
- **URNs vs IDs bruts** : tous les paramètres acceptent les deux formes,
  via le helper `ensureUrn`.
