"use client";

import {
  CircleHelp,
  FolderOpen,
  Home,
  Menu,
  Palette,
  Plus,
  ReceiptText,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "../../components/logo";
import { minuteBalance } from "../data";

const navItems = [
  { href: "/dashboard", label: "Главная", icon: Home, exact: true },
  { href: "/dashboard/projects", label: "Проекты", icon: FolderOpen },
  { href: "/dashboard/styles", label: "Стили", icon: Palette },
];

const utilityItems = [
  { href: "/dashboard/billing", label: "Минуты и тариф", icon: ReceiptText },
  { href: "/dashboard/help", label: "Помощь", icon: CircleHelp },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isWizard = pathname === "/dashboard/new";

  return (
    <div className={`dash-shell ${isWizard ? "is-wizard" : ""}`}>
      <aside className={`dash-sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Кабинет 4Short">
        <div className="dash-sidebar__head">
          <Link href="/" aria-label="4Short — на главную">
            <Logo priority />
          </Link>
          <button
            className="dash-icon-button dash-sidebar__close"
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          >
            <X size={22} />
          </button>
        </div>

        <Link className="dash-new-button" href="/dashboard/new">
          <Plus size={19} />
          Новое видео
        </Link>

        <nav className="dash-nav" aria-label="Разделы кабинета">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link className={active ? "is-active" : ""} href={href} key={href} onClick={() => setMenuOpen(false)}>
                <Icon size={19} strokeWidth={2} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="dash-sidebar__spacer" />

        <nav className="dash-nav dash-nav--utility" aria-label="Оплата и помощь">
          {utilityItems.map(({ href, label, icon: Icon }) => (
            <Link
              className={pathname.startsWith(href) ? "is-active" : ""}
              href={href}
              key={href}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <Link className="dash-balance" href="/dashboard/billing" onClick={() => setMenuOpen(false)}>
          <span className="dash-balance__label">Баланс</span>
          <strong>{minuteBalance.planUsed} / {minuteBalance.planTotal} мин.</strong>
          <span className="dash-balance__track" aria-hidden="true">
            <i style={{ width: `${(minuteBalance.planUsed / minuteBalance.planTotal) * 100}%` }} />
          </span>
          <small>+ {minuteBalance.extra} дополнительных</small>
        </Link>

        <button className="dash-profile" type="button">
          <span className="dash-profile__avatar">К</span>
          <span>
            <strong>Кирилл</strong>
            <small>Creator</small>
          </span>
          <UserRound size={18} />
        </button>
      </aside>

      {menuOpen ? (
        <button
          className="dash-sidebar-backdrop"
          type="button"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="dash-main">
        <header className="dash-mobile-header">
          <button
            className="dash-icon-button"
            type="button"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={22} />
          </button>
          <Logo />
          <Link className="dash-mobile-balance" href="/dashboard/billing">
            {minuteBalance.planUsed + minuteBalance.extra} мин.
          </Link>
        </header>
        {children}
      </div>

      <nav className="dash-mobile-nav" aria-label="Мобильная навигация">
        {navItems.slice(0, 2).map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link className={active ? "is-active" : ""} href={href} key={href}>
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          );
        })}
        <Link className="dash-mobile-nav__new" href="/dashboard/new" aria-label="Новое видео">
          <Plus size={25} />
        </Link>
        <Link className={pathname.startsWith("/dashboard/styles") ? "is-active" : ""} href="/dashboard/styles">
          <Palette size={20} />
          <span>Стили</span>
        </Link>
        <button type="button" onClick={() => setMenuOpen(true)}>
          <UserRound size={20} />
          <span>Профиль</span>
        </button>
      </nav>
    </div>
  );
}
