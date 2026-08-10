"use client";

import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  CreditCardIcon,
  FlashIcon,
  Invoice01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { AsyncButton } from "@/components/hashpix/async-button";
import { EmptyState } from "@/components/hashpix/empty-state";
import { LockedField } from "@/components/hashpix/locked-field";
import { PageHeader } from "@/components/hashpix/page-header";
import { SectionHeader } from "@/components/hashpix/section-header";
import { StatusBadge } from "@/components/hashpix/status-badge";
import { typographyVariants } from "@/components/hashpix/typography";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { minutePackages, productPlans } from "@/packages/product-config/src";
import { minuteTransactions as previewTransactions } from "../data";
import {
  ControlApiError,
  isControlApiConfigured,
  listTransactions,
  purchaseMinutePackage,
} from "../lib/control-api";
import { trackApp } from "../lib/track-app";
import { useDashboardStore } from "../store";
import type { MinuteTransaction } from "../types";

function formatTransactionDate(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (daysAgo === 0) return `Сегодня, ${time}`;
  if (daysAgo === 1) return `Вчера, ${time}`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

const packageNotes: Record<string, string> = {
  minutes_60: "Один короткий выпуск",
  minutes_180: "До трёх часовых выпусков",
  minutes_360: "Для активного месяца",
};

const popularPackageCode = "minutes_180";

function formatRubles(kopecks: number) {
  return `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

function transactionTone(kind: MinuteTransaction["kind"]) {
  if (kind === "charge") return { tone: "warning" as const, label: "Списание", icon: Clock01Icon };
  if (kind === "refund") return { tone: "accent" as const, label: "Возврат", icon: CheckmarkCircle01Icon };
  return { tone: "success" as const, label: "Начисление", icon: CreditCardIcon };
}

export function BillingView() {
  const [selected, setSelected] = useState(180);
  const [notice, setNotice] = useState("");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [transactions, setTransactions] = useState<MinuteTransaction[] | null>(
    isControlApiConfigured() ? null : previewTransactions,
  );
  const [transactionsError, setTransactionsError] = useState("");
  const { balanceSeconds, planCode } = useDashboardStore();

  useEffect(() => {
    if (!isControlApiConfigured()) return;
    let cancelled = false;
    listTransactions().then(
      (response) => {
        if (!cancelled) {
          setTransactions(response.items.map((item) => ({ ...item, date: formatTransactionDate(item.date) })));
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setTransactionsError(
            error instanceof ControlApiError
              ? error.message
              : "Не удалось загрузить операции. Проверьте соединение и попробуйте ещё раз.",
          );
        }
      },
    );
    return () => { cancelled = true; };
  }, []);

  const credits = balanceSeconds === null ? null : Math.floor(balanceSeconds / 60);
  const plan = planCode ? productPlans[planCode as keyof typeof productPlans] : undefined;
  const selectedPackage = minutePackages.find((item) => item.seconds / 60 === selected);

  const purchase = async () => {
    if (!selectedPackage || isPurchasing) return;
    setIsPurchasing(true);
    setNotice("");
    trackApp("minutes_purchase_start", { package: selected });
    try {
      const { confirmationUrl } = await purchaseMinutePackage(selectedPackage.code);
      window.location.href = confirmationUrl;
    } catch (error) {
      setNotice(
        error instanceof ControlApiError
          ? error.message
          : "Не удалось начать оплату. Попробуйте ещё раз.",
      );
      setIsPurchasing(false);
    }
  };

  return (
    <main className="dash-page space-y-8">
      <PageHeader
        title="Минуты и тариф"
        description="Минуты списываются один раз по длительности исходного видео. Повторный поиск и ререндер не расходуют баланс снова."
      />

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Баланс и тариф">
        <Card>
          <CardHeader>
            <CardDescription>Баланс</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <AppIcon icon={FlashIcon} size="lg" aria-hidden="true" />
              {credits === null ? "…" : `${credits} мин.`}
            </CardTitle>
          </CardHeader>
          <CardContent className={typographyVariants({ role: "muted" })}>
            {credits === null
              ? "Загружаем баланс с российского сервера."
              : "Один баланс на минуты тарифа и купленные пакеты."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Текущий тариф</CardDescription>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {plan?.name ?? "—"}
              {plan ? <StatusBadge tone="neutral">{formatRubles(plan.priceKopecks)} / месяц</StatusBadge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className={typographyVariants({ role: "muted" })}>
              {plan ? `${plan.includedSeconds / 60} минут начисляется каждый месяц.` : "Тариф загружается."}
            </p>
            <LockedField
              label="Смена тарифа"
              reason="Самостоятельная смена тарифа пока не поддерживается: доступен только выбор пакета минут."
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4" aria-label="Добавить минуты">
        <SectionHeader
          title="Добавить минуты"
          description="Пакет не меняет тариф и сразу добавляется к тому же балансу."
        />
        <div className="grid gap-4 xl:grid-cols-4">
          {minutePackages.map((item) => {
            const minutes = item.seconds / 60;
            const isSelected = selected === minutes;
            const isPopular = item.code === popularPackageCode;
            return (
              <Button
                key={item.code}
                type="button"
                variant={isSelected ? "secondary" : "outline"}
                aria-pressed={isSelected}
                className="h-auto min-h-36 flex-col items-start justify-start gap-2 whitespace-normal text-left"
                onClick={() => {
                  setSelected(minutes);
                  trackApp("minutes_package_select", { package: minutes });
                }}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  {isPopular ? <StatusBadge tone="accent">Чаще выбирают</StatusBadge> : <span />}
                  {isSelected ? <AppIcon icon={CheckmarkCircle01Icon} size="sm" aria-label="Выбрано" /> : null}
                </span>
                <span className="text-base font-semibold">{minutes} минут</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {packageNotes[item.code] ?? `Действует ${item.expiresDays / 30} месяцев`}
                </span>
                <span className="mt-auto text-base font-semibold">{formatRubles(item.priceKopecks)}</span>
              </Button>
            );
          })}

          <Card className="min-h-36">
            <CardHeader>
              <CardDescription>После покупки</CardDescription>
              <CardTitle>{selected} минут</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Сейчас</dt><dd>{credits ?? "…"} мин.</dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Пакет</dt><dd>+{selected} мин.</dd></div>
                <div className="flex items-center justify-between gap-4 border-t pt-2 font-medium"><dt>Итого</dt><dd>{credits === null ? "…" : `${credits + selected} мин.`}</dd></div>
              </dl>
              <AsyncButton className="w-full" onClick={() => void purchase()} loading={isPurchasing}>
                Добавить минуты
                {!isPurchasing ? <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" /> : null}
              </AsyncButton>
              {notice ? <p className="text-sm text-destructive" role="alert">{notice}</p> : null}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-4" aria-label="История операций">
        <SectionHeader title="История операций" />
        <Card>
          <CardContent className="p-0">
            {transactions === null ? (
              transactionsError ? (
                <p className="p-6 text-sm text-destructive" role="alert">{transactionsError}</p>
              ) : (
                <div className="space-y-3 p-6" aria-label="Загрузка операций">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-1/2" />
                </div>
              )
            ) : transactions.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Операция</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Минуты</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => {
                    const state = transactionTone(transaction.kind);
                    return (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <AppIcon icon={state.icon} size="sm" className="text-muted-foreground" aria-hidden="true" />
                            <div className="min-w-0"><p className="font-medium">{transaction.title}</p><p className="text-xs text-muted-foreground">{transaction.date}</p></div>
                          </div>
                        </TableCell>
                        <TableCell><StatusBadge tone={state.tone}>{state.label}</StatusBadge></TableCell>
                        <TableCell className={cn("text-right font-medium", transaction.amount > 0 && "text-primary")}>
                          {transaction.amount > 0 ? "+" : ""}{transaction.amount} мин.
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                className="p-10"
                icon={<AppIcon icon={Invoice01Icon} size="lg" />}
                title="Операций пока нет"
                description="Здесь появятся начисления и списания минут."
              />
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
