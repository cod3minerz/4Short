"use client"

import {
  ArrowLeft05Icon,
  DashboardSpeed01Icon,
  HistoryIcon,
  ShieldUserIcon,
  Task01Icon,
  UserGroupIcon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons"
import Link from "next/link"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { AppIcon } from "@/components/hashpix/app-icon"
import { PageTitle } from "@/components/hashpix/typography"
import { Logo } from "@/app/components/logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { adminApi, type AdminMe, type AdminOverview, isAdminApiConfigured } from "../lib/admin-api"

export type AdminView = "overview" | "users" | "workspaces" | "jobs" | "audit"
export type AdminNotice = { tone: "success" | "danger"; text: string } | null

type AdminAccess = {
  me: AdminMe
  overview: AdminOverview | null
  refreshOverview: () => Promise<void>
  setNotice: (notice: AdminNotice) => void
}

const AdminAccessContext = createContext<AdminAccess | null>(null)
let bootstrapSnapshot: Pick<AdminAccess, "me" | "overview"> | null = null
let bootstrapRequest: Promise<Pick<AdminAccess, "me" | "overview">> | null = null

const views: Array<{ id: AdminView; label: string; href: string; icon: typeof DashboardSpeed01Icon }> = [
  { id: "overview", label: "Обзор", href: "/admin", icon: DashboardSpeed01Icon },
  { id: "users", label: "Пользователи", href: "/admin/users", icon: UserGroupIcon },
  { id: "workspaces", label: "Аккаунты", href: "/admin/workspaces", icon: Wallet02Icon },
  { id: "jobs", label: "Очередь", href: "/admin/jobs", icon: Task01Icon },
  { id: "audit", label: "Журнал", href: "/admin/audit", icon: HistoryIcon },
]

const roleLabels: Record<AdminMe["role"], string> = {
  support: "Поддержка",
  admin: "Администратор",
  super_admin: "Super admin",
}

function loadBootstrap() {
  if (bootstrapSnapshot) return Promise.resolve(bootstrapSnapshot)
  bootstrapRequest ??= Promise.all([adminApi.me(), adminApi.overview()]).then(([me, overview]) => {
    bootstrapSnapshot = { me, overview }
    return bootstrapSnapshot
  })
  return bootstrapRequest
}

export function useAdminAccess() {
  const context = useContext(AdminAccessContext)
  if (!context) throw new Error("Admin routes must be rendered inside AdminShell.")
  return context
}

function AdminShellSkeleton() {
  return (
    <div className="flex min-h-svh bg-background" aria-busy="true" aria-label="Загружаем административную консоль">
      <aside className="hidden w-64 border-r bg-sidebar p-4 md:block"><Skeleton className="h-8 w-28" /><div className="mt-8 grid gap-2">{Array.from({ length: 5 }, (_, index) => <Skeleton className="h-9 w-full" key={index} />)}</div></aside>
      <main className="flex-1 p-6"><Skeleton className="h-5 w-36" /><Skeleton className="mt-8 h-8 w-64" /><Skeleton className="mt-3 h-5 w-96 max-w-full" /></main>
    </div>
  )
}

function AdminAccessGate({ state, error }: { state: "unconfigured" | "denied"; error: string }) {
  const title = state === "unconfigured" ? "CONTROL API НЕ ПОДКЛЮЧЁН" : "ДОСТУП ЗАКРЫТ"
  const description = state === "unconfigured"
    ? "Админ-панель не показывает демонстрационные данные. Подключите Control API и задайте PLATFORM_ADMIN_EMAILS."
    : error || "Активная сессия не обладает административными правами."
  return (
    <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <section className="grid w-full max-w-md gap-5 rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <Link className="justify-self-center" href="/" aria-label="Narezai — на главную"><Logo priority tone="light" /></Link>
        <AppIcon className="mx-auto text-muted-foreground" icon={ShieldUserIcon} size="lg" aria-hidden="true" />
        <div className="grid gap-2"><span className="text-xs font-medium tracking-wide text-muted-foreground">NAREZAI / ADMIN</span><PageTitle>{title}</PageTitle><p className="text-sm text-muted-foreground">{description}</p></div>
        <Button className="justify-self-center" variant="outline" nativeButton={false} render={<Link href="/dashboard" />}><AppIcon icon={ArrowLeft05Icon} size="sm" aria-hidden="true" />Вернуться в кабинет</Button>
      </section>
    </main>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [access, setAccess] = useState<"loading" | "ready" | "unconfigured" | "denied">(() => !isAdminApiConfigured() ? "unconfigured" : bootstrapSnapshot ? "ready" : "loading")
  const [snapshot, setSnapshot] = useState(() => bootstrapSnapshot)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<AdminNotice>(null)

  useEffect(() => {
    if (!isAdminApiConfigured() || bootstrapSnapshot) return
    let active = true
    void loadBootstrap().then((next) => { if (active) { setSnapshot(next); setAccess("ready") } }).catch((caught) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : "Доступ запрещён")
      setAccess("denied")
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const refreshOverview = useCallback(async () => {
    if (!snapshot) return
    const overview = await adminApi.overview()
    bootstrapSnapshot = { me: snapshot.me, overview }
    setSnapshot(bootstrapSnapshot)
  }, [snapshot])
  const context = useMemo<AdminAccess | null>(() => snapshot ? ({ me: snapshot.me, overview: snapshot.overview, refreshOverview, setNotice }) : null, [refreshOverview, snapshot])

  if (access === "loading") return <AdminShellSkeleton />
  if (access === "unconfigured" || access === "denied") return <AdminAccessGate state={access} error={error} />
  if (!context) return <AdminShellSkeleton />
  const { me } = context

  return (
    <AdminAccessContext.Provider value={context}>
      <SidebarProvider>
        <Sidebar collapsible="offcanvas">
          <SidebarHeader className="gap-3"><div className="flex items-center justify-between gap-2 px-2"><Link href="/" aria-label="Narezai — на главную"><Logo priority tone="light" /></Link><Badge variant="secondary">ADMIN</Badge></div></SidebarHeader>
          <SidebarContent>
            <nav aria-label="Разделы админ-панели"><SidebarMenu>{views.map(({ id, label, href, icon }) => <SidebarMenuItem key={id}><SidebarMenuButton isActive={pathname === href} render={<Link href={href} />}><AppIcon icon={icon} size="sm" aria-hidden="true" /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></nav>
          </SidebarContent>
          <SidebarFooter className="gap-3 border-t">
            <Button className="justify-start" variant="ghost" nativeButton={false} render={<Link href="/dashboard" />}><AppIcon icon={ArrowLeft05Icon} size="sm" aria-hidden="true" />Кабинет</Button>
            <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-md bg-sidebar-accent p-2"><span className="grid size-8 place-items-center rounded-md bg-sidebar-primary text-xs font-medium text-sidebar-primary-foreground">{me.email.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-xs font-medium">{me.email}</p><p className="text-xs text-muted-foreground">{roleLabels[me.role]}</p></div></div>
          </SidebarFooter>
        </Sidebar>
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <header className="flex min-h-14 items-center border-b px-4 md:px-6"><div className="flex items-center gap-2"><SidebarTrigger className="md:hidden" aria-label="Открыть меню" /><span className="text-xs text-muted-foreground"><AppIcon className="mr-1 inline-flex align-text-bottom" icon={ShieldUserIcon} size="sm" aria-hidden="true" />{roleLabels[me.role]}{me.bootstrap ? " · bootstrap" : ""}</span></div></header>
          <div className="w-full max-w-6xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
        {notice ? <div className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-2 rounded-md bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10" role="status"><span className={notice.tone === "danger" ? "text-destructive" : "text-primary"}>{notice.tone === "danger" ? "Ошибка" : "Готово"}</span>{notice.text}</div> : null}
      </SidebarProvider>
    </AdminAccessContext.Provider>
  )
}
