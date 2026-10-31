"use client";

import { Dialog } from "@base-ui/react/dialog";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Release } from "@/lib/releases";
import { nav } from "./data";
import { HeaderDownload } from "./download";

const Chevron = () => (
  <svg className="lp-nav__chevron" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M2 3.5 5 6.5 8 3.5" />
  </svg>
);

function Panel({ items }: { items: readonly { href: string; title: string; text: string }[] }) {
  return (
    <ul className="lp-navcontent">
      {items.map((item) => (
        <li key={item.title}>
          <NavigationMenu.Link className="lp-navitem" href={item.href} render={item.href.startsWith("/") ? <Link href={item.href} /> : <a />}>
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </NavigationMenu.Link>
        </li>
      ))}
    </ul>
  );
}

export function LandingHeader({ release }: { release: Release | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className={`lp-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="lp-container lp-header__bar">
        <Link className="lp-header__logo" href="/" aria-label="Нарезай, на главную">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-narezai.svg" alt="" width={112} height={23} />
        </Link>

        <NavigationMenu.Root className="lp-nav" aria-label="Основная навигация">
          <NavigationMenu.List className="lp-nav__list">
            <NavigationMenu.Item>
              <NavigationMenu.Trigger className="lp-nav__trigger">
                Продукт <Chevron />
              </NavigationMenu.Trigger>
              <NavigationMenu.Content>
                <Panel items={nav.product} />
              </NavigationMenu.Content>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link className="lp-nav__link" href="#pricing" render={<a />}>
                Тарифы
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Trigger className="lp-nav__trigger">
                Ресурсы <Chevron />
              </NavigationMenu.Trigger>
              <NavigationMenu.Content>
                <Panel items={nav.resources} />
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          </NavigationMenu.List>
          <NavigationMenu.Portal>
            <NavigationMenu.Positioner className="lp-navpos" sideOffset={8} align="start">
              <NavigationMenu.Popup className="lp-navpopup">
                <NavigationMenu.Viewport />
              </NavigationMenu.Popup>
            </NavigationMenu.Positioner>
          </NavigationMenu.Portal>
        </NavigationMenu.Root>

        <div className="lp-header__actions">
          <Link className="lp-btn lp-btn--ghost lp-btn--s" href="/sign-in">Войти</Link>
          <HeaderDownload release={release} />
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger className="lp-header__menu" aria-label="Открыть меню">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12" /></svg>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="lp-drawer__backdrop" />
              <Dialog.Popup className="lp lp-drawer" aria-label="Меню">
                <div className="lp-drawer__head">
                  <Dialog.Title className="lp-sample">Меню</Dialog.Title>
                  <Dialog.Close className="lp-header__menu" style={{ display: "inline-flex" }} aria-label="Закрыть меню">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3.5 3.5 9 9m0-9-9 9" /></svg>
                  </Dialog.Close>
                </div>
                <div className="lp-drawer__group" onClick={() => setOpen(false)}>
                  <h2>Продукт</h2>
                  {nav.product.map((item) => <a key={item.title} href={item.href}>{item.title}</a>)}
                  <a href="#pricing">Тарифы</a>
                </div>
                <div className="lp-drawer__group" onClick={() => setOpen(false)}>
                  <h2>Ресурсы</h2>
                  {nav.resources.map((item) => <a key={item.title} href={item.href}>{item.title}</a>)}
                </div>
                <div className="lp-drawer__cta">
                  <a className="lp-btn lp-btn--primary" href="#download" onClick={() => setOpen(false)}>Скачать</a>
                  <Link className="lp-btn lp-btn--secondary" href="/sign-in">Войти</Link>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
