"use client";

import { ArrowRight, Check, Clock3, CreditCard, Zap } from "lucide-react";
import { useEffect, useState } from "react";
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
import { PageHeading } from "./page-heading";
import { ActionButton } from "./ui/ActionButton";

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
        if (!cancelled) setTransactionsError(error instanceof ControlApiError ? error.message : "Не удалось загрузить операции. Проверьте соединение и попробуйте ещё раз.");
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
    <main className="dash-page">
      <PageHeading
        title="Кредиты и тариф"
        description="Кредиты списываются один раз по длительности исходного видео. Один кредит — одна минута."
      />

      <section className="billing-hero">
        <div className="billing-balance">
          <span className="dash-eyebrow">Баланс</span>
          <strong className="billing-balance__value">
            <Zap size={30} fill="currentColor" />
            {credits === null ? "…" : credits}
          </strong>
          <p>
            {credits === null
              ? "Загружаем баланс с российского сервера."
              : "Один баланс на всё: минуты тарифа и купленные пакеты расходуются из него же."}
          </p>
        </div>

        <div className="billing-plan">
          <div className="billing-plan__head">
            <div>
              <small>Текущий тариф</small>
              <h2>{plan?.name ?? "—"}</h2>
            </div>
            <span>{plan ? `${formatRubles(plan.priceKopecks)} / месяц` : ""}</span>
          </div>
          <p className="billing-plan__included">
            {plan ? `${plan.includedSeconds / 60} кредитов начисляется каждый месяц` : "Тариф загружается"}
          </p>
          <div className="billing-plan__actions">
            <ActionButton tone="secondary" isDisabled>Изменить тариф</ActionButton>
            <small>Смена тарифа появится вместе с подключением оплаты.</small>
          </div>
        </div>
      </section>

      <section className="billing-packages">
        <div className="dash-section-head">
          <div><h2>Добавить кредиты</h2></div>
          <p>Пакет не меняет тариф и сразу добавляется к тому же балансу.</p>
        </div>
        <div className="billing-packages__grid">
          {minutePackages.map((item) => {
            const minutes = item.seconds / 60;
            const isPopular = item.code === popularPackageCode;
            return (
              <button
                className={`${selected === minutes ? "is-selected" : ""} ${isPopular ? "is-popular" : ""}`}
                type="button"
                key={item.code}
                aria-pressed={selected === minutes}
                onClick={() => {
                  setSelected(minutes);
                  trackApp("minutes_package_select", { package: minutes });
                }}
              >
                {isPopular ? <span className="billing-package-badge">Чаще выбирают</span> : null}
                <span className="billing-package-check">{selected === minutes ? <Check size={15} /> : null}</span>
                <strong>{minutes} кредитов</strong>
                <p>{packageNotes[item.code] ?? `Действует ${item.expiresDays / 30} месяцев`}</p>
                <b>{formatRubles(item.priceKopecks)}</b>
              </button>
            );
          })}
          <div className="billing-purchase-summary">
            <small>После покупки</small>
            <dl>
              <div><dt>Сейчас</dt><dd>{credits ?? "…"}</dd></div>
              <div><dt>Пакет</dt><dd>+{selected}</dd></div>
              <div><dt>Итого</dt><dd>{credits === null ? "…" : `${credits + selected} кредитов`}</dd></div>
            </dl>
            <ActionButton fullWidth onPress={purchase} isDisabled={isPurchasing}>
              {isPurchasing ? "Переходим к оплате…" : "Добавить кредиты"} <ArrowRight size={17} />
            </ActionButton>
            {notice ? <p role="status">{notice}</p> : null}
          </div>
        </div>
      </section>

      <section className="billing-history">
        <div className="dash-section-head">
          <div><h2>История операций</h2></div>
        </div>
        {transactions === null ? (
          transactionsError
            ? <p className="dash-field-error" role="alert">{transactionsError}</p>
            : <p className="dash-empty-note">Загружаем операции…</p>
        ) : transactions.length ? (
          <div className="billing-history__table">
            {transactions.map((transaction) => (
              <div key={transaction.id}>
                <span className={`billing-transaction-icon tone-${transaction.kind}`}>
                  {transaction.kind === "credit" ? <CreditCard size={18} /> : <Clock3 size={18} />}
                </span>
                <span><strong>{transaction.title}</strong><small>{transaction.date}</small></span>
                <b className={transaction.amount > 0 ? "is-positive" : ""}>
                  {transaction.amount > 0 ? "+" : ""}{transaction.amount} кред.
                </b>
              </div>
            ))}
          </div>
        ) : (
          <p className="dash-empty-note">Операций пока нет — здесь появятся начисления и списания кредитов.</p>
        )}
      </section>
    </main>
  );
}
