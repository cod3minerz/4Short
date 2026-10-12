"use client";

import { Button, FieldError, InputGroup, Link, Modal, TextField } from "@heroui/react";
import { FolderOpenIcon, Link01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AppIcon } from "@/components/hashpix/app-icon";
import { ControlApiError, createMultipartUpload, createSourcePreview, listSources, type ApiSource } from "../dashboard/lib/control-api";
import { useDashboardStore } from "../dashboard/store";

export function ProductHome() {
  const router = useRouter();
  const { projects, connection } = useDashboardStore();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [sourcePicker, setSourcePicker] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const connected = connection === "connected";
  const realProjects = connected ? projects : [];

  async function preflight(file?: File) {
    if (!connected || pending) return;
    setPending(true); setError("");
    try {
      let preview;
      if (file) {
        const upload = await createMultipartUpload(file);
        preview = await createSourcePreview({ sourceId: upload.sourceId });
        window.sessionStorage.setItem(`hashpix:source:${preview.id}`, JSON.stringify({ uploadId: upload.uploadId, originalFileName: file.name }));
      } else {
        const parsed = new URL(url.trim());
        if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Вставьте ссылку на видео.");
        preview = await createSourcePreview({ url: parsed.href });
      }
      router.push(`/dashboard/new?preflight=${encodeURIComponent(preview.id)}`);
    } catch (cause) {
      setError(cause instanceof ControlApiError ? cause.message : file ? "Не удалось загрузить видео. Повторите попытку." : "Проверьте ссылку на видео и повторите попытку.");
      setPending(false);
    }
  }
  async function openSources() {
    if (!connected || pending) return;
    setPending(true); setError("");
    try {
      const result = await listSources();
      setSources(result.items.filter((source) => source.analyzedAt));
      setSourcePicker(true);
    } catch (cause) { setError(cause instanceof ControlApiError ? cause.message : "Не удалось загрузить источники."); }
    finally { setPending(false); }
  }

  return <div className="hp-home">
    <h1 className="sr-only">Создать клипы из видео</h1>
    <section className="hp-source-entry" aria-label="Новое видео">
      <form onSubmit={(event) => { event.preventDefault(); void preflight(); }}>
        <TextField className="hp-source-entry__field" aria-label="Ссылка на видео" value={url} onChange={setUrl} isInvalid={Boolean(error)} isDisabled={!connected || pending}>
          <div className="hp-source-entry__row">
            <InputGroup className="hp-source-entry__group">
              <InputGroup.Prefix><AppIcon icon={Link01Icon} size="md" /></InputGroup.Prefix>
              <InputGroup.Input className="hp-source-entry__input" placeholder="Вставьте ссылку на видео" />
            </InputGroup>
            <Button type="submit" variant="primary" className="hp-source-entry__submit" isDisabled={!connected || !url.trim() || pending} isPending={pending}>{pending ? "Подготавливаем…" : "Получить клипы"}</Button>
          </div>
          {error ? <FieldError className="hp-error">{error}</FieldError> : null}
        </TextField>
      </form>
      <div className="hp-source-entry__alternatives">
        <Button variant="ghost" isDisabled={!connected || pending} onPress={() => input.current?.click()}><AppIcon icon={Upload01Icon} size="md" />Загрузить файл</Button>
        <Modal isOpen={sourcePicker} onOpenChange={setSourcePicker}>
          <Button variant="ghost" isDisabled={!connected || pending} onPress={() => void openSources()}><AppIcon icon={FolderOpenIcon} size="md" />Из источников</Button>
          <Modal.Backdrop><Modal.Container><Modal.Dialog>
            <Modal.Header><Modal.Heading>Ранее импортированные источники</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
            <Modal.Body>{sources.length ? sources.map((source) => <Button key={source.id} variant="ghost" onPress={() => { setSourcePicker(false); router.push(`/dashboard/new?sourceId=${encodeURIComponent(source.id)}`); }}>{String(source.metadata.title || source.providerRef || "Видео")}</Button>) : <p className="hp-empty">Здесь появятся источники с готовой транскрипцией.</p>}</Modal.Body>
          </Modal.Dialog></Modal.Container></Modal.Backdrop>
        </Modal>
        <input ref={input} type="file" accept="video/*" className="sr-only" tabIndex={-1} aria-label="Видео для загрузки" onChange={(event) => { const file = event.target.files?.[0]; if (file) void preflight(file); event.target.value = ""; }} />
      </div>
      {connection === "preview" ? <p className="hp-empty">Это локальный предпросмотр. Подключите API для загрузки и обработки видео.</p> : null}
    </section>
    <section aria-labelledby="recent-projects">
      <div className="hp-section-head"><h2 id="recent-projects">Недавние проекты</h2><Link href="/dashboard/projects">Все проекты ›</Link></div>
      {connection === "loading" ? <p className="hp-empty" role="status">Загружаем проекты…</p> : connection === "error" ? <p className="hp-error" role="alert">Не удалось загрузить проекты. Обновите страницу.</p> : !realProjects.length ? <p className="hp-empty">Загрузите первое видео — здесь появятся ваши проекты.</p> : <div className="hp-project-grid">
        {realProjects.slice(0, 4).map((project) => <Link key={project.id} className="hp-project-card" href={`/dashboard/projects/${project.id}`}>
          <div className="hp-project-card__media">{project.thumbnailUrl ? <Image src={project.thumbnailUrl} alt="" width={480} height={270} unoptimized /> : <span>Превью недоступно</span>}</div>
          <span className="hp-project-card__title">{project.title}</span>
          <span className="hp-project-card__meta">{project.clipsReady} клипов · {project.updatedAt}</span>
        </Link>)}
      </div>}
    </section>
  </div>;
}
