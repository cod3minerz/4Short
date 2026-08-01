"use client";

import { Button } from "@heroui/react";
import { FileVideo, HardDrive, Plus, Search, Trash2, Youtube } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { projectStatus } from "../data";
import { handleTablistKeyDown } from "../lib/a11y";
import { removeProject, useDashboardStore } from "../store";
import type { Project, ProjectStatus } from "../types";
import { PageHeading } from "./page-heading";
import { Dialog } from "./ui/Dialog";

type Filter = "all" | "active" | "review" | "ready" | "failed";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "active", label: "В работе" },
  { id: "review", label: "Проверить" },
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
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const visible = useMemo(
    () => projects.filter((project) => {
      const matchesFilter = filter === "all" || groups[filter].includes(project.status);
      return matchesFilter && project.title.toLowerCase().includes(query.toLowerCase());
    }),
    [projects, filter, query],
  );

  return (
    <main className="dash-page">
      <PageHeading
        title="Проекты"
        description="Исходники, найденные моменты и готовые клипы."
        actions={<Link className="dash-compact-primary" href="/dashboard"><Plus size={16} /> Новое видео</Link>}
      />

      {connection !== "connected" ? (
        <div className={`dashboard-connection-notice is-${connection}`} role="status">
          <strong>{connection === "preview" ? "Демо-режим" : connection === "loading" ? "Подключаем кабинет" : "Сервис временно недоступен"}</strong>
          <span>
            {connection === "preview"
              ? "Показаны примеры проектов. После входа здесь появятся ваши исходники и готовые клипы."
              : error ?? "Загружаем ваши проекты."}
          </span>
        </div>
      ) : null}

      {storage ? (
        <section className={`project-storage ${storage.blocked ? "is-blocked" : ""}`} aria-label="Хранилище">
          <span className="project-storage__icon"><HardDrive size={17} /></span>
          <div className="project-storage__body">
            <span><strong>Хранилище</strong><small>{formatBytes(storage.usedBytes)} из {formatBytes(storage.limitBytes)}</small></span>
            <span className="project-storage__track" aria-hidden="true"><i style={{ width: `${Math.max(1, storage.usagePercent)}%` }} /></span>
          </div>
          <small>{storage.blocked ? "Новые загрузки приостановлены" : `Свободно ${formatBytes(storage.availableBytes)}`}</small>
        </section>
      ) : null}

      <div className="dash-project-toolbar">
        <div className="dash-filter-row" role="tablist" aria-label="Фильтры проектов" onKeyDown={handleTablistKeyDown}>
          {filters.map((item) => (
            <button
              role="tab"
              aria-selected={filter === item.id}
              tabIndex={filter === item.id ? 0 : -1}
              className={filter === item.id ? "is-active" : ""}
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="dash-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Найти проект</span>
          <input
            placeholder="Поиск"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {visible.length ? (
        <div className="project-list">
          <div className="project-list__head" aria-hidden="true">
            <span>Проект</span><span>Статус</span><span>Результат</span><span>Обновлён</span><span />
          </div>
          {visible.map((project) => {
            const status = projectStatus[project.status] ?? projectStatus.failed;
            return (
              <article className="project-row" key={project.id}>
                <Link className="project-row__main" href={`/dashboard/projects/${project.id}`}>
                  <span className={`project-row__thumb tone-${project.accent}`}>
                    <span className="dash-media-mark">HP</span>
                  </span>
                  <span className="project-row__identity">
                    <strong>{project.title}</strong>
                    <small>
                      {project.source === "YouTube" ? <Youtube size={13} /> : <FileVideo size={13} />}
                      {project.source} · {project.duration}
                    </small>
                  </span>
                </Link>
                <span className={`project-row__status tone-${status.tone}`}><i />{status.label}</span>
                <span className="project-row__result">
                  <strong>{project.clipsReady} готово</strong>
                  <small>{project.clipsFound} моментов</small>
                </span>
                <time>{project.updatedAt}</time>
                <button
                  className="project-row__delete"
                  type="button"
                  aria-label={`Удалить проект «${project.title}»`}
                  onClick={() => { setDeleteError(""); setProjectToDelete(project); }}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="dash-empty-state">
          <Search size={24} />
          <h2>Проекты не найдены</h2>
          <p>Измените запрос или очистите фильтр.</p>
          <button type="button" onClick={() => { setFilter("all"); setQuery(""); }}>Показать все</button>
        </div>
      )}

      <Dialog
        isOpen={Boolean(projectToDelete)}
        onOpenChange={(open) => { if (!open && !deleting) setProjectToDelete(null); }}
        title="Удалить проект?"
        description="Действие нельзя отменить."
        footer={(
          <>
            <Button variant="outline" isDisabled={deleting} onPress={() => setProjectToDelete(null)}>Отменить</Button>
            <Button
              variant="danger"
              isPending={deleting}
              onPress={async () => {
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
              }}
            >Удалить</Button>
          </>
        )}
      >
        <p className="project-delete-copy">
          «{projectToDelete?.title}» исчезнет из списка, активная обработка остановится, а его файлы перестанут занимать место. Общий исходник сохранится, если используется в другом проекте.
        </p>
        {deleteError ? <p className="dash-field-error" role="alert">{deleteError}</p> : null}
      </Dialog>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 3) return `${Math.max(0, bytes / 1024 ** 2).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${(bytes / 1024 ** 3).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`;
}
