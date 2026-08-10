"use client";

import {
  Key01Icon,
  Logout01Icon,
  Mail01Icon,
  Shield01Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { AsyncButton } from "@/components/hashpix/async-button";
import { LockedField } from "@/components/hashpix/locked-field";
import { PageHeader } from "@/components/hashpix/page-header";
import { SectionHeader } from "@/components/hashpix/section-header";
import { typographyVariants } from "@/components/hashpix/typography";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { ControlApiError, isControlApiConfigured, listSessions, revokeOtherSessions, signOut } from "../lib/control-api";
import { useDashboardStore } from "../store";

type SessionRow = Awaited<ReturnType<typeof listSessions>>[number];

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
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);

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
        if (!cancelled) {
          setSessionsError(error instanceof ControlApiError ? error.message : "Не удалось загрузить сессии. Проверьте соединение и попробуйте ещё раз.");
        }
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
      setRevokeDialogOpen(false);
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
  const canRevokeOthers = Boolean(sessions && sessions.length > 1);

  return (
    <main className="dash-page space-y-8">
      <PageHeader title="Аккаунт" description="Вход, безопасность и управление данными." />

      <section className="space-y-4" aria-label="Данные аккаунта">
        <SectionHeader title="Данные аккаунта" description="Основной способ связи и входа." />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AppIcon icon={Mail01Icon} size="sm" aria-hidden="true" />Личные данные</CardTitle>
          </CardHeader>
          <CardContent>
            {signedIn ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field><FieldContent><FieldTitle>Email</FieldTitle><FieldDescription>{user!.email}</FieldDescription></FieldContent></Field>
                {user!.name ? <Field><FieldContent><FieldTitle>Имя</FieldTitle><FieldDescription>{user!.name}</FieldDescription></FieldContent></Field> : null}
              </div>
            ) : (
              <p className={typographyVariants({ role: "muted" })}>
                {connection === "loading" ? "Загружаем данные аккаунта…" : "Вход не подключён к этому окружению — данные аккаунта недоступны."}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4" aria-label="Безопасность">
        <SectionHeader title="Безопасность" description="Активные входы в аккаунт и доступные меры защиты." />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AppIcon icon={Shield01Icon} size="sm" aria-hidden="true" />Активные сессии</CardTitle>
            <CardDescription>Сервер сохраняет текущую сессию при завершении остальных входов.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sessions === null ? (
              sessionsError ? (
                <p className="text-sm text-destructive" role="alert">{sessionsError}</p>
              ) : isControlApiConfigured() ? (
                <div className="space-y-3" aria-label="Загрузка сессий"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-4/5" /></div>
              ) : (
                <p className={typographyVariants({ role: "muted" })}>Список сессий доступен только при подключённом API.</p>
              )
            ) : (
              <>
                <div className="divide-y rounded-md border">
                  {sessions.map((session) => (
                    <div className="flex items-start gap-3 p-4" key={session.id}>
                      <AppIcon icon={SmartPhone01Icon} size="sm" className="mt-0.5 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0"><p className="font-medium">{describeDevice(session.userAgent)}</p><p className="text-sm text-muted-foreground">Вход {formatDate(session.createdAt)}{session.ipAddress ? ` · ${session.ipAddress}` : ""}</p></div>
                    </div>
                  ))}
                </div>
                {canRevokeOthers ? (
                  <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
                    <AlertDialogTrigger render={<Button variant="outline" disabled={busy !== null}>Завершить другие сессии</Button>} />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Завершить остальные сессии?</AlertDialogTitle>
                        <AlertDialogDescription>Все другие активные входы будут завершены. Текущая сессия останется открытой.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy !== null}>Отмена</AlertDialogCancel>
                        <AsyncButton variant="destructive" loading={busy === "revoke"} onClick={() => void revokeOthers()}>Завершить сессии</AsyncButton>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : <p className={typographyVariants({ role: "muted" })}>Это единственный активный вход.</p>}
                {sessionsError ? <p className="text-sm text-destructive" role="alert">{sessionsError}</p> : null}
                {notice ? <p className="text-sm text-muted-foreground" role="status">{notice}</p> : null}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AppIcon icon={Key01Icon} size="sm" aria-hidden="true" />Дополнительная защита</CardTitle></CardHeader>
          <CardContent>
            <LockedField
              icon={<AppIcon icon={SmartPhone01Icon} size="sm" aria-hidden="true" />}
              label="Двухфакторная защита"
              reason="TOTP и passkey станут доступны после добавления серверного security-контракта."
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4" aria-label="Управление аккаунтом">
        <SectionHeader title="Управление аккаунтом" description="Действия применяются ко всему workspace." />
        <Card>
          <CardContent className="space-y-4">
            <AsyncButton variant="outline" disabled={!signedIn || busy !== null} loading={busy === "signout"} onClick={() => void handleSignOut()}>
              {!busy ? <AppIcon icon={Logout01Icon} size="sm" aria-hidden="true" /> : null}
              Выйти
            </AsyncButton>
            <p className={typographyVariants({ role: "muted" })}>
              Удаление аккаунта и данных — по запросу через <Link className="underline underline-offset-4 hover:text-foreground" href="/dashboard/help">поддержку</Link>: мы отвязываем оплату и удаляем исходники вручную, чтобы ничего не потерялось безвозвратно по ошибке.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
