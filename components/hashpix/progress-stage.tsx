"use client";

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
    <section className="progress-stage" aria-live="polite">
      <header className="progress-stage__head">
        <div>
          <strong>{title}</strong>
          <span className="progress-stage__count">Этап {current} из {total}</span>
        </div>
      </header>
      {percent !== undefined ? (
        <div className="progress-stage__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-stage__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
      ) : null}
      <p className="progress-stage__description">{description}</p>
      <footer className="progress-stage__footer">
        <span className="progress-stage__status">
          <i className="progress-stage__dot" aria-hidden="true" />
          Обработка идёт
        </span>
        {metric ? <span>{metric}</span> : null}
        {secondsInStage !== undefined ? <span>Этап начат {formatDuration(secondsInStage)} назад</span> : null}
        <span>Статус обновится автоматически</span>
        <span>Эту страницу можно закрыть — обработка продолжится</span>
      </footer>
    </section>
  );
}
