"use client";

import { ArrowLeft01Icon, EyeIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { AsyncButton } from "@/components/hashpix/async-button";
import { PageDescription, PageTitle } from "@/components/hashpix/typography";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const feedbackId = useId();

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

  const hasFeedback = Boolean(error || notice);

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground sm:p-6">
      <Card className="w-full max-w-md" aria-labelledby="auth-title">
        <CardHeader className="gap-5">
          <Link className="flex w-fit [&_img]:h-auto [&_img]:w-36" href="/" aria-label="Hashpix — на главную">
            <Logo priority tone="light" variant="identity" />
          </Link>
          {(step === "verify-email" || step === "reset-password") ? (
            <Button variant="ghost" type="button" onClick={() => changeStep(step === "verify-email" ? "sign-up" : "forgot-password")}>
              <AppIcon icon={ArrowLeft01Icon} size="sm" aria-hidden="true" />
              Назад
            </Button>
          ) : null}
          <div className="space-y-1">
            <PageTitle id="auth-title">{title}</PageTitle>
            <PageDescription>{description}</PageDescription>
          </div>
        </CardHeader>

        <CardContent>
          {error ? <FieldError id={feedbackId}>{error}</FieldError> : null}
          {notice ? <FieldDescription id={feedbackId} role="status">{notice}</FieldDescription> : null}

          {step === "sign-in" ? (
            <form onSubmit={(event) => { event.preventDefault(); void signIn(); }} noValidate aria-describedby={hasFeedback ? feedbackId : undefined}>
              <FieldGroup className="gap-4">
                <EmailField email={email} setEmail={setEmail} clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <PasswordField value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} label="Пароль" autoComplete="current-password" clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <AsyncButton className="w-full" type="submit" loading={busy}>Войти</AsyncButton>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="link" type="button" onClick={() => changeStep("forgot-password")}>Забыли пароль?</Button>
                  <Button nativeButton={false} render={<Link href="/sign-up" />} variant="link">Создать аккаунт</Button>
                </div>
              </FieldGroup>
            </form>
          ) : null}

          {step === "sign-up" ? (
            <form onSubmit={(event) => { event.preventDefault(); void signUp(); }} noValidate aria-describedby={hasFeedback ? feedbackId : undefined}>
              <FieldGroup className="gap-4">
                <EmailField email={email} setEmail={setEmail} clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <PasswordField value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} label="Пароль" autoComplete="new-password" hint="От 12 символов" clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <PasswordField value={confirmPassword} onChange={setConfirmPassword} show={showPassword} setShow={setShowPassword} label="Повторите пароль" autoComplete="new-password" clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <AsyncButton className="w-full" type="submit" loading={busy}>Продолжить</AsyncButton>
                <FieldDescription>Продолжая, вы подтверждаете, что имеете право использовать сервис.</FieldDescription>
                <Button nativeButton={false} render={<Link href="/sign-in" />} variant="link">Уже есть аккаунт? Войти</Button>
              </FieldGroup>
            </form>
          ) : null}

          {step === "verify-email" ? (
            <form onSubmit={(event) => { event.preventDefault(); void verifyEmail(); }} noValidate aria-describedby={hasFeedback ? feedbackId : undefined}>
              <FieldGroup className="gap-4">
                <OtpField value={otp} onChange={(value) => { setOtp(value); clearFeedback(); }} describedBy={hasFeedback ? feedbackId : undefined} />
                <AsyncButton className="w-full" type="submit" loading={busy}>Подтвердить email</AsyncButton>
                <ResendButton cooldown={cooldown} busy={busy} onClick={resendVerification} />
              </FieldGroup>
            </form>
          ) : null}

          {step === "forgot-password" ? (
            <form onSubmit={(event) => { event.preventDefault(); void requestReset(); }} noValidate aria-describedby={hasFeedback ? feedbackId : undefined}>
              <FieldGroup className="gap-4">
                <EmailField email={email} setEmail={setEmail} clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <AsyncButton className="w-full" type="submit" loading={busy}>Отправить код</AsyncButton>
                <Button nativeButton={false} render={<Link href="/sign-in" />} variant="link">Вернуться ко входу</Button>
              </FieldGroup>
            </form>
          ) : null}

          {step === "reset-password" ? (
            <form onSubmit={(event) => { event.preventDefault(); void resetPassword(); }} noValidate aria-describedby={hasFeedback ? feedbackId : undefined}>
              <FieldGroup className="gap-4">
                <OtpField value={otp} onChange={(value) => { setOtp(value); clearFeedback(); }} describedBy={hasFeedback ? feedbackId : undefined} />
                <PasswordField value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} label="Новый пароль" autoComplete="new-password" hint="От 12 символов" clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <PasswordField value={confirmPassword} onChange={setConfirmPassword} show={showPassword} setShow={setShowPassword} label="Повторите пароль" autoComplete="new-password" clearFeedback={clearFeedback} describedBy={hasFeedback ? feedbackId : undefined} />
                <AsyncButton className="w-full" type="submit" loading={busy}>Обновить пароль</AsyncButton>
                <ResendButton cooldown={cooldown} busy={busy} onClick={resendReset} />
              </FieldGroup>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

function EmailField({ email, setEmail, clearFeedback, describedBy }: { email: string; setEmail: (value: string) => void; clearFeedback: () => void; describedBy?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>Email</FieldLabel>
      <Input id={id} type="email" autoComplete="email" autoCapitalize="none" autoFocus placeholder="you@example.com" value={email} aria-describedby={describedBy} onChange={(event) => { setEmail(event.target.value); clearFeedback(); }} />
    </Field>
  );
}

function PasswordField({ value, onChange, show, setShow, label, autoComplete, hint, clearFeedback, describedBy }: { value: string; onChange: (value: string) => void; show: boolean; setShow: (value: boolean) => void; label: string; autoComplete: "current-password" | "new-password"; hint?: string; clearFeedback: () => void; describedBy?: string }) {
  const id = useId();
  const hintId = useId();
  const description = [hint ? hintId : undefined, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input id={id} className="pr-10" type={show ? "text" : "password"} autoComplete={autoComplete} placeholder="••••••••••••" value={value} aria-describedby={description} onChange={(event) => { onChange(event.target.value); clearFeedback(); }} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button className="absolute right-0 top-0" variant="ghost" size="icon" type="button" onClick={() => setShow(!show)} aria-label={show ? "Скрыть пароль" : "Показать пароль"} aria-pressed={show}>
                <AppIcon icon={show ? ViewOffIcon : EyeIcon} size="sm" aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>{show ? "Скрыть пароль" : "Показать пароль"}</TooltipContent>
        </Tooltip>
      </div>
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
    </Field>
  );
}

function OtpField({ value, onChange, describedBy }: { value: string; onChange: (value: string) => void; describedBy?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>Код из письма</FieldLabel>
      <InputOTP id={id} maxLength={6} value={value} onChange={onChange} pattern={REGEXP_ONLY_DIGITS} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-describedby={describedBy} containerClassName="w-full justify-between">
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => <InputOTPSlot index={index} key={index} />)}
        </InputOTPGroup>
      </InputOTP>
    </Field>
  );
}

function ResendButton({ cooldown, busy, onClick }: { cooldown: number; busy: boolean; onClick: () => Promise<void> }) {
  return (
    <AsyncButton className="self-center" variant="link" type="button" loading={busy} disabled={cooldown > 0} onClick={() => void onClick()}>
      {cooldown ? `Отправить ещё раз через ${cooldown} с` : "Отправить код ещё раз"}
    </AsyncButton>
  );
}
