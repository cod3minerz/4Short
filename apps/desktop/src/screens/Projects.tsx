import { useState } from "react";
import { Badge, Button, PageHead, Segmented, fmt } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { PROJECTS } from "../data";

export function Projects({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [f, setF] = useState<"all" | "ready" | "processing">("all");
  const [q, setQ] = useState("");
  const list = PROJECTS.filter((p) => (f === "all" || p.status === f) && p.title.toLowerCase().includes(q.toLowerCase()));
  const h = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="page">
      <PageHead title="Проекты" sub={`${PROJECTS.length} проектов на этом компьютере`}>
        <Button variant="primary" icon="plus" onClick={onNew}>Новый проект</Button>
      </PageHead>
      <div className="row">
        <label className="field" style={{ width: 320, height: 40 }}>
          <Icon name="search" />
          <input placeholder="Найти проект" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented value={f} onChange={setF} options={[{ id: "all", label: "Все" }, { id: "ready", label: "Готовые" }, { id: "processing", label: "В работе" }]} />
      </div>
      {list.length === 0 ? (
        <div className="empty"><Icon name="folder" size={28} /><b>Ничего не найдено</b><span>Попробуйте другой запрос</span></div>
      ) : (
        <div className="grid">
          {list.map((p) => (
            <button key={p.id} className="card pcard" onClick={() => p.status === "ready" && onOpen(p.id)} disabled={p.status !== "ready"} style={{ cursor: p.status === "ready" ? "pointer" : "default" }}>
              <div className="pcard__cover thumb" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 55% 22%), hsl(${(p.hue + 50) % 360} 60% 10%))`, borderRadius: 0 }}>
                <span className="pcard__dur">{h(p.duration)}</span>
              </div>
              <div className="pcard__body">
                <b>{p.title}</b>
                <div className="row">
                  {p.status === "ready" ? <Badge tone="local"><Icon name="check" size={12} /> {p.clips} клипов</Badge> : <Badge tone="warn">Обрабатывается</Badge>}
                  <span className="spacer" />
                  <span className="faint" style={{ fontSize: 12 }}>{p.date}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <span className="faint" style={{ fontSize: 12 }}>Всего времени видео: {fmt(PROJECTS.reduce((a, p) => a + p.duration, 0))} мин</span>
    </div>
  );
}
