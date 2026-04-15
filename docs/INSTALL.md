# Installation — MCP LinkedIn Ads

Guide d'installation pas à pas pour déployer le serveur MCP LinkedIn Ads sur
un serveur Linux avec Docker.

## Pré-requis

- Un serveur Linux (Ubuntu 22.04+ recommandé) avec :
  - Docker 24+ et Docker Compose v2 installés
  - Les ports 80 et 443 ouverts en entrée
- Un nom de domaine (par ex. `mcp.exemple.com`) avec un enregistrement DNS
  `A` qui pointe vers l'IP publique du serveur **avant** le démarrage du
  conteneur (Caddy en a besoin pour obtenir le certificat HTTPS).
- Une **app LinkedIn Developer** avec :
  - Le produit **Advertising API** validé en tier Standard
  - Le `Client ID` et le `Client Secret` notés quelque part
- `git` et `openssl` installés sur le serveur (`sudo apt install git openssl`).

## Étape 1 — Cloner le dépôt

```bash
git clone <url-du-repo> mcp-linkedin-ads
cd mcp-linkedin-ads
```

## Étape 2 — Générer les secrets et configurer le `.env`

Lancez le script de bootstrap, qui va :

1. Générer un `MCP_API_TOKEN` aléatoire (clé d'accès au serveur MCP)
2. Générer une `ENCRYPTION_KEY` aléatoire (clé de chiffrement du token store)
3. Vous demander vos identifiants LinkedIn et le domaine
4. Écrire le tout dans `docker/.env`

```bash
./scripts/generate-secrets.sh
```

À la fin, le script affiche le `MCP_API_TOKEN` généré — **gardez-le quelque
part**, vous en aurez besoin pour vous connecter au wizard et pour
configurer Claude.

## Étape 3 — Déclarer le redirect URI dans LinkedIn

1. Ouvrez https://www.linkedin.com/developers/apps
2. Cliquez sur votre app → onglet **Auth**
3. Dans la section **Authorized redirect URLs for your app**, ajoutez :

   ```
   https://VOTRE-DOMAINE/oauth/callback
   ```

   (en remplaçant `VOTRE-DOMAINE` par celui que vous avez fourni au script)

4. Cliquez sur **Update**

Sans cette étape, LinkedIn refusera de rediriger après l'authentification.

## Étape 4 — Vérifier que le DNS pointe bien

```bash
dig +short VOTRE-DOMAINE
```

Le résultat doit être l'IP publique de votre serveur. Si ce n'est pas le
cas, attendez la propagation DNS avant de continuer (sinon Caddy échouera
à obtenir le certificat HTTPS).

## Étape 5 — Démarrer le stack

```bash
cd docker
docker compose up -d
```

Caddy va automatiquement obtenir un certificat Let's Encrypt et démarrer le
reverse proxy. Le serveur MCP démarre en parallèle.

Vérifiez que tout tourne :

```bash
docker compose ps
docker compose logs -f mcp
```

Vous devez voir une ligne du type `MCP server listening { port: 3000 }`.

Testez le healthcheck depuis le serveur :

```bash
curl -k https://localhost/health
```

Vous devez recevoir un JSON `{ "status": "ok", "oauth": { "configured": false, ... } }`.

## Étape 6 — Connecter LinkedIn via le wizard

1. Ouvrez `https://VOTRE-DOMAINE/setup` dans votre navigateur
2. Collez le `MCP_API_TOKEN` (généré à l'étape 2) dans le champ "Jeton API"
   → vous arrivez sur le tableau de bord
3. Cliquez sur **Connecter / Reconnecter LinkedIn**
4. Vous êtes redirigé sur LinkedIn → autorisez l'app
5. LinkedIn vous renvoie sur le tableau de bord avec le statut "Connecté"
6. Sur la même page, le tableau de bord affiche :
   - L'**URL MCP** à utiliser dans Claude.ai / Desktop / Code
   - Le **jeton Bearer** à coller dans le header `Authorization`
   - Des **snippets de configuration** prêts à copier-coller pour chaque client

## Étape 7 — Brancher les clients Claude

### Claude Desktop

Éditez le fichier de config :

- macOS : `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows : `%APPDATA%\Claude\claude_desktop_config.json`

Ajoutez (ou fusionnez) :

```json
{
  "mcpServers": {
    "linkedin-ads": {
      "url": "https://VOTRE-DOMAINE/mcp",
      "headers": {
        "Authorization": "Bearer VOTRE_MCP_API_TOKEN"
      }
    }
  }
}
```

Redémarrez Claude Desktop.

### Claude Code (CLI)

Éditez `~/.config/claude-code/.mcp.json` (ou créez-le) :

```json
{
  "mcpServers": {
    "linkedin-ads": {
      "type": "http",
      "url": "https://VOTRE-DOMAINE/mcp",
      "headers": {
        "Authorization": "Bearer VOTRE_MCP_API_TOKEN"
      }
    }
  }
}
```

### Claude.ai (web app)

1. Ouvrez Claude.ai
2. **Settings → Connectors → Add custom connector**
3. Type : MCP / HTTP
4. URL : `https://VOTRE-DOMAINE/mcp`
5. Header : `Authorization: Bearer VOTRE_MCP_API_TOKEN`

## Étape 8 — Tester

Demandez à Claude :

> Liste mes comptes LinkedIn Ads.

Claude doit appeler le tool `list_ad_accounts` et vous afficher la liste de
tous les comptes auxquels vous avez accès. Bingo.

## Mises à jour

```bash
cd mcp-linkedin-ads
git pull
cd docker
docker compose up -d --build
```

## Renouvellement du token (~tous les 11 mois)

Le `refresh_token` LinkedIn dure 365 jours. Le serveur le renouvelle
automatiquement à chaque appel à l'API. Si vous laissez le serveur sans
trafic pendant ~12 mois, le refresh token expire et il faudra refaire le
flow OAuth :

1. Ouvrez `https://VOTRE-DOMAINE/setup`
2. Cliquez sur **Reconnecter LinkedIn**
3. Refaites l'autorisation

Les snippets de config Claude restent les mêmes — pas besoin de toucher à
quoi que ce soit côté client.

## Dépannage

### Caddy n'obtient pas le certificat HTTPS

```bash
docker compose logs caddy
```

Causes courantes :

- DNS qui ne pointe pas encore (attendre la propagation)
- Ports 80/443 bloqués par un firewall en amont
- Domaine déjà utilisé par un autre serveur Let's Encrypt

### `401 invalid_bearer_token` depuis Claude

Le `MCP_API_TOKEN` ne correspond pas. Vérifiez celui dans `docker/.env`
côté serveur :

```bash
grep MCP_API_TOKEN docker/.env
```

et celui collé dans la config Claude.

### `LinkedIn returned 401` après plusieurs jours

Le token a expiré et le refresh a échoué. Refaites le flow `/setup`.

### `LinkedIn returned 403` sur certains endpoints

Le membre LinkedIn authentifié n'a pas le bon rôle sur l'Ad Account ciblé,
ou l'app LinkedIn n'a pas le scope nécessaire. Vérifiez :

- Que vous êtes bien Account Manager / Campaign Manager sur le compte
  client dans Campaign Manager
- Que l'app LinkedIn a les scopes `r_ads`, `rw_ads`, `r_ads_reporting`
