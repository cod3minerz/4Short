"use client";

import { LoaderCircle, LogOut, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeading } from "../components/page-heading";
import { ControlApiError, isControlApiConfigured, listSessions, revokeOtherSessions, signOut } from "../lib/control-api";
import { useDashboardStore } from "../store";

type SessionRow = Awaited<ReturnType<typeof listSessions>>[number];

/** "Mozilla/5.0 (Macintosh; …" → "macOS" — enough to recognise your own device. */
function describeDevice(userAgent?: string | null) {
  if (!userAgent) return "Устройство не определено";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS/i.test(userAgent)) return "macOS";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Другое устройство";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export function AccountView() {
  const { user, connection } = useDashboardStore();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsError, setSessionsError] = useState("");
  const [busy, setBusy] = useState<"revoke" | "signout" | null>(null);
  const [notice, setNotice] = useState("");

  const loadSessions = async () => {
    if (!isControlApiConfigured()) return;
    setSessionsError("");
    try {
      setSessions(await listSessions());
    } catch (error) {
      setSessionsError(error instanceof ControlApiError ? error.message : "Не удалось загрузить сессии. Проверьте соединение и попробуйте ещё раз.");
    }
  };

  useEffect(() => {
    if (!isControlApiConfigured()) return;
    let cancelled = false;
    listSessions().then(
      (rows) => { if (!cancelled) setSessions(rows); },
      (error: unknown) => {
        if (!cancelled) setSessionsError(error instanceof ControlApiError ? error.message : "Не удалось загрузить сессии. Проверьте соединение и попробуйте ещё раз.");
      },
    );
    return () => { cancelled = true; };
  }, []);

  const revokeOthers = async () => {
    setBusy("revoke");
    setNotice("");
    try {
      await revokeOtherSessions();
      setNotice("Остальные сессии завершены.");
      await loadSessions();
    } catch (error) {
      setSessionsError(error instanceof ControlApiError ? error.message : "Не удалось завершить сессии. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    setBusy("signout");
    try {
      await signOut();
      window.location.href = "/";
    } catch (error) {
      setSessionsError(error instanceof ControlApiError ? error.message : "Не удалось выйти. Проверьте соединение и попробуйте ещё раз.");
      setBusy(null);
    }
  };

  const signedIn = Boolean(user);

  return (
    <main className="dash-page">
      <PageHeading title="Аккаунт" description="Вход, безопасность и управление данными." />
      <div className="account-sections">
        <section className="account-section">
          <div><Mail size={18} /><span><h2>Данные аккаунта</h2><p>Основной способ связи и входа.</p></span></div>
          {signedIn ? (
            <dl>
              <div><dt>Email</dt><dd>{user!.email}</dd></div>
              {user!.name ? <div><dt>Имя</dt><dd>{user!.name}</dd></div> : null}
            </dl>
          ) : (
            <p className="dash-empty-note">
              {connection === "loading"
                ? "Загружаем данные аккаунта…"
                : "Вход не подключён к этому окружению — данные аккаунта недоступны."}
            </p>
          )}
        </section>

        <section className="account-section">
          <div><ShieldCheck size={18} /><span><h2>Безопасность</h2><p>Активные входы в аккаунт.</p></span></div>
          {sessions === null ? (
            sessionsError
              ? <p className="dash-field-error" role="alert">{sessionsError}</p>
              : <p className="dash-empty-note">{isControlApiConfigured() ? "Загружаем сессии…" : "Список сессий доступен только при подключённом API."}</p>
          ) : (
            <>
              {sessions.map((session, index) => (
                <div className="account-session" key={session.id}>
                  <span>
                    <strong>{describeDevice(session.userAgent)}</strong>
                    <small>Вход {formatDate(session.createdAt)}{session.ipAddress ? ` · ${session.ipAddress}` : ""}</small>
                  </span>
                  {index === 0 && sessions.length > 1 ? (
                    <button type="button" disabled={busy !== null} onClick={() => void revokeOthers()}>
                      {busy === "revoke" ? "Завершаем…" : "Завершить другие сессии"}
                    </button>
                  ) : null}
                </div>
              ))}
              {sessions.length <= 1 ? (
                <p className="account-section__hint">Это единственный активный вход.</p>
              ) : null}
              {sessionsError ? <p className="dash-field-error" role="alert">{sessionsError}</p> : null}
              {notice ? <p className="account-section__hint" role="status">{notice}</p> : null}
            </>
          )}
        </section>

        <section className="account-section">
          <div><LogOut size={18} /><span><h2>Управление аккаунтом</h2><p>Действия применяются ко всему workspace.</p></span></div>
          <div className="account-actions">
            <button
              type="button"
              disabled={!signedIn || busy !== null}
              title={signedIn ? undefined : "Вход не подключён к этому окружению"}
              onClick={() => void handleSignOut()}
            >
              {busy === "signout" ? <LoaderCircle className="is-spinning" size={16} /> : <LogOut size={16} />}
              {busy === "signout" ? "Выходим…" : "Выйти"}
            </button>
          </div>
          <p className="account-section__hint">
            Удаление аккаунта и данных — по запросу через <Link href="/dashboard/help">поддержку</Link>:
            мы отвязываем оплату и удаляем исходники вручную, чтобы ничего не потерялось безвозвратно по ошибке.
          </p>
        </section>
      </div>
    </main>
  );
}
