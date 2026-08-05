import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { processingStages } from "../../lib/processing-stages";
import { MediaThumb } from "./MediaThumb";
import { ProgressStage } from "./ProgressStage";

interface ProcessingCardAction {
  completedHref: string;
  completedLabel: string;
  fallbackHref: string;
  fallbackLabel: string;
}

interface ProcessingCardProps {
  sourceName: string;
  sourceThumbnail?: string | null;
  /** Real backend project_status — drives the completed/failed/in-progress sub-state. */
  status: string | null;
  processingIndex: number;
  secondsInStage: number;
  progress?: { completed?: number; total?: number; unit?: "bytes" | "milliseconds" | "frames" | "steps" } | null;
  errorMessage?: string;
  /** Omit on pages that already sit on the project (no "go check it out" link needed). */
  action?: ProcessingCardAction;
}

/**
 * The processing-screen card: spinner mark, heading, source row and live
 * stage progress. Shared between the wizard's step-4 screen and the project
 * detail page so both look and behave identically while a project is being
 * analyzed — see `useProjectProcessing` for the live status/timing behind it.
 */
export function ProcessingCard({
  sourceName,
  sourceThumbnail,
  status,
  processingIndex,
  secondsInStage,
  progress,
  errorMessage,
  action,
}: ProcessingCardProps) {
  const completed = status === "review_required";
  const failed = status === "failed";
  const stage = processingStages[Math.min(processingIndex, processingStages.length - 1)];
  const inProgressHeading = stage?.title ?? "Обрабатываем видео";
  const transferredBytes = progress?.unit === "bytes" && typeof progress.completed === "number" ? progress.completed : null;
  const metric = transferredBytes !== null
    ? `Получено ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1, notation: "compact", style: "unit", unit: "megabyte", unitDisplay: "short" }).format(transferredBytes / (1024 * 1024))}`
    : undefined;
  const percent = progress?.total && typeof progress.completed === "number"
    ? (progress.completed / progress.total) * 100
    : undefined;

  return (
    <div className="wizard-processing__card">
      <div className={`wizard-processing__mark ${completed ? "is-complete" : failed ? "is-failed" : ""}`}>
        {completed ? <Check size={32} /> : failed ? <span aria-hidden="true">!</span> : <LoaderCircle size={32} />}
      </div>
      <span className="dash-eyebrow">{completed ? "Анализ завершён" : failed ? "Нужна помощь" : "Можно закрыть страницу"}</span>
      <h1>{completed ? "Моменты готовы к проверке" : failed ? "Обработка остановлена" : inProgressHeading}</h1>
      <p>
        {completed
          ? "Мы нашли самостоятельные фрагменты. Выберите те, из которых нужно создать клипы."
          : failed
            ? "Откройте проект: там указан этап ошибки и доступное действие."
            : `${stage?.description ?? "Hashpix продолжает работу в фоне."} Страницу можно закрыть — состояние сохранится.`}
      </p>

      <div className="wizard-processing__source">
        <MediaThumb src={sourceThumbnail ?? undefined} alt={sourceName} />
        <div>
          <strong>{sourceName}</strong>
          <small>{completed ? "Обработка завершена" : failed ? "Обработка остановлена" : "Можно закрыть вкладку — работа продолжится"}</small>
        </div>
      </div>

      {!completed && !failed ? (
        <>
          <ProgressStage
            title={stage.title}
            description={stage.description}
            current={Math.min(processingIndex, processingStages.length - 1) + 1}
            total={processingStages.length}
            secondsInStage={secondsInStage}
            metric={metric}
            percent={percent}
          />
          <p className="wizard-processing__truth">
            Варианты клипов появятся только после завершения анализа — мы не
            показываем фиктивные карточки до того, как их реально нашли.
          </p>
        </>
      ) : null}

      {errorMessage ? <span className="dash-field-error" role="alert">{errorMessage}</span> : null}

      {action ? (
        completed ? (
          <Link className="dash-primary-link wizard-processing__action" href={action.completedHref}>
            {action.completedLabel}
            <ArrowRight size={18} />
          </Link>
        ) : (
          <Link className="dash-secondary-link wizard-processing__action" href={action.fallbackHref}>
            {action.fallbackLabel}
          </Link>
        )
      ) : null}
    </div>
  );
}
