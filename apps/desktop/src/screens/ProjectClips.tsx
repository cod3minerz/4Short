import { useState } from "react";
import { Badge, Button, PageHead, fmt } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { CLIPS, SUB_PRESETS, type Project } from "../data";
import { ExportModal } from "./ExportModal";

const tone = (s: number) => (s >= 90 ? "var(--ok)" : s >= 80 ? "var(--signal)" : "var(--warn)");

export function ProjectClips(p: { project: Project; clipId: string; onClip: (id: string) => void; preset: string; onBack: () => void; onEdit: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(["c1", "c2", "c3"]));
  const [exporting, setExporting] = useState(false);
  const clip = CLIPS.find((c) => c.id === p.clipId) ?? CLIPS[0];
  const sub = SUB_PRESETS.find((s) => s.id === p.preset) ?? SUB_PRESETS[0];
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="page">
      <PageHead title={p.project.title} sub={`ИИ нашёл ${CLIPS.length} моментов. Отметьте нужные и откройте в редакторе.`}>
        <Button variant="ghost" icon="back" onClick={p.onBack}>Проекты</Button>
        <Button variant="primary" icon="download" disabled={picked.size === 0} onClick={() => setExporting(true)}>Экспорт ({picked.size})</Button>
      </PageHead>
      <div className="split">
        <div className="clips">
          {CLIPS.map((c) => (
            <button key={c.id} className="clip" aria-selected={c.id === clip.id} onClick={() => p.onClip(c.id)}>
              <span className="check" data-on={picked.has(c.id)} role="checkbox" aria-checked={picked.has(c.id)} onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>
                <Icon name="check" size={14} />
              </span>
              <span className="score" style={{ color: tone(c.score), background: `conic-gradient(${tone(c.score)} ${c.score}%, var(--surface-3) 0)`, position: "relative" }}>
                <span style={{ position: "absolute", inset: 4, borderRadius: "50%", background: "var(--surface-1)", display: "grid", placeItems: "center" }}>{c.score}</span>
              </span>
              <span className="clip__t">
                <b>{c.title}</b>
                <span className="muted" style={{ fontSize: 13 }}>{fmt(c.start)} – {fmt(c.end)} · {c.end - c.start} с</span>
              </span>
              <Badge>{c.topic}</Badge>
            </button>
          ))}
        </div>
        <aside className="sticky">
          <div className="phone phone--sm">
            <div className="cap" style={{ bottom: "18%", fontSize: 17, ...sub.style }}>{clip.caption}</div>
          </div>
          <div>
            <b>{clip.title}</b>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Оценка ИИ {clip.score}. Субтитры: {sub.name}.</p>
          </div>
          <Button variant="primary" icon="scissors" onClick={p.onEdit}>Открыть в редакторе</Button>
        </aside>
      </div>
      {exporting && <ExportModal count={picked.size} onClose={() => setExporting(false)} />}
    </div>
  );
}
