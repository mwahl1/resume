# Guestbook feature design

## Context

The site's "About Me" window has always had a joke marquee line ("Sign my guestbook") as retro Geocities-era flavor text, with no real guestbook behind it. We're building an actual one.

The site is a single static `index.html` with no backend and no `package.json`. It's deployed on Vercel (project `marshal-resume`), connected to `github.com/mwahl1/resume` for git-push deploys.

## Goals

- Visitors can leave a name + short message that posts immediately (no approval queue).
- Basic abuse resistance: a server-side word filter blocks obvious slurs/profanity before anything is stored, and a per-IP rate limit stops flood-posting. No admin delete tool in this scope — a slipped-through entry would need direct Redis editing.
- Fits the existing Win98 desktop UI as its own icon/window, matching the look of Projects/Resume/Contact.

## Non-goals

- No moderation queue / approval step.
- No admin UI for deleting or editing entries.
- No user accounts, avatars, replies, or threading. Flat list of name + message + timestamp.

## Architecture

- **Storage**: Upstash Redis, provisioned via the Vercel Marketplace (`vercel integration add upstash`). One list key, `guestbook:entries`, holding JSON-stringified `{ name, message, createdAt }` objects.
  - New entries are `LPUSH`ed (newest first).
  - After each write, `LTRIM guestbook:entries 0 199` caps the list at 200 entries so it can't grow unbounded.
- **API**: one Vercel serverless function, `api/guestbook.js`:
  - `GET` → `LRANGE guestbook:entries 0 49`, returns the 50 most recent entries as JSON.
  - `POST` → validates input, checks rate limit, checks word filter, writes to Redis, returns the created entry.
- **Rate limiting**: `@upstash/ratelimit`, sliding window, 1 request per IP per 60 seconds, backed by the same Redis instance. IP read from the `x-forwarded-for` header (Vercel sets this).
- **Word filter**: a small hardcoded blocklist array in `api/guestbook.js`, checked as case-insensitive substring match against both `name` and `message`. Any hit rejects the whole submission. The blocklist lives in function source, which is part of a public repo — acceptable for this scope; it's a basic deterrent, not a security boundary.
- **New dependency surface**: this is the project's first backend code. Adds a minimal `package.json` (`@upstash/redis`, `@upstash/ratelimit`) and a `node_modules` entry in `.gitignore`.

## UI

- New desktop icon, "Guestbook", added to the existing icon grid, opening a new entry in the `WINDOWS` object (same pattern as `about`/`resume`/`contact`).
- Window layout, top to bottom:
  1. A small form: Name input, Message textarea, "Sign" button — styled with the existing `fieldset`/`btn` classes.
  2. The entry list below, newest first, each entry showing name, message, and a relative/short date.
- On window open, `fetch('/api/guestbook')` loads and renders the current entries.
- On submit, `fetch('/api/guestbook', { method: 'POST', body: JSON.stringify({ name, message }) })`. On success, the new entry is prepended to the visible list client-side (no full reload). Form clears after a successful post.

## Validation & error handling

Server-side validation (the API is the source of truth; client-side checks are just for UX):

- `name`: required, trimmed, 1-40 chars.
- `message`: required, trimmed, 1-300 chars.

Error responses and their client-facing messages (shown inline in the window, not a browser `alert`):

| Condition | HTTP status | Message shown |
|---|---|---|
| Missing/empty name or message | 400 | "Please fill in both fields." |
| Name or message too long | 400 | "Keep it a bit shorter." |
| Rate limit exceeded | 429 | "You're posting too fast — try again in a minute." |
| Word filter match | 400 | "That entry couldn't be posted." |
| Redis/server error | 500 | "Something went wrong — try again later." |

## Testing

No test framework exists in this static project (by design — it's a single HTML file). Verification is manual on a Vercel preview deployment:

1. Post a valid entry, confirm it appears at the top of the list immediately.
2. Submit with an empty name or message, confirm the inline error and no write.
3. Double-submit quickly, confirm the second attempt is rate-limited.
4. Submit a blocklisted word, confirm it's rejected and not stored.
5. Reload the page, confirm previously posted entries persist (Redis survives reloads/redeploys).
6. Check the window layout at a narrow/mobile viewport width, consistent with the rest of the site's responsive behavior.

## Open items for implementation planning

- Exact icon artwork for the desktop icon (reuse an existing SVG style from the icon set).
- Final wording/size of the word blocklist.
