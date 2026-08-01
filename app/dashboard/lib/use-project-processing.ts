"use client";

import { useEffect, useState } from "react";
import { ControlApiError, getProject } from "./control-api";
import { activeProcessingStatuses, stageByStatus } from "./processing-stages";

/**
 * Polls a project's status every 3s while it's actively being processed
 * (see `activeProcessingStatuses`), stopping itself once the pipeline
 * leaves that set — so a long-lived page (the project detail view, not
 * just the wizard's transient processing screen) doesn't poll forever
 * after the project is done. The first poll fires immediately (no 3s
 * wait), so `status`/`processingIndex` start out null/0 only for the
 * length of one network round trip.
 */
export function useProjectProcessing(projectId: string | null) {
  const [status, setStatus] = useState<string | null>(null);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [stageStartedAt, setStageStartedAt] = useState<number | null>(null);
  const [secondsInStage, setSecondsInStage] = useState(0);
  const [pollError, setPollError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // `poll` closes over `timer` before it's declared below — safe because
    // `poll` is async, so its body only actually runs (past the first
    // `await`) on a later tick, by which point `timer` is already assigned.
    const poll = async () => {
      try {
        const response = await getProject(projectId);
        if (cancelled) return;
        const nextStatus = response.project.status;
        setStatus(nextStatus);
        const nextIndex = stageByStatus[nextStatus] ?? 0;
        // Also covers the very first poll: stageStartedAt starts null, which
        // never equals nextIndex's "previous" value, so it always seeds here.
        setProcessingIndex((current) => {
          if (current !== nextIndex) setStageStartedAt(Date.now());
          return nextIndex;
        });
        setStageStartedAt((current) => current ?? Date.now());
        if (!activeProcessingStatuses.has(nextStatus)) {
          window.clearInterval(timer);
        }
      } catch (error) {
        if (!cancelled) setPollError(error instanceof ControlApiError ? error.message : "Не удалось получить состояние проекта. Проверьте соединение.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId]);

  /** "На этом этапе уже N сек" — a real elapsed-time readout, ticked locally
   *  between polls rather than faked as a static number. */
  useEffect(() => {
    if (!projectId || stageStartedAt === null) return;
    const tick = () => setSecondsInStage(Math.floor((Date.now() - stageStartedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [projectId, stageStartedAt]);

  return { status, processingIndex, secondsInStage, pollError };
}
