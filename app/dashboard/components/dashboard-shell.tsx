"use client";

import {
  ChevronDown,
  CircleHelp,
  FolderOpen,
  Scissors,
  LogOut,
  Palette,
  ReceiptText,
  UserRound,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../../components/logo";
import { ControlApiError, signOut } from "../lib/control-api";
import { useDashboardStore } from "../store";

/**
 * "Нарезка" is the clipping flow itself. Teaser, uniqueness and standalone
 * subtitle tools belong here too, but each needs a backend pipeline that does
 * not exist yet — they are deliberately absent rather than added as nav items
 * that lead nowhere.
 */
const primaryItems = [
  { href: "/dashboard", label: "Нарезка", icon: Scissors, exact: true },
  { href: "/dashboard/projects", label: "Мои проекты", icon: FolderOpen },
  { href: "/dashboard/styles", label: "Стили", icon: Palette },
];

const utilityItems = [
  { href: "/dashboard/billing", label: "Кредиты и тариф", icon: ReceiptText },
  { href: "/dashboard/help", label: "Помощь", icon: CircleHelp },
];

/**
 * The bottom bar on mobile. Derived from the same nav items as the sidebar so
 * the two can't drift apart: "Нарезка" becomes the centre action button,
 * and the account entry is mobile-only (it lives in the profile menu on
 * desktop). `mobileOnly` items are never shown in the sidebar.
 */
const mobileItems = [
  primaryItems[1],
  primaryItems[0],
  primaryItems[2],
  { href: "/dashboard/account", label: "Профиль", icon: UserRound },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname.startsWith(href);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isEditor = /\/dashboard\/projects\/[^/]+\/clips\/[^/]+/.test(pathname);
  const { balanceSeconds, user, connection } = useDashboardStore();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const availableMinutes = balanceSeconds === null ? null : Math.floor(balanceSeconds / 60);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);

  // Native <details> has no built-in "close on outside click" — closing it
  // imperatively here (rather than converting to React-controlled open
  // state) keeps the markup/CSS identical to before; only the dismissal
  // behavior is new.
  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const details = profileMenuRef.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && profileMenuRef.current?.open) {
        profileMenuRef.current.open = false;
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  // Only once the real API has actually answered — "preview" (API not
  // configured) is a deliberate offline-demo state, not a signed-out one,
  // and must never redirect. Checks BOTH "connected" and "error": a
  // genuinely signed-out visitor hits every workspace-scoped endpoint
  // (styles/billing/projects) with a 401, which lands hydration in "error",
  // never "connected" — so gating on "connected" alone left this redirect
  // unreachable for the exact case it exists for. `user` itself still comes
  // from the dedicated session check, resolved independently of whether
  // those other calls succeeded, so a real signed-in user hitting an
  // unrelated error (a transient 500, a network blip) keeps `user` set and
  // is correctly NOT redirected here.
  useEffect(() => {
    if ((connection === "connected" || connection === "error") && !user) {
      router.replace(`/sign-in?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [connection, user, pathname, router]);

  // No hardcoded name: falls back to a neutral label until a real session loads.
  const displayName = user?.name || user?.email || "Аккаунт";
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      window.location.href = "/";
    } catch (error) {
      setSigningOut(false);
      setSignOutError(error instanceof ControlApiError ? error.message : "Не удалось выйти. Проверьте соединение и попробуйте ещё раз.");
    }
  };

  if (isEditor) {
    return <div className="editor-focus-shell">{children}</div>;
  }

  return (
    <div className="dash-shell">
      <header className="dash-topbar">
        <div className="dash-topbar__inner">
          <Link className="dash-topbar__logo" href="/" aria-label="Hashpix — на главную">
            <Logo priority />
          </Link>
          <div className="dash-topbar__actions">
            <Link
              className="dash-topbar__balance"
              href="/dashboard/billing"
              aria-label={availableMinutes === null ? "Баланс загружается" : `${availableMinutes} кредитов доступно`}
            >
              <span className="dash-topbar__balance-icon" aria-hidden="true"><Zap size={14} fill="currentColor" strokeWidth={2.25} /></span>
              <span>{availableMinutes === null ? "…" : availableMinutes}</span>
            </Link>
            <details className="dash-profile-menu" ref={profileMenuRef}>
              <summary aria-label="Открыть меню профиля">
                <span className="dash-profile-menu__avatar">{initial}</span>
                <span className="dash-profile-menu__name">{displayName}</span>
                <ChevronDown size={14} />
              </summary>
              <div className="dash-profile-menu__popover">
                {user ? <span className="dash-profile-menu__email">{user.email}</span> : null}
                <Link href="/dashboard/account"><UserRound size={16} /> Аккаунт</Link>
                <button
                  type="button"
                  disabled={!user || signingOut}
                  title={user ? undefined : "Вход ещё не подключён к этому окружению"}
                  onClick={() => void handleSignOut()}
                >
                  <LogOut size={16} /> {signingOut ? "Выходим…" : "Выйти"}
                </button>
                {signOutError ? <p className="dash-field-error" role="alert">{signOutError}</p> : null}
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="dash-frame">
        <aside className="dash-sidebar" aria-label="Кабинет Hashpix">
          <nav className="dash-nav" aria-label="Основные разделы">
            {primaryItems.map(({ href, label, icon: Icon, exact }) => (
              <Link className={isActive(pathname, href, exact) ? "is-active" : ""} href={href} key={href}>
                <Icon size={18} strokeWidth={2} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <nav className="dash-nav dash-nav--utility" aria-label="Оплата и помощь">
            {utilityItems.map(({ href, label, icon: Icon }) => (
              <Link className={isActive(pathname, href) ? "is-active" : ""} href={href} key={href}>
                <Icon size={17} strokeWidth={2} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <div className="dash-main">
          {children}
        </div>
      </div>

      <nav className="dash-mobile-nav" aria-label="Мобильная навигация">
        {mobileItems.map(({ href, label, icon: Icon, exact }) => (
          exact ? (
            <Link className="dash-mobile-nav__new" href={href} key={href} aria-label={label}>
              <Icon size={24} />
            </Link>
          ) : (
            <Link className={isActive(pathname, href) ? "is-active" : ""} href={href} key={href}>
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          )
        ))}
      </nav>
    </div>
  );
}
