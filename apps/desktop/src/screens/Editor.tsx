import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Segmented, fmt } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { CLIPS, LAYOUTS, SUB_PRESETS } from "../data";
import { ExportModal } from "./ExportModal";

export function Editor({ clipId, preset, onPreset, onBack }: { clipId: string; preset: string; onPreset: (id: string) => void; onBack: () => void }) {
  const clip = CLIPS.find((c) => c.id === clipId) ?? CLIPS[0];
  const len = clip.end - clip.start;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layout, setLayout] = useState("blur");
  const [size, setSize] = useState<"s" | "m" | "l">("m");
  const [exporting, setExporting] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const sub = SUB_PRESETS.find((s) => s.id === preset) ?? SUB_PRESETS[0];

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => (v + 0.05 >= len ? (setPlaying(false), len) : v + 0.05)), 50);
    return () => clearInterval(id);
  }, [playing, len]);

  const words = useMemo(() => clip.caption.split(" "), [clip]);
  const per = len / Math.max(words.length * 2, 1);
  const wave = useMemo(() => Array.from({ length: 140 }, (_, i) => 18 + Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11)) * 70), []);
  const ticks = Array.from({ length: Math.floor(len / 10) + 1 }, (_, i) => i * 10);
  const activeWord = Math.min(words.length - 1, Math.floor(t / per) % words.length);
  const pct = (t / len) * 100;
  const fs = { s: 15, m: 19, l: 24 }[size];

  const seek = (e: React.MouseEvent) => {
    const r = track.current?.getBoundingClientRect();
    if (r) setT(Math.max(0, Math.min(len, ((e.clientX - r.left) / r.width) * len)));
  };

  return (
    <div className="editor" style={{ background: "var(--bg)" }}>
      <div className="editor__top">
        <Button variant="ghost" icon="back" onClick={onBack}>Клипы</Button>
        <b style={{ letterSpacing: "-0.01em" }}>{clip.title}</b>
        <Badge>{len} с</Badge>
        <span className="spacer" />
        <Badge tone="local"><Icon name="check" size={12} /> Сохранено на этом ПК</Badge>
        <Button variant="primary" icon="download" onClick={() => setExporting(true)}>Экспорт</Button>
      </div>

      <div className="editor__mid">
        <div className="panel panel--l">
          <div className="opt">
            <span className="eyebrow">Раскладка</span>
            <div className="opts">
              {LAYOUTS.map((l) => (
                <button key={l.id} className={`optcard${l.available ? "" : " optcard--locked"}`} aria-pressed={layout === l.id} disabled={!l.available} onClick={() => setLayout(l.id)}>
                  <b style={{ fontSize: 13 }}>{l.name}</b>
                  {l.available ? <small>{l.note}</small> : <small><Icon name="lock" size={11} /> Скоро</small>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="stage">
          <div className="phone">
            {layout === "split" && <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "var(--bg)" }} />}
            {layout === "blur" && <div style={{ position: "absolute", left: 0, right: 0, top: "28%", bottom: "28%", background: "linear-gradient(135deg,#5b3fb0,#0f3d56)" }} />}
            <div className="cap" style={{ bottom: "14%", fontSize: fs, ...sub.style }}>
              {words.map((w, i) => (
                <span key={i} style={i === activeWord ? sub.active : undefined}>{w}{i < words.length - 1 ? " " : ""}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="panel panel--r">
          <div className="opt">
            <span className="eyebrow">Субтитры</span>
            <div className="opts">
              {SUB_PRESETS.map((s) => (
                <button key={s.id} className="optcard" aria-pressed={preset === s.id} onClick={() => onPreset(s.id)}>
                  <span style={{ fontSize: 15, ...s.style }}>Аа Текст</span>
                  <small>{s.name}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="opt">
            <span className="eyebrow">Размер текста</span>
            <Segmented value={size} onChange={setSize} options={[{ id: "s", label: "Мелкий" }, { id: "m", label: "Средний" }, { id: "l", label: "Крупный" }]} />
          </div>
        </div>
      </div>

      <div className="timeline">
        <div className="tl__bar">
          <Button size="sm" icon={playing ? "pause" : "play"} onClick={() => { if (t >= len) setT(0); setPlaying(!playing); }}>{playing ? "Пауза" : "Играть"}</Button>
          <span className="mono muted">{fmt(t)} / {fmt(len)}</span>
        </div>
        <div className="tl__body">
          <div className="tl__labels"><div /><div>ВИДЕО</div><div>ЗВУК</div><div>ТЕКСТ</div></div>
          <div className="tl__tracks" ref={track} onClick={seek}>
            <div className="ruler">{ticks.map((s) => <span key={s} style={{ left: `${(s / len) * 100}%` }}>{fmt(s)}</span>)}</div>
            <div className="track"><div className="block block--video" style={{ left: 0, right: 0 }}>{clip.title}</div></div>
            <div className="track"><div className="wave">{wave.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div></div>
            <div className="track">
              {words.map((w, i) => (
                <div key={i} className="block block--text" style={{ left: `${((i * 2 * per) / len) * 100}%`, width: `${((per * 1.8) / len) * 100}%` }}>{w}</div>
              ))}
            </div>
            <div className="playhead" style={{ left: `${pct}%` }} />
          </div>
        </div>
      </div>
      {exporting && <ExportModal count={1} onClose={() => setExporting(false)} />}
    </div>
  );
}
