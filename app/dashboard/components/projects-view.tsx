"use client";

import { Button, Card, Dropdown, Label, Modal, SearchField, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Add01Icon, Cancel01Icon, Delete02Icon, FileVideoIcon, HardDriveIcon, MoreHorizontalIcon, Search01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { isProjectJobQueued } from "../lib/project-status";
import { refreshProjects, refreshStorage, removeProject, useDashboardStore } from "../store";
import type { Project, ProjectStatus } from "../types";
import { projectStatus } from "../data";

type Filter = "all" | "active" | "review" | "ready" | "failed";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "active", label: "В обработке" },
  { id: "review", label: "Проверка" },
  { id: "ready", label: "Готовы" },
  { id: "failed", label: "Ошибки" },
];

const groups: Record<Exclude<Filter, "all">, ProjectStatus[]> = {
  active: ["uploading", "importing", "probing", "transcribing", "finding_moments", "rendering"],
  review: ["review_required"],
  ready: ["ready", "partially_ready"],
  failed: ["failed"],
};

export function ProjectsView() {
  const { projects, connection, error, storage } = useDashboardStore();
  const hasProcessingProject = projects.some((project) => groups.active.includes(project.status));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (connection !== "connected") return;
    void refreshProjects();
    void refreshStorage();
    if (!hasProcessingProject) return;
    const timer = window.setInterval(() => void refreshProjects(), 5_000);
    return () => window.clearInterval(timer);
  }, [connection, hasProcessingProject]);

  const visible = useMemo(() => projects.filter((project) =>
    (filter === "all" || groups[filter].includes(project.status)) &&
    project.title.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"))), [projects, filter, query]);
  const counts = useMemo(() => Object.fromEntries(filters.map(({ id }) => [
    id,
    id === "all" ? projects.length : projects.filter((project) => groups[id].includes(project.status)).length,
  ])) as Record<Filter, number>, [projects]);
  const clearFilters = () => { setFilter("all"); setQuery(""); };

  async function confirmDelete() {
    if (!projectToDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await removeProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch {
      setDeleteError("Не удалось удалить проект. Попробуйте ещё раз.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="hp-projects" aria-labelledby="hp-projects-title">
      <header className="hp-projects__header">
        <div>
          <h1 id="hp-projects-title">Мои проекты</h1>
        </div>
        {storage ? (
          <div className="hp-projects__storage" aria-label="Использование хранилища">
            <AppIcon icon={HardDriveIcon} size="sm" aria-hidden="true" />
            <span>Хранилище</span>
            <strong>{formatBytes(storage.usedBytes)}</strong>
            <span className="hp-projects__storage-separator">из</span>
            <strong>{formatBytes(storage.limitBytes)}</strong>
            {storage.blocked ? <span className="hp-projects__storage-warning">Загрузка приостановлена</span> : null}
          </div>
        ) : null}
      </header>

      {connection === "error" ? <div className="hp-projects__error" role="alert"><span>{error ?? "Не удалось загрузить проекты."}</span><Button variant="secondary" size="sm" onPress={() => window.location.reload()}>Повторить</Button></div> : null}

      <section className="hp-projects__tools" aria-label="Поиск и фильтры проектов">
        <ToggleButtonGroup
          aria-label="Фильтры проектов"
          className="hp-projects__filters"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={new Set([filter])}
          onSelectionChange={(keys) => {
            const selected = [...keys][0];
            if (selected !== undefined) setFilter(String(selected) as Filter);
          }}
        >
          {filters.map(({ id, label }) => (
            <ToggleButton className="hp-projects__filter" key={id} id={id}>
              <span>{label}</span><span className="hp-projects__count">{counts[id]}</span>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <SearchField aria-label="Найти проект" className="hp-projects__search" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon><AppIcon icon={Search01Icon} size="sm" aria-hidden="true" /></SearchField.SearchIcon>
            <SearchField.Input placeholder="Поиск проектов" />
            <SearchField.ClearButton aria-label="Очистить поиск" />
          </SearchField.Group>
        </SearchField>
      </section>

      {connection === "loading" ? <ProjectSkeletons /> : null}

      {connection !== "loading" && connection !== "error" ? (
        <section className="hp-projects__grid" aria-label="Список проектов" aria-live="polite">
          <Link className="hp-projects__add" href="/dashboard" aria-label="Добавить новое видео">
            <span className="hp-projects__add-icon"><AppIcon icon={Add01Icon} size="md" aria-hidden="true" /></span>
            <span className="hp-projects__add-title">Новое видео</span>
            <span className="hp-projects__add-copy">Загрузить файл или вставить ссылку</span>
          </Link>

          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={() => { setDeleteError(""); setProjectToDelete(project); }} />
          ))}
        </section>
      ) : null}

      {connection !== "loading" && connection !== "error" && projects.length === 0 ? (
        <p className="hp-projects__empty-copy">Загруженные видео и результаты обработки появятся здесь.</p>
      ) : null}

      {connection !== "loading" && connection !== "error" && projects.length > 0 && visible.length === 0 ? (
        <div className="hp-projects__no-results">
          <AppIcon icon={Search01Icon} size="md" aria-hidden="true" />
          <strong>Ничего не найдено</strong>
          <span>Попробуйте изменить фильтр или поисковый запрос.</span>
          <Button variant="tertiary" size="sm" onPress={clearFilters}>Сбросить поиск</Button>
        </div>
      ) : null}

      <Modal isOpen={Boolean(projectToDelete)} onOpenChange={(open) => { if (!open && !deleting) setProjectToDelete(null); }}>
        <Button className="hp-projects__modal-anchor" aria-hidden="true" isDisabled />
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="hp-projects__delete-dialog" aria-labelledby="hp-project-delete-title">
              <Modal.Header>
                <Modal.Heading id="hp-project-delete-title">Удалить проект?</Modal.Heading>
                <Modal.CloseTrigger aria-label="Закрыть"><AppIcon icon={Cancel01Icon} size="sm" aria-hidden="true" /></Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body>
                <p>«{projectToDelete?.title}» исчезнет из списка. Активная обработка остановится, а файлы проекта перестанут занимать место.</p>
                {deleteError ? <p className="hp-projects__delete-error" role="alert">{deleteError}</p> : null}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" isDisabled={deleting} onPress={() => setProjectToDelete(null)}>Отменить</Button>
                <Button variant="danger" isPending={deleting} onPress={() => void confirmDelete()}>{deleting ? "Удаляем…" : "Удалить проект"}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </main>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const state = projectStatus[project.status] ?? projectStatus.failed;
  const active = groups.active.includes(project.status);
  const ready = project.status === "ready" || project.status === "partially_ready";
  const queued = isProjectJobQueued(project.status, project.processing?.status);
  const completed = project.processing?.progress?.completed;
  const total = project.processing?.progress?.total;
  const measuredProgress = active && typeof completed === "number" && typeof total === "number" && total > 0
    ? Math.round(Math.max(0, Math.min(total, completed)) / total * 100)
    : null;
  const statusLabel = queued ? "В очереди" : state.label;
  const previewLabel = project.thumbnailUrl ? "" : "Обложка не добавлена";
  const clipsAvailable = project.clipsAvailable ?? project.clipsReady;
  const unavailableClips = Math.max(0, project.clipsReady - clipsAvailable);
  const clipsSummary = clipsAvailable > 0
    ? `${clipsAvailable}${(project.clipsTotal ?? project.clipsFound) > clipsAvailable ? ` из ${project.clipsTotal ?? project.clipsFound} клипов доступно` : ` ${pluralize(clipsAvailable, "клип доступен", "клипа доступны", "клипов доступно")}`}`
    : unavailableClips > 0
      ? `${unavailableClips} ${pluralize(unavailableClips, "файл недоступен", "файла недоступны", "файлов недоступно")}`
    : (project.clipsFailed ?? 0) > 0
      ? `${project.clipsFailed} ${pluralize(project.clipsFailed ?? 0, "клип с ошибкой", "клипа с ошибкой", "клипов с ошибкой")}`
    : project.status === "review_required" && project.clipsFound > 0
      ? `${project.clipsFound} моментов ждут проверки`
      : project.clipsFound > 0
        ? `${project.clipsFound} ${pluralize(project.clipsFound, "момент", "момента", "моментов")}`
        : project.duration;

  return (
    <Card className="hp-projects__card" variant="transparent">
      <Link className="hp-projects__card-link" href={`/dashboard/projects/${project.id}`} aria-label={`${project.title}. ${statusLabel}${measuredProgress === null ? "" : `, ${measuredProgress}%`}. Открыть проект`}>
        <div className="hp-projects__card-media">
          {project.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Signed thumbnails come from the control API.
            <img src={project.thumbnailUrl} alt="" loading="lazy" />
          ) : (
            <span className="hp-projects__no-thumb"><AppIcon icon={FileVideoIcon} size="lg" aria-hidden="true" />{previewLabel}</span>
          )}
          <span className={`hp-projects__status ${active ? "is-active" : ready ? "is-ready" : project.status === "failed" ? "is-failed" : ""}`}>
            {active ? <span className="hp-projects__status-dot" aria-hidden="true" /> : null}
            {statusLabel}{measuredProgress === null ? "" : ` · ${measuredProgress}%`}
          </span>
          {measuredProgress !== null ? <span className="hp-projects__progress" role="progressbar" aria-label="Прогресс обработки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={measuredProgress}><span style={{ width: `${measuredProgress}%` }} /></span> : null}
          {ready && clipsAvailable > 0 ? <span className="hp-projects__clip-count">{clipsAvailable} {pluralize(clipsAvailable, "клип", "клипа", "клипов")}</span> : null}
        </div>
        <Card.Header className="hp-projects__card-header">
          <Card.Title className="hp-projects__card-title">{project.title}</Card.Title>
          <Card.Description className="hp-projects__card-meta">
            <span>{clipsSummary}</span><span aria-hidden="true">·</span>
            <span>{project.source === "YouTube" ? "YouTube" : "Файл"}</span><span aria-hidden="true">·</span>
            <time>{project.updatedAt}</time>
          </Card.Description>
        </Card.Header>
        {project.sourceAvailable === false ? <span className="hp-projects__card-detail">Исходное видео недоступно</span>
          : project.sourceExpiresAt ? <span className="hp-projects__card-retention">Исходное видео доступно до {formatRetentionDate(project.sourceExpiresAt)}</span> : null}
        {project.status === "failed" ? <span className="hp-projects__card-detail">Откройте проект, чтобы проверить ошибку</span> : null}
      </Link>
      <Dropdown>
        <Button className="hp-projects__menu-trigger" variant="tertiary" isIconOnly aria-label={`Действия проекта «${project.title}»`}>
          <AppIcon icon={MoreHorizontalIcon} size="sm" aria-hidden="true" />
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu aria-label={`Действия проекта «${project.title}»`} onAction={(key) => { if (key === "delete") onDelete(); }}>
            <Dropdown.Item id="delete" textValue="Удалить проект" variant="danger">
              <AppIcon icon={Delete02Icon} size="sm" aria-hidden="true" /><Label>Удалить проект</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </Card>
  );
}

function ProjectSkeletons() {
  return <div className="hp-projects__grid" aria-label="Загружаем проекты" role="status">
    {Array.from({ length: 3 }, (_, index) => <div className="hp-project-skeleton" key={index}><span /><i /><i /></div>)}
  </div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 3) return `${Math.max(0, bytes / 1024 ** 2).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${(bytes / 1024 ** 3).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`;
}

function pluralize(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatRetentionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "указанной даты";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}
