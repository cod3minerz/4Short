"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Accordion, Button, Drawer, Input } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check, Menu, Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  faqItems,
  minutePackages,
  navigation,
  pricingPlans,
  type MinutePackage,
  type PricingPlan,
} from "../data/content";
import { track } from "../lib/analytics";
import { Logo } from "./logo";

const urlSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Вставьте полную ссылку")
    .refine(
      (value) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(value).hostname),
      "Нужна ссылка на YouTube",
    ),
});

type UrlForm = z.infer<typeof urlSchema>;
type Placement = "hero" | "final";

const currency = new Intl.NumberFormat("ru-RU");

function notify() {
  window.dispatchEvent(new CustomEvent("4short:notice"));
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 20);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="site-header__island">
        <a className="site-header__brand" href="#top" aria-label="4Short — на главную">
          <Logo priority />
        </a>

        <nav className="site-header__nav" aria-label="Основная навигация">
          {navigation.map((item) => (
            <a href={item.href} key={item.href}>{item.label}</a>
          ))}
        </nav>

        <div className="site-header__actions">
          <a className="login-link" href="#top">Войти</a>
          <a className="header-cta" href="#top">Создать шортсы</a>
          <Button
            aria-label="Открыть меню"
            className="menu-button"
            isIconOnly
            variant="ghost"
            onPress={() => setOpen(true)}
          >
            <Menu size={22} />
          </Button>
        </div>
      </div>

      <Drawer.Backdrop isOpen={open} onOpenChange={setOpen} variant="blur">
        <Drawer.Content className="mobile-drawer" placement="right">
          <Drawer.Dialog aria-label="Навигация 4Short">
            <Drawer.CloseTrigger className="mobile-drawer__close" />
            <Drawer.Header>
              <Logo />
              <Drawer.Heading>Меню</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <nav aria-label="Мобильная навигация">
                {navigation.map((item) => (
                  <a href={item.href} key={item.href} onClick={() => setOpen(false)}>
                    {item.label}
                  </a>
                ))}
              </nav>
            </Drawer.Body>
            <Drawer.Footer>
              <a className="header-cta" href="#top" onClick={() => setOpen(false)}>
                Создать шортсы
              </a>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </header>
  );
}

export function UrlActionForm({ placement }: { placement: Placement }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UrlForm>({
    resolver: zodResolver(urlSchema),
    defaultValues: { url: "" },
  });

  const submit = () => {
    track(placement === "hero" ? "hero_url_submit" : "final_cta_submit");
    notify();
  };

  const upload = () => {
    track("hero_upload_click", { placement });
    fileRef.current?.click();
  };

  return (
    <form className="url-form" onSubmit={handleSubmit(submit)} noValidate>
      <div className="url-form__row">
        <div className="url-form__field">
          <a
            className="youtube-icon"
            href="https://www.youtube.com/"
            aria-label="Открыть YouTube"
            target="_blank"
            rel="noreferrer"
          />
          <Input
            aria-invalid={Boolean(errors.url)}
            aria-label="Ссылка на видео YouTube"
            className="url-form__input"
            placeholder="Вставьте ссылку на YouTube"
            type="url"
            variant="secondary"
            {...register("url", {
              onFocus: () => placement === "hero" && track("hero_url_focus"),
            })}
          />
        </div>
        <Button className="cta-button" type="submit">
          Создать шортсы
          <ArrowRight size={17} />
        </Button>
      </div>

      {errors.url ? (
        <span className="url-form__error" role="alert">{errors.url.message}</span>
      ) : null}

      <button className="upload-link" onClick={upload} type="button">
        <Upload size={16} />
        Загрузить видео
      </button>

      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="video/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          track("video_upload_start", { fileType: file.type });
          track("video_upload_complete");
          notify();
        }}
      />
    </form>
  );
}

function PlanCard({
  plan,
  annual,
}: {
  plan: PricingPlan;
  annual: boolean;
}) {
  const price = annual ? Math.round(plan.monthly * 0.8) : plan.monthly;

  return (
    <article
      className={`price-card squircle ${plan.popular ? "is-popular" : ""}`}
      data-plan={plan.id}
    >
      <div className="price-card__topline">
        <span>{plan.minutes} минут / месяц</span>
        {plan.popular ? <strong>Популярный</strong> : null}
      </div>

      <div className="price-card__heading">
        <h3>{plan.name}</h3>
        <p>{plan.description}</p>
      </div>

      <div className="price-card__price">
        <strong>{currency.format(price)} ₽</strong>
        <span>в месяц</span>
      </div>

      <p className="price-card__billing">
        {annual ? "Оплата за год, экономия 20%" : "Ежемесячная оплата"}
      </p>

      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>
            <Check size={16} aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        className="price-button"
        variant={plan.popular ? "primary" : "outline"}
        onPress={() => {
          track("plan_select", { plan: plan.id, billing: annual ? "annual" : "monthly" });
          notify();
        }}
      >
        {plan.cta}
        <ArrowRight size={17} aria-hidden="true" />
      </Button>
    </article>
  );
}

export function PricingSection() {
  const [annual, setAnnual] = useState(false);

  useEffect(() => {
    const section = document.querySelector("#pricing");
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        track("pricing_view");
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const setBilling = (value: boolean) => {
    setAnnual(value);
    track("billing_period_change", { period: value ? "annual" : "monthly" });
  };

  return (
    <section className="pricing-section section" id="pricing">
      <div className="container">
        <div className="section-intro section-intro--pricing">
          <div>
            <span className="section-index">Тарифы</span>
            <h2>ВЫБЕРИТЕ СВОЙ ОБЪЁМ</h2>
          </div>
          <div className="section-intro__aside">
            <p>Минуты списываются по длительности исходного видео.</p>
            <div className="billing-toggle" aria-label="Период оплаты">
              <button
                className={!annual ? "is-active" : ""}
                type="button"
                aria-pressed={!annual}
                onClick={() => setBilling(false)}
              >
                Ежемесячно
              </button>
              <button
                className={annual ? "is-active" : ""}
                type="button"
                aria-pressed={annual}
                onClick={() => setBilling(true)}
              >
                На год <span>−20%</span>
              </button>
            </div>
          </div>
        </div>

        <div className="pricing-shell squircle">
          <div className="pricing-grid">
            {pricingPlans.map((plan) => (
              <PlanCard annual={annual} key={plan.id} plan={plan} />
            ))}
          </div>
          <div className="pricing-footnote">
            <span>300 минут — до пяти выпусков по 60 минут</span>
            <span>Финальные условия показываются до оплаты</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PackageButton({
  pack,
  selected,
  onSelect,
}: {
  pack: MinutePackage;
  selected: boolean;
  onSelect: (pack: MinutePackage) => void;
}) {
  return (
    <button
      className={`minute-package ${selected ? "is-selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(pack)}
    >
      <span>{pack.featured ? "Чаще выбирают" : "Разовый пакет"}</span>
      <strong>{pack.minutes} минут</strong>
      <b>{currency.format(pack.price)} ₽</b>
      <i aria-hidden="true">{selected ? <Check size={15} /> : null}</i>
    </button>
  );
}

export function MinutesSection() {
  const [selectedMinutes, setSelectedMinutes] = useState(180);
  const selectedPackage = useMemo(
    () => minutePackages.find((item) => item.minutes === selectedMinutes) ?? minutePackages[1],
    [selectedMinutes],
  );
  const total = 184 + selectedPackage.minutes;

  return (
    <section className="minutes-section section" id="minutes">
      <div className="container minutes-panel squircle">
        <div className="minutes-panel__copy">
          <span className="section-index">Дополнительные минуты</span>
          <h2>ДОБАВЬТЕ МИНУТЫ, НЕ МЕНЯЯ ТАРИФ</h2>
          <p>Разовый пакет сразу добавляется к текущему балансу.</p>
        </div>

        <div className="minute-packages">
          {minutePackages.map((pack) => (
            <PackageButton
              key={pack.minutes}
              pack={pack}
              selected={pack.minutes === selectedMinutes}
              onSelect={(next) => {
                setSelectedMinutes(next.minutes);
                track("minutes_package_select", next);
              }}
            />
          ))}
        </div>

        <aside className="balance-card">
          <div className="balance-card__row">
            <span>Тариф</span>
            <strong>184 / 300 мин.</strong>
          </div>
          <div className="balance-card__row">
            <span>Пакет</span>
            <strong>+{selectedPackage.minutes} мин.</strong>
          </div>
          <div className="balance-card__total">
            <span>После покупки</span>
            <strong>{total} мин.</strong>
          </div>
          <Button
            className="minutes-button"
            onPress={() => {
              track("minutes_purchase_start", selectedPackage);
              notify();
            }}
          >
            Добавить {selectedPackage.minutes} минут
            <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </aside>
      </div>
    </section>
  );
}

export function FaqSection() {
  return (
    <section className="faq-section section" id="faq">
      <div className="container faq-layout">
        <div className="faq-layout__intro">
          <span className="section-index">FAQ</span>
          <h2>ОТВЕТЫ БЕЗ МЕЛКОГО ШРИФТА</h2>
          <p>Всё важное о загрузке, минутах и результате.</p>
        </div>

        <Accordion
          className="faq-accordion"
          onExpandedChange={(keys) => {
            const values = Array.from(keys);
            if (values.length) track("faq_open", { question: values.at(-1) });
          }}
        >
          {faqItems.map((item) => (
            <Accordion.Item id={item.question} key={item.question}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  {item.question}
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body>{item.answer}</Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function Notice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const show = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), 3200);
    };
    window.addEventListener("4short:notice", show);
    return () => {
      window.removeEventListener("4short:notice", show);
      clearTimeout(timeout);
    };
  }, []);

  if (!visible) return null;
  return (
    <div className="site-notice" role="status">
      <Check size={17} aria-hidden="true" />
      Действие будет доступно после подключения личного кабинета
    </div>
  );
}
