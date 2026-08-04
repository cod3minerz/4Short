# Transactional email: Resend + Hashpix

Hashpix uses Resend only for transactional account messages: email verification,
sign-in verification for an unverified account, and password reset. Marketing
mailings are deliberately out of scope until consent, unsubscribe and audience
models exist.

## One-time DNS setup

1. In Resend, add the sending domain `hashpix.ru`.
2. Copy the SPF/DKIM records **exactly** from the Resend domain-verification
   screen into the authoritative DNS zone. Do not guess record names or values.
3. Add a DMARC record in monitoring mode if it does not exist yet:
   `v=DMARC1; p=none; rua=mailto:hello@hashpix.ru`.
4. Wait for Resend to show the domain as verified, then send a manual test to a
   Gmail and a Yandex Mail inbox.

The authenticated sender is `Hashpix <hello@hashpix.ru>`. `hello@hashpix.ru`
must be able to receive replies if it remains the Reply-To address.

## Production secrets

Set the following only in `/etc/4short/control-api.env` on the control API host
(`chmod 600`; owned by the deployment user). Never commit them, use `NEXT_PUBLIC_`
prefixes, or paste them into CI logs:

```dotenv
RESEND_API_KEY=replace-with-a-new-server-secret
RESEND_FROM_EMAIL=hello@hashpix.ru
RESEND_FROM_NAME=Hashpix
RESEND_REPLY_TO=hello@hashpix.ru
```

After changing the file, restart the control API and check its health endpoint.
The key must be rotated in Resend if it was ever shown in a chat, terminal log,
commit, browser console or screenshot.

## Security characteristics

- Passwords are hashed by Better Auth; no password, OTP or token is stored in
  the browser application state after a request.
- Verification OTPs are six digits, stored hashed, expire after 10 minutes and
  allow five validation attempts.
- OTP delivery is throttled to three requests per minute in addition to the API
  rate limit.
- Password reset responds generically for unknown emails to reduce enumeration.
- Resetting a password revokes existing sessions.
- Browser authentication relies on Better Auth server sessions and HttpOnly,
  Secure cookies in production — not JWTs in `localStorage`.

## Operational test

1. Register a new address and verify the six-digit code.
2. Confirm the code cannot be reused.
3. Request a password reset; check the generic response for an unknown email.
4. Reset a password and confirm another active session is revoked.
5. Confirm no OTP or Resend API key appears in API logs.
