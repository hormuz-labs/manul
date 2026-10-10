# Manul's gateway

A Manul key lets the app use AI without the user's own vendor accounts. The user never chooses a model: the app asks
for one model, `manul`, and **we** decide on the gateway which real model answers (Claude, Gemini, GPT…). We can
change it any time without an app release.

The gateway is [Bifrost](https://github.com/maximhq/bifrost). It holds the vendor keys. A Manul key is a Bifrost
**virtual key** with its own budget, rate limit and allowed models.

## How a request goes

1. The app's agent (pi-ai) sends model `manul` to Bifrost's OpenAI Responses route, `/openai/responses`, with the Manul
   key as `Authorization: Bearer` ([src/main/gateway.ts](../src/main/gateway.ts)).
2. Bifrost checks the virtual key (whether it's known, its budget, its rate limit and its allowed models).
3. The **routing rule** `model == 'manul'` picks the provider and model ([k8s/config.json](k8s/config.json):
   Gemini 3.8 Flash in production; the local [config.json](config.json) still routes to Claude Opus 5.5).
4. Bifrost translates the request to that vendor's API and the reply back.

This route was chosen because Bifrost's translation through it keeps each vendor's tool-call state across a multi-step
turn, which the agent needs:

| Vendor state kept between steps | Anthropic route | **OpenAI Responses route** | OpenAI chat route |
|---|---|---|---|
| Gemini thought signature | ✅ (but reports a tool call as a final reply) | ✅ | ✅ |
| Claude thinking signature | ✅ | ✅ | ❌ lost |
| GPT encrypted reasoning | ✅ (same issue) | ✅ | ❌ lost |

Images in messages and in tool results (frames, contact sheets) reach all three vendors through it.
`test/gateway-translation.test.ts` checks this against fake vendor servers (see [Checking Bifrost](#checking-bifrost)).

## Changing the model

In the dashboard, go to **Routing Rules → `manul`** and change the target provider and model. In config.json, edit
`governance.routing_rules`. You can also:

- split traffic between several targets with `weight`s;
- route by the caller with `scope` set to `virtual_key`, for example a bigger model for Pro keys;
- add more rules later (`manul-fast`, …) if the app ever sends more than one name.

The routed model must also be in each virtual key's `allowed_models`. It must handle at least the limits the app
assumes in gateway.ts: 400k context, 64k output tokens, images, and tool calls with reasoning.

## Run it locally

```bash
cd gateway && cp .env.example .env    # fill in the vendor keys
docker compose up -d                  # gateway and dashboard on http://localhost:8089
```

The first time you open the dashboard, enter `BIFROST_SETUP_TOKEN` from `.env` and create the admin account. Then
start the app against the gateway, and paste `MANUL_DEV_KEY` into Settings → Keys → Manul key:

```bash
MANUL_GATEWAY=http://localhost:8089 npm run dev
```

The app finds the gateway at `MANUL_GATEWAY`, else at `gateway` in the app's config.json, else at
`https://gateway.manul.si`.

## Checking Bifrost

Run these after upgrading Bifrost or changing the route.

1. Start Bifrost with [config.probe.json](config.probe.json). It points the three vendors at fake servers that the test
   starts on ports 9911 to 9913, and it has one routing rule per vendor.

   ```bash
   docker create --name bifrost-probe --user 0 -p 8089:8080 --env-file .env maximhq/bifrost:v2.2.6
   docker cp config.probe.json bifrost-probe:/app/data/config.json && docker start bifrost-probe
   ```

2. Run the test against it:

   ```bash
   BIFROST_PROBE=http://localhost:8089 npx vitest run test/gateway-translation.test.ts
   ```

`test/gateway.test.ts`, which runs with every `npm test`, checks the app's side: the route, the header and the model
name.

Already checked against Bifrost v2.2.6:

- The key check: an unknown key is refused by Bifrost (`access not found`).
- The `manul` rule: it routes from every route.
- Translation, as in the table above.

**Not checked yet (needs real vendor keys):** real replies, and spend being counted and the key cut off at its budget.

## Production (the silverfish cluster)

Everything runs in namespace `manul` ([k8s/manul.yaml](k8s/manul.yaml)):

- **Bifrost:** one replica. Its config is [k8s/config.json](k8s/config.json): providers, the `manul` routing rule,
  the admin login from secrets, and both stores in Postgres. Database `bifrost` on the `silverfish` Cloud SQL instance
  (private IP, daily backups and 7 days of point-in-time recovery) holds the customers, keys, budgets, spend and
  request logs, with logs kept 90 days. The credentials are `PG_HOST`, `PG_USER` and `PG_PASSWORD` in `manul-secrets`.
- **The account service** ([account/](../account/README.md)): two replicas of a small Node 24
  service. It reaches Bifrost's admin API inside the cluster.
- **One Google load balancer**, static IP `manul-gateway`, with a Google-managed certificate:
  - `gateway.manul.si` serves `/openai` and `/v1` (the models, with a Manul key);
  - `account.manul.si` serves `/v1/key` (signing in);
  - everything else is a 404, so the dashboard and `/api` are never public.

Steps:

1. **Secrets (once):** `manul-secrets` holds `BIFROST_ADMIN_USER`, `BIFROST_ADMIN_PASSWORD` and `BIFROST_AUTH`
   (generated), plus the keys you fill in. Each key is base64-encoded:

   ```bash
   kubectl -n manul patch secret manul-secrets -p '{"stringData":{"ANTHROPIC_API_KEY":"…","GEMINI_API_KEY":"…","OPENAI_API_KEY":"…","CLERK_SECRET_KEY":"sk_…"}}'
   ```

2. **Deploy:** `gateway/k8s/deploy.sh`. It reserves the static IP, loads the config and the account code as config
   maps, applies the manifests and restarts the pods. Run it again after changing config.json or the account code.
3. **DNS (once):** in Cloudflare, add `A` records for `gateway.manul.si` and `account.manul.si` pointing at the
   static IP. Set them to **DNS only** (grey cloud), so Google can issue the certificate (this takes up to about an
   hour).
4. **Dashboard:** run the command below, open http://localhost:8089 and sign in as `admin`. To read the password:
   `kubectl -n manul get secret manul-secrets -o jsonpath='{.data.BIFROST_ADMIN_PASSWORD}' | base64 -d`.

   ```bash
   kubectl -n manul port-forward svc/bifrost 8089:8080
   ```

A key in a desktop app can be extracted. Its budget is what limits a leaked key.
