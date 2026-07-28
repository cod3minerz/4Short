"use client";

import { Button, Switch } from "@heroui/react";
import { Check, Copy, MoreHorizontal, Palette, Plus, UploadCloud } from "lucide-react";
import { useState } from "react";
import { styles as initialStyles } from "../data";
import { trackApp } from "../lib/track-app";
import { PageHeading } from "./page-heading";

export function StylesView() {
  const [activeId, setActiveId] = useState("main");
  const [captions, setCaptions] = useState(true);
  const [silence, setSilence] = useState(true);
  const [banner, setBanner] = useState(false);
  const active = initialStyles.find((style) => style.id === activeId) ?? initialStyles[0];

  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Пресеты"
        title="СТИЛИ"
        description="Сохраните оформление один раз и применяйте его ко всем новым проектам."
        actions={<Button onPress={() => trackApp("style_create")}><Plus size={18} /> Новый стиль</Button>}
      />

      <div className="styles-layout">
        <section className="styles-library" aria-label="Сохранённые стили">
          {initialStyles.map((style) => (
            <button
              className={`style-library-card ${activeId === style.id ? "is-active" : ""}`}
              type="button"
              key={style.id}
              onClick={() => setActiveId(style.id)}
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
                  {style.isDefault ? <small><Check size={13} /> По умолчанию</small> : null}
                </span>
                <p>{style.description}</p>
                <i><Palette size={15} /> {style.captions} · {style.framing}</i>
              </span>
              <MoreHorizontal size={19} />
            </button>
          ))}
          <button className="style-library-add" type="button" onClick={() => trackApp("style_create")}>
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
            <button type="button" aria-label="Дублировать стиль"><Copy size={18} /></button>
          </div>

          <div
            className="style-editor__preview"
            style={{ "--style-a": active.colors[0], "--style-b": active.colors[1] } as React.CSSProperties}
          >
            <span className="dash-media-mark">4S</span>
            {captions ? <div><span>ОДНА МЫСЛЬ</span><strong>СТАНОВИТСЯ</strong><span>ЦЕЛЫМ КЛИПОМ</span></div> : null}
            {banner ? <small>ВАШ БАННЕР</small> : null}
          </div>

          <div className="style-editor__settings">
            <label>
              <span><strong>Название</strong><small>Видно только вам</small></span>
              <input defaultValue={active.name} />
            </label>
            <label>
              <span><strong>Кадрирование</strong><small>Безопасный fallback при ошибке трекинга</small></span>
              <select defaultValue="auto"><option value="auto">Автоматически</option><option>Активный спикер</option><option>Два спикера</option><option>Фон с размытием</option></select>
            </label>
            <div className="style-editor__switch">
              <span><strong>Субтитры</strong><small>Выделять активное слово</small></span>
              <Switch aria-label="Субтитры" isSelected={captions} onChange={setCaptions}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
            </div>
            <div className="style-editor__colors">
              <span><strong>Цвета субтитров</strong><small>Основной и активный</small></span>
              <div><button style={{ background: active.colors[0] }} aria-label="Основной цвет" /><button style={{ background: active.colors[1] }} aria-label="Акцентный цвет" /></div>
            </div>
            <div className="style-editor__switch">
              <span><strong>Удалять паузы</strong><small>Длиннее 0,8 секунды</small></span>
              <Switch aria-label="Удалять паузы" isSelected={silence} onChange={setSilence}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
            </div>
            <div className="style-editor__switch">
              <span><strong>Рекламный баннер</strong><small>Учитывает безопасную зону субтитров</small></span>
              <Switch aria-label="Рекламный баннер" isSelected={banner} onChange={setBanner}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
            </div>
            {banner ? <button className="style-upload-asset" type="button"><UploadCloud size={17} /> Загрузить баннер</button> : null}
          </div>

          <div className="style-editor__footer">
            <Button variant="outline">Сохранить копию</Button>
            <Button onPress={() => trackApp("style_apply", { style: active.id })}>Сохранить изменения</Button>
          </div>
        </aside>
      </div>
    </main>
  );
}

