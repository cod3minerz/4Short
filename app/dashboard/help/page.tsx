"use client";

import { ArrowRight, BookOpenText, MessageCircle, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeading } from "../components/page-heading";

/**
 * Each guide points at the screen it explains — previously all four linked to
 * the same blog article regardless of topic.
 */
const guides = [
  { category: "Начало работы", title: "Создать первый проект", text: "Источник, поиск моментов и запуск обработки.", href: "/dashboard" },
  { category: "Настройки", title: "Оформить клипы", text: "Кадрирование, субтитры, заголовки и баннеры.", href: "/dashboard/styles" },
  { category: "Проекты", title: "Проверить найденные моменты", text: "Границы, транскрипт и повторный поиск.", href: "/dashboard/projects" },
  { category: "Оплата", title: "Как списываются кредиты", text: "Резерв, списание и автоматический возврат.", href: "/dashboard/billing" },
];

const supportEmail = "hello@hashpix.ru";

export default function HelpPage() {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => guides.filter((guide) => `${guide.title} ${guide.text}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <main className="dash-page">
      <PageHeading title="Помощь" description="Ответы о создании и обработке клипов." />
      <label className="help-search">
        <Search size={17} />
        <span className="sr-only">Найти руководство</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ответ" type="search" />
      </label>
      <section className="help-list" aria-label="Руководства">
        {visible.map((guide) => (
          <Link href={guide.href} key={guide.title}>
            <span><BookOpenText size={18} /></span>
            <div><small>{guide.category}</small><h2>{guide.title}</h2><p>{guide.text}</p></div>
            <ArrowRight size={17} />
          </Link>
        ))}
      </section>
      {visible.length === 0 ? (
        <p className="dash-empty-note">Ничего не нашли по запросу «{query}». Напишите нам — подскажем.</p>
      ) : null}
      <section className="help-contact">
        <span><MessageCircle size={21} /></span>
        <div><h2>Нужна помощь с проектом?</h2><p>Напишите в поддержку — ответим на {supportEmail}.</p></div>
        <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Вопрос по Hashpix")}`}>
          Написать в поддержку
        </a>
      </section>
    </main>
  );
}
