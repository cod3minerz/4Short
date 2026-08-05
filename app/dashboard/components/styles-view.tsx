"use client";

import { Check, Copy, Palette, Plus, Subtitles } from "lucide-react";
import { useState } from "react";
import { ControlApiError } from "../lib/control-api";
import { trackApp } from "../lib/track-app";
import {
  createStyle,
  duplicateStyle,
  saveStyle,
  setDefaultStyle,
  updateStyle,
  useDashboardStore,
} from "../store";
import type { StylePreset } from "../types";
import { PageHeading } from "./page-heading";
import { ActionButton } from "./ui/ActionButton";
import { ColorField } from "./ui/ColorField";
import { LockedField } from "./ui/LockedField";
import { Select } from "./ui/Select";
import { Switch } from "./ui/Switch";

const subtitlePresets = [
  { id: "clean", label: "Clean", description: "Спокойный текст без подложки и анимации" },
  { id: "bold", label: "Bold", description: "Контрастный крупный текст для коротких фраз" },
  { id: "karaoke", label: "Karaoke", description: "Активное слово двигается вместе с речью" },
  { id: "active_word", label: "Активное слово", description: "Текущее слово выделяется выбранным цветом" },
  { id: "word_pop", label: "Word Pop", description: "Короткое увеличение на произнесённом слове" },
  { id: "minimal_box", label: "Minimal Box", description: "Сдержанная подложка за строкой субтитров" },
  { id: "speaker_colors", label: "По спикерам", description: "Разные цвета для распознанных участников" },
] as const satisfies ReadonlyArray<{ id: StylePreset["subtitlePreset"]; label: string; description: string }>;

const framingOptions = [
  "Автоматически",
  "Активный спикер",
  "Два спикера",
  "Фон с размытием",
  "Статичный кадр",
].map((label) => ({ id: label, label }));

const fontOptions = ["HVE Sans"].map((label) => ({ id: label, label }));

const positionOptions: Array<{ id: StylePreset["subtitlePosition"]; label: string }> = [
  { id: "top", label: "Сверху" },
  { id: "center", label: "По центру" },
  { id: "bottom", label: "Снизу" },
];

export function StylesView() {
  const { styles, defaultStyleId, connection, error, savingStyleId } = useDashboardStore();
  const [activeOverride, setActiveOverride] = useState<string | null>(null);
  const activeId = activeOverride ?? defaultStyleId;
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const active = styles.find((style) => style.id === activeId) ?? styles[0];
  // Asset- and participant-backed layouts are edited in the clip editor, but
  // an existing preset must still display its true layout instead of looking
  // like it has become `auto` in this compact screen.
  const activeFramingOptions = active && !framingOptions.some((option) => option.id === active.framing)
    ? [{ id: active.framing, label: `${active.framing} — настраивается в редакторе` }, ...framingOptions]
    : framingOptions;
  const activeSubtitlePreset = subtitlePresets.find((preset) => preset.id === active?.subtitlePreset)
    ?? subtitlePresets[0];

  const patch = (value: Parameters<typeof updateStyle>[1]) => {
    if (!active) return;
    updateStyle(active.id, value);
    setSaved(false);
  };

  const startNewStyle = () => {
    const id = createStyle();
    setActiveOverride(id);
    trackApp("style_create");
  };

  const connectionNotice = connection !== "connected" ? (
    <div className={`dashboard-connection-notice is-${connection}`} role="status">
      <strong>{connection === "preview" ? "Демо-режим" : connection === "loading" ? "Подключаем кабинет" : "Сервис временно недоступен"}</strong>
      <span>
        {connection === "preview"
          ? "Изменения сохраняются в этом браузере. После входа пресеты будут доступны на других устройствах."
          : error ?? "Загружаем сохранённые стили."}
      </span>
    </div>
  ) : null;

  if (!active) {
    return (
      <main className="dash-page">
        <PageHeading
          eyebrow="Пресеты"
          title="Стили"
          description="Сохраните оформление один раз и применяйте его ко всем новым проектам."
        />
        {connectionNotice}
        <div className="dash-empty-state">
          <Palette size={24} />
          <h2>Стили не загружены</h2>
          <p>{connection === "loading" ? "Загружаем сохранённые стили…" : "Не удалось загрузить стили. Обновите страницу."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Пресеты"
        title="Стили"
        description="Сохраните оформление один раз и применяйте его ко всем новым проектам."
        actions={
          <ActionButton onPress={startNewStyle}>
            <Plus size={18} /> Новый стиль
          </ActionButton>
        }
      />

      {connectionNotice}

      <div className="styles-layout">
        <section className="styles-library" aria-label="Сохранённые стили">
          {styles.map((style) => (
            <button
              className={`style-library-card ${activeId === style.id ? "is-active" : ""}`}
              type="button"
              key={style.id}
              onClick={() => setActiveOverride(style.id)}
            >
              <span className="style-library-card__body">
                <span className="style-library-card__title">
                  <b>{style.name}</b>
                  {style.id === defaultStyleId ? (
                    <small className="style-library-card__default"><Check size={12} /> По умолчанию</small>
                  ) : null}
                </span>
                <span className="style-library-card__meta">
                  {style.captions !== "Выключены" ? style.captions : "Без субтитров"} · {style.framing}
                </span>
                <span className="style-library-card__tag">
                  <Subtitles size={13} aria-hidden="true" />
                  {style.captions === "Выключены" ? "Без субтитров" : style.captions}
                </span>
              </span>
            </button>
          ))}
          <ActionButton className="style-library-add" tone="secondary" onPress={startNewStyle}>
            <Plus size={20} />
            <span><strong>Создать новый стиль</strong><small>Настройте субтитры, кадр и брендирование</small></span>
          </ActionButton>
        </section>

        <div className="styles-editor-column">
          <div className="style-editor">
          <div className="style-editor__main">
            <header className="style-editor__head">
              <div>
                <span className="dash-eyebrow">Редактирование стиля</span>
                <h2>{active.name}</h2>
              </div>
              <ActionButton
                tone="secondary"
                className="style-editor__duplicate"
                onPress={() => {
                  const id = duplicateStyle(active.id);
                  if (id) setActiveOverride(id);
                }}
              >
                <Copy size={16} /> Дублировать
              </ActionButton>
            </header>

            <label className="style-field style-editor__name">
              <span><strong>Название</strong><small>Видно только вам</small></span>
              <input value={active.name} onChange={(event) => patch({ name: event.target.value })} />
            </label>

            <section className="style-section">
              <h3>Кадр</h3>
              <label className="style-field">
                <span><strong>Кадрирование</strong><small>Безопасный fallback при ошибке трекинга</small></span>
                <Select
                  options={activeFramingOptions}
                  value={active.framing}
                  onChange={(value) => patch({ framing: value })}
                  aria-label="Кадрирование"
                  fullWidth
                />
              </label>
            </section>

            <section className="style-section">
              <div className="style-section__head">
                <h3>Субтитры</h3>
                <Switch
                  checked={active.captions !== "Выключены"}
                  aria-label="Субтитры"
                  onCheckedChange={(value) => patch({ captions: value ? "Активное слово" : "Выключены" })}
                />
              </div>

              {active.captions !== "Выключены" ? (
                <>
                  <label className="style-field">
                    <span><strong>Оформление</strong><small>{activeSubtitlePreset.description}</small></span>
                      <Select
                      options={subtitlePresets.map(({ id, label }) => ({ id, label }))}
                      value={active.subtitlePreset}
                      onChange={(value) => patch({ subtitlePreset: value as StylePreset["subtitlePreset"] })}
                      aria-label="Оформление субтитров"
                      fullWidth
                    />
                  </label>

                  <div className="style-field-row">
                    <label className="style-field">
                      <span><strong>Шрифт</strong></span>
                      <Select
                        options={fontOptions}
                        value={active.fontFamily}
                        onChange={(value) => patch({ fontFamily: value })}
                        aria-label="Шрифт субтитров"
                        fullWidth
                      />
                    </label>
                    <label className="style-field">
                      <span><strong>Положение</strong></span>
                      <Select
                        options={positionOptions}
                        value={active.subtitlePosition}
                        onChange={(value) => patch({ subtitlePosition: value as StylePreset["subtitlePosition"] })}
                        aria-label="Положение субтитров"
                        fullWidth
                      />
                    </label>
                  </div>

                  <div className="style-field">
                    <span><strong>Цвета субтитров</strong><small>Основной и активный</small></span>
                    <div className="style-editor__colors">
                      <ColorField
                        label="Основной"
                        value={active.colors[0]}
                        onChange={(value) => patch({ colors: [value, active.colors[1]] })}
                      />
                      <ColorField
                        label="Активный"
                        value={active.colors[1]}
                        onChange={(value) => patch({ colors: [active.colors[0], value] })}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </section>

            <section className="style-section">
              <h3>Клип</h3>
              <div className="style-editor__switch">
                <span><strong>Удалять паузы</strong><small>Длиннее 0,8 секунды</small></span>
                <Switch
                  checked={active.silenceRemoval}
                  aria-label="Удалять паузы"
                  onCheckedChange={(value) => patch({ silenceRemoval: value })}
                />
              </div>
              <div className="style-editor__switch">
                <span><strong>Заголовок клипа</strong><small>Автоматический или введённый вручную</small></span>
                <Switch
                  checked={active.title}
                  aria-label="Заголовок клипа"
                  onCheckedChange={(value) => patch({ title: value })}
                />
              </div>
              <div className="style-editor__switch">
                <span><strong>Логотип</strong><small>С безопасным отступом от интерфейса соцсетей</small></span>
                <Switch
                  checked={active.logo}
                  aria-label="Логотип"
                  onCheckedChange={(value) => patch({ logo: value })}
                />
              </div>
              <div className="style-editor__switch">
                <span><strong>Рекламный баннер</strong><small>Учитывает безопасную зону субтитров</small></span>
                <Switch
                  checked={active.banner}
                  aria-label="Рекламный баннер"
                  onCheckedChange={(value) => patch({ banner: value })}
                />
              </div>
              {active.banner ? (
                <LockedField
                  label="Загрузить баннер"
                  reason="Нужна загрузка своих изображений — пока недоступно"
                />
              ) : null}
            </section>
          </div>
          </div>

        <div className="style-editor__footer">
          {active.id !== defaultStyleId ? (
            <ActionButton
              tone="secondary"
              onPress={async () => {
                setSaveError("");
                try {
                  await setDefaultStyle(active.id);
                } catch (error) {
                  setSaveError(error instanceof ControlApiError ? error.message : "Не удалось изменить стиль по умолчанию. Проверьте соединение и попробуйте ещё раз.");
                }
              }}
            >
              Использовать по умолчанию
            </ActionButton>
          ) : <span className="style-saved-state"><Check size={15} /> Стиль по умолчанию</span>}
          <ActionButton
            isPending={savingStyleId === active.id}
            onPress={async () => {
              setSaveError("");
              try {
                await saveStyle(active.id);
                setSaved(true);
                trackApp("style_apply", { style: active.id });
              } catch (error) {
                setSaved(false);
                setSaveError(error instanceof ControlApiError ? error.message : "Не удалось сохранить стиль. Проверьте соединение и попробуйте ещё раз.");
              }
            }}
          >
            {saved && !active.dirty ? <><Check size={16} /> Сохранено</> : "Сохранить изменения"}
          </ActionButton>
          {saveError ? <p className="dash-field-error" role="alert">{saveError}</p> : null}
        </div>
        </div>
      </div>
    </main>
  );
}
