# MCP LinkedIn Ads

Serveur MCP (Model Context Protocol) qui expose l'API LinkedIn Marketing
(Advertising tier Standard) sous forme d'~21 outils pour piloter Campaign
Manager depuis Claude (web, Desktop, CLI).

Un seul déploiement = un seul OAuth LinkedIn = accès à **tous les Ad Accounts**
auxquels le membre authentifié a un rôle (ses propres comptes + ceux des
clients où il a été invité comme manager).

## Pour qui

Pour Sébastien et toute personne qui gère plusieurs comptes publicitaires
LinkedIn et veut les piloter par instructions naturelles dans Claude au lieu
de cliquer dans Campaign Manager.

## Quoi

- Serveur HTTP+SSE en Node 22 / TypeScript
- ~21 outils MCP : list/create/update sur Ad Accounts, Campaign Groups,
  Campaigns, Creatives, Targeting, Analytics, plus des outils composites
  (`bulk_pause_campaigns`, `duplicate_campaign`)
- Wizard web embarqué (`/setup`) pour le bootstrap OAuth en quelques clics
- Token store chiffré au repos (AES-256-GCM)
- Refresh token rotatif géré automatiquement
- Backoff exponentiel sur les 429
- Déploiement Docker en une commande, HTTPS automatique via Caddy +
  Let's Encrypt

## Démarrage rapide

Voir [`docs/INSTALL.md`](docs/INSTALL.md) pour le guide d'installation
complet (en français).

## Documentation

- [`docs/INSTALL.md`](docs/INSTALL.md) — installation pas à pas pour Sébastien
- [`docs/TOOLS.md`](docs/TOOLS.md) — liste des outils MCP avec exemples
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — choix techniques et points
  d'extension pour reprise du projet

## Hors scope

- **Matched Audiences / Conversions API / Lead Sync** : nécessitent des
  approbations LinkedIn séparées non incluses dans le tier Standard
- **Multi-tenant** : un déploiement = un membre LinkedIn (qui couvre déjà N
  Ad Accounts via les invitations Campaign Manager)
- **UI de gestion** : c'est Claude qui pilote, pas une interface web qui
  remplacerait Campaign Manager

## Licence

Privé — projet client.
