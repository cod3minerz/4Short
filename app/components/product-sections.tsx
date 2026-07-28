import {
  Captions,
  Check,
  Clock3,
  Download,
  Link2,
  MessageSquareText,
  ScanFace,
  Sparkles,
  Upload,
  Users,
  Video,
} from "lucide-react";

type Scene =
  | "tracking"
  | "subtitles"
  | "moments"
  | "economy"
  | "youtube"
  | "formats"
  | "ads"
  | "silence"
  | "controls"
  | "variety"
  | "platforms"
  | "styles"
  | "batch";

type Feature = {
  eyebrow: string;
  title: string;
  description: string;
  result: string;
  scene: Scene;
};

const features: readonly Feature[] = [
  {
    eyebrow: "Умное кадрирование",
    title: "СПИКЕР ВСЕГДА ОСТАЁТСЯ В КАДРЕ",
    description:
      "4Short отслеживает активного спикера и перестраивает горизонтальное видео под вертикальный формат.",
    result: "16:9 превращается в аккуратный 9:16",
    scene: "tracking",
  },
  {
    eyebrow: "Автоматические субтитры",
    title: "СЛОВА СТАНОВЯТСЯ ЧАСТЬЮ ВИДЕО",
    description:
      "Речь превращается в читаемые субтитры. Текст можно проверить и исправить перед экспортом.",
    result: "Крупный текст, удобный для просмотра без звука",
    scene: "subtitles",
  },
  {
    eyebrow: "Поиск моментов",
    title: "4SHORT НАХОДИТ СИЛЬНЫЕ ФРАГМЕНТЫ",
    description:
      "Сервис анализирует длинное видео и выделяет законченные мысли, сильные ответы и самостоятельные сюжеты.",
    result: "Меньше ручного просмотра каждого часа",
    scene: "moments",
  },
  {
    eyebrow: "Меньше ручной работы",
    title: "БОЛЬШЕ РОЛИКОВ ИЗ ОДНОГО ИСХОДНИКА",
    description:
      "Один выпуск становится серией самостоятельных клипов. Вы используете уже снятый материал снова.",
    result: "Один исходник — несколько готовых тем",
    scene: "economy",
  },
  {
    eyebrow: "Импорт по ссылке",
    title: "ДОБАВЛЯЙТЕ ВИДЕО ПРЯМО С YOUTUBE",
    description:
      "Вставьте ссылку на опубликованное видео или выберите файл на устройстве — оба сценария начинаются одинаково просто.",
    result: "Ссылка или видеофайл на выбор",
    scene: "youtube",
  },
  {
    eyebrow: "Разные исходники",
    title: "ОДИН ПРОЦЕСС ДЛЯ РАЗНЫХ ВИДЕО",
    description:
      "Подкасты, интервью, вебинары, уроки и эфиры обрабатываются в одном понятном процессе.",
    result: "Работает с разговорным контентом разных типов",
    scene: "formats",
  },
  {
    eyebrow: "Встроенная реклама",
    title: "ДОБАВЛЯЙТЕ ОФФЕРЫ ПРЯМО В РОЛИК",
    description:
      "Разместите промокод, название продукта или короткий призыв в безопасной зоне вертикального видео.",
    result: "Баннер не перекрывает лицо и субтитры",
    scene: "ads",
  },
  {
    eyebrow: "Чистый темп",
    title: "ПАУЗЫ УБИРАЮТСЯ АВТОМАТИЧЕСКИ",
    description:
      "4Short помогает сократить молчание и сделать фрагмент плотнее, сохраняя контроль над финальной версией.",
    result: "Динамичнее без ручной чистки таймлайна",
    scene: "silence",
  },
  {
    eyebrow: "Настройка результата",
    title: "ВЫБИРАЙТЕ КОЛИЧЕСТВО И ДЛИТЕЛЬНОСТЬ",
    description:
      "Задайте нужное число клипов, диапазон длительности и формат до начала обработки.",
    result: "Результат под ваш контент-план",
    scene: "controls",
  },
  {
    eyebrow: "Разные смыслы",
    title: "КАЖДЫЙ КЛИП РАСКРЫВАЕТ НОВУЮ ТЕМУ",
    description:
      "Получайте не повторы одного эпизода, а разные форматы: ответ, историю, совет или ключевую мысль.",
    result: "Несколько самостоятельных поводов для публикации",
    scene: "variety",
  },
  {
    eyebrow: "Готово к публикации",
    title: "ОДИН РОЛИК ДЛЯ ВСЕХ КОРОТКИХ ФОРМАТОВ",
    description:
      "Экспортируйте вертикальные клипы для YouTube Shorts, Reels, TikTok и VK Клипов.",
    result: "Вертикальный формат 9:16",
    scene: "platforms",
  },
  {
    eyebrow: "Единый стиль",
    title: "СОХРАНЯЙТЕ ОФОРМЛЕНИЕ ДЛЯ НОВЫХ ВЫПУСКОВ",
    description:
      "Используйте одинаковые субтитры, положение баннеров и параметры кадрирования в следующих проектах.",
    result: "Узнаваемое оформление без повторной настройки",
    scene: "styles",
  },
  {
    eyebrow: "Для команд",
    title: "ОБРАБАТЫВАЙТЕ НЕСКОЛЬКО ИСХОДНИКОВ",
    description:
      "Монтажёры, агентства и команды смогут вести несколько выпусков в едином рабочем процессе.",
    result: "Понятный статус каждого исходника",
    scene: "batch",
  },
] as const;

function MediaSlot({
  ratio = "16:9",
  label = "Будущий кадр видео",
  className = "",
}: {
  ratio?: "16:9" | "9:16";
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`product-media product-media--${ratio.replace(":", "x")} ${className}`}
      role="img"
      aria-label={`${label}, формат ${ratio}`}
    >
      <Video size={20} aria-hidden="true" />
      <span>{label}</span>
      <small>{ratio}</small>
    </div>
  );
}

function TrackingScene() {
  return (
    <div className="scene scene--tracking">
      <div className="tracking-source">
        <MediaSlot label="Исходный кадр" />
        <span className="tracking-frame" aria-hidden="true">
          <ScanFace size={24} />
        </span>
      </div>
      <MediaSlot ratio="9:16" label="Спикер в кадре" className="tracking-result" />
    </div>
  );
}

function SubtitleScene() {
  return (
    <div className="scene scene--subtitles">
      <MediaSlot ratio="9:16" label="Будущий ролик" />
      <div className="subtitle-preview" aria-label="Пример расположения субтитров">
        <span>ГЛАВНОЕ —</span>
        <strong>ДОНЕСТИ МЫСЛЬ</strong>
      </div>
      <div className="subtitle-toolbar">
        <Captions size={17} aria-hidden="true" />
        <span>Субтитры включены</span>
        <Check size={16} aria-hidden="true" />
      </div>
    </div>
  );
}

function MomentsScene() {
  return (
    <div className="scene scene--moments">
      <div className="transcript-card">
        <div className="scene-toolbar">
          <MessageSquareText size={18} aria-hidden="true" />
          <span>Транскрипт выпуска</span>
          <time>42:18</time>
        </div>
        <p>Важно не просто публиковать чаще, а находить в разговоре законченные мысли.</p>
        <p className="transcript-card__active">
          Один сильный ответ уже может стать самостоятельным коротким роликом.
        </p>
        <p>Остальное можно оставить для следующей темы.</p>
        <div className="moment-result">
          <Sparkles size={17} aria-hidden="true" />
          <span>Найден сильный момент</span>
          <time>18:04–18:41</time>
        </div>
      </div>
      <div className="scene-timeline" aria-label="Таймлайн с найденными моментами">
        <i />
        <i className="is-active" />
        <i />
        <i className="is-active" />
        <i />
      </div>
    </div>
  );
}

function EconomyScene() {
  return (
    <div className="scene scene--economy">
      <MediaSlot label="Один длинный выпуск" />
      <div className="economy-process">
        <Sparkles size={17} aria-hidden="true" />
        <span>4Short собирает клипы</span>
      </div>
      <div className="economy-results">
        {["Сильный ответ", "История", "Практический совет"].map((label) => (
          <MediaSlot ratio="9:16" label={label} key={label} />
        ))}
      </div>
    </div>
  );
}

function YoutubeScene() {
  return (
    <div className="scene scene--youtube">
      <div className="youtube-source">
        <span className="youtube-source__icon" aria-hidden="true" />
        <span>youtube.com/watch?v=4short</span>
        <Link2 size={18} aria-hidden="true" />
      </div>
      <div className="youtube-preview">
        <MediaSlot label="Видео по ссылке" />
        <div>
          <strong>Видео найдено</strong>
          <span>Можно переходить к настройкам</span>
        </div>
        <Check size={18} aria-hidden="true" />
      </div>
      <div className="youtube-divider"><span>или</span></div>
      <div className="upload-source">
        <Upload size={20} aria-hidden="true" />
        <span>Загрузить видеофайл</span>
      </div>
    </div>
  );
}

function FormatsScene() {
  return (
    <div className="scene scene--formats">
      <MediaSlot label="Будущий кадр исходника" />
      <div className="format-list" aria-label="Поддерживаемые типы видео">
        {["Подкаст", "Интервью", "Вебинар", "Обучение", "Эфир"].map((item, index) => (
          <span className={index === 0 ? "is-active" : ""} key={item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function AdsScene() {
  return (
    <div className="scene scene--ads">
      <MediaSlot ratio="9:16" label="Будущий ролик" />
      <div className="ad-safe-area" aria-hidden="true" />
      <div className="ad-banner">
        <span>ПРОМОКОД</span>
        <strong>4SHORT</strong>
        <small>Название продукта или CTA</small>
      </div>
      <div className="ad-controls">
        {["Промокод", "Продукт", "CTA"].map((item, index) => (
          <span className={index === 0 ? "is-active" : ""} key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

const waveform = [38, 62, 28, 76, 54, 34, 18, 12, 10, 14, 42, 70, 50, 80, 36, 58];

function SilenceScene() {
  return (
    <div className="scene scene--silence">
      <div className="silence-card">
        <div className="scene-toolbar">
          <Clock3 size={18} aria-hidden="true" />
          <span>Фрагмент 01:04</span>
          <strong>Пауза найдена</strong>
        </div>
        <div className="waveform" aria-label="Аудиодорожка с участком молчания">
          {waveform.map((height, index) => (
            <i
              className={index >= 6 && index <= 9 ? "is-silence" : ""}
              key={`${height}-${index}`}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div className="silence-selection">
          <span>Молчание</span>
          <strong>−8 сек.</strong>
        </div>
      </div>
      <div className="silence-result">
        <Check size={17} aria-hidden="true" />
        <span>Готовый фрагмент</span>
        <strong>00:56</strong>
      </div>
    </div>
  );
}

function ControlsScene() {
  return (
    <div className="scene scene--controls">
      <div className="control-panel">
        <div>
          <span>Количество</span>
          <strong>8 клипов</strong>
        </div>
        <div>
          <span>Длительность</span>
          <strong>30–60 сек.</strong>
        </div>
        <div>
          <span>Формат</span>
          <strong>9:16</strong>
        </div>
      </div>
      <div className="control-results">
        {["01", "02", "03"].map((item) => (
          <MediaSlot ratio="9:16" label={`Клип ${item}`} key={item} />
        ))}
      </div>
    </div>
  );
}

function VarietyScene() {
  return (
    <div className="scene scene--variety">
      {[
        ["Сильный ответ", "00:37"],
        ["История", "00:44"],
        ["Совет", "00:29"],
        ["Ключевая мысль", "00:35"],
      ].map(([label, time]) => (
        <div className="variety-card" key={label}>
          <MediaSlot ratio="9:16" label={label} />
          <time>{time}</time>
        </div>
      ))}
    </div>
  );
}

function PlatformsScene() {
  return (
    <div className="scene scene--platforms">
      <MediaSlot ratio="9:16" label="Готовый клип" />
      <div className="platform-list">
        {["YouTube Shorts", "Reels", "TikTok", "VK Клипы"].map((item) => (
          <span key={item}>
            <Check size={14} aria-hidden="true" />
            {item}
          </span>
        ))}
      </div>
      <div className="export-chip">
        <Download size={17} aria-hidden="true" />
        <span>Экспорт 9:16</span>
      </div>
    </div>
  );
}

function StylesScene() {
  return (
    <div className="scene scene--styles">
      <MediaSlot ratio="9:16" label="Будущий ролик" />
      <div className="style-presets" aria-label="Сохранённые стили оформления">
        {["Основной", "Подкаст", "Эксперт"].map((item, index) => (
          <div className={index === 0 ? "is-active" : ""} key={item}>
            <span className={`preset-mark preset-mark--${index + 1}`} aria-hidden="true" />
            <strong>{item}</strong>
            <small>{index === 0 ? "Выбран" : "Шаблон"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatchScene() {
  const rows = [
    ["Подкаст №24", "Клипы готовы", "ready"],
    ["Интервью с экспертом", "Ищем моменты", "progress"],
    ["Вебинар о продукте", "В очереди", "queued"],
  ];

  return (
    <div className="scene scene--batch">
      <div className="batch-heading">
        <Users size={20} aria-hidden="true" />
        <div>
          <strong>Проекты команды</strong>
          <span>Три исходника в работе</span>
        </div>
      </div>
      <div className="batch-list">
        {rows.map(([title, status, state], index) => (
          <div className="batch-row" data-state={state} key={title}>
            <span className="batch-row__index">0{index + 1}</span>
            <div>
              <strong>{title}</strong>
              <span>{status}</span>
            </div>
            {state === "ready" ? <Check size={18} aria-hidden="true" /> : <i aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureScene({ scene }: { scene: Scene }) {
  switch (scene) {
    case "tracking":
      return <TrackingScene />;
    case "subtitles":
      return <SubtitleScene />;
    case "moments":
      return <MomentsScene />;
    case "economy":
      return <EconomyScene />;
    case "youtube":
      return <YoutubeScene />;
    case "formats":
      return <FormatsScene />;
    case "ads":
      return <AdsScene />;
    case "silence":
      return <SilenceScene />;
    case "controls":
      return <ControlsScene />;
    case "variety":
      return <VarietyScene />;
    case "platforms":
      return <PlatformsScene />;
    case "styles":
      return <StylesScene />;
    case "batch":
      return <BatchScene />;
  }
}

const chapterBreaks: Record<number, { label: string; title: string }> = {
  0: { label: "01 · Найти", title: "СНАЧАЛА 4SHORT ПОНИМАЕТ ВИДЕО" },
  3: { label: "02 · Собрать", title: "ЗАТЕМ СОБИРАЕТ ВЕРТИКАЛЬНЫЙ РОЛИК" },
  7: { label: "03 · Настроить", title: "РЕЗУЛЬТАТ ОСТАЁТСЯ ПОД ВАШИМ КОНТРОЛЕМ" },
  10: { label: "04 · Масштабировать", title: "ГОТОВЫЙ ФОРМАТ ДЛЯ РЕГУЛЯРНОЙ РАБОТЫ" },
};

export function ProductSections() {
  return (
    <section className="product-series" id="features" aria-labelledby="features-title">
      <div className="container product-series__intro">
        <span className="section-index">Возможности</span>
        <h2 id="features-title">ВСЁ, ЧТО НУЖНО ДЛЯ КОРОТКОГО ВИДЕО</h2>
        <p>
          От поиска сильного момента до готового вертикального клипа — каждая функция
          решает одну понятную задачу.
        </p>
      </div>

      <div className="container product-series__list">
        {features.map((feature, index) => {
          const chapter = chapterBreaks[index];
          return (
            <div
              className="product-series__group"
              key={feature.scene}
              style={{ zIndex: index + 1 }}
            >
              {chapter ? (
                <div className="product-chapter" aria-hidden="true">
                  <span>{chapter.label}</span>
                  <strong>{chapter.title}</strong>
                </div>
              ) : null}

              <article
                className={`product-feature ${index % 2 ? "product-feature--reverse" : ""}`}
              >
                <div className="product-feature__copy">
                  <span className="product-feature__number">/ {String(index + 1).padStart(2, "0")}</span>
                  <span className="product-feature__eyebrow">{feature.eyebrow}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <div className="product-feature__result">
                    <Check size={17} aria-hidden="true" />
                    <span>{feature.result}</span>
                  </div>
                </div>

                <div className="product-feature__visual squircle">
                  <FeatureScene scene={feature.scene} />
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
