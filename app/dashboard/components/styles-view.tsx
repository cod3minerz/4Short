"use client";

import { Button } from "@heroui/react";
import { Check, Copy, MoreHorizontal, Palette, Plus, UploadCloud } from "lucide-react";
import { useState } from "react";
import { trackApp } from "../lib/track-app";
import {
  createStyle,
  duplicateStyle,
  saveStyle,
  setDefaultStyle,
  updateStyle,
  useDashboardStore,
} from "../store";
import { DashboardSwitch } from "./dashboard-switch";
import { PageHeading } from "./page-heading";

export function StylesView() {
  const { styles, defaultStyleId, connection, error, savingStyleId } = useDashboardStore();
  const [activeOverride, setActiveOverride] = useState<string | null>(null);
  const activeId = activeOverride ?? defaultStyleId;
  const [saved, setSaved] = useState(false);
  const active = styles.find((style) => style.id === activeId) ?? styles[0];

  const patch = (value: Parameters<typeof updateStyle>[1]) => {
    updateStyle(active.id, value);
    setSaved(false);
  };

  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Пресеты"
        title="СТИЛИ"
        description="Сохраните оформление один раз и применяйте его ко всем новым проектам."
        actions={
          <Button
            onPress={() => {
              const id = createStyle();
              setActiveOverride(id);
              trackApp("style_create");
            }}
          >
            <Plus size={18} /> Новый стиль
          </Button>
        }
      />

      {connection !== "connected" ? (
        <div className={`dashboard-connection-notice is-${connection}`} role="status">
          <strong>{connection === "preview" ? "Локальный preview" : connection === "loading" ? "Подключаем кабинет" : "API недоступен"}</strong>
          <span>
            {connection === "preview"
              ? "Изменения сохраняются только в этом браузере. Подключите NEXT_PUBLIC_CONTROL_API_URL для серверных версий пресетов."
              : error ?? "Загружаем сохранённые стили."}
          </span>
        </div>
      ) : null}

      <div className="styles-layout">
        <section className="styles-library" aria-label="Сохранённые стили">
          {styles.map((style) => (
            <button
              className={`style-library-card ${activeId === style.id ? "is-active" : ""}`}
              type="button"
              key={style.id}
              onClick={() => setActiveOverride(style.id)}
            >
              <span
                className="style-library-card__preview"
                style={{ "--style-a": style.colors[0], "--style-b": style.colors[1] } as React.CSSProperties}
              >
                <span className="dash-media-mark">4S</span>
                <span><i>СИЛЬНАЯ МЫСЛЬ</i><b>ОСТАЁТСЯ</b><i>В КАДРЕ</i></span>
              </span>
              <span className="style-library-card__body">
                <span>
                  <b>{style.name}</b>
                  {style.id === defaultStyleId ? <small><Check size={13} /> По умолчанию</small> : null}
                </span>
                <p>{style.description}</p>
                <i><Palette size={15} /> {style.captions} · {style.framing}</i>
              </span>
              <MoreHorizontal size={19} />
            </button>
          ))}
          <button
            className="style-library-add"
            type="button"
            onClick={() => {
              const id = createStyle();
              setActiveOverride(id);
              trackApp("style_create");
            }}
          >
            <Plus size={21} />
            <span><strong>Создать новый стиль</strong><small>Настройте субтитры, кадр и брендирование</small></span>
          </button>
        </section>

        <aside className="style-editor">
          <div className="style-editor__head">
            <div>
              <span className="dash-eyebrow">Редактирование</span>
              <h2>{active.name}</h2>
            </div>
            <button
              type="button"
              aria-label="Дублировать стиль"
              onClick={() => {
                const id = duplicateStyle(active.id);
                if (id) setActiveOverride(id);
              }}
            >
              <Copy size={18} />
            </button>
          </div>

          <div
            className="style-editor__preview"
            style={{ "--style-a": active.colors[0], "--style-b": active.colors[1] } as React.CSSProperties}
          >
            <span className="dash-media-mark">4S</span>
            {active.captions !== "Выключены" ? <div><span>ОДНА МЫСЛЬ</span><strong>СТАНОВИТСЯ</strong><span>ЦЕЛЫМ КЛИПОМ</span></div> : null}
            {active.banner ? <small>ВАШ БАННЕР</small> : null}
          </div>

          <div className="style-editor__settings">
            <label>
              <span><strong>Название</strong><small>Видно только вам</small></span>
              <input value={active.name} onChange={(event) => patch({ name: event.target.value })} />
            </label>
            <label>
              <span><strong>Кадрирование</strong><small>Безопасный fallback при ошибке трекинга</small></span>
              <select value={active.framing} onChange={(event) => patch({ framing: event.target.value })}>
                <option>Автоматически</option>
                <option>Активный спикер</option>
                <option>Два спикера</option>
                <option>Фон с размытием</option>
                <option>Статичный кадр</option>
              </select>
            </label>
            <div className="style-editor__switch">
              <span><strong>Субтитры</strong><small>Выделять активное слово</small></span>
              <DashboardSwitch
                checked={active.captions !== "Выключены"}
                label="Субтитры"
                onCheckedChange={(value) => patch({ captions: value ? "Активное слово" : "Выключены" })}
              />
            </div>
            <div className="style-editor__colors">
              <span><strong>Цвета субтитров</strong><small>Основной и активный</small></span>
              <div>
                <label aria-label="Основной цвет">
                  <input
                    type="color"
                    value={active.colors[0]}
                    onChange={(event) => patch({ colors: [event.target.value, active.colors[1]] })}
                  />
                </label>
                <label aria-label="Акцентный цвет">
                  <input
                    type="color"
                    value={active.colors[1]}
                    onChange={(event) => patch({ colors: [active.colors[0], event.target.value] })}
                  />
                </label>
              </div>
            </div>
            <div className="style-editor__switch">
              <span><strong>Удалять паузы</strong><small>Длиннее 0,8 секунды</small></span>
              <DashboardSwitch
                checked={active.silenceRemoval}
                label="Удалять паузы"
                onCheckedChange={(value) => patch({ silenceRemoval: value })}
              />
            </div>
            <div className="style-editor__switch">
              <span><strong>Рекламный баннер</strong><small>Учитывает безопасную зону субтитров</small></span>
              <DashboardSwitch
                checked={active.banner}
                label="Рекламный баннер"
                onCheckedChange={(value) => patch({ banner: value })}
              />
            </div>
            {active.banner ? <button className="style-upload-asset" type="button"><UploadCloud size={17} /> Загрузить баннер</button> : null}
          </div>

          <div className="style-editor__footer">
            {active.id !== defaultStyleId ? (
              <Button variant="outline" onPress={() => void setDefaultStyle(active.id)}>Использовать по умолчанию</Button>
            ) : <span className="style-saved-state"><Check size={15} /> Стиль по умолчанию</span>}
            <Button
              isPending={savingStyleId === active.id}
              onPress={async () => {
                try {
                  await saveStyle(active.id);
                  setSaved(true);
                  trackApp("style_apply", { style: active.id });
                } catch {
                  setSaved(false);
                }
              }}
            >
              {saved && !active.dirty ? <><Check size={16} /> Сохранено</> : "Сохранить изменения"}
            </Button>
          </div>
        </aside>
      </div>
    </main>
  );
}
