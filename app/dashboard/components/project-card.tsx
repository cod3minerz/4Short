import { ArrowRight, FileVideo, Youtube } from "lucide-react";
import Link from "next/link";
import { projectStatus } from "../data";
import type { Project } from "../types";

export function ProjectCard({ project, compact = false }: { project: Project; compact?: boolean }) {
  const status = projectStatus[project.status];
  const href =
    project.id === "podcast-24"
      ? `/dashboard/projects/${project.id}`
      : `/dashboard/projects/${project.id}`;

  return (
    <Link className={`dash-project-card ${compact ? "is-compact" : ""}`} href={href}>
      <div className={`dash-project-card__media tone-${project.accent}`}>
        <span className="dash-project-card__source">
          {project.source === "YouTube" ? <Youtube size={15} /> : <FileVideo size={15} />}
          {project.source}
        </span>
        <span className="dash-project-card__duration">{project.duration}</span>
        <span className="dash-media-mark" aria-hidden="true">4S</span>
      </div>
      <div className="dash-project-card__body">
        <div className="dash-project-card__meta">
          <span className={`dash-status tone-${status.tone}`}>{status.label}</span>
          <time>{project.updatedAt}</time>
        </div>
        <h3>{project.title}</h3>
        <p>
          {project.clipsFound
            ? `${project.clipsFound} моментов · ${project.clipsReady} клипов готово`
            : `Стиль: ${project.style}`}
        </p>
        <span className="dash-project-card__action">
          {status.action}
          <ArrowRight size={16} />
        </span>
      </div>
    </Link>
  );
}

