import type {
  ClipEditorState,
  ClipResult,
  MinuteTransaction,
  MomentCandidate,
  Project,
  ProjectStatus,
  SourceLibraryItem,
  StylePreset,
} from "./types";

/** Offline/preview fallback only — real balance comes from GET /v1/billing/summary via the dashboard store. */
export const previewBalanceSeconds = 296 * 60;
export const previewPlanCode = "creator";

export const projectStatus: Record<
  ProjectStatus,
  { label: string; tone: "neutral" | "accent" | "success" | "danger"; action: string }
> = {
  draft: { label: "Черновик", tone: "neutral", action: "Продолжить" },
  uploading: { label: "Загружается", tone: "accent", action: "Открыть" },
  importing: { label: "Загружаем видео", tone: "accent", action: "Открыть" },
  probing: { label: "Проверяем видео", tone: "accent", action: "Открыть" },
  transcribing: { label: "Распознаём речь", tone: "accent", action: "Открыть" },
  finding_moments: { label: "Ищем моменты", tone: "accent", action: "Открыть" },
  review_required: { label: "Нужна проверка", tone: "accent", action: "Проверить" },
  rendering: { label: "Создаём клипы", tone: "accent", action: "Открыть" },
  ready: { label: "Готово", tone: "success", action: "Смотреть" },
  partially_ready: { label: "Частично готово", tone: "neutral", action: "Смотреть" },
  failed: { label: "Нужна помощь", tone: "danger", action: "Исправить" },
  archived: { label: "В архиве", tone: "neutral", action: "Смотреть" },
};

export const projects: Project[] = [
  {
    id: "podcast-24",
    title: "Подкаст №24 — как запускать продукты",
    source: "YouTube",
    duration: "01:03:42",
    durationMinutes: 64,
    status: "review_required",
    clipsFound: 8,
    clipsReady: 0,
    style: "Основной",
    updatedAt: "Сегодня, 14:32",
    accent: "sky",
  },
  {
    id: "webinar-sales",
    title: "Вебинар: системные продажи",
    source: "Файл",
    duration: "48:16",
    durationMinutes: 49,
    status: "rendering",
    clipsFound: 6,
    clipsReady: 3,
    style: "Экспертный",
    updatedAt: "Сегодня, 12:08",
    accent: "ink",
  },
  {
    id: "interview-founder",
    title: "Интервью с основателем",
    source: "YouTube",
    duration: "01:18:09",
    durationMinutes: 79,
    status: "ready",
    clipsFound: 11,
    clipsReady: 9,
    style: "Основной",
    updatedAt: "Вчера, 18:41",
    accent: "soft",
  },
  {
    id: "course-module",
    title: "Курс — модуль про команду",
    source: "Файл",
    duration: "36:52",
    durationMinutes: 37,
    status: "draft",
    clipsFound: 0,
    clipsReady: 0,
    style: "Минимал",
    updatedAt: "25 июля",
    accent: "sky",
  },
  {
    id: "bad-audio",
    title: "Ответы после конференции",
    source: "Файл",
    duration: "22:11",
    durationMinutes: 23,
    status: "failed",
    clipsFound: 0,
    clipsReady: 0,
    style: "Основной",
    updatedAt: "23 июля",
    accent: "ink",
  },
];

export const moments: MomentCandidate[] = [
  {
    id: "moment-1",
    title: "Почему первый продукт почти всегда ошибается",
    topic: "Сильное мнение",
    start: "08:14",
    end: "09:01",
    duration: "00:47",
    excerpt:
      "Первый продукт не обязан быть идеальным. Его задача — показать, за что пользователь действительно готов платить.",
    reason: "Самостоятельная мысль с ясным тезисом и практическим выводом.",
    selected: true,
    speaker: "Алексей",
    score: 94,
  },
  {
    id: "moment-2",
    title: "Три сигнала, что пора менять позиционирование",
    topic: "Практический совет",
    start: "16:32",
    end: "17:26",
    duration: "00:54",
    excerpt:
      "Если люди понимают функцию, но не понимают результат, проблема почти всегда не в продукте, а в формулировке.",
    reason: "Есть перечисление, контекст и законченная рекомендация.",
    selected: true,
    speaker: "Марина",
    score: 91,
  },
  {
    id: "moment-3",
    title: "Как команда потеряла месяц на ненужной функции",
    topic: "История",
    start: "24:08",
    end: "25:20",
    duration: "01:12",
    excerpt:
      "Мы уже написали половину функции, когда впервые показали прототип клиенту. Он спросил: а зачем мне это вообще?",
    reason: "История работает без контекста и заканчивается понятным уроком.",
    selected: true,
    speaker: "Алексей",
    score: 88,
  },
  {
    id: "moment-4",
    title: "Что спрашивать на первом интервью",
    topic: "Вопрос и ответ",
    start: "31:44",
    end: "32:21",
    duration: "00:37",
    excerpt:
      "Не просите человека придумать решение. Попросите вспомнить последний раз, когда проблема уже произошла.",
    reason: "Короткий ответ, который можно сразу применить.",
    selected: true,
    speaker: "Марина",
    score: 86,
  },
  {
    id: "moment-5",
    title: "Почему скорость важнее количества идей",
    topic: "Сильное мнение",
    start: "44:11",
    end: "44:59",
    duration: "00:48",
    excerpt:
      "Преимущество маленькой команды не в количестве идей. Оно в том, сколько циклов проверки она успевает пройти.",
    reason: "Выразительный тезис, но вступлению требуется небольшой контекст.",
    selected: false,
    speaker: "Алексей",
    score: 82,
  },
];

export const transcript = [
  {
    time: "08:05",
    speaker: "Марина",
    text: "Но ведь первая версия всё равно должна производить хорошее впечатление?",
  },
  {
    time: "08:14",
    speaker: "Алексей",
    text: "Первый продукт не обязан быть идеальным. Его задача — показать, за что пользователь действительно готов платить.",
    active: true,
  },
  {
    time: "08:29",
    speaker: "Алексей",
    text: "Если мы полируем то, что людям не нужно, качество исполнения уже ничего не меняет.",
    active: true,
  },
  {
    time: "08:43",
    speaker: "Марина",
    text: "То есть сначала проверяем ценность, а уже потом масштабируем качество?",
    active: true,
  },
  {
    time: "08:51",
    speaker: "Алексей",
    text: "Да. И хорошая первая версия должна быть не большой, а честной: она решает одну задачу целиком.",
    active: true,
  },
  {
    time: "09:01",
    speaker: "Марина",
    text: "Это, кажется, сильно меняет взгляд на сроки запуска.",
  },
];

export const sourceLibrary: SourceLibraryItem[] = [
  {
    id: "source-podcast-24",
    title: "Подкаст №24 — как запускать продукты",
    source: "YouTube",
    duration: "01:03:42",
    lastUsed: "Сегодня",
    retainedUntil: "до 26 октября",
  },
  {
    id: "source-webinar-sales",
    title: "Вебинар: системные продажи",
    source: "Файл",
    duration: "48:16",
    lastUsed: "24 июля",
    retainedUntil: "до 22 октября",
  },
  {
    id: "source-founder",
    title: "Интервью с основателем",
    source: "YouTube",
    duration: "01:18:09",
    lastUsed: "23 июля",
    retainedUntil: "до 21 октября",
  },
];

export const readyClips: ClipResult[] = moments.slice(0, 3).map((moment, index) => ({
  id: `clip-${index + 1}`,
  momentId: moment.id,
  title: moment.title,
  topic: moment.topic,
  duration: moment.duration,
  status: index === 2 ? "rendering" : "ready",
  version: 1,
}));

export const defaultClipEditorState: ClipEditorState = {
  title: "Почему первый продукт почти всегда ошибается",
  socialTitle: "Первый продукт не обязан быть идеальным",
  socialDescription: "Как проверить ценность продукта до долгой разработки.\n\n#продукт #стартап #бизнес",
  startSeconds: 494,
  endSeconds: 541,
  layout: "active_speaker",
  speaker: "Автоматически",
  captionsEnabled: true,
  subtitlePreset: "active_word",
  fontFamily: "HVE Sans",
  fontSize: 58,
  subtitlePosition: "bottom",
  primaryColor: "#ffffff",
  activeColor: "#10b8f4",
  titleEnabled: true,
  titlePosition: "top",
  bannerEnabled: false,
  logoEnabled: false,
  silenceRemoval: true,
  normalizeAudio: true,
  exportHeight: 1920,
};

export const styles: StylePreset[] = [
  {
    id: "main",
    name: "Основной",
    description: "Контрастные субтитры, активный спикер и аккуратный логотип.",
    isDefault: true,
    captions: "Активное слово",
    subtitlePreset: "active_word",
  fontFamily: "HVE Sans",
    subtitlePosition: "bottom",
    framing: "Автоматически",
    silenceRemoval: true,
    title: true,
    logo: false,
    banner: false,
    safeZones: ["shorts", "reels", "tiktok", "vk"],
    // Fill must stay readable against the fixed #06131a outline (the ASS
    // render default — see subtitles.py write_ass / packages/contracts
    // media.ts outlineColor) — this used to be #06131a too, so fill and
    // outline were identical: a solid near-black blob, invisible on any
    // video darker than itself. White fill is what actually contrasts.
    colors: ["#ffffff", "#10b8f4"],
  },
  {
    id: "expert",
    name: "Экспертный",
    description: "Спокойная типографика для советов, лекций и образовательных видео.",
    captions: "Две строки",
    subtitlePreset: "clean",
  fontFamily: "HVE Sans",
    subtitlePosition: "bottom",
    framing: "Активный спикер",
    silenceRemoval: true,
    title: true,
    logo: true,
    banner: true,
    safeZones: ["shorts", "reels", "tiktok", "vk"],
    colors: ["#ffffff", "#0d86b5"],
  },
  {
    id: "minimal",
    name: "Минимал",
    description: "Белые субтитры без анимации и статичный вертикальный кадр.",
    captions: "Минимал",
    subtitlePreset: "minimal_box",
  fontFamily: "HVE Sans",
    subtitlePosition: "bottom",
    framing: "Статичный кадр",
    silenceRemoval: false,
    title: false,
    logo: false,
    banner: false,
    safeZones: ["shorts", "reels", "tiktok", "vk"],
    colors: ["#ffffff", "#111820"],
  },
];

export const minuteTransactions: MinuteTransaction[] = [
  { id: "tx-1", title: "Подкаст №24", date: "Сегодня, 14:32", amount: -64, kind: "charge" },
  { id: "tx-2", title: "Дополнительный пакет", date: "26 июля", amount: 180, kind: "credit" },
  { id: "tx-3", title: "Вебинар: системные продажи", date: "24 июля", amount: -49, kind: "charge" },
  { id: "tx-4", title: "Возврат за незавершённую обработку", date: "23 июля", amount: 23, kind: "refund" },
];
