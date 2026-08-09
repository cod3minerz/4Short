"use client";

import { Delete02Icon, FileVideoIcon, HardDriveIcon, PlusSignIcon, Search01Icon, YoutubeIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { AsyncButton } from "@/components/hashpix/async-button";
import { EmptyState } from "@/components/hashpix/empty-state";
import { MediaThumb } from "@/components/hashpix/media-thumb";
import { PageHeader } from "@/components/hashpix/page-header";
import { StatusBadge } from "@/components/hashpix/status-badge";
import { typographyVariants } from "@/components/hashpix/typography";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressIndicator } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { projectStatus } from "../data";
import { removeProject, useDashboardStore } from "../store";
import type { Project, ProjectStatus } from "../types";

type Filter = "all" | "active" | "review" | "ready" | "failed";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Все" }, { id: "active", label: "В работе" }, { id: "review", label: "Проверить" }, { id: "ready", label: "Готовы" }, { id: "failed", label: "Ошибки" },
];

const groups: Record<Exclude<Filter, "all">, ProjectStatus[]> = {
  active: ["uploading", "importing", "probing", "transcribing", "finding_moments", "rendering"],
  review: ["review_required"], ready: ["ready", "partially_ready"], failed: ["failed"],
};

const toneByStatus: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = { success: "success", accent: "accent", warning: "warning", danger: "danger", neutral: "neutral" };

export function ProjectsView() {
  const { projects, connection, error, storage } = useDashboardStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const visible = useMemo(() => projects.filter((project) => (filter === "all" || groups[filter].includes(project.status)) && project.title.toLowerCase().includes(query.toLowerCase())), [projects, filter, query]);
  const clearFilters = () => { setFilter("all"); setQuery(""); };

  return (
    <main className="dash-page">
      <PageHeader title="Проекты" description="Исходники, найденные моменты и готовые клипы." actions={<Button nativeButton={false} render={<Link href="/dashboard" />}><AppIcon icon={PlusSignIcon} size="sm" aria-hidden="true" />Новое видео</Button>} />

      {connection !== "connected" ? <Card className="dashboard-connection-notice" role="status"><CardContent><span className={typographyVariants({ role: "label" })}>{connection === "preview" ? "Демо-режим" : connection === "loading" ? "Подключаем кабинет" : "Сервис временно недоступен"}</span><span className={typographyVariants({ role: "muted" })}>{connection === "preview" ? "Показаны примеры проектов. После входа здесь появятся ваши исходники и готовые клипы." : error ?? "Загружаем ваши проекты."}</span></CardContent></Card> : null}

      {storage ? (
        <Card className="project-storage px-(--card-spacing)" aria-label="Хранилище">
          <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground"><AppIcon icon={HardDriveIcon} size="sm" aria-hidden="true" /></span>
          <div className="project-storage__body">
            <span><strong>Хранилище</strong><small>{formatBytes(storage.usedBytes)} из {formatBytes(storage.limitBytes)}</small></span>
            <Progress value={storage.usagePercent} aria-label={`Использовано ${storage.usagePercent}%`}><ProgressIndicator className={storage.blocked ? "bg-destructive" : undefined} /></Progress>
          </div>
          <StatusBadge tone={storage.blocked ? "danger" : "neutral"}>{storage.blocked ? "Новые загрузки приостановлены" : `Свободно ${formatBytes(storage.availableBytes)}`}</StatusBadge>
        </Card>
      ) : null}

      <div className="dash-project-toolbar">
        <ToggleGroup className="max-w-full overflow-x-auto" aria-label="Фильтры проектов" value={[filter]} onValueChange={(next) => { const selected = next[0] as Filter | undefined; if (selected) setFilter(selected); }} variant="outline" spacing={0}>
          {filters.map((item) => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <Field className="relative w-full sm:w-55">
          <FieldLabel className="sr-only" htmlFor="project-search">Найти проект</FieldLabel>
          <AppIcon icon={Search01Icon} size="sm" className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground" aria-hidden="true" />
          <Input id="project-search" className="pl-9" placeholder="Поиск" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
      </div>

      {connection === "loading" ? <ProjectSkeletons /> : null}
      {connection !== "loading" && visible.length ? (
        <div className="project-list">
          <div className="project-list__head" aria-hidden="true"><span>Проект</span><span>Статус</span><span>Результат</span><span>Обновлён</span><span /></div>
          {visible.map((project) => <ProjectRow key={project.id} project={project} onDelete={() => { setDeleteError(""); setProjectToDelete(project); }} />)}
        </div>
      ) : null}
      {connection !== "loading" && !visible.length ? <Card className="min-h-90 items-center justify-center px-(--card-spacing)"><CardContent className="items-center text-center"><EmptyState icon={<AppIcon icon={Search01Icon} size="lg" />} title="Проекты не найдены" description="Измените запрос или очистите фильтр." actions={<Button variant="outline" onClick={clearFilters}>Показать все</Button>} /></CardContent></Card> : null}

      <Dialog open={Boolean(projectToDelete)} onOpenChange={(open) => { if (!open && !deleting) setProjectToDelete(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Удалить проект?</DialogTitle><DialogDescription>Действие нельзя отменить.</DialogDescription></DialogHeader>
          <p className="project-delete-copy">«{projectToDelete?.title}» исчезнет из списка, активная обработка остановится, а его файлы перестанут занимать место. Общий исходник сохранится, если используется в другом проекте.</p>
          {deleteError ? <p className="text-sm text-destructive" role="alert">{deleteError}</p> : null}
          <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setProjectToDelete(null)}>Отменить</Button><AsyncButton variant="destructive" loading={deleting} onClick={async () => { if (!projectToDelete) return; setDeleting(true); setDeleteError(""); try { await removeProject(projectToDelete.id); setProjectToDelete(null); } catch { setDeleteError("Не удалось удалить проект. Попробуйте ещё раз."); } finally { setDeleting(false); } }}>Удалить</AsyncButton></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ProjectRow({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const status = projectStatus[project.status] ?? projectStatus.failed;
  return <article className="project-row">
    <Link className="project-row__main" href={`/dashboard/projects/${project.id}`}>
      <MediaThumb className="project-row__thumb" src={project.thumbnailUrl ?? undefined} alt={project.title} tone="ink" />
      <span className="project-row__identity"><CardTitle>{project.title}</CardTitle><span className={typographyVariants({ role: "caption" })}><AppIcon icon={project.source === "YouTube" ? YoutubeIcon : FileVideoIcon} size="sm" aria-hidden="true" />{project.source} · {project.duration}</span></span>
    </Link>
    <StatusBadge tone={toneByStatus[status.tone] ?? "neutral"}>{status.label}</StatusBadge>
    <span className="project-row__result"><span className={typographyVariants({ role: "label" })}>{project.clipsReady} готово</span><span className={typographyVariants({ role: "caption" })}>{project.clipsFound} моментов</span></span>
    <time className={typographyVariants({ role: "caption" })}>{project.updatedAt}</time>
    <Tooltip><TooltipTrigger render={<Button className="project-row__delete" variant="ghost" size="icon" type="button" aria-label={`Удалить проект «${project.title}»`} onClick={onDelete}><AppIcon icon={Delete02Icon} size="sm" aria-hidden="true" /></Button>} /><TooltipContent>Удалить проект</TooltipContent></Tooltip>
  </article>;
}

function ProjectSkeletons() { return <div className="project-list">{Array.from({ length: 3 }, (_, index) => <div className="project-row" key={index}><Skeleton className="h-14 w-24" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-5 w-20" /></div>)}</div>; }

function formatBytes(bytes: number) { if (bytes < 1024 ** 3) return `${Math.max(0, bytes / 1024 ** 2).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`; return `${(bytes / 1024 ** 3).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`; }
