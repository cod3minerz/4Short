"use client";

import { Button, Dropdown, Label, Link, Modal } from "@heroui/react";
import { ArrowDown01Icon, Cancel01Icon, FlashIcon, FolderOpenIcon, HelpCircleIcon, Home01Icon, Menu01Icon, SidebarLeft01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { productPlans } from "@/packages/product-config/src";
import { Logo } from "../../components/logo";
import { ControlApiError, signOut } from "../lib/control-api";
import { useDashboardStore } from "../store";

const navigation = [
  { href: "/dashboard", label: "Главная", icon: Home01Icon },
  { href: "/dashboard/projects", label: "Мои проекты", icon: FolderOpenIcon },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { balanceSeconds, user, connection, planCode } = useDashboardStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const editor = /^\/dashboard\/projects\/[^/]+\/clips\/[^/]+/.test(pathname);
  const plan = planCode ? productPlans[planCode as keyof typeof productPlans] : null;

  useEffect(() => {
    if ((connection === "connected" || connection === "error") && !user) router.replace(`/sign-in?redirect=${encodeURIComponent(pathname)}`);
  }, [connection, user, pathname, router]);

  async function logout() {
    setSigningOut(true);
    setError("");
    try { await signOut(); window.location.assign("/"); }
    catch (cause) {
      setError(cause instanceof ControlApiError ? cause.message : "Не удалось выйти. Повторите попытку.");
      setSigningOut(false);
    }
  }

  function sidebar(drawer = false) {
    const narrow = !drawer && collapsed;
    return <aside className="hp-sidebar" data-collapsed={narrow} aria-label="Навигация Hashpix">
      <div className="hp-sidebar__head">
        <Link href="/dashboard" className="hp-sidebar__logo" aria-label="Hashpix — главная"><Logo priority tone="light" /></Link>
        <Button variant="ghost" size="sm" isIconOnly aria-label={drawer ? "Закрыть меню" : narrow ? "Развернуть меню" : "Свернуть меню"} onPress={() => {
          if (drawer) setMobileOpen(false);
          else setCollapsed(!collapsed);
        }}><AppIcon icon={drawer ? Cancel01Icon : SidebarLeft01Icon} size="md" /></Button>
      </div>
      <Dropdown>
        <Button className="hp-account" variant="ghost" aria-label="Открыть меню аккаунта">
          <span className="hp-avatar">{(user?.name || user?.email || "П").charAt(0).toUpperCase()}</span>
          <span className="hp-account__copy"><span className="hp-account__name">{user?.name || user?.email || (connection === "preview" ? "Предпросмотр" : "Загрузка…")}</span><span className="hp-account__plan">{connection === "preview" ? "Без подключения к API" : plan?.name ?? "Тариф загружается"}</span></span>
          <AppIcon icon={ArrowDown01Icon} className="hp-account__chevron" size="sm" />
        </Button>
        <Dropdown.Popover><Dropdown.Menu aria-label="Аккаунт" onAction={(key) => {
          setMobileOpen(false);
          if (key === "logout") void logout();
          else router.push(String(key));
        }}>
          <Dropdown.Item id="/dashboard/account" textValue="Настройки аккаунта"><Label>Настройки аккаунта</Label></Dropdown.Item>
          <Dropdown.Item id="/dashboard/billing" textValue="Минуты и тариф"><Label>Минуты и тариф</Label></Dropdown.Item>
          {user ? <Dropdown.Item id="logout" isDisabled={signingOut} textValue="Выйти"><Label>{signingOut ? "Выходим…" : "Выйти"}</Label></Dropdown.Item> : <Dropdown.Item id="/sign-in?redirect=%2Fdashboard" textValue="Войти"><Label>Войти</Label></Dropdown.Item>}
        </Dropdown.Menu></Dropdown.Popover>
      </Dropdown>
      {error ? <p className="hp-error" role="alert">{error}</p> : null}
      <nav className="hp-nav" aria-label="Создание клипов">
        <span className="hp-nav__label">Создание</span>
        {navigation.map((item) => <Link key={item.href} href={item.href} className="hp-nav__link" aria-label={narrow ? item.label : undefined} aria-current={(item.href === "/dashboard" ? pathname === item.href || pathname === "/dashboard/new" : pathname.startsWith(item.href)) ? "page" : undefined} onPress={() => setMobileOpen(false)}><AppIcon icon={item.icon} size="md" /><span>{item.label}</span></Link>)}
      </nav>
      <nav className="hp-nav hp-nav--footer" aria-label="Помощь и настройки">
        <Link href="/dashboard/help" className="hp-nav__link" aria-label={narrow ? "Помощь" : undefined} onPress={() => setMobileOpen(false)}><AppIcon icon={HelpCircleIcon} size="md" /><span>Помощь</span></Link>
        <Link href="/dashboard/account" className="hp-nav__link" aria-label={narrow ? "Настройки" : undefined} onPress={() => setMobileOpen(false)}><AppIcon icon={UserIcon} size="md" /><span>Настройки</span></Link>
      </nav>
    </aside>;
  }

  if (editor) return <div className="hp-editor-surface">{children}</div>;
  return <div className="hp-shell" data-collapsed={collapsed}>
    {sidebar()}
    <div className="hp-workspace">
      <div className="hp-utilities" aria-label="Баланс и покупка минут">
        <Modal isOpen={mobileOpen} onOpenChange={setMobileOpen}>
          <Button variant="ghost" isIconOnly className="hp-mobile-menu" aria-label="Открыть меню" onPress={() => setMobileOpen(true)}><AppIcon icon={Menu01Icon} size="md" /></Button>
          <Modal.Backdrop><Modal.Container className="hp-drawer" placement="center"><Modal.Dialog aria-label="Меню Hashpix">{sidebar(true)}</Modal.Dialog></Modal.Container></Modal.Backdrop>
        </Modal>
        {connection === "preview" ? <span className="hp-preview-label">Локальный предпросмотр · действия API недоступны</span> : null}
        <span className="hp-utilities__balance" aria-label={connection === "preview" ? "Баланс недоступен в предпросмотре" : balanceSeconds === null ? "Баланс загружается" : `${Math.floor(balanceSeconds / 60)} минут`}><AppIcon icon={FlashIcon} size="sm" />{connection === "preview" ? "—" : balanceSeconds === null ? "…" : Math.floor(balanceSeconds / 60)}</span>
        <Link href="/dashboard/billing" className="hp-purchase">Добавить минуты</Link>
      </div>
      <main className="hp-content">{children}</main>
    </div>
  </div>;
}
