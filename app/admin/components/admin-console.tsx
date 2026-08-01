"use client";

import { Button, Chip, SearchField } from "@heroui/react";
import {
  Activity,
  ArrowLeft,
  Ban,
  Check,
  CircleDollarSign,
  Clock3,
  Database,
  Gauge,
  History,
  LoaderCircle,
  LogOut,
  Menu,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "../../components/logo";
import {
  adminApi,
  type AdminAuditEvent,
  type AdminJob,
  type AdminMe,
  type AdminOverview,
  type AdminUser,
  type AdminWorkspace,
  type Paginated,
  type PlatformRole,
  isAdminApiConfigured,
} from "../lib/admin-api";

export type AdminView = "overview" | "users" | "workspaces" | "jobs" | "audit";
type Notice = { tone: "success" | "danger"; text: string } | null;

const views: Array<{ id: AdminView; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Обзор", icon: Gauge },
  { id: "users", label: "Пользователи", icon: Users },
  { id: "workspaces", label: "Аккаунты", icon: WalletCards },
  { id: "jobs", label: "Очередь", icon: Activity },
  { id: "audit", label: "Журнал", icon: History },
];

const roleLabels: Record<PlatformRole, string> = {
  user: "Пользователь",
  support: "Поддержка",
  admin: "Администратор",
  super_admin: "Super admin",
};

const planLabels: Record<AdminWorkspace["planCode"], string> = {
  free: "Free",
  start: "Start",
  creator: "Creator",
  studio: "Studio",
};

const actionLabels: Record<string, string> = {
  "admin.user.role_changed": "Изменена роль",
  "admin.user.suspended": "Пользователь заблокирован",
  "admin.user.reactivated": "Пользователь восстановлен",
  "admin.workspace.plan_changed": "Изменён тариф",
  "admin.workspace.minutes_adjusted": "Скорректированы минуты",
  "admin.job.retried": "Задача перезапущена",
  "admin.job.cancelled": "Задача отменена",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMinutes(seconds: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(seconds / 60);
}

function statusColor(status: string): "default" | "success" | "warning" | "danger" | "accent" {
  if (["ready", "succeeded", "active"].includes(status)) return "success";
  if (["failed", "suspended", "cancelled"].includes(status)) return "danger";
  if (["queued", "draft"].includes(status)) return "warning";
  return "accent";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="admin-empty"><Database size={28} /><p>{children}</p></div>;
}

function LoadingState() {
  return <div className="admin-loading" role="status"><LoaderCircle size={24} /> Загружаем данные</div>;
}

function Pager({
  data,
  onPage,
}: {
  data: { page: number; limit: number; total: number };
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  if (pages <= 1) return null;
  return (
    <div className="admin-pager">
      <Button variant="outline" size="sm" isDisabled={data.page <= 1} onPress={() => onPage(data.page - 1)}>
        Назад
      </Button>
      <span>{data.page} из {pages}</span>
      <Button variant="outline" size="sm" isDisabled={data.page >= pages} onPress={() => onPage(data.page + 1)}>
        Далее
      </Button>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  search,
  setSearch,
  onSearch,
}: {
  title: string;
  description: string;
  search?: string;
  setSearch?: (value: string) => void;
  onSearch?: () => void;
}) {
  return (
    <div className="admin-section-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {search !== undefined && setSearch && onSearch ? (
        <SearchField
          aria-label={`Поиск: ${title}`}
          className="admin-search"
          value={search}
          onChange={setSearch}
          onSubmit={onSearch}
        >
          <SearchField.Group>
            <SearchField.SearchIcon><Search size={17} /></SearchField.SearchIcon>
            <SearchField.Input placeholder="Найти…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      ) : null}
    </div>
  );
}

function OverviewView({ data }: { data: AdminOverview | null }) {
  if (!data) return <LoadingState />;
  const metrics = [
    { label: "Пользователи", value: data.users, detail: `${data.workspaces} аккаунтов`, icon: Users },
    { label: "Активные проекты", value: data.projects.active, detail: `${data.projects.total} всего`, icon: Play },
    { label: "Очередь", value: data.jobs.queued, detail: `${data.jobs.running} выполняются`, icon: Clock3 },
    { label: "Ошибки задач", value: data.jobs.failed, detail: `${data.projects.failed} проектов`, icon: Ban },
  ];
  return (
    <>
      <SectionHeader title="Состояние платформы" description="Пользователи, очередь и работоспособность конвейера." />
      <div className="admin-metrics">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <article className="admin-metric" key={label}>
            <span><Icon size={18} /></span>
            <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
          </article>
        ))}
      </div>
      <div className="admin-overview-grid">
        <section className="admin-panel">
          <div className="admin-panel__head">
            <div><Server size={19} /><h2>Media workers</h2></div>
            <Chip color={data.workers.some((worker) => worker.online) ? "success" : "danger"} variant="soft">
              {data.workers.filter((worker) => worker.online).length} онлайн
            </Chip>
          </div>
          {data.workers.length ? (
            <div className="admin-worker-list">
              {data.workers.map((worker) => (
                <div key={worker.id}>
                  <span className={worker.online ? "is-online" : ""} />
                  <div><strong>{worker.id}</strong><small>Версия {worker.version}</small></div>
                  <time>{formatDate(worker.lastHeartbeatAt)}</time>
                </div>
              ))}
            </div>
          ) : <EmptyState>Worker ещё не зарегистрирован</EmptyState>}
        </section>
        <section className="admin-panel admin-panel--revenue">
          <div className="admin-panel__head">
            <div><CircleDollarSign size={19} /><h2>Оплачено</h2></div>
          </div>
          <strong>{new Intl.NumberFormat("ru-RU").format(data.revenueKopecks / 100)} ₽</strong>
          <p>Сумма успешных платежей за всё время. Возвраты отображаются в платёжном журнале.</p>
        </section>
      </div>
    </>
  );
}

function UsersView({
  me,
  data,
  search,
  setSearch,
  reload,
  setNotice,
}: {
  me: AdminMe;
  data: Paginated<AdminUser> | null;
  search: string;
  setSearch: (value: string) => void;
  reload: (page?: number) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const mutate = async (id: string, task: () => Promise<unknown>, success: string) => {
    setBusy(id);
    try {
      await task();
      await reload(data?.page);
      setNotice({ tone: "success", text: success });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Не удалось выполнить действие" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHeader
        title="Пользователи"
        description="Доступ к платформе и операторские роли. Роли внутри аккаунтов управляются отдельно."
        search={search}
        setSearch={setSearch}
        onSearch={() => void reload(1)}
      />
      {!data ? <LoadingState /> : data.items.length ? (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Пользователь</th><th>Аккаунты</th><th>Роль платформы</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id}>
                    <td data-label="Пользователь">
                      <div className="admin-identity">
                        <span>{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
                        <div><strong>{user.name || "Без имени"}</strong><small>{user.email}</small></div>
                      </div>
                    </td>
                    <td data-label="Аккаунты">
                      <strong>{user.memberships.length}</strong>
                      <small>{user.memberships[0]?.workspaceName ?? "Нет аккаунта"}</small>
                    </td>
                    <td data-label="Роль платформы">
                      <select
                        aria-label={`Роль ${user.email}`}
                        value={user.platformRole}
                        disabled={!me.permissions.rolesWrite || user.id === me.id || busy === user.id}
                        onChange={(event) => void mutate(
                          user.id,
                          () => adminApi.updateUserRole(user.id, event.target.value as PlatformRole),
                          "Роль пользователя обновлена",
                        )}
                      >
                        {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td data-label="Статус">
                      <Chip color={statusColor(user.status)} variant="soft">
                        {user.status === "active" ? "Активен" : "Заблокирован"}
                      </Chip>
                    </td>
                    <td data-label="Действия">
                      {user.status === "active" ? (
                        <div className="admin-inline-action">
                          <input
                            aria-label={`Причина блокировки ${user.email}`}
                            placeholder="Причина"
                            value={reason[user.id] ?? ""}
                            onChange={(event) => setReason((current) => ({ ...current, [user.id]: event.target.value }))}
                          />
                          <Button
                            variant="danger-soft"
                            size="sm"
                            isPending={busy === user.id}
                            isDisabled={!me.permissions.usersWrite || user.id === me.id || (reason[user.id]?.trim().length ?? 0) < 3}
                            onPress={() => void mutate(
                              user.id,
                              () => adminApi.updateUserStatus(user.id, "suspended", reason[user.id]),
                              "Доступ пользователя приостановлен",
                            )}
                          >
                            Заблокировать
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          isPending={busy === user.id}
                          isDisabled={!me.permissions.usersWrite}
                          onPress={() => void mutate(
                            user.id,
                            () => adminApi.updateUserStatus(user.id, "active"),
                            "Доступ пользователя восстановлен",
                          )}
                        >
                          Восстановить
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={data} onPage={(page) => void reload(page)} />
        </>
      ) : <EmptyState>Пользователи не найдены</EmptyState>}
    </>
  );
}

function WorkspacesView({
  me,
  data,
  search,
  setSearch,
  reload,
  setNotice,
}: {
  me: AdminMe;
  data: Paginated<AdminWorkspace> | null;
  search: string;
  setSearch: (value: string) => void;
  reload: (page?: number) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, { minutes: string; reason: string }>>({});

  const updateAdjustment = (id: string, patch: Partial<{ minutes: string; reason: string }>) => {
    setAdjustments((current) => ({
      ...current,
      [id]: { minutes: current[id]?.minutes ?? "", reason: current[id]?.reason ?? "", ...patch },
    }));
  };

  const mutate = async (id: string, task: () => Promise<unknown>, success: string) => {
    setBusy(id);
    try {
      await task();
      await reload(data?.page);
      setNotice({ tone: "success", text: success });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Не удалось выполнить действие" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHeader
        title="Аккаунты"
        description="Тариф, баланс и активность workspace без доступа к содержимому пользовательских видео."
        search={search}
        setSearch={setSearch}
        onSearch={() => void reload(1)}
      />
      {!data ? <LoadingState /> : data.items.length ? (
        <>
          <div className="admin-workspace-grid">
            {data.items.map((workspace) => {
              const adjustment = adjustments[workspace.id] ?? { minutes: "", reason: "" };
              const minutes = Number(adjustment.minutes);
              return (
                <article className="admin-workspace-card" key={workspace.id}>
                  <div className="admin-workspace-card__head">
                    <div><strong>{workspace.name}</strong><small>{workspace.slug}</small></div>
                    <Chip color="accent" variant="soft">{planLabels[workspace.planCode]}</Chip>
                  </div>
                  <dl>
                    <div><dt>Баланс</dt><dd>{formatMinutes(workspace.availableSeconds)} мин.</dd></div>
                    <div><dt>Проекты</dt><dd>{workspace.projectCount}</dd></div>
                    <div><dt>Участники</dt><dd>{workspace.memberCount}</dd></div>
                  </dl>
                  <div className="admin-workspace-actions">
                    <label>
                      <span>Тариф</span>
                      <select
                        value={workspace.planCode}
                        disabled={!me.permissions.workspacesWrite || busy === workspace.id}
                        onChange={(event) => void mutate(
                          workspace.id,
                          () => adminApi.updateWorkspacePlan(workspace.id, event.target.value as AdminWorkspace["planCode"]),
                          "Тариф аккаунта обновлён",
                        )}
                      >
                        {Object.entries(planLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <div className="admin-adjustment">
                      <label>
                        <span>Минуты, можно со знаком −</span>
                        <input
                          inputMode="numeric"
                          placeholder="+60"
                          value={adjustment.minutes}
                          onChange={(event) => updateAdjustment(workspace.id, { minutes: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Основание</span>
                        <input
                          placeholder="Компенсация"
                          value={adjustment.reason}
                          onChange={(event) => updateAdjustment(workspace.id, { reason: event.target.value })}
                        />
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        isPending={busy === workspace.id}
                        isDisabled={!me.permissions.minutesWrite || !Number.isFinite(minutes) || minutes === 0 || adjustment.reason.trim().length < 3}
                        onPress={() => void mutate(
                          workspace.id,
                          () => adminApi.adjustMinutes(workspace.id, Math.round(minutes * 60), adjustment.reason),
                          "Баланс скорректирован",
                        )}
                      >
                        Применить
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <Pager data={data} onPage={(page) => void reload(page)} />
        </>
      ) : <EmptyState>Аккаунты не найдены</EmptyState>}
    </>
  );
}

function JobsView({
  me,
  data,
  search,
  setSearch,
  reload,
  setNotice,
}: {
  me: AdminMe;
  data: Paginated<AdminJob> | null;
  search: string;
  setSearch: (value: string) => void;
  reload: (page?: number) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const mutate = async (job: AdminJob, action: "retry" | "cancel") => {
    setBusy(job.id);
    try {
      await adminApi.jobAction(job.id, action);
      await reload(data?.page);
      setNotice({ tone: "success", text: action === "retry" ? "Задача возвращена в очередь" : "Задача отменена" });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Не удалось изменить задачу" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SectionHeader
        title="Очередь"
        description="Состояние фоновых задач. Повтор и отмена всегда фиксируются в журнале."
        search={search}
        setSearch={setSearch}
        onSearch={() => void reload(1)}
      />
      {!data ? <LoadingState /> : data.items.length ? (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--jobs">
              <thead><tr><th>Задача</th><th>Аккаунт / проект</th><th>Попытка</th><th>Статус</th><th>Обновлена</th><th>Действия</th></tr></thead>
              <tbody>
                {data.items.map((job) => (
                  <tr key={job.id}>
                    <td data-label="Задача"><strong>{job.type}</strong><small>{job.class} · {job.id.slice(0, 8)}</small></td>
                    <td data-label="Аккаунт / проект"><strong>{job.workspaceName}</strong><small>{job.projectTitle ?? "Системная задача"}</small></td>
                    <td data-label="Попытка">{job.attemptCount} / {job.maxAttempts}</td>
                    <td data-label="Статус"><Chip color={statusColor(job.status)} variant="soft">{job.status}</Chip></td>
                    <td data-label="Обновлена">{formatDate(job.updatedAt)}</td>
                    <td data-label="Действия">
                      <div className="admin-job-actions">
                        {["failed", "cancelled"].includes(job.status) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            isPending={busy === job.id}
                            isDisabled={!me.permissions.jobsWrite}
                            onPress={() => void mutate(job, "retry")}
                          ><RotateCcw size={14} /> Повторить</Button>
                        ) : null}
                        {["queued", "leased", "waiting_provider"].includes(job.status) ? (
                          <Button
                            variant="danger-soft"
                            size="sm"
                            isPending={busy === job.id}
                            isDisabled={!me.permissions.jobsWrite}
                            onPress={() => void mutate(job, "cancel")}
                          ><X size={14} /> Отменить</Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={data} onPage={(page) => void reload(page)} />
        </>
      ) : <EmptyState>Задачи не найдены</EmptyState>}
    </>
  );
}

function AuditView({
  data,
  search,
  setSearch,
  reload,
}: {
  data: Paginated<AdminAuditEvent> | null;
  search: string;
  setSearch: (value: string) => void;
  reload: (page?: number) => Promise<void>;
}) {
  return (
    <>
      <SectionHeader
        title="Журнал действий"
        description="Неизменяемая история административных операций."
        search={search}
        setSearch={setSearch}
        onSearch={() => void reload(1)}
      />
      {!data ? <LoadingState /> : data.items.length ? (
        <>
          <div className="admin-audit-list">
            {data.items.map((event) => (
              <article key={event.id}>
                <span><ShieldCheck size={17} /></span>
                <div>
                  <strong>{actionLabels[event.action] ?? event.action}</strong>
                  <p>{event.actorEmail ?? "Системный оператор"} · {event.entityType} · {event.entityId.slice(0, 12)}</p>
                </div>
                <time>{formatDate(event.createdAt)}</time>
              </article>
            ))}
          </div>
          <Pager data={data} onPage={(page) => void reload(page)} />
        </>
      ) : <EmptyState>В журнале пока нет событий</EmptyState>}
    </>
  );
}

export function AdminConsole({ initialView = "overview" }: { initialView?: AdminView }) {
  const view = initialView;
  const [menuOpen, setMenuOpen] = useState(false);
  const [me, setMe] = useState<AdminMe | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<Paginated<AdminUser> | null>(null);
  const [workspaces, setWorkspaces] = useState<Paginated<AdminWorkspace> | null>(null);
  const [jobs, setJobs] = useState<Paginated<AdminJob> | null>(null);
  const [audit, setAudit] = useState<Paginated<AdminAuditEvent> | null>(null);
  const [searches, setSearches] = useState<Record<AdminView, string>>({
    overview: "", users: "", workspaces: "", jobs: "", audit: "",
  });
  const [access, setAccess] = useState<"loading" | "ready" | "unconfigured" | "denied">(
    isAdminApiConfigured() ? "loading" : "unconfigured",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!isAdminApiConfigured()) return;
    let active = true;
    void Promise.all([adminApi.me(), adminApi.overview()]).then(([actor, summary]) => {
      if (!active) return;
      setMe(actor);
      setOverview(summary);
      setAccess("ready");
      if (initialView === "users") void adminApi.users("", 1).then(setUsers);
      if (initialView === "workspaces") void adminApi.workspaces("", 1).then(setWorkspaces);
      if (initialView === "jobs") void adminApi.jobs("", 1).then(setJobs);
      if (initialView === "audit") void adminApi.audit("", 1).then(setAudit);
    }).catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Доступ запрещён");
      setAccess("denied");
    });
    return () => {
      active = false;
    };
  }, [initialView]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadUsers = useCallback(async (page = 1) => {
    setUsers(await adminApi.users(searches.users, page));
  }, [searches.users]);
  const loadWorkspaces = useCallback(async (page = 1) => {
    setWorkspaces(await adminApi.workspaces(searches.workspaces, page));
  }, [searches.workspaces]);
  const loadJobs = useCallback(async (page = 1) => {
    setJobs(await adminApi.jobs(searches.jobs, page));
  }, [searches.jobs]);
  const loadAudit = useCallback(async (page = 1) => {
    setAudit(await adminApi.audit(searches.audit, page));
  }, [searches.audit]);

  if (access !== "ready" || !me) {
    return (
      <main className="admin-gate">
        <Link href="/" aria-label="Hashpix — на главную"><Logo priority /></Link>
        <section>
          {access === "loading" ? <LoaderCircle className="admin-gate__spinner" size={28} /> : <ShieldCheck size={30} />}
          <span className="admin-eyebrow">HASHPIX / ADMIN</span>
          <h1>{access === "loading" ? "ПРОВЕРЯЕМ ДОСТУП" : access === "unconfigured" ? "CONTROL API НЕ ПОДКЛЮЧЁН" : "ДОСТУП ЗАКРЫТ"}</h1>
          <p>
            {access === "unconfigured"
              ? "Админ-панель не показывает демонстрационные данные. Подключите российский Control API и задайте PLATFORM_ADMIN_EMAILS."
              : access === "denied"
                ? error
                : "Проверяем активную сессию и платформенную роль."}
          </p>
          <Link className="admin-back-link" href="/dashboard"><ArrowLeft size={17} /> Вернуться в кабинет</Link>
        </section>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="admin-sidebar__brand">
          <Link href="/" aria-label="Hashpix — на главную"><Logo priority /></Link>
          <Chip color="accent" variant="soft">ADMIN</Chip>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"><X size={21} /></button>
        </div>
        <nav aria-label="Разделы админ-панели">
          {views.map(({ id, label, icon: Icon }) => (
            <Link className={view === id ? "is-active" : ""} href={id === "overview" ? "/admin" : `/admin/${id}`} key={id} onClick={() => setMenuOpen(false)}>
              <Icon size={18} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar__spacer" />
        <Link className="admin-dashboard-link" href="/dashboard"><ArrowLeft size={17} /> Кабинет</Link>
        <div className="admin-actor">
          <span>{me.email.slice(0, 1).toUpperCase()}</span>
          <div><strong>{me.email}</strong><small>{roleLabels[me.role]}</small></div>
          <LogOut size={17} />
        </div>
      </aside>
      {menuOpen ? <button className="admin-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню" /> : null}
      <main className="admin-main">
        <header className="admin-mobile-header">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Открыть меню"><Menu size={21} /></button>
          <Logo />
          <Chip color="accent" variant="soft">ADMIN</Chip>
        </header>
        <div className="admin-toolbar">
          <span><ShieldCheck size={16} /> {roleLabels[me.role]}{me.bootstrap ? " · bootstrap" : ""}</span>
          <Button
            variant="outline"
            size="sm"
            onPress={() => {
              if (view === "overview") void adminApi.overview().then(setOverview);
              if (view === "users") void loadUsers(users?.page);
              if (view === "workspaces") void loadWorkspaces(workspaces?.page);
              if (view === "jobs") void loadJobs(jobs?.page);
              if (view === "audit") void loadAudit(audit?.page);
            }}
          ><RefreshCw size={14} /> Обновить</Button>
        </div>
        <div className="admin-content">
          {view === "overview" ? <OverviewView data={overview} /> : null}
          {view === "users" ? (
            <UsersView
              me={me}
              data={users}
              search={searches.users}
              setSearch={(value) => setSearches((current) => ({ ...current, users: value }))}
              reload={loadUsers}
              setNotice={setNotice}
            />
          ) : null}
          {view === "workspaces" ? (
            <WorkspacesView
              me={me}
              data={workspaces}
              search={searches.workspaces}
              setSearch={(value) => setSearches((current) => ({ ...current, workspaces: value }))}
              reload={loadWorkspaces}
              setNotice={setNotice}
            />
          ) : null}
          {view === "jobs" ? (
            <JobsView
              me={me}
              data={jobs}
              search={searches.jobs}
              setSearch={(value) => setSearches((current) => ({ ...current, jobs: value }))}
              reload={loadJobs}
              setNotice={setNotice}
            />
          ) : null}
          {view === "audit" ? (
            <AuditView
              data={audit}
              search={searches.audit}
              setSearch={(value) => setSearches((current) => ({ ...current, audit: value }))}
              reload={loadAudit}
            />
          ) : null}
        </div>
      </main>
      {notice ? <div className={`admin-notice is-${notice.tone}`} role="status">{notice.tone === "success" ? <Check size={16} /> : <Ban size={16} />}{notice.text}</div> : null}
    </div>
  );
}
