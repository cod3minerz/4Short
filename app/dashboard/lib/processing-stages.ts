export const processingStages = [
  { title: "Получаем исходное видео", description: "Скачиваем или принимаем файл. Большие видео могут занять больше времени." },
  { title: "Готовим звук и распознаём речь", description: "Извлекаем звук, проверяем длительность и переводим голос в текст. Обычно самый долгий этап." },
  { title: "Ищем законченные мысли", description: "Подбираем фрагменты, которые можно вырезать как отдельный клип." },
];

/**
 * Real backend project_status values (db/schema.ts) → visible stage index.
 * Only 3 distinct in-progress statuses actually exist server-side
 * (`services/control-api/src/routes/projects.ts` sets `probing` once, at
 * creation, before any job has run; `services/control-api/src/services/pipeline.ts`
 * moves straight from `probing` to `transcribing` when the import/probe job
 * completes, then straight to `finding_moments` when speech-to-text
 * completes — `extract_audio` runs silently INSIDE the `transcribing`
 * window, with no separate status of its own). `importing`/`uploading`/
 * `draft` are never actually written by any route — confirmed by grepping
 * every assignment to `projects.status` — so they only matter as safe
 * defaults before the first real status arrives. A 4th visible stage
 * ("Подготавливаем звук" as separate from "Распознаём речь") was tried
 * first but is impossible to show honestly: nothing distinguishes "audio
 * extraction is running" from "speech-to-text is running" while status
 * reads `transcribing`, so `probing` was previously mapped to stage 1
 * ("Подготавливаем звук") to make room for a 4-stage display — which meant
 * every brand-new project showed "preparing audio" immediately after
 * creation, before the source had even been downloaded. Caught only by
 * creating a real project against a live backend and watching the actual
 * `jobs`/`projects` rows (E-AUDIT); collapsed to 3 stages that each map
 * to one real, unambiguous status instead.
 */
export const stageByStatus: Record<string, number> = {
  draft: 0,
  uploading: 0,
  importing: 0,
  probing: 0,
  transcribing: 1,
  finding_moments: 2,
  review_required: processingStages.length,
};

/**
 * Statuses the finding-moments pipeline can be in while it's still running.
 * Anything outside this set (review_required, failed, ready, rendering,
 * ...) means the pipeline has stopped one way or another, so a poller
 * watching it can safely stop asking. Derived from stageByStatus rather
 * than listed again so the two can't drift apart.
 */
export const activeProcessingStatuses = new Set(
  Object.keys(stageByStatus).filter((status) => status !== "review_required"),
);
