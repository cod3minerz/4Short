import { useState } from "react";
import { Badge, PageHead, Segmented } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { LAYOUTS, SUB_PRESETS } from "../data";

export function Presets({ preset, onPreset }: { preset: string; onPreset: (id: string) => void }) {
  const [tab, setTab] = useState<"subs" | "layouts">("subs");
  const [layout, setLayout] = useState("blur");
  return (
    <div className="page">
      <PageHead title="Пресеты" sub="Выбранный пресет применяется ко всем новым клипам. В редакторе его можно изменить.">
        <Segmented value={tab} onChange={setTab} options={[{ id: "subs", label: "Субтитры" }, { id: "layouts", label: "Раскладки" }]} />
      </PageHead>
      {tab === "subs" ? (
        <div className="pgrid">
          {SUB_PRESETS.map((s) => (
            <button key={s.id} className="card preset" aria-pressed={preset === s.id} onClick={() => onPreset(s.id)}>
              <div className="preset__view"><div className="cap" style={s.style}>как это <span style={s.active}>будет</span> выглядеть</div></div>
              <div className="row"><div><b>{s.name}</b><div className="muted" style={{ fontSize: 13 }}>{s.note}</div></div><span className="spacer" />{preset === s.id && <Badge tone="accent">Выбран</Badge>}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="pgrid">
          {LAYOUTS.map((l) => (
            <button key={l.id} className="card preset" aria-pressed={layout === l.id} disabled={!l.available} style={{ opacity: l.available ? 1 : 0.55, cursor: l.available ? "pointer" : "not-allowed" }} onClick={() => setLayout(l.id)}>
              <div className="preset__view">
                {l.id === "blur" && <div style={{ position: "absolute", left: 0, right: 0, top: "30%", bottom: "30%", background: "linear-gradient(135deg,#5b3fb0,#0f3d56)" }} />}
                {l.id === "split" && <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "var(--bg)" }} />}
                {!l.available && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-2)" }}><Icon name="lock" size={22} /></div>}
              </div>
              <div className="row"><div><b>{l.name}</b><div className="muted" style={{ fontSize: 13 }}>{l.note}</div></div><span className="spacer" />{!l.available ? <Badge>Скоро</Badge> : layout === l.id && <Badge tone="accent">Выбрана</Badge>}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
