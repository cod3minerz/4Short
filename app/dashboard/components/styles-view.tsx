"use client";

import { Button } from "@heroui/react";
import { Check, Copy, Palette, Plus } from "lucide-react";
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
import { ColorField } from "./ui/ColorField";
import { LockedField } from "./ui/LockedField";
import { MediaThumb } from "./ui/MediaThumb";
import { OptionCard } from "./ui/OptionCard";
import { Select } from "./ui/Select";
import { SubtitlePreviewOverlay } from "./ui/SubtitlePreviewOverlay";
import { Switch } from "./ui/Switch";

const subtitlePresets = [
  ["clean", "Clean", "Без затемнения и анимаций"],
  ["bold", "Bold", "Крупный текст с сильным акцентом"],
  ["karaoke", "Karaoke", "Слово подчёркивается по ходу речи"],
  ["active_word", "Active Word", "Текущее слово выделяется цветом"],
  ["word_pop", "Word Pop", "Слово увеличивается при озвучке"],
  ["minimal_box", "Minimal Box", "Светлая плашка под текстом"],
  ["speaker_colors", "Speaker Colors", "Свой цвет под каждого спикера"],
] as const;

const framingOptions = [
  "Автоматически",
  "Активный спикер",
  "Два спикера",
  "Фон с размытием",
  "Статичный кадр",
].map((label) => ({ id: label, label }));

const fontOptions = ["Manrope", "Inter", "Onest", "Montserrat"].map((label) => ({ id: label, label }));

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
          <Button onPress={startNewStyle}>
            <Plus size={18} /> Новый стиль
          </Button>
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
              <MediaThumb aspect="9:16" tone="ink" className="style-library-card__thumb" alt={style.name} />
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
                <span className="style-library-card__swatches" aria-hidden="true">
                  <i style={{ background: style.colors[0] }} />
                  <i style={{ background: style.colors[1] }} />
                </span>
              </span>
            </button>
          ))}
          <button className="style-library-add" type="button" onClick={startNewStyle}>
            <Plus size={20} />
            <span><strong>Создать новый стиль</strong><small>Настройте субтитры, кадр и брендирование</small></span>
          </button>
        </section>

        <div className="styles-editor-column">
        <div className="style-editor">
          <div
            className="style-editor__preview"
            style={{
              "--style-a": active.colors[0],
              "--style-b": active.colors[1],
              // The preview used to hardcode the font and pin captions to the
              // bottom, so the font and position pickers had no visible effect.
              "--style-font": active.fontFamily,
            } as React.CSSProperties}
          >
            <span className="dash-media-mark">HP</span>
            {active.captions !== "Выключены" ? (
              <SubtitlePreviewOverlay
                text="ОДНА МЫСЛЬ СТАНОВИТСЯ ЦЕЛЫМ КЛИПОМ"
                preset={active.subtitlePreset}
                fontFamily={active.fontFamily}
                position={active.subtitlePosition}
                color={active.colors[0]}
                activeColor={active.colors[1]}
              />
            ) : null}
            {active.banner ? <small>ВАШ БАННЕР</small> : null}
          </div>

          <div className="style-editor__main">
            <header className="style-editor__head">
              <div>
                <span className="dash-eyebrow">Редактирование стиля</span>
                <h2>{active.name}</h2>
              </div>
              <button
                type="button"
                className="style-editor__duplicate"
                onClick={() => {
                  const id = duplicateStyle(active.id);
                  if (id) setActiveOverride(id);
                }}
              >
                <Copy size={16} /> Дублировать
              </button>
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
                  options={framingOptions}
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
                  <div className="option-card-grid style-preset-grid">
                    {subtitlePresets.map(([id, label, description]) => (
                      <OptionCard
                        key={id}
                        icon={<b className={`preset-sample preset-${id}`}>ABC</b>}
                        title={label}
                        description={description}
                        selected={active.subtitlePreset === id}
                        onSelect={() => patch({ subtitlePreset: id })}
                      />
                    ))}
                  </div>

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
            <Button
              variant="outline"
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
            </Button>
          ) : <span className="style-saved-state"><Check size={15} /> Стиль по умолчанию</span>}
          <Button
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
          </Button>
          {saveError ? <p className="dash-field-error" role="alert">{saveError}</p> : null}
        </div>
        </div>
      </div>
    </main>
  );
}
