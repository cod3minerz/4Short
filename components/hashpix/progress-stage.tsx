"use client";

import { Progress, ProgressIndicator } from "@/components/ui/progress";
import { typographyVariants } from "./typography";

interface ProgressStageProps {
  /** Human title of the current stage, e.g. "Загружаем видео". */
  title: string;
  /** 1-indexed current stage. */
  current: number;
  /** Total real stage count — driven by `processingStages.length` in `new-project-wizard.tsx`, never a hardcoded number. */
  total: number;
  /** Explanatory sentence, e.g. "Подключаемся к источнику. Первые данные могут появиться не сразу." */
  description: string;
  /** Real metric when the backend provides one, e.g. "Скачано 298,5 МБ" — omit rather than fake it. */
  metric?: string;
  /** 0-100, or undefined for an indeterminate stage. */
  percent?: number;
  secondsInStage?: number;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} сек`;
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`;
}

/**
 * The processing-screen stage card. `total` must reflect the real pipeline
 * (`new-project-wizard.tsx`'s `processingStages`) — never hardcode a stage
 * count to match a reference screenshot from a different product's pipeline.
 */
export function ProgressStage({ title, current, total, description, metric, percent, secondsInStage }: ProgressStageProps) {
  return (
    <section className="flex w-full flex-col gap-3 text-left" aria-live="polite">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={typographyVariants({ role: "label" })}>{title}</span>
        <span className={typographyVariants({ role: "caption" })}>Этап {current} из {total}</span>
      </header>
      {percent !== undefined ? (
        <Progress value={percent} aria-label={`Выполнено ${Math.round(percent)}%`}><ProgressIndicator /></Progress>
      ) : null}
      <p className={typographyVariants({ role: "muted" })}>{description}</p>
      <footer className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Обработка идёт</span>
        {metric ? <span>{metric}</span> : null}
        {secondsInStage !== undefined ? <span>Этап начат {formatDuration(secondsInStage)} назад</span> : null}
        <span>Статус обновится автоматически</span>
        <span>Эту страницу можно закрыть — обработка продолжится</span>
      </footer>
    </section>
  );
}
