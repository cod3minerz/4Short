// Demo data for the interface prototype. Real data arrives with the local
// pipeline and the /v1/desktop API; nothing here is treated as truth.
export type Clip = { id: string; title: string; topic: string; start: number; end: number; score: number; caption: string };
export type Project = { id: string; title: string; duration: number; clips: number; status: "ready" | "processing"; date: string; hue: number };

export const CLIPS: Clip[] = [
  { id: "c1", title: "Почему первый продукт почти всегда проваливается", topic: "Стартапы", start: 312, end: 358, score: 94, caption: "первый продукт почти всегда провал" },
  { id: "c2", title: "Как мы потеряли половину клиентов за месяц", topic: "История", start: 905, end: 962, score: 91, caption: "потеряли половину клиентов" },
  { id: "c3", title: "Главная ошибка при найме первых людей", topic: "Команда", start: 1420, end: 1471, score: 87, caption: "ошибка при найме первых людей" },
  { id: "c4", title: "Сколько на самом деле стоит привлечь клиента", topic: "Деньги", start: 2210, end: 2268, score: 82, caption: "сколько стоит привлечь клиента" },
  { id: "c5", title: "Совет, который я бы дал себе пять лет назад", topic: "Совет", start: 3105, end: 3146, score: 78, caption: "совет себе пять лет назад" },
  { id: "c6", title: "Когда пора закрывать проект", topic: "Решения", start: 3890, end: 3944, score: 73, caption: "когда пора закрывать проект" },
];

export const PROJECTS: Project[] = [
  { id: "p1", title: "Интервью с основателем", duration: 4510, clips: 6, status: "ready", date: "сегодня", hue: 265 },
  { id: "p2", title: "Подкаст #42: деньги и рынок", duration: 5342, clips: 11, status: "ready", date: "вчера", hue: 200 },
  { id: "p3", title: "Лекция по маркетингу", duration: 3120, clips: 8, status: "ready", date: "3 дня назад", hue: 20 },
  { id: "p4", title: "Стрим: разбор подписчиков", duration: 7260, clips: 0, status: "processing", date: "только что", hue: 150 },
  { id: "p5", title: "Вебинар для новичков", duration: 2640, clips: 5, status: "ready", date: "неделю назад", hue: 330 },
];

export type SubPreset = { id: string; name: string; note: string; style: React.CSSProperties; active?: React.CSSProperties };
export const SUB_PRESETS: SubPreset[] = [
  { id: "classic", name: "Классика", note: "Белый текст с обводкой", style: { color: "#fff", textShadow: "0 0 0 #000, 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000" } },
  { id: "karaoke", name: "Караоке", note: "Подсветка текущего слова", style: { color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,.7)" }, active: { color: "#ffd23f" } },
  { id: "box", name: "Плашка", note: "Текст на тёмной подложке", style: { color: "#fff", background: "rgba(0,0,0,.72)", padding: "4px 10px", borderRadius: 8, display: "inline-block", fontWeight: 700 } },
  { id: "neon", name: "Неон", note: "Свечение по контуру", style: { color: "#c8f7ff", textShadow: "0 0 6px #35c8ff, 0 0 16px #35c8ff" } },
  { id: "bold", name: "Жирный жёлтый", note: "Крупно, для сторис", style: { color: "#ffd23f", textShadow: "2px 3px 0 #000", textTransform: "uppercase", fontWeight: 900 } },
  { id: "clean", name: "Чистый", note: "Без декора, как в интервью", style: { color: "#fff", fontWeight: 600, textShadow: "0 1px 8px rgba(0,0,0,.6)" } },
];

export const LAYOUTS = [
  { id: "fill", name: "Заполнить", note: "Кадр по центру, лишнее обрезается", available: true },
  { id: "blur", name: "Размытый фон", note: "Исходный кадр на размытой копии", available: true },
  { id: "split", name: "Два кадра", note: "Видео сверху, второй фрагмент снизу", available: true },
  { id: "face", name: "Слежение за лицом", note: "Кадр следует за говорящим", available: false },
  { id: "speaker", name: "Активный спикер", note: "Переключение между говорящими", available: false },
];
