# Recipes & Grocery (Kroger)

Single-user recipe library + weekly plan + grocery list, with AI recipe parsing
(Claude) and Kroger cart integration. Static PWA frontend, Netlify Functions
backend, Netlify Blobs storage. No database, no build step.

## Stack

- Frontend: vanilla HTML/CSS/JS in `public/`, installable PWA with a Web Share Target.
- Backend: Netlify Functions v2 (ESM) in `netlify/functions/`, shared code in `netlify/lib/`.
- Storage: Netlify Blobs, one store `recipe-app`.
- AI: `@anthropic-ai/sdk`, model `claude-sonnet-5-5` (set `ANTHROPIC_MODEL` to change it, e.g. `claude-fable-5-1`).
- Kroger: OAuth2 authorization code flow, locations, products, cart.

## Local development

```bash
npm install
npm install -g netlify-cli      # or use: npx netlify-cli dev
cp .env.example .env            # then fill in the values
npm run dev                     # = netlify dev  -> http://localhost:8888
```

`netlify dev` loads `.env` automatically, runs the functions, and provides a local
sandbox for Netlify Blobs (data does not sync with production). Background
functions work locally too.

Note: the env file in this folder is currently named `env` (no leading dot).
`netlify dev` only reads `.env`, so rename it (`ren env .env`) or copy its values
into `.env`. Both names are git-ignored.

Checks:

```bash
npm run check          # imports every function/lib module (syntax + exports)
npm run test:jsonld    # parses real recipe pages with the JSON-LD extractor
npm run icons          # regenerates public/icons/*.png
```

If you are behind a TLS-inspecting corporate proxy, `npm install` and the
JSON-LD test may fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Point Node at the
proxy's root certificate: `set NODE_EXTRA_CA_CERTS=C:\path\to\corp-root.pem`.

## Environment variables

Set these in `.env` locally and in the Netlify dashboard
(Site configuration -> Environment variables) for production.

| Variable | Purpose |
|---|---|
| `KROGER_CLIENT_ID` | Kroger developer app client id |
| `KROGER_CLIENT_SECRET` | Kroger developer app client secret |
| `KROGER_API_BASE` | Kroger API base, e.g. `https://api.kroger.com/v1` (`/v1` is appended if missing) |
| `KROGER_TOKEN_URL` | OAuth token endpoint, e.g. `https://api.kroger.com/v1/connect/oauth2/token` (the authorize URL is derived from it) |
| `KROGER_REDIRECT_URI` | Must exactly match the redirect URI registered on the Kroger app (see below) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | Optional, defaults to `claude-sonnet-5-5` |
| `APP_USERNAME` | Login username |
| `APP_PASSWORD` | Login password |
| `SESSION_SECRET` | Random string (32+ chars) used to HMAC-sign the session cookie |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Kroger redirect URI registration

1. Go to https://developer.kroger.com, open your application.
2. Under the app's **Redirect URL** settings add both:
   - `http://localhost:8888/api/kroger/callback` (local `netlify dev`)
   - `https://<your-site>.netlify.app/api/kroger/callback` (production; use your custom domain if you have one)
3. Make sure the app has the **Cart** and **Products** APIs enabled (scopes used:
   `cart.basic:write product.compact profile.compact`).
4. Set `KROGER_REDIRECT_URI` to the matching value in each environment
   (`.env` locally, Netlify dashboard in production). It must match character for character.

Store search and product matching use an app-level (client credentials) token,
so they work before you connect your account. Adding to the cart requires
"Connect Kroger" (user token). Tokens are stored in Blobs (`kroger-tokens`) and
refreshed automatically; rotated refresh tokens are always saved.
Checkout always happens in the Kroger app or on kroger.com.

## Deploying to Netlify

1. Push the repo to GitHub/GitLab and create a Netlify site from it
   (`netlify.toml` sets `publish = "public"` and `functions = "netlify/functions"`).
   Or deploy from the CLI: `netlify deploy --prod`.
2. Add all environment variables from the table above.
3. Netlify Blobs needs no setup.
4. Open the site, sign in, and (on Android Chrome) install it from the browser
   menu so it appears in the share sheet. On iOS, use "Add to Home Screen".

## How the pieces fit

- `POST /api/parse` fetches a URL with a browser User-Agent and tries schema.org
  `Recipe` JSON-LD first (`@graph`, `HowToSection`/`HowToStep` supported). If
  none is found the page is reduced to plain text and handed to the background
  function `/api/parse-background`, which calls Claude and writes the result to
  `jobs/{id}` in Blobs. The frontend polls `/api/jobs/:id`. Pasted text always
  goes through the AI path.
- Some sites (Allrecipes, Serious Eats, Budget Bytes and other Cloudflare-protected
  sites) answer server-side fetches with a bot challenge (HTTP 403). The app
  reports this clearly; use "Paste text" for those recipes.
- "Build Grocery List" (`/api/build-list` + `/api/build-list-background`) scales
  the flagged recipes, asks Claude to merge/convert/group them, filters pantry
  staples, and saves `grocery-list`.
- Both AI operations run as background functions (15 min limit) because a
  synchronous function times out after ~10-26 s.
- Blobs keys: `recipes/{id}`, `recipes-index`, `week`, `grocery-list`,
  `settings`, `kroger-tokens`, `kroger-client-token`, `kroger-product-map`,
  `login-attempts`, `jobs/{id}`.

## Auth

Login compares against `APP_USERNAME` / `APP_PASSWORD` with a timing-safe
compare and sets an HttpOnly, SameSite=Lax (Secure on https) cookie containing an
HMAC-SHA256 signed token valid for 30 days. Five failed logins within 15 minutes
lock login for 15 minutes (tracked in Blobs `login-attempts`). Every function
except `/api/login` and `/api/kroger/callback` returns 401 without a valid session.

## Share target

The manifest declares a `share_target` at `/share`. Sharing a link from an
Android browser to the installed app opens it and parses the URL immediately.
iOS does not support Web Share Target for PWAs; on iPhone, copy the link and use
"Add -> From URL", or create an iOS Shortcut that opens
`https://<your-site>/share?url=<shared url>`.
