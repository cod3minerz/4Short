"use client";

import { Button, Switch, TextArea } from "@heroui/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FileArchive,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Subtitles,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { moments as initialMoments, transcript } from "../data";
import { trackApp } from "../lib/track-app";
import { useDashboardStore } from "../store";

type Tab = "moments" | "transcript";
type RenderState = "review" | "rendering" | "ready";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "moments", label: "Клипы" },
  { id: "transcript", label: "Транскрипт" },
];

export function ProjectWorkspace() {
  const { styles, defaultStyleId } = useDashboardStore();
  const [tab, setTab] = useState<Tab>("moments");
  const [items, setItems] = useState(initialMoments);
  const [activeId, setActiveId] = useState(initialMoments[0].id);
  const [renderState, setRenderState] = useState<RenderState>("review");
  const [search, setSearch] = useState("");
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState(transcript.map((line) => line.text).join("\n\n"));
  const [styleOverride, setStyleOverride] = useState<string | null>(null);
  const styleId = styleOverride ?? defaultStyleId;
  const [captions, setCaptions] = useState(true);
  const [silence, setSilence] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selected = items.filter((item) => item.selected);
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const currentStyle = styles.find((style) => style.id === styleId) ?? styles[0];
  const filteredTranscript = useMemo(
    () => transcript.filter((line) => line.text.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  const toggleMoment = (id: string) => {
    setItems((current) =>
      current.map((item) => item.id === id ? { ...item, selected: !item.selected } : item),
    );
    trackApp("moment_select", { projectId: "podcast-24", momentId: id });
  };

  const startRender = () => {
    setRenderState("rendering");
    trackApp("render_start", { clips: selected.length });
    window.setTimeout(() => {
      setRenderState("ready");
      trackApp("clip_render_complete", { clips: selected.length });
    }, 2400);
  };

  return (
    <main className="project-workspace">
      <header className="project-header">
        <div className="project-header__title">
          <Link href="/dashboard/projects" aria-label="Назад к проектам"><ArrowLeft size={19} /></Link>
          <div>
            <span className="dash-status tone-accent">
              {renderState === "review" ? "Нужна проверка" : renderState === "rendering" ? "Создаём клипы" : "Готово"}
            </span>
            <h1>Подкаст №24 — как запускать продукты</h1>
            <p>YouTube · 01:03:42 · стиль «{currentStyle.name}»</p>
          </div>
        </div>
        <div className="project-header__actions">
          {renderState === "ready" ? (
            <Button variant="outline" onPress={() => trackApp("project_download_all")}>
              <FileArchive size={18} />
              Скачать всё
            </Button>
          ) : null}
          <Button variant="outline" onPress={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
            Параметры
          </Button>
          <Button isDisabled={!selected.length || renderState === "rendering"} onPress={startRender}>
            {renderState === "rendering" ? <LoaderCircle className="is-spinning" size={18} /> : <Sparkles size={18} />}
            {renderState === "review"
              ? `Создать клипы · ${selected.length}`
              : renderState === "rendering"
                ? `Создаём ${selected.length} клипа`
                : "Создать заново"}
          </Button>
        </div>
      </header>

      <div className="project-tabs" role="tablist" aria-label="Разделы проекта">
        {tabs.map((item) => (
          <button
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : ""}
            type="button"
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === "moments" ? <span>{items.length}</span> : null}
          </button>
        ))}
      </div>

      {renderState === "rendering" ? (
        <div className="project-render-banner">
          <LoaderCircle className="is-spinning" size={21} />
          <div>
            <strong>Создаём выбранные клипы</strong>
            <span>Готовые клипы появятся по одному. Можно покинуть страницу.</span>
          </div>
          <span>3 из {selected.length}</span>
        </div>
      ) : null}

      {tab === "moments" && renderState !== "ready" ? (
        <div className="project-review-layout">
          <section className="moment-list" aria-label="Найденные моменты">
            <div className="moment-list__head">
              <div>
                <span className="dash-eyebrow">Найдено {items.length}</span>
                <h2>Выберите клипы для рендера</h2>
              </div>
              <button type="button" onClick={() => setSettingsOpen(true)}>
                <RotateCcw size={16} />
                Найти иначе
              </button>
            </div>

            {items.map((moment, index) => (
              <article className={`moment-row ${activeId === moment.id ? "is-active" : ""}`} key={moment.id}>
                <button
                  className={`moment-check ${moment.selected ? "is-selected" : ""}`}
                  type="button"
                  aria-label={`${moment.selected ? "Исключить" : "Выбрать"} момент «${moment.title}»`}
                  aria-pressed={moment.selected}
                  onClick={() => toggleMoment(moment.id)}
                >
                  {moment.selected ? <Check size={16} /> : index + 1}
                </button>
                <button className="moment-row__content" type="button" onClick={() => setActiveId(moment.id)}>
                  <span className="moment-row__top">
                    <span>{moment.topic}</span>
                    <time>{moment.start}–{moment.end} · {moment.duration}</time>
                  </span>
                  <strong>{moment.title}</strong>
                  <p>{moment.excerpt}</p>
                </button>
                <button className="moment-row__open" type="button" aria-label="Открыть момент" onClick={() => setActiveId(moment.id)}>
                  <ChevronRight size={19} />
                </button>
              </article>
            ))}
          </section>

          <aside className="moment-inspector">
            <div className="moment-preview">
              <span className="dash-media-mark">4S</span>
              <button type="button" aria-label="Воспроизвести фрагмент"><Play fill="currentColor" size={19} /></button>
              <div className="moment-preview__captions">
                <span>ПЕРВЫЙ ПРОДУКТ</span>
                <strong>НЕ ОБЯЗАН БЫТЬ</strong>
                <span>ИДЕАЛЬНЫМ</span>
              </div>
              <small>{active.start} / {active.end}</small>
            </div>
            <div className="moment-inspector__body">
              <span className="dash-eyebrow">{active.topic}</span>
              <h2>{active.title}</h2>
              <p>{active.reason}</p>
              <div className="moment-score">
                <span>Качество фрагмента</span>
                <b>{active.score} / 100</b>
              </div>
              <dl>
                <div><dt>Спикер</dt><dd>{active.speaker}</dd></div>
                <div><dt>Длительность</dt><dd>{active.duration}</dd></div>
                <div><dt>Начало и конец</dt><dd>{active.start} — {active.end}</dd></div>
              </dl>
              <button className="moment-inspector__edit" type="button" onClick={() => setTab("transcript")}>
                Изменить по транскрипту
                <ChevronRight size={17} />
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "moments" && renderState === "ready" ? (
        <section className="project-results">
          <div className="project-results__head">
            <div>
              <span className="dash-eyebrow">Готово {selected.length} клипа</span>
              <h2>Серия готова к скачиванию</h2>
              <p>Каждый клип можно скачать или точечно изменить без повторного списания минут.</p>
            </div>
            <Button variant="outline" onPress={() => trackApp("project_download_all")}>
              <FileArchive size={18} />
              Скачать ZIP
            </Button>
          </div>
          <div className="result-clip-grid">
            {selected.map((moment, index) => (
              <article className="result-clip" key={moment.id}>
                <div className={`result-clip__media result-tone-${index % 3}`}>
                  <span className="dash-status tone-success"><Check size={13} /> Готово</span>
                  <span className="dash-media-mark">4S</span>
                  <div><span>ОДНА МЫСЛЬ</span><strong>СТАНОВИТСЯ</strong><span>ЦЕЛЫМ КЛИПОМ</span></div>
                  <small>{moment.duration}</small>
                </div>
                <h3>{moment.title}</h3>
                <p>{moment.topic} · {moment.duration}</p>
                <div className="result-clip__actions">
                  <Button variant="outline" onPress={() => trackApp("clip_download", { clipId: moment.id })}>
                    <Download size={17} />
                    MP4
                  </Button>
                  <button type="button" onClick={() => { setRenderState("review"); setActiveId(moment.id); }}>
                    Изменить
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "transcript" ? (
        <section className="transcript-layout">
          <div className="transcript-main">
            <div className="transcript-head">
              <div>
                <span className="dash-eyebrow">Версия 1</span>
                <h2>Транскрипт исходника</h2>
                <p>Исправьте имя или термин. Исходное распознавание сохранится.</p>
              </div>
              <button type="button" onClick={() => setEditingTranscript((value) => !value)}>
                {editingTranscript ? "Отменить" : "Исправить текст"}
              </button>
            </div>
            <label className="dash-search transcript-search">
              <Search size={18} />
              <span className="sr-only">Найти в транскрипте</span>
              <input type="search" placeholder="Найти слово или фразу" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {editingTranscript ? (
              <div className="transcript-editor">
                <TextArea
                  fullWidth
                  rows={14}
                  value={transcriptDraft}
                  variant="secondary"
                  onChange={(event) => setTranscriptDraft(event.target.value)}
                />
                <div>
                  <Button variant="outline" onPress={() => setEditingTranscript(false)}>Отменить</Button>
                  <Button onPress={() => { setEditingTranscript(false); trackApp("transcript_edit"); }}>Сохранить версию</Button>
                </div>
              </div>
            ) : (
              <div className="transcript-lines">
                {filteredTranscript.map((line) => (
                  <button className={line.active ? "is-active" : ""} type="button" key={`${line.time}-${line.text}`}>
                    <time>{line.time}</time>
                    <span>
                      <strong>{line.speaker}</strong>
                      <p>{line.text}</p>
                    </span>
                    {line.active ? <span className="transcript-line-mark">В моменте</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <aside className="transcript-aside">
            <span className="dash-eyebrow">Словарь проекта</span>
            <h3>Имена и термины</h3>
            <p>4Short будет учитывать написание во всех субтитрах проекта.</p>
            <div className="transcript-terms">
              <span>4Short <button aria-label="Удалить термин 4Short">×</button></span>
              <span>Product market fit <button aria-label="Удалить термин Product market fit">×</button></span>
            </div>
            <button type="button">+ Добавить термин</button>
          </aside>
        </section>
      ) : null}

      {settingsOpen ? (
        <>
          <button
            className="project-settings-backdrop"
            type="button"
            aria-label="Закрыть параметры проекта"
            onClick={() => setSettingsOpen(false)}
          />
          <aside className="project-settings-drawer" role="dialog" aria-modal="true" aria-labelledby="project-settings-title">
            <header>
              <div>
                <span className="dash-eyebrow">Один экран вместо вкладок</span>
                <h2 id="project-settings-title">Параметры проекта</h2>
                <p>Меняйте поиск и оформление здесь. Транскрипция повторно не запускается.</p>
              </div>
              <button type="button" aria-label="Закрыть" onClick={() => setSettingsOpen(false)}><X size={21} /></button>
            </header>

            <section>
              <h3>Что искать</h3>
              <label>
                <span>Сценарий</span>
                <select defaultValue="tips">
                  <option value="tips">Практические советы</option>
                  <option>Лучшие моменты</option>
                  <option>Сильные мнения</option>
                  <option>Истории</option>
                </select>
              </label>
              <div className="project-settings-drawer__pair">
                <label><span>Количество</span><select defaultValue="auto"><option value="auto">Рекомендуемое</option><option>Ровно 6</option><option>Ровно 8</option></select></label>
                <label><span>Длительность</span><select defaultValue="medium"><option value="medium">30–60 сек.</option><option>До 30 сек.</option><option>60–90 сек.</option></select></label>
              </div>
            </section>

            <section>
              <h3>Как оформить</h3>
              <div className="project-drawer-styles">
                {styles.map((style) => (
                  <button
                    className={styleId === style.id ? "is-selected" : ""}
                    type="button"
                    key={style.id}
                    onClick={() => {
                      setStyleOverride(style.id);
                      setCaptions(style.captions !== "Выключены");
                      setSilence(style.silenceRemoval);
                    }}
                  >
                    <span style={{ background: `linear-gradient(135deg, ${style.colors[0]} 50%, ${style.colors[1]} 50%)` }} />
                    <b>{style.name}</b>
                    {styleId === style.id ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>
              <div className="project-setting-row">
                <span><Subtitles size={19} /><span><strong>Субтитры</strong><small>Применить к выбранным клипам</small></span></span>
                <Switch aria-label="Субтитры" isSelected={captions} onChange={setCaptions}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </div>
              <div className="project-setting-row">
                <span><WandSparkles size={19} /><span><strong>Удаление пауз</strong><small>Не обрезать окончания фраз</small></span></span>
                <Switch aria-label="Удаление пауз" isSelected={silence} onChange={setSilence}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </div>
              <Link href="/dashboard/styles">Изменить сам пресет <ChevronRight size={16} /></Link>
            </section>

            <div className="project-warning">
              <AlertTriangle size={18} />
              <span><strong>Повторного списания не будет.</strong> Новый поиск использует готовый транскрипт.</span>
            </div>

            <footer>
              <Button variant="outline" onPress={() => { trackApp("moments_recompute"); setSettingsOpen(false); }}>
                Найти новые варианты
              </Button>
              <Button onPress={() => { trackApp("style_apply", { style: styleId }); setSettingsOpen(false); }}>
                Применить
              </Button>
            </footer>
          </aside>
        </>
      ) : null}
    </main>
  );
}
