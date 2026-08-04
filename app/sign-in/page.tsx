"use client";

import { Eye, EyeOff, LockKeyhole, Mail, MoveLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "../components/logo";
import {
  ControlApiError,
  requestPasswordReset,
  resetPasswordWithOtp,
  sendVerificationOtp,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailOtp,
} from "../dashboard/lib/control-api";
import "./sign-in.css";

export type AuthScreenMode = "sign-in" | "sign-up" | "forgot-password";
type AuthStep = AuthScreenMode | "verify-email" | "reset-password";

const RESEND_COOLDOWN_SECONDS = 45;
const GENERIC_SIGN_IN_ERROR = "Не удалось войти. Проверьте email и пароль.";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongPassword(value: string) {
  return value.length >= 12 && value.length <= 128;
}

function safeInternalRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  return value;
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <AuthScreen initialMode="sign-in" />
    </Suspense>
  );
}

export function AuthScreen({ initialMode }: { initialMode: AuthScreenMode }) {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<AuthStep>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    cooldownTimer.current = window.setInterval(() => {
      setCooldown((seconds) => {
        if (seconds <= 1) {
          if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
          return 0;
        }
        return seconds - 1;
      });
    }, 1_000);
  };

  const clearFeedback = () => {
    setError("");
    setNotice("");
  };

  const validateEmail = () => {
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) {
      setError("Введите корректный email.");
      return null;
    }
    return normalized;
  };

  const goToDashboard = () => {
    // A full navigation gives the dashboard a fresh authenticated session.
    window.location.assign(safeInternalRedirect(searchParams.get("redirect")));
  };

  const signIn = async () => {
    const normalized = validateEmail();
    if (!normalized) return;
    if (!password) {
      setError("Введите пароль.");
      return;
    }

    setBusy(true);
    clearFeedback();
    try {
      await signInWithPassword({ email: normalized, password, rememberMe: true });
      goToDashboard();
    } catch (requestError) {
      if (requestError instanceof ControlApiError && requestError.code === "EMAIL_NOT_VERIFIED") {
        setEmail(normalized);
        setStep("verify-email");
        setNotice("Мы отправили новый код подтверждения на этот email.");
        startCooldown();
      } else {
        setError(GENERIC_SIGN_IN_ERROR);
      }
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    const normalized = validateEmail();
    if (!normalized) return;
    if (!isStrongPassword(password)) {
      setError("Пароль должен содержать от 12 до 128 символов.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    setBusy(true);
    clearFeedback();
    try {
      // Better Auth requires a name field; avoid deriving a public display name
      // from the local part of a private email address.
      await signUpWithPassword({ email: normalized, password, name: "Пользователь" });
      setEmail(normalized);
      setOtp("");
      setStep("verify-email");
      setNotice("Если это новый аккаунт, шестизначный код подтверждения уже отправлен. Если вы уже регистрировались, войдите в аккаунт.");
      startCooldown();
    } catch {
      // Do not reveal whether an address is already registered.
      setError("Не удалось создать аккаунт. Проверьте данные или попробуйте войти.");
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async () => {
    const normalized = validateEmail();
    if (!normalized) return;
    if (otp.length !== 6) {
      setError("Введите шестизначный код из письма.");
      return;
    }

    setBusy(true);
    clearFeedback();
    try {
      await verifyEmailOtp(normalized, otp);
      goToDashboard();
    } catch {
      setError("Код неверный или уже истёк. Запросите новый и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async () => {
    const normalized = validateEmail();
    if (!normalized) return;

    setBusy(true);
    clearFeedback();
    try {
      // The API always returns success, so this text does not disclose whether
      // an account exists for the submitted address.
      await requestPasswordReset(normalized);
      setEmail(normalized);
      setOtp("");
      setStep("reset-password");
      setNotice("Если аккаунт существует, мы отправили на него код для смены пароля.");
      startCooldown();
    } catch {
      setError("Не удалось обработать запрос. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    const normalized = validateEmail();
    if (!normalized) return;
    if (otp.length !== 6) {
      setError("Введите шестизначный код из письма.");
      return;
    }
    if (!isStrongPassword(password)) {
      setError("Новый пароль должен содержать от 12 до 128 символов.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    setBusy(true);
    clearFeedback();
    try {
      await resetPasswordWithOtp({ email: normalized, otp, password });
      setPassword("");
      setConfirmPassword("");
      setOtp("");
      setStep("sign-in");
      setNotice("Пароль обновлён. Теперь войдите с новым паролем.");
    } catch {
      setError("Не удалось сменить пароль. Проверьте код и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    const normalized = validateEmail();
    if (!normalized) return;
    setBusy(true);
    clearFeedback();
    try {
      await sendVerificationOtp(normalized);
      setNotice("Новый код отправлен. Предыдущий код больше не действует.");
      startCooldown();
    } catch {
      setError("Не удалось отправить код. Повторите попытку позже.");
    } finally {
      setBusy(false);
    }
  };

  const resendReset = async () => {
    const normalized = validateEmail();
    if (!normalized) return;
    setBusy(true);
    clearFeedback();
    try {
      await requestPasswordReset(normalized);
      setNotice("Если аккаунт существует, новый код уже отправлен.");
      startCooldown();
    } catch {
      setError("Не удалось отправить код. Повторите попытку позже.");
    } finally {
      setBusy(false);
    }
  };

  const changeStep = (next: AuthStep) => {
    setStep(next);
    setPassword("");
    setConfirmPassword("");
    setOtp("");
    clearFeedback();
  };

  const title = step === "sign-in"
    ? "Вход в Hashpix"
    : step === "sign-up"
      ? "Создайте аккаунт"
      : step === "verify-email"
        ? "Подтвердите email"
        : step === "forgot-password"
          ? "Восстановление пароля"
          : "Новый пароль";

  const description = step === "sign-in"
    ? "Войдите, чтобы продолжить работу с проектами и клипами."
    : step === "sign-up"
      ? "Сначала подтвердим email — это защитит ваш аккаунт и проекты."
      : step === "verify-email"
        ? `Мы отправили код на ${email || "ваш email"}. Он действует 10 минут.`
        : step === "forgot-password"
          ? "Введите email — отправим код для безопасной смены пароля."
          : `Введите код из письма для ${email || "вашего email"} и новый пароль.`;

  return (
    <main className="auth-shell">
      <div className="auth-ambient auth-ambient--one" aria-hidden="true" />
      <div className="auth-ambient auth-ambient--two" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-card__logo" href="/" aria-label="Hashpix — на главную">
          <Logo priority tone="light" variant="identity" />
        </Link>
        {(step === "verify-email" || step === "reset-password") ? (
          <button className="auth-back" type="button" onClick={() => changeStep(step === "verify-email" ? "sign-up" : "forgot-password")}>
            <MoveLeft aria-hidden="true" size={16} /> Назад
          </button>
        ) : null}
        <header className="auth-card__header">
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </header>
        {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}

        {step === "sign-in" ? (
          <form onSubmit={(event) => { event.preventDefault(); void signIn(); }} noValidate>
            <EmailField email={email} setEmail={setEmail} clearFeedback={clearFeedback} />
            <PasswordField value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} label="Пароль" autoComplete="current-password" clearFeedback={clearFeedback} />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
            <div className="auth-actions">
              <button className="auth-link" type="button" onClick={() => changeStep("forgot-password")}>Забыли пароль?</button>
              <Link className="auth-link" href="/sign-up">Создать аккаунт</Link>
            </div>
          </form>
        ) : null}

        {step === "sign-up" ? (
          <form onSubmit={(event) => { event.preventDefault(); void signUp(); }} noValidate>
            <EmailField email={email} setEmail={setEmail} clearFeedback={clearFeedback} />
            <PasswordField value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} label="Пароль" autoComplete="new-password" hint="От 12 символов" clearFeedback={clearFeedback} />
            <PasswordField value={confirmPassword} onChange={setConfirmPassword} show={showPassword} setShow={setShowPassword} label="Повторите пароль" autoComplete="new-password" clearFeedback={clearFeedback} />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Создаём аккаунт…" : "Продолжить"}</button>
            <p className="auth-legal">Продолжая, вы подтверждаете, что имеете право использовать сервис.</p>
            <div className="auth-actions auth-actions--single"><Link className="auth-link" href="/sign-in">Уже есть аккаунт? Войти</Link></div>
          </form>
        ) : null}

        {step === "verify-email" ? (
          <form onSubmit={(event) => { event.preventDefault(); void verifyEmail(); }} noValidate>
            <OtpField value={otp} onChange={(value) => { setOtp(value); clearFeedback(); }} />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Проверяем…" : "Подтвердить email"}</button>
            <ResendButton cooldown={cooldown} busy={busy} onClick={resendVerification} />
          </form>
        ) : null}

        {step === "forgot-password" ? (
          <form onSubmit={(event) => { event.preventDefault(); void requestReset(); }} noValidate>
            <EmailField email={email} setEmail={setEmail} clearFeedback={clearFeedback} />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Отправляем…" : "Отправить код"}</button>
            <div className="auth-actions auth-actions--single"><Link className="auth-link" href="/sign-in">Вернуться ко входу</Link></div>
          </form>
        ) : null}

        {step === "reset-password" ? (
          <form onSubmit={(event) => { event.preventDefault(); void resetPassword(); }} noValidate>
            <OtpField value={otp} onChange={(value) => { setOtp(value); clearFeedback(); }} />
            <PasswordField value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} label="Новый пароль" autoComplete="new-password" hint="От 12 символов" clearFeedback={clearFeedback} />
            <PasswordField value={confirmPassword} onChange={setConfirmPassword} show={showPassword} setShow={setShowPassword} label="Повторите пароль" autoComplete="new-password" clearFeedback={clearFeedback} />
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Обновляем…" : "Обновить пароль"}</button>
            <ResendButton cooldown={cooldown} busy={busy} onClick={resendReset} />
          </form>
        ) : null}
      </section>
    </main>
  );
}

function EmailField({ email, setEmail, clearFeedback }: { email: string; setEmail: (value: string) => void; clearFeedback: () => void }) {
  return (
    <label className="auth-field">
      <span>Email</span>
      <span className="auth-input-wrap">
        <Mail aria-hidden="true" size={18} />
        <input type="email" autoComplete="email" autoCapitalize="none" autoFocus placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); clearFeedback(); }} />
      </span>
    </label>
  );
}

function PasswordField({ value, onChange, show, setShow, label, autoComplete, hint, clearFeedback }: { value: string; onChange: (value: string) => void; show: boolean; setShow: (value: boolean) => void; label: string; autoComplete: "current-password" | "new-password"; hint?: string; clearFeedback: () => void }) {
  return (
    <label className="auth-field">
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
      <span className="auth-input-wrap">
        <LockKeyhole aria-hidden="true" size={18} />
        <input type={show ? "text" : "password"} autoComplete={autoComplete} placeholder="••••••••••••" value={value} onChange={(event) => { onChange(event.target.value); clearFeedback(); }} />
        <button className="auth-password-toggle" type="button" onClick={() => setShow(!show)} aria-label={show ? "Скрыть пароль" : "Показать пароль"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </span>
    </label>
  );
}

function OtpField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="auth-field">
      <span>Код из письма</span>
      <input className="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="000000" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))} />
    </label>
  );
}

function ResendButton({ cooldown, busy, onClick }: { cooldown: number; busy: boolean; onClick: () => Promise<void> }) {
  return <div className="auth-resend"><button className="auth-link" type="button" disabled={cooldown > 0 || busy} onClick={() => void onClick()}>{cooldown ? `Отправить ещё раз через ${cooldown} с` : "Отправить код ещё раз"}</button></div>;
}
