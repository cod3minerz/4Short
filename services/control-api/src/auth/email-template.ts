export type AuthEmailKind =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email";

type AuthEmail = {
  subject: string;
  text: string;
  html: string;
};

const COPY: Record<AuthEmailKind, { eyebrow: string; title: string; body: string; subject: string }> = {
  "sign-in": {
    eyebrow: "Вход в аккаунт",
    title: "Подтвердите вход",
    body: "Введите этот код в Hashpix, чтобы продолжить работу.",
    subject: "Код для входа в Hashpix",
  },
  "email-verification": {
    eyebrow: "Новый аккаунт",
    title: "Подтвердите email",
    body: "Введите этот код в Hashpix, чтобы активировать аккаунт.",
    subject: "Подтвердите email в Hashpix",
  },
  "forget-password": {
    eyebrow: "Сброс пароля",
    title: "Подтвердите смену пароля",
    body: "Введите этот код в Hashpix, чтобы задать новый пароль.",
    subject: "Код для смены пароля в Hashpix",
  },
  "change-email": {
    eyebrow: "Изменение email",
    title: "Подтвердите новый email",
    body: "Введите этот код в Hashpix, чтобы завершить изменение email.",
    subject: "Подтвердите новый email в Hashpix",
  },
};

function codeOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

/**
 * Transactional email is deliberately table/inlined-CSS based: it renders
 * predictably in Gmail, Apple Mail and Outlook without a client-side asset.
 */
export function buildAuthEmail(kind: AuthEmailKind, otp: string): AuthEmail {
  const copy = COPY[kind];
  const code = codeOnly(otp);

  return {
    subject: copy.subject,
    text: `${copy.title}\n\n${copy.body}\n\nКод: ${code}\n\nКод действует 10 минут. Если это были не вы, просто проигнорируйте письмо.`,
    html: `<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:0;background:#07080b;color:#f8fafc;font-family:Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07080b;padding:36px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#101218;border:1px solid #2a2e39;border-radius:20px;overflow:hidden;">
          <tr><td style="padding:36px 36px 12px;">
            <div style="font-size:24px;line-height:28px;font-weight:800;letter-spacing:-0.7px;color:#ffffff;">hashpix</div>
            <div style="width:28px;height:3px;margin-top:15px;background:#3153ff;border-radius:4px;"></div>
          </td></tr>
          <tr><td style="padding:18px 36px 8px;">
            <p style="margin:0 0 10px;color:#98a2b8;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">${copy.eyebrow}</p>
            <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:34px;letter-spacing:-0.8px;">${copy.title}</h1>
            <p style="margin:14px 0 0;color:#bac1cf;font-size:16px;line-height:24px;">${copy.body}</p>
          </td></tr>
          <tr><td style="padding:26px 36px 18px;">
            <div style="border:1px solid #3a4357;background:#0b0d12;border-radius:14px;padding:19px 16px;text-align:center;color:#ffffff;font-size:32px;font-weight:800;letter-spacing:9px;font-variant-numeric:tabular-nums;">${code}</div>
          </td></tr>
          <tr><td style="padding:0 36px 36px;">
            <p style="margin:0;color:#8590a3;font-size:13px;line-height:20px;">Код действует 10 минут и подходит только для одного действия. Если это были не вы, просто проигнорируйте письмо.</p>
          </td></tr>
        </table>
        <p style="margin:18px 0 0;color:#626b7c;font-size:12px;line-height:18px;">© Hashpix · Создавайте короткие видео из длинных</p>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
