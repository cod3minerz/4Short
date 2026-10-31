import { useState } from "react";
import { Button, Badge, PageHead, Segmented } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { pickVideo } from "../lib/tauri";
import { SUB_PRESETS } from "../data";

export type Source = { kind: "file" | "url"; label: string };
export type Settings = { length: "15-30" | "30-60" | "60-90"; count: "auto" | "5" | "10" | "20"; lang: "auto" | "ru" | "en"; format: "9:16" | "1:1" | "4:5" };

const HOSTS = ["YouTube", "VK Видео", "RuTube", "Twitch"];

export function NewProject(p: {
  source: Source | null; onSource: (s: Source | null) => void;
  settings: Settings; onSettings: (s: Settings) => void;
  preset: string; onPreset: (id: string) => void; onStart: () => void;
}) {
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => p.onSettings({ ...p.settings, [k]: v });
  const validUrl = /^https?:\/\/\S+\.\S+/.test(url.trim());

  const choose = async () => {
    const f = await pickVideo();
    if (f) p.onSource({ kind: "file", label: f.name });
  };

  return (
    <div className="page">
      <PageHead title="Что нарезаем сегодня?" sub="Загрузите видео или вставьте ссылку. ИИ найдёт лучшие моменты и подготовит клипы." />

      {p.source ? (
        <div className="chosen">
          <div className="thumb thumb--sm" />
          <div>
            <b>{p.source.label}</b>
            <div className="muted" style={{ fontSize: 13 }}>{p.source.kind === "file" ? "Файл на этом компьютере" : "Ссылка"}</div>
          </div>
          <span className="spacer" />
          <Button variant="ghost" size="sm" icon="x" onClick={() => p.onSource(null)}>Убрать</Button>
        </div>
      ) : (
        <>
          <div
            className={`drop${over ? " drop--over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) p.onSource({ kind: "file", label: f.name }); }}
          >
            <div className="drop__icon"><Icon name="upload" size={26} /></div>
            <div>
              <h2>Перетащите видео сюда</h2>
              <p className="muted" style={{ marginTop: 6 }}>MP4, MOV, MKV, WebM. Файл не покидает ваш компьютер.</p>
            </div>
            <Button variant="primary" size="lg" icon="film" onClick={choose}>Выбрать файл</Button>
          </div>
          <div className="divider">или</div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <Icon name="link" />
              <input placeholder="Вставьте ссылку на видео" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <Button size="lg" disabled={!validUrl} onClick={() => p.onSource({ kind: "url", label: url.trim() })}>Добавить</Button>
          </div>
          <div className="row" style={{ marginTop: -16 }}>
            <span className="faint" style={{ fontSize: 12 }}>Поддерживаются:</span>
            {HOSTS.map((h) => <Badge key={h}>{h}</Badge>)}
          </div>
        </>
      )}

      <div className="settings">
        <div className="card setting">
          <span className="eyebrow">Длина клипа</span>
          <Segmented value={p.settings.length} onChange={(v) => set("length", v)} options={[{ id: "15-30", label: "15–30 с" }, { id: "30-60", label: "30–60 с" }, { id: "60-90", label: "60–90 с" }]} />
        </div>
        <div className="card setting">
          <span className="eyebrow">Сколько клипов</span>
          <Segmented value={p.settings.count} onChange={(v) => set("count", v)} options={[{ id: "auto", label: "Авто" }, { id: "5", label: "5" }, { id: "10", label: "10" }, { id: "20", label: "20" }]} />
        </div>
        <div className="card setting">
          <span className="eyebrow">Язык речи</span>
          <Segmented value={p.settings.lang} onChange={(v) => set("lang", v)} options={[{ id: "auto", label: "Авто" }, { id: "ru", label: "Русский" }, { id: "en", label: "English" }]} />
        </div>
        <div className="card setting">
          <span className="eyebrow">Формат</span>
          <Segmented value={p.settings.format} onChange={(v) => set("format", v)} options={[{ id: "9:16", label: "9:16" }, { id: "1:1", label: "1:1" }, { id: "4:5", label: "4:5" }]} />
        </div>
        <div className="card setting" style={{ gridColumn: "span 2" }}>
          <span className="eyebrow">Стиль субтитров</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {SUB_PRESETS.map((s) => (
              <button key={s.id} className="btn btn--sm" aria-pressed={p.preset === s.id}
                style={p.preset === s.id ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
                onClick={() => p.onPreset(s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="notice">
        <Icon name="shield" />
        <div>
          <b>Как это работает.</b> Речь распознаётся на вашем компьютере. На сервер уходит только текст, чтобы ИИ выбрал лучшие моменты. Видео и звук не загружаются.
        </div>
      </div>

      <div className="row">
        <span className="spacer" />
        <Button variant="primary" size="lg" icon="sparkle" disabled={!p.source} onClick={p.onStart}>Начать нарезку</Button>
      </div>
    </div>
  );
}
