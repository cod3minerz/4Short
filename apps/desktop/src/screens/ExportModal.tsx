import { useEffect, useState } from "react";
import { Bar, Button, Segmented, Toggle } from "../ui/kit";

export function ExportModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [res, setRes] = useState<"720" | "1080">("1080");
  const [gpu, setGpu] = useState(true);
  const [run, setRun] = useState(false);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => setPct((v) => Math.min(100, v + 4)), 90);
    return () => clearInterval(id);
  }, [run]);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Экспорт">
        <div className="row"><h2 style={{ fontSize: 20, letterSpacing: "-0.02em" }}>Экспорт {count} клипов</h2><span className="spacer" /><Button variant="ghost" icon="x" onClick={onClose} aria-label="Закрыть" /></div>
        {!run ? (
          <>
            <div className="row"><span>Качество</span><span className="spacer" /><Segmented value={res} onChange={setRes} options={[{ id: "720", label: "720p" }, { id: "1080", label: "1080p" }]} /></div>
            <div className="row"><div><div>Ускорение видеокартой</div><div className="faint" style={{ fontSize: 12 }}>Быстрее, если есть поддержка</div></div><span className="spacer" /><Toggle on={gpu} onChange={setGpu} label="Видеокарта" /></div>
            <p className="muted" style={{ fontSize: 13 }}>Перед экспортом приложение запрашивает у сервера рецепт сборки и списывает минуты. Нужен интернет.</p>
            <Button variant="primary" size="lg" icon="download" onClick={() => setRun(true)}>Экспортировать</Button>
          </>
        ) : (
          <>
            <Bar value={pct} />
            <div className="muted">{pct < 100 ? `Готово ${Math.round(pct)}%` : "Все клипы сохранены в папку «Видео/Нарезай»"}</div>
            <Button variant={pct < 100 ? "default" : "primary"} onClick={onClose}>{pct < 100 ? "Свернуть" : "Готово"}</Button>
          </>
        )}
      </div>
    </div>
  );
}
