"use client";

import {
  ArrowDown01Icon,
  FlashIcon,
  FolderOpenIcon,
  HelpCircleIcon,
  Invoice01Icon,
  Logout01Icon,
  ScissorIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { StatusBadge } from "@/components/hashpix/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Logo } from "../../components/logo";
import { ControlApiError, signOut } from "../lib/control-api";
import { useDashboardStore } from "../store";

const primaryItems = [
  { href: "/dashboard", label: "Нарезка", icon: ScissorIcon, exact: true },
  { href: "/dashboard/projects", label: "Мои проекты", icon: FolderOpenIcon, exact: false },
];

const utilityItems = [
  { href: "/dashboard/billing", label: "Минуты и тариф", icon: Invoice01Icon, exact: false },
  { href: "/dashboard/help", label: "Помощь", icon: HelpCircleIcon, exact: false },
];

const mobileItems = [
  primaryItems[1],
  primaryItems[0],
  utilityItems[0],
  { href: "/dashboard/account", label: "Профиль", icon: UserIcon, exact: false },
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

  useEffect(() => {
    if ((connection === "connected" || connection === "error") && !user) {
      router.replace(`/sign-in?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [connection, user, pathname, router]);

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

  if (isEditor) return <div className="editor-focus-shell dark">{children}</div>;

  return (
    <div className="dash-shell dark">
      <header className="dash-topbar">
        <div className="dash-topbar__inner">
          <Link className="dash-topbar__logo" href="/" aria-label="Hashpix — на главную"><Logo priority /></Link>
          <div className="dash-topbar__actions">
            <Button nativeButton={false} render={<Link href="/dashboard/billing" />} variant="outline" size="sm" aria-label={availableMinutes === null ? "Баланс загружается" : `${availableMinutes} минут доступно`}>
              <span className="grid size-5 place-items-center rounded-sm bg-muted text-foreground" aria-hidden="true"><AppIcon icon={FlashIcon} size="sm" /></span>
              <span>{availableMinutes === null ? "…" : availableMinutes}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" type="button" aria-label="Открыть меню профиля">
                <span className="grid size-7 place-items-center rounded-sm bg-muted text-xs font-medium">{initial}</span>
                <span className="hidden max-w-44 truncate sm:inline">{displayName}</span>
                <AppIcon icon={ArrowDown01Icon} size="sm" aria-hidden="true" />
              </Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {user ? <DropdownMenuLabel>{user.email}</DropdownMenuLabel> : null}
                  <DropdownMenuItem onClick={() => router.push("/dashboard/account")}><AppIcon icon={UserIcon} size="sm" aria-hidden="true" />Аккаунт</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!user || signingOut} title={user ? undefined : "Вход ещё не подключён к этому окружению"} onClick={() => void handleSignOut()}>
                  <AppIcon icon={Logout01Icon} size="sm" aria-hidden="true" />{signingOut ? "Выходим…" : "Выйти"}
                </DropdownMenuItem>
                {signOutError ? <StatusBadge tone="danger" className="m-1 whitespace-normal">{signOutError}</StatusBadge> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="dash-frame">
        <aside className="dash-sidebar" aria-label="Кабинет Hashpix">
          <nav className="dash-nav" aria-label="Основные разделы">
            {primaryItems.map(({ href, label, icon, exact }) => (
              <Link className={isActive(pathname, href, exact) ? "is-active" : ""} href={href} key={href}><AppIcon icon={icon} size="md" aria-hidden="true" /><span>{label}</span></Link>
            ))}
          </nav>
          <nav className="dash-nav dash-nav--utility" aria-label="Оплата и помощь">
            {utilityItems.map(({ href, label, icon, exact }) => (
              <Link className={isActive(pathname, href, exact) ? "is-active" : ""} href={href} key={href}><AppIcon icon={icon} size="sm" aria-hidden="true" /><span>{label}</span></Link>
            ))}
          </nav>
        </aside>

        <div className="dash-main">{children}</div>
      </div>

      <nav className="dash-mobile-nav" aria-label="Мобильная навигация">
        {mobileItems.map(({ href, label, icon, exact }) => (
          exact ? (
            <Link className="dash-mobile-nav__new" href={href} key={href} aria-label={label}><AppIcon icon={icon} size="lg" aria-hidden="true" /></Link>
          ) : (
            <Link className={isActive(pathname, href, exact) ? "is-active" : ""} href={href} key={href}><AppIcon icon={icon} size="md" aria-hidden="true" /><span>{label}</span></Link>
          )
        ))}
      </nav>
    </div>
  );
}
