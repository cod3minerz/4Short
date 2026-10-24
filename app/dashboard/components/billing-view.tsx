"use client";

import { Button, Card, Chip, Skeleton, Table } from "@heroui/react";
import { ArrowRight01Icon, CheckmarkCircle01Icon, Clock01Icon, CreditCardIcon, FlashIcon, Invoice01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { minutePackages, productPlans } from "@/packages/product-config/src";
import { ControlApiError, isControlApiConfigured, listTransactions, purchaseMinutePackage } from "../lib/control-api";
import { trackApp } from "../lib/track-app";
import { useDashboardStore } from "../store";
import type { MinuteTransaction } from "../types";

const packageNotes: Record<string, string> = {
  minutes_60: "На один час исходного видео",
  minutes_180: "На три часа исходного видео",
  minutes_360: "На шесть часов исходного видео",
};
const popularPackageCode = "minutes_180";
const formatRubles = (kopecks: number) => `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function BillingView() {
  const [selected, setSelected] = useState(180);
  const [notice, setNotice] = useState("");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [transactions, setTransactions] = useState<MinuteTransaction[] | null>(isControlApiConfigured() ? null : []);
  const [transactionsError, setTransactionsError] = useState("");
  const { balanceSeconds, planCode, connection } = useDashboardStore();
  const credits = connection === "connected" && balanceSeconds !== null ? Math.floor(balanceSeconds / 60) : null;
  const plan = connection === "connected" && planCode ? productPlans[planCode as keyof typeof productPlans] : undefined;
  const selectedPackage = minutePackages.find((item) => item.seconds / 60 === selected);

  useEffect(() => {
    if (!isControlApiConfigured()) return;
    let cancelled = false;
    listTransactions().then(
      (response) => { if (!cancelled) setTransactions(response.items.map((item) => ({ ...item, date: formatDate(item.date) }))); },
      (error: unknown) => { if (!cancelled) setTransactionsError(error instanceof ControlApiError ? error.message : "Не удалось загрузить историю операций."); },
    );
    return () => { cancelled = true; };
  }, []);

  async function purchase() {
    if (!selectedPackage || isPurchasing) return;
    setIsPurchasing(true);
    setNotice("");
    trackApp("minutes_purchase_start", { package: selected });
    try {
      const { confirmationUrl } = await purchaseMinutePackage(selectedPackage.code);
      window.location.assign(confirmationUrl);
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось начать оплату. Попробуйте ещё раз.");
      setIsPurchasing(false);
    }
  }

  return <main className="hp-billing" aria-labelledby="hp-billing-title">
    <header className="hp-billing__header">
      <div><p className="hp-billing__eyebrow">БАЛАНС И ПОПОЛНЕНИЕ</p><h1 id="hp-billing-title">Минуты для ваших видео</h1><p>Пополните баланс и продолжайте превращать длинные записи в короткие клипы.</p></div>
      <div className="hp-billing__balance"><span className="hp-billing__balance-icon"><AppIcon icon={FlashIcon} size="md" aria-hidden="true" /></span><span><small>Доступно</small><strong>{credits === null ? "—" : credits.toLocaleString("ru-RU")} <i>мин.</i></strong></span></div>
    </header>

    <section className="hp-billing__overview" aria-label="Тариф и баланс">
      <Card className="hp-billing__plan">
        <Card.Header><Card.Description>Текущий тариф</Card.Description><Card.Title>{plan?.name ?? "Тариф"}</Card.Title></Card.Header>
        <Card.Content>{plan ? <><p className="hp-billing__plan-price">{formatRubles(plan.priceKopecks)} <span>/ месяц</span></p><p className="hp-billing__muted">{plan.includedSeconds / 60} минут начисляется каждый месяц.</p></> : <p className="hp-billing__muted">Информация о тарифе появится после загрузки аккаунта.</p>}</Card.Content>
      </Card>
      <div className="hp-billing__promise"><span><AppIcon icon={CheckmarkCircle01Icon} size="sm" aria-hidden="true" /></span><div><strong>Платите за длительность исходника</strong><p>Минуты списываются один раз при обработке видео. Повторный поиск и рендер готового проекта не списывают баланс снова.</p></div></div>
    </section>

    <section className="hp-billing__purchase" aria-labelledby="hp-billing-packages">
      <div className="hp-billing__section-head"><div><p className="hp-billing__eyebrow">ПАКЕТЫ МИНУТ</p><h2 id="hp-billing-packages">Выберите запас для работы</h2><p>Купленные минуты добавятся к текущему балансу и действуют 12 месяцев.</p></div></div>
      <div className="hp-billing__purchase-layout">
        <div className="hp-billing__packages">
          {minutePackages.map((item) => {
            const minutes = item.seconds / 60;
            const chosen = selected === minutes;
            const popular = item.code === popularPackageCode;
            return <Button key={item.code} className="hp-billing__package" variant="secondary" aria-pressed={chosen} data-selected={chosen} onPress={() => { setSelected(minutes); trackApp("minutes_package_select", { package: minutes }); }}>
              <span className="hp-billing__package-top">{popular ? <Chip size="sm" color="warning" variant="soft">Популярный</Chip> : <span />}{chosen ? <AppIcon icon={CheckmarkCircle01Icon} size="sm" aria-label="Выбрано" /> : null}</span>
              <strong>{minutes} <i>минут</i></strong><span className="hp-billing__package-note">{packageNotes[item.code]}</span><span className="hp-billing__package-price">{formatRubles(item.priceKopecks)}</span>
            </Button>;
          })}
        </div>
        <Card className="hp-billing__checkout">
          <Card.Header><Card.Description>Ваш выбор</Card.Description><Card.Title>{selected} минут</Card.Title></Card.Header>
          <Card.Content>
            <div className="hp-billing__total"><span>Сейчас на балансе</span><strong>{credits === null ? "—" : `${credits} мин.`}</strong></div>
            <div className="hp-billing__total"><span>После пополнения</span><strong>{credits === null ? "—" : `${credits + selected} мин.`}</strong></div>
            <Button className="hp-billing__pay" variant="primary" isPending={isPurchasing} isDisabled={isPurchasing || !selectedPackage} onPress={() => void purchase()}>
              {isPurchasing ? "Открываем оплату…" : <>Продолжить · {selectedPackage ? formatRubles(selectedPackage.priceKopecks) : ""}<AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" /></>}
            </Button>
            <p className="hp-billing__secure"><AppIcon icon={CreditCardIcon} size="sm" aria-hidden="true" /> Безопасная оплата через платёжный сервис</p>
            {notice ? <p className="hp-billing__error" role="alert">{notice}</p> : null}
          </Card.Content>
        </Card>
      </div>
    </section>

    <section className="hp-billing__history" aria-labelledby="hp-billing-history">
      <div className="hp-billing__section-head"><div><p className="hp-billing__eyebrow">АККАУНТ</p><h2 id="hp-billing-history">История операций</h2></div></div>
      {transactions === null ? transactionsError ? <p className="hp-billing__error" role="alert">{transactionsError}</p> : <div className="hp-billing__loading" aria-label="Загрузка операций"><Skeleton /><Skeleton /><Skeleton /></div> : transactions.length ? <div className="hp-billing__table-wrap"><Table>
        <Table.ScrollContainer><Table.Content aria-label="История операций">
          <Table.Header><Table.Column isRowHeader>Операция</Table.Column><Table.Column>Статус</Table.Column><Table.Column>Дата</Table.Column><Table.Column className="hp-billing__amount-col">Минуты</Table.Column></Table.Header>
          <Table.Body>{transactions.map((item) => <Table.Row key={item.id}>
            <Table.Cell><span className="hp-billing__transaction"><span className="hp-billing__transaction-icon"><AppIcon icon={item.kind === "charge" ? Clock01Icon : item.kind === "refund" ? CheckmarkCircle01Icon : CreditCardIcon} size="sm" aria-hidden="true" /></span><strong>{item.title}</strong></span></Table.Cell>
            <Table.Cell><Chip size="sm" color={item.kind === "charge" ? "warning" : item.kind === "refund" ? "accent" : "success"} variant="soft">{item.kind === "charge" ? "Списание" : item.kind === "refund" ? "Возврат" : "Начисление"}</Chip></Table.Cell>
            <Table.Cell>{item.date}</Table.Cell><Table.Cell className="hp-billing__amount">{item.amount > 0 ? "+" : ""}{item.amount} мин.</Table.Cell>
          </Table.Row>)}</Table.Body>
        </Table.Content></Table.ScrollContainer>
      </Table></div> : <div className="hp-billing__empty"><span><AppIcon icon={Invoice01Icon} size="md" aria-hidden="true" /></span><strong>Операций пока нет</strong><p>Покупки и списания минут будут собраны здесь.</p></div>}
    </section>
  </main>;
}
