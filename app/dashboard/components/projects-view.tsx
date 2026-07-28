"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { projects } from "../data";
import type { ProjectStatus } from "../types";
import { PageHeading } from "./page-heading";
import { ProjectCard } from "./project-card";

type Filter = "all" | "active" | "review" | "ready" | "failed";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "active", label: "В обработке" },
  { id: "review", label: "Нужна проверка" },
  { id: "ready", label: "Готовы" },
  { id: "failed", label: "С ошибкой" },
];

const groups: Record<Exclude<Filter, "all">, ProjectStatus[]> = {
  active: ["uploading", "transcribing", "finding_moments", "rendering"],
  review: ["review_required"],
  ready: ["ready", "partially_ready"],
  failed: ["failed"],
};

export function ProjectsView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () =>
      projects.filter((project) => {
        const matchesFilter = filter === "all" || groups[filter].includes(project.status);
        const matchesQuery = project.title.toLowerCase().includes(query.toLowerCase());
        return matchesFilter && matchesQuery;
      }),
    [filter, query],
  );

  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Библиотека"
        title="ПРОЕКТЫ"
        description="Все исходники, найденные моменты и готовые серии клипов."
      />

      <div className="dash-project-toolbar">
        <div className="dash-filter-row" role="tablist" aria-label="Фильтры проектов">
          {filters.map((item) => (
            <button
              role="tab"
              aria-selected={filter === item.id}
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
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Найти проект</span>
          <input
            placeholder="Найти проект"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {visible.length ? (
        <div className="dash-project-grid dash-project-grid--library">
          {visible.map((project) => <ProjectCard project={project} key={project.id} />)}
        </div>
      ) : (
        <div className="dash-empty-state">
          <Search size={26} />
          <h2>Ничего не найдено</h2>
          <p>Попробуйте другой запрос или сбросьте фильтр.</p>
          <button type="button" onClick={() => { setFilter("all"); setQuery(""); }}>Показать все</button>
        </div>
      )}
    </main>
  );
}

