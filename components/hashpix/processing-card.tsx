import { ArrowRight01Icon, CheckmarkCircle01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { processingStages } from "@/app/dashboard/lib/processing-stages";
import { AppIcon } from "./app-icon";
import { MediaThumb } from "./media-thumb";
import { ProgressStage } from "./progress-stage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionDescription, SectionTitle, typographyVariants } from "./typography";

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
    <Card className="mx-auto w-full max-w-2xl">
      <CardContent className="items-center text-center">
        <div className="grid size-12 place-items-center rounded-md bg-muted text-muted-foreground">
          {completed ? <AppIcon icon={CheckmarkCircle01Icon} size="lg" className="text-primary" aria-hidden="true" /> : failed ? <span className="text-lg font-medium text-destructive" aria-hidden="true">!</span> : <AppIcon icon={Refresh01Icon} size="lg" className="animate-spin" aria-hidden="true" />}
        </div>
        <span className={typographyVariants({ role: "caption" })}>{completed ? "Анализ завершён" : failed ? "Нужна помощь" : "Можно закрыть страницу"}</span>
        <SectionTitle>{completed ? "Моменты готовы к проверке" : failed ? "Обработка остановлена" : inProgressHeading}</SectionTitle>
        <SectionDescription>
        {completed
          ? "Мы нашли самостоятельные фрагменты. Выберите те, из которых нужно создать клипы."
          : failed
            ? "Откройте проект: там указан этап ошибки и доступное действие."
            : `${stage?.description ?? "Narezai продолжает работу в фоне."} Страницу можно закрыть — состояние сохранится.`}
        </SectionDescription>

      <div className="flex w-full items-center gap-3 rounded-md bg-muted p-3 text-left">
        <MediaThumb src={sourceThumbnail ?? undefined} alt={sourceName} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className={typographyVariants({ role: "label" })}>{sourceName}</span>
          <span className={typographyVariants({ role: "caption" })}>{completed ? "Обработка завершена" : failed ? "Обработка остановлена" : "Можно закрыть вкладку — работа продолжится"}</span>
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
          <p className={typographyVariants({ role: "caption" })}>
            Варианты клипов появятся только после завершения анализа — мы не
            показываем фиктивные карточки до того, как их реально нашли.
          </p>
        </>
      ) : null}

      {errorMessage ? <p className="text-sm text-destructive" role="alert">{errorMessage}</p> : null}

      {action ? (
        completed ? (
          <Button nativeButton={false} render={<Link href={action.completedHref} />} className="w-full">
            {action.completedLabel}
            <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
          </Button>
        ) : (
          <Button nativeButton={false} render={<Link href={action.fallbackHref} />} className="w-full" variant="outline">{action.fallbackLabel}</Button>
        )
      ) : null}
      </CardContent>
    </Card>
  );
}
