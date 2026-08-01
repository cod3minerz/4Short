"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "../components/logo";
import { ControlApiError, sendSignInOtp, verifySignInOtp } from "../dashboard/lib/control-api";
import "./sign-in.css";

const RESEND_COOLDOWN_SECONDS = 45;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
      setCooldown((value) => {
        if (value <= 1) {
          if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
          return 0;
        }
        return value - 1;
      });
    }, 1_000);
  };

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError("Введите настоящий email — на него придёт код.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendSignInOtp(trimmed);
      setStep("otp");
      startCooldown();
    } catch (sendError) {
      setError(sendError instanceof ControlApiError ? sendError.message : "Не удалось отправить код. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (otp.trim().length < 4) {
      setError("Введите код из письма.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await verifySignInOtp(email.trim(), otp.trim());
      const redirectTo = searchParams.get("redirect");
      // A hard navigation, not router.push — the dashboard store hydrates
      // once per page load (module-level `hydrated` flag, never reset), so
      // a client-side push here would land on the SAME store instance that
      // already cached "no session" from the redirect that sent the user
      // here in the first place, sending them straight back to sign-in.
      window.location.href = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/dashboard";
    } catch (verifyError) {
      setError(verifyError instanceof ControlApiError ? verifyError.message : "Неверный или устаревший код. Попробуйте снова.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link className="auth-card__logo" href="/" aria-label="Hashpix — на главную">
          <Logo priority />
        </Link>
        {step === "email" ? (
          <>
            <h1>Вход в Hashpix</h1>
            <p>Введите email — пришлём одноразовый код для входа.</p>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendCode();
              }}
            >
              <label className="auth-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setError(""); }}
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Отправляем…" : "Отправить код"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>Введите код</h1>
            <p>Отправили код на {email}. Код действует 10 минут.</p>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void verifyCode();
              }}
            >
              <label className="auth-field">
                <span>Код из письма</span>
                <input
                  className="is-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(event) => { setOtp(event.target.value.replace(/\D/g, "")); setError(""); }}
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Проверяем…" : "Войти"}
              </button>
            </form>
            <div className="auth-resend">
              <button
                type="button"
                disabled={cooldown > 0 || busy}
                onClick={() => void sendCode()}
              >
                {cooldown > 0 ? `Отправить код ещё раз через ${cooldown} с` : "Отправить код ещё раз"}
              </button>
            </div>
            <div className="auth-change-email">
              <button type="button" onClick={() => { setStep("email"); setOtp(""); setError(""); }}>
                Указать другой email
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
