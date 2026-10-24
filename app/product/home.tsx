"use client";

import { Button, Card, FieldError, InputGroup, Link, Modal, TextField } from "@heroui/react";
import { ArrowRight01Icon, Cancel01Icon, FolderOpenIcon, Link01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AppIcon } from "@/components/hashpix/app-icon";
import { ControlApiError, createMultipartUpload, createSourcePreview, listSources, type ApiSource } from "../dashboard/lib/control-api";
import { useDashboardStore } from "../dashboard/store";

const sourceHints = [
  { id: "generic", text: "Вставьте ссылку на видео" },
  { id: "youtube", text: "Ссылка на YouTube" },
  { id: "vk", text: "Ссылка на VK Видео" },
  { id: "rutube", text: "Ссылка на RuTube" },
  { id: "twitch", text: "Ссылка на Twitch" },
];

export type HomeArticle = { slug: string; title: string; description: string; category: string; readingTime: number; cover: string };

function PlatformMark({ id }: { id: string }) {
  if (id === "youtube") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#ff3030" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path fill="#fff" d="M9.545 15.568V8.432L15.818 12z" /></svg>;
  if (id === "vk") return <Image src="/assets/platform-vk.png" alt="" width={24} height={24} unoptimized />;
  if (id === "rutube") return <Image src="/assets/platform-rutube.png" alt="" width={24} height={24} unoptimized />;
  if (id === "twitch") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#9146ff" d="M6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0H6Zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714v9.429Z"/><path fill="#9146ff" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714z"/></svg>;
  return <AppIcon icon={Link01Icon} size="md" aria-hidden="true" />;
}

export function ProductHome({ initialSource = "", articles = [] }: { initialSource?: string; articles?: HomeArticle[] }) {
  const router = useRouter();
  const { projects, connection } = useDashboardStore();
  const [url, setUrl] = useState(initialSource);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [sourcePicker, setSourcePicker] = useState(false);
  const [sourceFocused, setSourceFocused] = useState(false);
  const [sourceHintIndex, setSourceHintIndex] = useState(0);
  const [previousSourceHintIndex, setPreviousSourceHintIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const connected = connection === "connected";
  const realProjects = connected ? projects : [];
  const sourceHint = sourceHints[sourceHintIndex];

  useEffect(() => {
    if (url || sourceFocused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setPreviousSourceHintIndex(sourceHintIndex);
      setSourceHintIndex((sourceHintIndex + 1) % sourceHints.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [url, sourceFocused, sourceHintIndex]);

  async function preflight(file?: File) {
    if (pending) return;
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
    if (pending) return;
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
    <section className="hp-source-entry" id="hp-source-entry" aria-label="Новое видео">
      <form onSubmit={(event) => { event.preventDefault(); void preflight(); }}>
        <TextField className="hp-source-entry__field" aria-label="Ссылка на видео" value={url} onChange={setUrl} isInvalid={Boolean(error)} isDisabled={pending}>
          <div className="hp-source-entry__row">
            <InputGroup className="hp-source-entry__group">
              <InputGroup.Prefix><span key={url ? "generic" : sourceHint.id} className={`hp-source-entry__mark hp-source-entry__mark--${url ? "generic" : sourceHint.id}`} aria-hidden="true"><PlatformMark id={url ? "generic" : sourceHint.id} /></span></InputGroup.Prefix>
              <InputGroup.Input id="hp-source-url" className="hp-source-entry__input" placeholder="" onFocus={() => setSourceFocused(true)} onBlur={() => setSourceFocused(false)} />
              {!url ? <span className="hp-source-entry__hint-stage" aria-hidden="true">
                {previousSourceHintIndex !== sourceHintIndex ? <span key={`out-${previousSourceHintIndex}`} className="hp-source-entry__hint hp-source-entry__hint--out">{sourceHints[previousSourceHintIndex].text}</span> : null}
                <span key={`in-${sourceHintIndex}`} className="hp-source-entry__hint hp-source-entry__hint--in">{sourceHint.text}</span>
              </span> : null}
            </InputGroup>
            <Button type="submit" variant="primary" className="hp-source-entry__submit" isDisabled={!url.trim() || pending} isPending={pending}>{pending ? "Подготавливаем…" : "Получить клипы"}</Button>
          </div>
          {error ? <FieldError className="hp-error">{error}</FieldError> : null}
        </TextField>
      </form>
      <div className="hp-source-entry__alternatives">
        <Button className="hp-source-entry__alternative" variant="ghost" isDisabled={pending} onPress={() => input.current?.click()}><span className="hp-source-entry__alternative-icon"><AppIcon icon={Upload01Icon} size="sm" aria-hidden="true" /></span>Загрузить файл</Button>
        <Modal isOpen={sourcePicker} onOpenChange={setSourcePicker}>
          <Button className="hp-source-entry__alternative" variant="ghost" isDisabled={pending} onPress={() => void openSources()}><span className="hp-source-entry__alternative-icon"><AppIcon icon={FolderOpenIcon} size="sm" aria-hidden="true" /></span>Из источников</Button>
          <Modal.Backdrop><Modal.Container><Modal.Dialog>
            <Modal.Header><Modal.Heading>Ранее импортированные источники</Modal.Heading><Modal.CloseTrigger aria-label="Закрыть"><AppIcon icon={Cancel01Icon} size="md" /></Modal.CloseTrigger></Modal.Header>
            <Modal.Body>{sources.length ? sources.map((source) => <Button key={source.id} variant="ghost" onPress={() => { setSourcePicker(false); router.push(`/dashboard/new?sourceId=${encodeURIComponent(source.id)}`); }}>{String(source.metadata.title || source.providerRef || "Видео")}</Button>) : <p className="hp-empty">Здесь появятся источники с готовой транскрипцией.</p>}</Modal.Body>
          </Modal.Dialog></Modal.Container></Modal.Backdrop>
        </Modal>
        <input ref={input} type="file" accept="video/*" className="sr-only" tabIndex={-1} aria-label="Видео для загрузки" onChange={(event) => { const file = event.target.files?.[0]; if (file) void preflight(file); event.target.value = ""; }} />
      </div>
    </section>
    <section aria-labelledby="recent-projects">
      <div className="hp-section-head"><h2 id="recent-projects">Недавние проекты</h2>{realProjects.length ? <Link href="/dashboard/projects">Все проекты <span aria-hidden="true">›</span></Link> : null}</div>
      {connection === "loading" ? <p className="hp-empty" role="status">Загружаем проекты…</p> : connection === "error" ? <p className="hp-error" role="alert">Не удалось загрузить проекты. Обновите страницу.</p> : realProjects.length ? <div className="hp-project-grid">
        {realProjects.slice(0, 4).map((project) => <Link key={project.id} className="hp-project-card" href={`/dashboard/projects/${project.id}`}>
          <div className="hp-project-card__media">{project.thumbnailUrl ? <Image src={project.thumbnailUrl} alt="" width={480} height={270} unoptimized /> : <span>Превью недоступно</span>}</div>
          <span className="hp-project-card__title">{project.title}</span>
          <span className="hp-project-card__meta">{project.clipsReady} клипов · {project.updatedAt}</span>
        </Link>)}
      </div> : null}
      {!realProjects.length && connection !== "loading" && connection !== "error" ? <div className="hp-empty-projects">
        <Button className="hp-empty-projects__create" variant="secondary" onPress={() => { document.getElementById("hp-source-url")?.focus(); document.getElementById("hp-source-entry")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
          <span className="hp-empty-projects__plus">+</span><span><strong>Создать новый проект</strong><small>Вставьте ссылку или выберите файл</small></span><AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
        </Button>
        <Card className="hp-empty-art" aria-label="Пример: видео превращается в готовые клипы">
          <div className="hp-empty-art__composition" aria-hidden="true"><div className="hp-empty-art__source"><span className="hp-empty-art__play">▶</span><i /><i /><i /></div><div className="hp-empty-art__beam" /><div className="hp-empty-art__clips"><span /><span /><span /></div></div>
          <div className="hp-empty-art__copy"><span>ВАШЕ ВИДЕО → ГОТОВЫЕ КЛИПЫ</span><strong>Один источник.<br />Несколько сильных моментов.</strong><small>Создайте первый проект — клипы появятся здесь.</small></div>
        </Card>
      </div> : null}
    </section>
    {articles.length ? <section className="hp-blog" aria-labelledby="hp-blog-title">
      <div className="hp-section-head"><h2 id="hp-blog-title">Полезное о видео</h2><Link href="/blog">Все статьи <span aria-hidden="true">›</span></Link></div>
      <div className="hp-blog__grid">{articles.map((article) => <Link className="hp-blog-card" key={article.slug} href={`/blog/${article.slug}`}>
        <div className="hp-blog-card__image"><Image src={article.cover} alt="" fill sizes="(max-width: 760px) 100vw, (max-width: 1200px) 50vw, 33vw" unoptimized /></div>
        <span className="hp-blog-card__category">{article.category} <i /> {article.readingTime} мин.</span><strong>{article.title}</strong><span className="hp-blog-card__description">{article.description}</span>
      </Link>)}</div>
    </section> : null}
  </div>;
}
