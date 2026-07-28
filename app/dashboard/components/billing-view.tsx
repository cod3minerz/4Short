"use client";

import { Button } from "@heroui/react";
import { ArrowRight, CalendarDays, Check, Clock3, CreditCard, ReceiptText } from "lucide-react";
import { useState } from "react";
import { minuteBalance, minuteTransactions } from "../data";
import { trackApp } from "../lib/track-app";
import { PageHeading } from "./page-heading";

const packages = [
  { minutes: 60, price: "590 ₽", note: "Один короткий выпуск" },
  { minutes: 180, price: "1 490 ₽", note: "До трёх часовых выпусков", popular: true },
  { minutes: 360, price: "2 690 ₽", note: "Для активного месяца" },
];

export function BillingView() {
  const [selected, setSelected] = useState(180);
  const [notice, setNotice] = useState("");

  const purchase = () => {
    trackApp("minutes_purchase_complete", { package: selected });
    setNotice(`Покупка ${selected} минут будет доступна после подключения оплаты.`);
  };

  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Баланс и оплата"
        title="МИНУТЫ И ТАРИФ"
        description="Минуты списываются один раз по длительности исходного видео."
      />

      <section className="billing-hero">
        <div className="billing-plan">
          <div className="billing-plan__head">
            <div><span className="dash-eyebrow">Текущий тариф</span><h2>Creator</h2></div>
            <span>2 490 ₽ / месяц</span>
          </div>
          <div className="billing-plan__usage">
            <div>
              <strong>{minuteBalance.planUsed}</strong>
              <span>из {minuteBalance.planTotal} минут</span>
            </div>
            <div className="billing-plan__track"><i style={{ width: `${(minuteBalance.planUsed / minuteBalance.planTotal) * 100}%` }} /></div>
            <p><CalendarDays size={16} /> Новый объём начислится {minuteBalance.renewsAt}</p>
          </div>
          <div className="billing-plan__features">
            <span><Check size={15} /> Поиск моментов</span>
            <span><Check size={15} /> Трекинг лица</span>
            <span><Check size={15} /> Сохранённые стили</span>
            <span><Check size={15} /> Приоритетная очередь</span>
          </div>
          <div className="billing-plan__actions">
            <Button variant="outline">Изменить тариф</Button>
            <button type="button">Управление подпиской</button>
          </div>
        </div>

        <aside className="billing-extra">
          <span className="billing-extra__icon"><Clock3 size={24} /></span>
          <span className="dash-eyebrow">Дополнительные</span>
          <strong>+{minuteBalance.extra}</strong>
          <p>Используются после минут тарифа и действуют 12 месяцев.</p>
          <small>Общий доступный баланс</small>
          <b>{minuteBalance.planUsed + minuteBalance.extra} минут</b>
        </aside>
      </section>

      <section className="billing-packages">
        <div className="dash-section-head">
          <div><span className="dash-eyebrow">Разовая покупка</span><h2>Добавить минуты</h2></div>
          <p>Пакет не меняет тариф и сразу добавляется к текущему балансу.</p>
        </div>
        <div className="billing-packages__grid">
          {packages.map((item) => (
            <button
              className={`${selected === item.minutes ? "is-selected" : ""} ${item.popular ? "is-popular" : ""}`}
              type="button"
              key={item.minutes}
              onClick={() => {
                setSelected(item.minutes);
                trackApp("minutes_package_select", { package: item.minutes });
              }}
            >
              {item.popular ? <span className="billing-package-badge">Чаще выбирают</span> : null}
              <span className="billing-package-check">{selected === item.minutes ? <Check size={15} /> : null}</span>
              <strong>{item.minutes} минут</strong>
              <p>{item.note}</p>
              <b>{item.price}</b>
            </button>
          ))}
          <div className="billing-purchase-summary">
            <span className="dash-eyebrow">После покупки</span>
            <dl>
              <div><dt>Сейчас</dt><dd>{minuteBalance.planUsed + minuteBalance.extra}</dd></div>
              <div><dt>Пакет</dt><dd>+{selected}</dd></div>
              <div><dt>Итого</dt><dd>{minuteBalance.planUsed + minuteBalance.extra + selected} минут</dd></div>
            </dl>
            <Button fullWidth onPress={purchase}>Добавить минуты <ArrowRight size={17} /></Button>
            {notice ? <p role="status">{notice}</p> : null}
          </div>
        </div>
      </section>

      <section className="billing-history">
        <div className="dash-section-head">
          <div><span className="dash-eyebrow">Журнал</span><h2>История минут</h2></div>
          <button type="button"><ReceiptText size={17} /> Платежи и чеки</button>
        </div>
        <div className="billing-history__table">
          {minuteTransactions.map((transaction) => (
            <div key={transaction.id}>
              <span className={`billing-transaction-icon tone-${transaction.kind}`}>
                {transaction.kind === "credit" ? <CreditCard size={18} /> : <Clock3 size={18} />}
              </span>
              <span><strong>{transaction.title}</strong><small>{transaction.date}</small></span>
              <b className={transaction.amount > 0 ? "is-positive" : ""}>
                {transaction.amount > 0 ? "+" : ""}{transaction.amount} мин.
              </b>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

