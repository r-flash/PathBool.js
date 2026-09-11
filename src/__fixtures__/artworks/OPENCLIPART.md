# Openclipart authentication

The collector currently supports Wikimedia Commons. These instructions prepare
credentials for a future Openclipart adapter; `scrape-paths` does not read these
credentials or collect from Openclipart yet.

Verified against the public [Openclipart API tutorial](https://openclipart.org/api/tutorial)
on 2026-09-11. Its prose sometimes omits `@beta`; the working examples consistently
use `https://openclipart.org/api/v2@beta`. These steps follow those examples.
Authenticated requests have not been exercised with a real account.

1. Create an account at [Openclipart](https://openclipart.org/) if needed.
2. In your HTTP client, send `POST https://openclipart.org/api/v2@beta/auth/login`
   with an `application/x-www-form-urlencoded` body containing `username` and
   `password`. Save the successful response's `data.token` as your **user token**.
3. Create an app **once**: send `POST https://openclipart.org/api/v2@beta/apps/create`
   with `Authorization: Bearer USER_TOKEN`, `Content-Type: application/json`,
   and body `{"name":"PathBool corpus"}`. Save `data.app.appid` and
   `data.app.secret` in your password manager. The tutorial says the secret is
   displayed only at creation. `data.token` from this response is already usable
   as an app token.
4. To obtain a new **app token** for an existing app, send
   `POST https://openclipart.org/api/v2@beta/apps/getToken` with
   `x-openclipart-apikey: USER_TOKEN`, `Content-Type: application/json`, and body
   `{"appid":"YOUR_APP_ID","secret":"YOUR_APP_SECRET"}`. Save `data.token`.
   Refresh an expired user token through step 2; reuse the existing app.
5. Verify with a single `GET https://openclipart.org/api/v2@beta/search?q=water`,
   using the header `x-openclipart-apikey: APP_TOKEN`. Check `success` and
   `data.files`. A user token and an app token have different purposes.

Keep credentials out of the artwork manifest, reports, URLs and committed files.
Use your HTTP client's private/local secret storage, not a shared collection or
shell command containing literal passwords. If a later adapter uses environment
variables, Bash can accept a token without echoing it or putting it in history:

```bash
read -rsp 'Openclipart app token: ' OPENCLIPART_API_TOKEN
export OPENCLIPART_API_TOKEN
```

Do not recreate the app for each run, repeatedly log in, or automatically retry
app creation. On 401/403, stop and check credentials. Future collection must use
serial paced requests, cache search pages and source downloads, honor full
`Retry-After` delays, and stop after repeated throttling. The tutorial's example
`rateLimit` values do not specify a time window and are not a scraping target.
