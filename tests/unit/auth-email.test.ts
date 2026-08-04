import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthEmail } from "../../services/control-api/src/auth/email-template.js";

test("auth email is branded, short-lived and never interpolates arbitrary OTP markup", () => {
  const email = buildAuthEmail("email-verification", "<123456>");

  assert.equal(email.subject, "Подтвердите email в Hashpix");
  assert.match(email.text, /123456/);
  assert.match(email.text, /10 минут/);
  assert.match(email.html, /hashpix/);
  assert.doesNotMatch(email.html, /<123456>/);
  assert.match(email.html, /#3153ff/);
});

test("reset emails communicate the correct transactional purpose", () => {
  const email = buildAuthEmail("forget-password", "012345");

  assert.equal(email.subject, "Код для смены пароля в Hashpix");
  assert.match(email.text, /новый пароль|смены пароля/i);
});
