"use client";

import { Button, Link, Modal } from "@heroui/react";
import { ArrowLeftToLineIcon, ArrowRightToLineIcon, Cancel01Icon, FingerprintPatternIcon, FlashIcon, FolderOpenIcon, HelpCircleIcon, Home01Icon, Menu01Icon, PaintBoardIcon, UserIcon } from "@hugeicons/core-free-icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import Aurora from "../../product/aurora";
import { Logo } from "../../components/logo";
import { useDashboardStore } from "../store";
import { hasLocalDevelopmentIdentity } from "../lib/control-api";

const navigation = [
  { href: "/dashboard", label: "Главная", icon: Home01Icon },
  { href: "/dashboard/projects", label: "Мои проекты", icon: FolderOpenIcon },
];

const plannedNavigation = [
  { id: "presets", label: "Пресеты", icon: PaintBoardIcon },
  { id: "uniqueness", label: "Уникализация", icon: FingerprintPatternIcon },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { balanceSeconds, user, connection } = useDashboardStore();
  const localDevelopmentIdentity = hasLocalDevelopmentIdentity();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const editor = /^\/dashboard\/projects\/[^/]+\/clips\/[^/]+/.test(pathname);
  const displayedBalance = connection === "connected" ? balanceSeconds : null;

  useEffect(() => {
    if ((connection === "connected" || connection === "error") && !user && !localDevelopmentIdentity) router.replace(`/sign-in?redirect=${encodeURIComponent(pathname)}`);
  }, [connection, user, localDevelopmentIdentity, pathname, router]);

  function sidebar(drawer = false) {
    const narrow = !drawer && collapsed;
    return <aside className="hp-sidebar" data-collapsed={narrow} aria-label="Навигация Narezai">
      <div className="hp-sidebar__head">
        <Link href="/dashboard" className="hp-sidebar__logo" aria-label="Narezai — главная"><Logo priority tone="light" markOnly={narrow} /></Link>
        <Button className="hp-sidebar__toggle" variant="ghost" size="sm" isIconOnly aria-label={drawer ? "Закрыть меню" : narrow ? "Развернуть меню" : "Свернуть меню"} onPress={() => {
          if (drawer) setMobileOpen(false);
          else setCollapsed(!collapsed);
        }}><AppIcon icon={drawer ? Cancel01Icon : narrow ? ArrowRightToLineIcon : ArrowLeftToLineIcon} size="md" /></Button>
      </div>
      <nav className="hp-nav" aria-label="Создание клипов">
        <span className="hp-nav__label">Создание</span>
        {navigation.map((item) => <Link key={item.href} href={item.href} className="hp-nav__link" aria-label={narrow ? item.label : undefined} aria-current={(item.href === "/dashboard" ? pathname === item.href || pathname === "/dashboard/new" : pathname.startsWith(item.href)) ? "page" : undefined} onPress={() => setMobileOpen(false)}><span className="hp-nav__icon"><AppIcon icon={item.icon} size="sm" aria-hidden="true" /></span><span>{item.label}</span></Link>)}
        {plannedNavigation.map((item) => <Button key={item.id} className="hp-nav__link hp-nav__link--planned" variant="ghost" isDisabled aria-label={narrow ? `${item.label}, скоро` : undefined} aria-describedby={!narrow ? `nav-planned-${item.id}` : undefined}><span className="hp-nav__icon"><AppIcon icon={item.icon} size="sm" aria-hidden="true" /></span><span className="hp-nav__planned-copy"><span>{item.label}</span><span className="hp-nav__planned-label" id={`nav-planned-${item.id}`}>Скоро</span></span></Button>)}
      </nav>
      <nav className="hp-nav hp-nav--footer" aria-label="Помощь и настройки">
        <Link href="/dashboard/help" className="hp-nav__link" aria-label={narrow ? "Помощь" : undefined} onPress={() => setMobileOpen(false)}><span className="hp-nav__icon"><AppIcon icon={HelpCircleIcon} size="sm" aria-hidden="true" /></span><span>Помощь</span></Link>
        <Link href="/dashboard/account" className="hp-nav__link" aria-label={narrow ? "Настройки" : undefined} onPress={() => setMobileOpen(false)}><span className="hp-nav__icon"><AppIcon icon={UserIcon} size="sm" aria-hidden="true" /></span><span>Настройки</span></Link>
      </nav>
    </aside>;
  }

  if (editor) return <div className="hp-editor-surface">{children}</div>;
  return <div className="hp-shell" data-collapsed={collapsed}>
    {sidebar()}
    <div className="hp-workspace">
      {pathname === "/dashboard" ? <Aurora
        className="hp-home-aurora"
        colorStops={["#e88935", "#9c7058", "#68666a", "#c5835c", "#e88935"]}
        amplitude={0.86}
        blend={0.68}
        height={0.43}
        speed={0.34}
        scale={0.78}
        glow={0.56}
        brightness={0.68}
        layers={2}
        opacity={0.16}
        dpr={0.85}
      /> : null}
      <div className="hp-utilities" aria-label="Баланс и покупка минут">
        <Modal isOpen={mobileOpen} onOpenChange={setMobileOpen}>
          <Button variant="ghost" isIconOnly className="hp-mobile-menu" aria-label="Открыть меню" onPress={() => setMobileOpen(true)}><AppIcon icon={Menu01Icon} size="md" /></Button>
          <Modal.Backdrop><Modal.Container className="hp-drawer" placement="center"><Modal.Dialog aria-label="Меню Narezai">{sidebar(true)}</Modal.Dialog></Modal.Container></Modal.Backdrop>
        </Modal>
        <span className="hp-utilities__balance" aria-label={displayedBalance === null ? "Баланс минут" : `${Math.floor(displayedBalance / 60)} минут`}><span className="hp-utilities__balance-icon"><AppIcon icon={FlashIcon} size="sm" aria-hidden="true" /></span>{displayedBalance === null ? "—" : Math.floor(displayedBalance / 60)}</span>
        <Link href="/dashboard/billing" className="hp-purchase">Добавить минуты</Link>
      </div>
      <main className="hp-content">{children}</main>
    </div>
  </div>;
}
