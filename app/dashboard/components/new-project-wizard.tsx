"use client";

import { Button, Input, TextArea } from "@heroui/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileUp,
  Frame,
  LoaderCircle,
  Sparkles,
  Subtitles,
  UploadCloud,
  WandSparkles,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { trackApp } from "../lib/track-app";
import { useDashboardStore } from "../store";
import { DashboardSwitch } from "./dashboard-switch";

const intents = [
  { id: "best", title: "Лучшие моменты", text: "Сбалансированный выбор сильных самостоятельных фрагментов." },
  { id: "opinions", title: "Сильные мнения", text: "Яркие позиции, споры и выводы, которые вызывают реакцию." },
  { id: "tips", title: "Практические советы", text: "Пошаговые рекомендации и мысли, которые можно применить." },
  { id: "stories", title: "Истории", text: "Законченные случаи, примеры и личный опыт." },
  { id: "qa", title: "Вопросы и ответы", text: "Содержательные ответы гостей и экспертов." },
  { id: "product", title: "Продукт и демонстрация", text: "Возможности, сценарии использования и объяснение пользы." },
  { id: "custom", title: "Свой запрос", text: "Опишите, какие именно моменты нужно найти." },
];

const durations = ["до 30 секунд", "30–60 секунд", "60–90 секунд"];

const processingStages = [
  "Получаем исходное видео",
  "Подготавливаем звук",
  "Распознаём речь",
  "Ищем законченные мысли",
  "Готовим варианты",
];

function Stepper({ step }: { step: number }) {
  const steps = ["Видео", "Моменты", "Стиль"];
  return (
    <ol className="wizard-stepper" aria-label="Этапы настройки">
      {steps.map((label, index) => (
        <li className={step === index + 1 ? "is-active" : step > index + 1 ? "is-complete" : ""} key={label}>
          <span>{step > index + 1 ? <Check size={15} /> : index + 1}</span>
          <b>{label}</b>
        </li>
      ))}
    </ol>
  );
}

export function NewProjectWizard({
  initialSource = "",
  initialUpload = false,
}: {
  initialSource?: string;
  initialUpload?: boolean;
}) {
  const { styles, defaultStyleId } = useDashboardStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState(initialSource);
  const [sourceReady, setSourceReady] = useState(Boolean(initialSource) || initialUpload);
  const [sourceType, setSourceType] = useState<"youtube" | "file">(initialUpload ? "file" : "youtube");
  const [sourceName, setSourceName] = useState(initialUpload ? "Загруженное видео.mp4" : "Подкаст №24 — как запускать продукты");
  const [error, setError] = useState("");
  const [intent, setIntent] = useState("tips");
  const [customPrompt, setCustomPrompt] = useState("");
  const [duration, setDuration] = useState("30–60 секунд");
  const [count, setCount] = useState("recommended");
  const [styleOverride, setStyleOverride] = useState<string | null>(null);
  const styleId = styleOverride ?? defaultStyleId;
  const [captions, setCaptions] = useState(true);
  const [silence, setSilence] = useState(true);
  const [banner, setBanner] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showAllIntents, setShowAllIntents] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);

  useEffect(() => {
    trackApp("project_create_start");
    if (initialSource) trackApp("source_probe_complete", { source: "youtube" });
  }, [initialSource]);

  useEffect(() => {
    if (!processing) return;
    if (processingIndex >= processingStages.length) return;
    const timer = window.setTimeout(() => setProcessingIndex((value) => value + 1), 900);
    return () => window.clearTimeout(timer);
  }, [processing, processingIndex]);

  const verifyUrl = () => {
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url.trim())) {
      setError("Нужна полная ссылка на видео YouTube");
      return;
    }
    setError("");
    setSourceType("youtube");
    setSourceReady(true);
    trackApp("source_url_submit");
    trackApp("source_probe_complete", { source: "youtube" });
  };

  const chooseStyle = (id: string) => {
    const style = styles.find((item) => item.id === id);
    if (!style) return;
    setStyleOverride(id);
    setCaptions(style.captions !== "Выключены");
    setSilence(style.silenceRemoval);
    setBanner(style.banner);
  };

  const currentStyle = styles.find((style) => style.id === styleId) ?? styles[0];

  if (processing) {
    const completed = processingIndex >= processingStages.length;
    return (
      <main className="wizard-processing">
        <Link className="wizard-close-link" href="/dashboard/projects">Проекты</Link>
        <div className="wizard-processing__card">
          <div className={`wizard-processing__mark ${completed ? "is-complete" : ""}`}>
            {completed ? <Check size={32} /> : <LoaderCircle size={32} />}
          </div>
          <span className="dash-eyebrow">{completed ? "Анализ завершён" : "Можно закрыть страницу"}</span>
          <h1>{completed ? "МOMЕНТЫ ГОТОВЫ К ПРОВЕРКЕ" : "ИЩЕМ СИЛЬНЫЕ МОМЕНТЫ"}</h1>
          <p>
            {completed
              ? "Мы нашли 8 самостоятельных фрагментов. Выберите те, из которых нужно создать клипы."
              : "4Short продолжит работу, даже если вы перейдёте в другой раздел."}
          </p>

          <div className="wizard-processing__source">
            <span className="dash-media-mark">4S</span>
            <div>
              <strong>{sourceName}</strong>
              <small>01:03:42 · 64 минуты</small>
            </div>
          </div>

          <ol className="wizard-processing__steps">
            {processingStages.map((stage, index) => (
              <li
                className={index < processingIndex ? "is-complete" : index === processingIndex ? "is-active" : ""}
                key={stage}
              >
                <span>{index < processingIndex ? <Check size={15} /> : index + 1}</span>
                <b>{stage}</b>
                {index === processingIndex && !completed ? <LoaderCircle className="is-spinning" size={17} /> : null}
              </li>
            ))}
          </ol>

          {completed ? (
            <Link className="dash-primary-link wizard-processing__action" href="/dashboard/projects/podcast-24">
              Проверить моменты
              <ArrowRight size={18} />
            </Link>
          ) : (
            <Link className="dash-secondary-link wizard-processing__action" href="/dashboard/projects">
              Перейти к проектам
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="wizard">
      <header className="wizard-header">
        <Link href="/dashboard" aria-label="Закрыть создание проекта">
          <ArrowLeft size={20} />
          <span>В кабинет</span>
        </Link>
        <Stepper step={step} />
        <span className="wizard-autosave">Черновик сохранён</span>
      </header>

      <div className="wizard-body">
        {step === 1 ? (
          <section className="wizard-panel" aria-labelledby="wizard-source-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 1 из 3</span>
              <h1 id="wizard-source-title">ДОБАВЬТЕ ИСХОДНОЕ ВИДЕО</h1>
              <p>Ссылка или файл проходят один и тот же конвейер.</p>
            </div>

            {!sourceReady ? (
              <div className="wizard-source-grid">
                <div className="wizard-source-card">
                  <span className="wizard-source-card__icon is-youtube"><Youtube size={25} /></span>
                  <h2>Ссылка на YouTube</h2>
                  <p>Подойдёт публичное видео или доступное по ссылке.</p>
                  <div className="wizard-url-input">
                    <Input
                      aria-label="Ссылка на YouTube"
                      className="dash-input"
                      placeholder="https://youtube.com/watch?v=..."
                      type="url"
                      value={url}
                      variant="secondary"
                      onChange={(event) => { setUrl(event.target.value); setError(""); }}
                      onKeyDown={(event) => { if (event.key === "Enter") verifyUrl(); }}
                    />
                    <Button onPress={verifyUrl}>Проверить</Button>
                  </div>
                  {error ? <span className="dash-field-error" role="alert">{error}</span> : null}
                </div>

                <button className="wizard-source-card wizard-source-card--upload" type="button" onClick={() => fileRef.current?.click()}>
                  <span className="wizard-source-card__icon"><UploadCloud size={25} /></span>
                  <h2>Загрузить файл</h2>
                  <p>Перетащите видео сюда или выберите его на устройстве.</p>
                  <span className="wizard-file-cta"><FileUp size={18} /> Выбрать видео</span>
                  <small>MP4, MOV, WebM · до 10 ГБ</small>
                </button>
                <input
                  ref={fileRef}
                  className="sr-only"
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setSourceType("file");
                    setSourceName(file.name);
                    setSourceReady(true);
                    trackApp("source_upload_start", { fileType: file.type });
                    trackApp("source_upload_complete");
                  }}
                />
              </div>
            ) : (
              <div className="wizard-source-ready">
                <div className="wizard-source-ready__media">
                  <span className="dash-media-mark">4S</span>
                  <span>{sourceType === "youtube" ? <Youtube size={17} /> : <FileUp size={17} />}</span>
                </div>
                <div className="wizard-source-ready__info">
                  <span className="dash-status tone-success"><Check size={14} /> Источник готов</span>
                  <h2>{sourceName}</h2>
                  <dl>
                    <div><dt>Длительность</dt><dd>01:03:42</dd></div>
                    <div><dt>Будет зарезервировано</dt><dd>64 минуты</dd></div>
                    <div><dt>Останется после запуска</dt><dd>120 минут</dd></div>
                  </dl>
                  <button type="button" onClick={() => setSourceReady(false)}>Выбрать другое видео</button>
                </div>
              </div>
            )}

            <div className="wizard-footer">
              <span>{sourceReady ? "Метаданные получены. Загрузка продолжится в фоне." : "Списание произойдёт только после подтверждения."}</span>
              <Button isDisabled={!sourceReady} onPress={() => setStep(2)}>
                Какие клипы нужны
                <ArrowRight size={18} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="wizard-panel" aria-labelledby="wizard-intent-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 2 из 3</span>
              <h1 id="wizard-intent-title">ЧТО НУЖНО НАЙТИ</h1>
              <p>Выберите задачу — детали можно уточнить позже.</p>
            </div>

            <div className="wizard-intent-grid">
              {intents.filter((_, index) => showAllIntents || index < 4).map((item) => (
                <button
                  className={intent === item.id ? "is-selected" : ""}
                  type="button"
                  key={item.id}
                  onClick={() => setIntent(item.id)}
                >
                  <span>{intent === item.id ? <Check size={16} /> : <Sparkles size={16} />}</span>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </button>
              ))}
            </div>
            {!showAllIntents ? (
              <button className="wizard-more-intents" type="button" onClick={() => setShowAllIntents(true)}>
                Ещё сценарии и свой запрос
                <ChevronDown size={17} />
              </button>
            ) : null}

            {intent === "custom" ? (
              <label className="wizard-custom-prompt">
                <span>Опишите нужные моменты</span>
                <TextArea
                  fullWidth
                  maxLength={240}
                  placeholder="Например: найди ответы гостя о запуске продукта и ошибках первой команды"
                  rows={4}
                  value={customPrompt}
                  variant="secondary"
                  onChange={(event) => setCustomPrompt(event.target.value)}
                />
                <small>{customPrompt.length} / 240</small>
              </label>
            ) : null}

            <div className="wizard-result-settings">
              <fieldset>
                <legend>Количество</legend>
                <div className="wizard-segmented">
                  <button className={count === "recommended" ? "is-active" : ""} type="button" onClick={() => setCount("recommended")}>
                    Рекомендуемое
                  </button>
                  <button className={count === "8" ? "is-active" : ""} type="button" onClick={() => setCount("8")}>
                    Ровно 8
                  </button>
                </div>
              </fieldset>
              <fieldset>
                <legend>Длительность</legend>
                <div className="wizard-segmented">
                  {durations.map((value) => (
                    <button className={duration === value ? "is-active" : ""} type="button" key={value} onClick={() => setDuration(value)}>
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <button
              className="wizard-advanced-trigger"
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              Дополнительные настройки
              <ChevronDown className={advancedOpen ? "is-open" : ""} size={18} />
            </button>
            {advancedOpen ? (
              <div className="wizard-advanced-grid">
                <label><span>Часть исходника</span><select defaultValue="all"><option value="all">Всё видео</option><option>Первые 30 минут</option><option>Свой диапазон</option></select></label>
                <label><span>Разнообразие тем</span><select defaultValue="high"><option value="high">Высокое</option><option>Среднее</option><option>Строго по теме</option></select></label>
                <label><span>Завершение мысли</span><select defaultValue="15"><option value="15">До 15 секунд сверх лимита</option><option>Не превышать лимит</option></select></label>
              </div>
            ) : null}

            <div className="wizard-footer">
              <button className="wizard-back" type="button" onClick={() => setStep(1)}><ArrowLeft size={17} /> Назад</button>
              <Button onPress={() => setStep(3)}>
                Выбрать оформление
                <ArrowRight size={18} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="wizard-panel wizard-panel--style" aria-labelledby="wizard-style-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 3 из 3</span>
              <h1 id="wizard-style-title">КАК ДОЛЖНЫ ВЫГЛЯДЕТЬ КЛИПЫ</h1>
              <p>Возьмите сохранённый стиль и при необходимости измените детали.</p>
            </div>

            <div className="wizard-style-layout">
              <div
                className="wizard-phone-preview"
                style={{
                  "--preview-bg": currentStyle.colors[0],
                  "--preview-accent": currentStyle.colors[1],
                } as React.CSSProperties}
              >
                <div className="wizard-phone-preview__safe"><span>Безопасная зона</span></div>
                <span className="dash-media-mark">4S</span>
                {captions ? (
                  <div className="wizard-phone-preview__captions">
                    <span>ОДНА МЫСЛЬ</span>
                    <span>МОЖЕТ СТАТЬ</span>
                    <strong>ЦЕЛЫМ КЛИПОМ</strong>
                  </div>
                ) : null}
                {banner ? <div className="wizard-phone-preview__banner">ВАШ БАННЕР</div> : null}
              </div>

              <div className="wizard-style-controls">
                <div className="wizard-style-options">
                  {styles.map((style) => (
                    <button
                      className={styleId === style.id ? "is-selected" : ""}
                      type="button"
                      key={style.id}
                      onClick={() => chooseStyle(style.id)}
                    >
                      <span style={{ background: `linear-gradient(135deg, ${style.colors[0]} 50%, ${style.colors[1]} 50%)` }} />
                      <b>{style.name}</b>
                      <small>{style.captions}</small>
                      {styleId === style.id ? <Check size={17} /> : null}
                    </button>
                  ))}
                </div>

                <div className="wizard-control-card">
                  <div>
                    <span className="wizard-control-card__icon"><Frame size={19} /></span>
                    <span><strong>Кадр</strong><small>Автоматически следить за спикером</small></span>
                  </div>
                  <select aria-label="Режим кадрирования" defaultValue="auto">
                    <option value="auto">Автоматически</option>
                    <option>Активный спикер</option>
                    <option>Два спикера</option>
                    <option>Фон с размытием</option>
                    <option>Статичный кадр</option>
                  </select>
                </div>
                <div className="wizard-control-card">
                  <div>
                    <span className="wizard-control-card__icon"><Subtitles size={19} /></span>
                    <span><strong>Субтитры</strong><small>Стиль можно изменить в готовом клипе</small></span>
                  </div>
                  <DashboardSwitch checked={captions} label="Добавлять субтитры" onCheckedChange={setCaptions} />
                </div>
                <div className="wizard-control-card">
                  <div>
                    <span className="wizard-control-card__icon"><WandSparkles size={19} /></span>
                    <span><strong>Убрать длинные паузы</strong><small>Мы не обрежем окончания фраз</small></span>
                  </div>
                  <DashboardSwitch checked={silence} label="Удалять длинные паузы" onCheckedChange={setSilence} />
                </div>
                <div className="wizard-control-card">
                  <div>
                    <span className="wizard-control-card__icon"><UploadCloud size={19} /></span>
                    <span><strong>Рекламный баннер</strong><small>Изображение или короткое видео</small></span>
                  </div>
                  <DashboardSwitch checked={banner} label="Добавить баннер" onCheckedChange={setBanner} />
                </div>

                {banner ? (
                  <div className="wizard-banner-settings">
                    <button type="button"><UploadCloud size={17} /> Загрузить баннер</button>
                    <label><span>Показывать</span><select defaultValue="end"><option value="end">В конце клипа</option><option>Весь клип</option><option>Свой диапазон</option></select></label>
                    <label><span>Положение</span><select defaultValue="bottom"><option value="bottom">Снизу</option><option>Сверху</option><option>Слева</option><option>Справа</option></select></label>
                  </div>
                ) : null}
              </div>

              <aside className="wizard-summary">
                <span className="dash-eyebrow">Проверка</span>
                <h2>Всё готово к запуску</h2>
                <dl>
                  <div><dt>Источник</dt><dd>64 минуты</dd></div>
                  <div><dt>Задача</dt><dd>{intents.find((item) => item.id === intent)?.title}</dd></div>
                  <div><dt>Результат</dt><dd>{count === "recommended" ? "6–10 клипов" : "8 клипов"}</dd></div>
                  <div><dt>Длительность</dt><dd>{duration}</dd></div>
                  <div><dt>Стиль</dt><dd>{styles.find((style) => style.id === styleId)?.name}</dd></div>
                </dl>
                <div className="wizard-summary__charge">
                  <span>Будет списано</span>
                  <strong>64 минуты</strong>
                  <small>Повторный поиск и рендер внутри проекта — без повторного списания.</small>
                </div>
                <Button
                  fullWidth
                  size="lg"
                  onPress={() => {
                    trackApp("project_settings_complete", { intent, duration, style: styleId });
                    trackApp("analysis_start");
                    setProcessing(true);
                  }}
                >
                  Найти моменты
                  <ArrowRight size={18} />
                </Button>
              </aside>
            </div>

            <div className="wizard-footer wizard-footer--style">
              <button className="wizard-back" type="button" onClick={() => setStep(2)}><ArrowLeft size={17} /> Назад</button>
              <span>Настройки сохранятся для следующего проекта.</span>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
