import { useEffect, useState } from "react";
import { Button, Bar, Where } from "../ui/kit";
import { Icon, type IconName } from "../ui/Icon";
import type { Source } from "./NewProject";

const STEPS: { title: string; note: string; where: "local" | "ai"; icon: IconName; ms: number }[] = [
  { title: "Подготовка видео", note: "Проверяем файл и готовим звук", where: "local", icon: "film", ms: 2200 },
  { title: "Распознавание речи", note: "Превращаем речь в текст с таймкодами", where: "local", icon: "type", ms: 4800 },
  { title: "Поиск лучших моментов", note: "ИИ читает текст и выбирает клипы", where: "ai", icon: "sparkle", ms: 3200 },
  { title: "Готово к просмотру", note: "Собираем список клипов", where: "local", icon: "check", ms: 900 },
];

export function Processing({ source, onDone, onCancel }: { source: Source | null; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(0);

  // Prototype timing only. The real stages report progress from the local pipeline.
  useEffect(() => {
    const total = STEPS[step].ms;
    const t0 = performance.now();
    const id = setInterval(() => {
      const f = Math.min(1, (performance.now() - t0) / total);
      setPct(f * 100);
      if (f >= 1) {
        clearInterval(id);
        if (step === STEPS.length - 1) onDone(); else { setStep(step + 1); setPct(0); }
      }
    }, 60);
    return () => clearInterval(id);
  }, [step, onDone]);

  return (
    <div className="page proc">
      <div className="chosen">
        <div className="thumb thumb--sm" />
        <div><b>{source?.label ?? "Видео"}</b><div className="muted" style={{ fontSize: 13 }}>Идёт обработка</div></div>
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={onCancel}>Отменить</Button>
      </div>
      <div className="card card--pad">
        <div className="steps">
          {STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "active" : "pending";
            return (
              <div key={s.title} className={`step step--${state}`}>
                <div className="step__dot"><Icon name={state === "done" ? "check" : s.icon} /></div>
                <div>
                  <b>{s.title}</b>
                  <div className="muted" style={{ fontSize: 13 }}>{s.note}</div>
                  {state === "active" && <Bar value={pct} tone={s.where === "ai" ? "signal" : undefined} />}
                </div>
                <Where where={s.where} />
              </div>
            );
          })}
        </div>
      </div>
      <p className="faint" style={{ textAlign: "center", fontSize: 12 }}>Можно свернуть окно. Обработка продолжится в фоне.</p>
    </div>
  );
}
