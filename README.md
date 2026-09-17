# Ujuzi Kidigitali Admin Panel

Standalone responsive React/Vite admin application. It lives beside the
learner application and never stores a Supabase service-role key in the UI.

## Included

- admin sign-in backed by the `admins` table and `is_admin()` RPC
- overview counts for users, paid users, courses, enrollments, and audiences
- publish/unpublish course controls
- consent-based email and SMS campaign composer
- campaign audience preview and typed `SEND` confirmation
- campaign history and delivery-result counts

The legacy `E:\Downloads\index.html` remains a migration reference for larger
authoring tools that are not in this first phase. Do not deploy that legacy
file because it stores a Supabase service-role key in browser local storage.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the public Supabase URL and anon key.
3. Run `npm install`.
4. Run `npm run dev` or `npm run build`.

The shared database migration and Edge Functions remain in
`../Learning App/supabase` because they are part of the common backend.

## Backend deployment

From `../Learning App`, apply the migration:

```bash
supabase db push
```

Set server-only secrets. Use a separate authenticated marketing subdomain so
campaign reputation cannot damage password-reset and confirmation delivery:

```bash
supabase secrets set RESEND_MARKETING_API_KEY=...
supabase secrets set RESEND_MARKETING_FROM="Ujuzi Kidigitali <updates@updates.ujuzikidigitali.com>"
supabase secrets set PUBLIC_WEB_URL=https://app.ujuzikidigitali.com
supabase secrets set NEXTSMS_API_KEY=...
supabase secrets set NEXTSMS_SENDER_ID=UJUZIKID
```

`NEXTSMS_API_KEY` is the Base64 Basic-auth value supplied/generated for the
NextSMS API. `NEXTSMS_SENDER_ID` must already be approved in NextSMS.

Deploy the functions:

```bash
supabase functions deploy admin-dashboard --no-verify-jwt
supabase functions deploy campaign-send --no-verify-jwt
supabase functions deploy campaign-unsubscribe --no-verify-jwt
```

Only accounts present in the Supabase `admins` table can enter the dashboard or
call privileged backend functions.

## Email deliverability checklist

1. Verify the marketing subdomain in Resend (SPF and DKIM).
2. Publish DMARC with monitoring first (`p=none`), then tighten it after
   verifying all legitimate senders.
3. Send a small internal test before increasing volume gradually.
4. Keep authentication and marketing senders on separate subdomains.

Existing users are not silently subscribed. They must enable Email updates or
SMS updates in the learner app's Settings before entering a campaign audience.
