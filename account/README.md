# Manul accounts

When a person signs in, the account service gives them their own Manul key. It's a small Node service, `server.mjs`
running [src/index.ts](src/index.ts), deployed in the cluster next to the gateway
([gateway/README.md](../gateway/README.md)).

```
App ──(Sign in to Manul: system browser, OAuth + PKCE)──▶ Clerk
App ──POST https://account.manul.si/v1/key, Bearer <Clerk access token>──▶ account service
        ──/oauth/userinfo──▶ Clerk                               who is it?
        ──/v1/users/<id>──▶ Clerk Backend API                    do they have a key already?
        ──/api/governance/customers, virtual-keys──▶ Bifrost     first time: their customer and key (inside the cluster)
        ──PATCH metadata──▶ Clerk                                remember which key is theirs
App ◀── { key, email }  (key into the keychain, email shown in Settings)
```

- **Who is who:** each person is a Bifrost *customer* named after their email, with one *virtual key*. The key's name
  is their Clerk user ID and its description is their email. Bifrost keeps customers, keys, budgets, spend and request
  logs in Postgres (database `bifrost` on the `silverfish` Cloud SQL instance). The Clerk user's private metadata links
  back to them: `{ bifrost: { customer_id, virtual_key_id } }`.
- **Same key everywhere:** signing in on another computer returns the same key. Signing out only removes it from that
  computer.
- **Turning someone off:** deactivate their virtual key in Bifrost's dashboard, and signing in again won't make a new
  one. If the key is deleted instead, the next sign-in makes a new one under the same customer.
- **What a new key gets:** `NEW_KEY` in [src/index.ts](src/index.ts), or the `NEW_KEY` environment variable as JSON. By
  default that's a $1/month budget, 300 requests an hour, and the models the gateway's `manul` rule may route to.

## Clerk

Clerk application **Manul** has a development instance, `good-wildcat-5360.clerk.accounts.dev`, with email and Google
sign-in. Its OAuth application **Manul desktop** is set up like this:

- Client ID: `5E3y3JppmCuVr1UD`
- Type: public client (PKCE, no secret)
- Scopes: `openid email profile`
- Redirect URI: `http://127.0.0.1:47619/oauth/callback`

The app's defaults are in [src/main/account.ts](../src/main/account.ts). You can override them with
`MANUL_AUTH_ISSUER`, `MANUL_AUTH_CLIENT_ID` and `MANUL_ACCOUNT`. The service's `CLERK_ISSUER` is set in
[gateway/k8s/manul.yaml](../gateway/k8s/manul.yaml).

Before launch, move to Clerk's production instance:

1. Click **Go to prod** in the Clerk dashboard and add the DNS records it lists for `manul.si`. Its Frontend API
   becomes `https://clerk.manul.si`.
2. Create the same OAuth application there.
3. Point `AUTH.issuer` and `AUTH.clientId` in account.ts, and `CLERK_ISSUER` in manul.yaml, at the new instance.
4. Put that instance's secret key in `manul-secrets` as `CLERK_SECRET_KEY`.
5. Set up Google sign-in with your own Google OAuth credentials, which production requires.

## Tests

- `test/account-service.test.ts`: this service, against a fake Clerk and Bifrost.
- `test/account.test.ts`: the app's sign-in, against a fake Clerk and account service.
