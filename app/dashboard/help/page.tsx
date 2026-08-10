"use client";

import { ArrowRight01Icon, BookOpenTextIcon, Message01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { EmptyState } from "@/components/hashpix/empty-state";
import { PageHeader } from "@/components/hashpix/page-header";
import { SectionHeader } from "@/components/hashpix/section-header";
import { typographyVariants } from "@/components/hashpix/typography";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const guides = [
  { category: "Начало работы", title: "Создать первый проект", text: "Источник, поиск моментов и запуск обработки.", href: "/dashboard" },
  { category: "Проекты", title: "Проверить найденные моменты", text: "Границы, транскрипт и повторный поиск.", href: "/dashboard/projects" },
  { category: "Оплата", title: "Как списываются минуты", text: "Резерв, списание и автоматический возврат.", href: "/dashboard/billing" },
];

const supportEmail = "hello@hashpix.ru";

export default function HelpPage() {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => guides.filter((guide) => `${guide.title} ${guide.text}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <main className="dash-page space-y-8">
      <PageHeader title="Помощь" description="Ответы о создании и обработке клипов." />

      <section className="space-y-4" aria-label="Руководства">
        <SectionHeader title="Руководства" description="Быстрые ответы по текущим рабочим сценариям." />
        <div className="relative max-w-xl">
          <AppIcon icon={Search01Icon} size="sm" className="pointer-events-none absolute top-2.5 left-3 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Найти ответ" type="search" aria-label="Найти руководство" />
        </div>
        {visible.length ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {visible.map((guide) => (
              <Card key={guide.title} className="h-full">
                <CardHeader>
                  <CardDescription>{guide.category}</CardDescription>
                  <CardTitle>{guide.title}</CardTitle>
                </CardHeader>
                <CardContent className="mt-auto space-y-4">
                  <p className={typographyVariants({ role: "muted" })}>{guide.text}</p>
                  <Button variant="outline" nativeButton={false} render={<Link href={guide.href} />}>
                    Открыть
                    <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card><CardContent className="p-10"><EmptyState icon={<AppIcon icon={BookOpenTextIcon} size="lg" />} title="Ничего не нашли" description={`Ничего не нашли по запросу «${query}». Напишите нам — подскажем.`} /></CardContent></Card>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AppIcon icon={Message01Icon} size="sm" aria-hidden="true" />Нужна помощь с проектом?</CardTitle>
          <CardDescription>Напишите в поддержку — ответим на {supportEmail}.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button nativeButton={false} render={<a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Вопрос по Hashpix")}`} />}>
            Написать в поддержку
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
