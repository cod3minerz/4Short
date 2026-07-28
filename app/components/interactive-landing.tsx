"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Accordion,
  Button,
  Drawer,
  Input,
  Switch,
  Tabs,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Menu, Play, Upload, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { audiences, faqItems } from "../data/content";
import { track } from "../lib/analytics";
import { Logo } from "./logo";

const urlSchema = z.object({
  url: z.string().trim().url("Вставьте полную ссылку").refine(
    (value) => /(^|\.)youtube\.com|youtu\.be/.test(new URL(value).hostname),
    "Нужна ссылка на YouTube",
  ),
});
type UrlForm = z.infer<typeof urlSchema>;

function UrlActionForm({ placement }: { placement: "hero" | "final" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<UrlForm>({
    resolver: zodResolver(urlSchema),
    defaultValues: { url: "" },
  });
  const submit = () => {
    track(placement === "hero" ? "hero_url_submit" : "final_cta_submit");
    window.dispatchEvent(new CustomEvent("4short:toast"));
  };
  const upload = () => {
    track("hero_upload_click", { placement });
    fileRef.current?.click();
  };
  return (
    <form className="url-form" onSubmit={handleSubmit(submit)} noValidate>
      <div className="url-form__row">
        <Input
          aria-label="Ссылка на видео YouTube"
          className="url-form__input"
          placeholder="Вставьте ссылку на YouTube"
          {...register("url", { onBlur: () => track("hero_url_focus", { placement }) })}
        />
        <Button className="cta-button" type="submit">Создать шортсы</Button>
      </div>
      {errors.url ? <span className="url-form__error" role="alert">{errors.url.message}</span> : null}
      <button className="upload-link" onClick={upload} type="button">
        <Upload size={16} /> или загрузить видео
      </button>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="video/*"
        onChange={(event) => {
          if (!event.target.files?.length) return;
          track("video_upload_start", { fileType: event.target.files[0].type });
          track("video_upload_complete");
          window.dispatchEvent(new CustomEvent("4short:toast"));
        }}
      />
    </form>
  );
}

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 16);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const links = [
    ["Возможности", "#features"], ["Как это работает", "#how"],
    ["Для кого", "#audience"], ["Тарифы", "#pricing"], ["FAQ", "#faq"],
  ];
  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="site-header__island">
        <a href="#top" aria-label="4Short — на главную"><Logo className="site-logo" /></a>
        <nav aria-label="Основная навигация">
          {links.map(([label, href]) => <a href={href} key={href}>{label}</a>)}
        </nav>
        <div className="site-header__actions">
          <a className="login-link" href="#top">Войти</a>
          <a className="header-cta" href="#top">Создать шортсы</a>
          <Button aria-label="Открыть меню" className="menu-button" isIconOnly variant="ghost" onPress={() => setOpen(true)}>
            <Menu size={22} />
          </Button>
        </div>
      </div>
      <Drawer isOpen={open} onOpenChange={setOpen}>
        <Drawer.Backdrop>
          <Drawer.Content className="mobile-drawer">
            <Drawer.Header><Logo className="site-logo" /><Button isIconOnly variant="ghost" aria-label="Закрыть меню" onPress={() => setOpen(false)}><X /></Button></Drawer.Header>
            <Drawer.Body>
              {links.map(([label, href]) => <a href={href} key={href} onClick={() => setOpen(false)}>{label}</a>)}
            </Drawer.Body>
            <Drawer.Footer><a className="header-cta" href="#top" onClick={() => setOpen(false)}>Создать шортсы</a></Drawer.Footer>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </header>
  );
}

function AudienceTabs() {
  const [selected, setSelected] = useState("podcasters");
  const item = audiences.find((audience) => audience.id === selected) ?? audiences[0];
  return (
    <div className="audience-layout">
      <Tabs
        aria-label="Сценарии использования"
        className="audience-tabs"
        orientation="vertical"
        selectedKey={selected}
        onSelectionChange={(key) => setSelected(String(key))}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Выберите аудиторию">
            {audiences.map((audience, index) => (
              <Tabs.Tab id={audience.id} key={audience.id}>
                <span>0{index + 1}</span>{audience.tab}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <article className="audience-visual squircle" key={item.id}>
        <div className="audience-visual__copy">
          <span>{item.tab}</span><h3>{item.title}</h3><p>{item.text}</p>
        </div>
        <div className="audience-visual__media">
          <div className="audience-source"><Play fill="currentColor" size={20} /><span>Исходное видео 16:9</span></div>
          <div className="audience-shorts">{[1, 2, 3].map((value) => <i key={value}><b /></i>)}</div>
        </div>
        <strong className="audience-result">{item.result}</strong>
      </article>
    </div>
  );
}

function PricingToggle() {
  const [annual, setAnnual] = useState(false);
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-monthly]").forEach((node) => {
      const monthly = Number(node.dataset.monthly);
      node.textContent = new Intl.NumberFormat("ru-RU").format(annual ? Math.round(monthly * 0.8) : monthly);
    });
  }, [annual]);
  return (
    <div className="pricing-toggle">
      <span>Ежемесячно</span>
      <Switch aria-label="Оплата за год" isSelected={annual} onChange={(value) => {
        setAnnual(value);
        track("billing_period_change", { period: value ? "annual" : "monthly" });
      }} />
      <span>На год <b>−20% демо</b></span>
    </div>
  );
}

function MinutesPicker() {
  const packages = [{ minutes: 60, price: 590 }, { minutes: 180, price: 1490 }, { minutes: 360, price: 2690 }];
  const [selected, setSelected] = useState(180);
  useEffect(() => {
    document.querySelector("[data-extra-minutes]")!.textContent = `+${selected}`;
    document.querySelector("[data-total-minutes]")!.textContent = `${184 + selected} минуты`;
  }, [selected]);
  return (
    <div className="minute-packages">
      {packages.map((pack) => (
        <button
          className={selected === pack.minutes ? "is-selected" : ""}
          key={pack.minutes}
          type="button"
          onClick={() => { setSelected(pack.minutes); track("minutes_package_select", { minutes: pack.minutes, price: pack.price }); }}
        >
          {pack.minutes === 180 ? <small>Чаще выбирают</small> : null}
          <strong>{pack.minutes} минут</strong>
          <span>{new Intl.NumberFormat("ru-RU").format(pack.price)} ₽</span>
          {selected === pack.minutes ? <Check size={16} /> : null}
        </button>
      ))}
      <Button className="cta-button" onPress={() => {
        track("minutes_purchase_start", { minutes: selected });
        window.dispatchEvent(new CustomEvent("4short:toast"));
      }}>Добавить минуты</Button>
    </div>
  );
}

function Faq() {
  return (
    <Accordion className="faq-accordion" onExpandedChange={(keys) => {
      const values = Array.from(keys);
      if (values.length) track("faq_open", { question: values[values.length - 1] });
    }}>
      {faqItems.map((item) => (
        <Accordion.Item id={item.question} key={item.question}>
          <Accordion.Heading>
            <Accordion.Trigger>
              {item.question}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>{item.answer}</Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

function Toast() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const show = () => { setVisible(true); clearTimeout(timeout); timeout = setTimeout(() => setVisible(false), 3400); };
    window.addEventListener("4short:toast", show);
    return () => { window.removeEventListener("4short:toast", show); clearTimeout(timeout); };
  }, []);
  if (!visible) return null;
  return <div className="demo-toast" role="status"><Check size={18} /> Сервис готовится к запуску. Это демонстрация сценария.</div>;
}

function Portals() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const planButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-plan]"));
    const handlers = planButtons.map((button) => {
      const handler = () => { track("plan_select", { plan: button.dataset.plan }); window.dispatchEvent(new CustomEvent("4short:toast")); };
      button.addEventListener("click", handler);
      return [button, handler] as const;
    });
    const pricing = document.querySelector("#pricing");
    const observer = pricing ? new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { track("pricing_view"); observer.disconnect(); }
    }, { threshold: 0.3 }) : null;
    if (pricing && observer) observer.observe(pricing);
    return () => { handlers.forEach(([button, handler]) => button.removeEventListener("click", handler)); observer?.disconnect(); };
  }, []);
  if (!ready) return null;
  const portal = (selector: string, node: React.ReactNode) => {
    const target = document.querySelector(selector);
    return target ? createPortal(node, target) : null;
  };
  return (
    <>
      {portal('[data-form-slot="hero"]', <UrlActionForm placement="hero" />)}
      {portal('[data-form-slot="final"]', <UrlActionForm placement="final" />)}
      {portal("[data-audience-slot]", <AudienceTabs />)}
      {portal("[data-pricing-toggle-slot]", <PricingToggle />)}
      {portal("[data-minutes-slot]", <MinutesPicker />)}
      {portal("[data-faq-slot]", <Faq />)}
    </>
  );
}

export function InteractiveLanding({ children }: { children: React.ReactNode }) {
  return <><Header />{children}<Portals /><Toast /></>;
}
