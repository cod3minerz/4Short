"use client";

import { Button, Input, Label, Link, Slider, Tabs, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LockedField } from "@/components/hashpix/locked-field";
import type { StyleConfig } from "@/packages/contracts/src/media";
import { ControlApiError, createProject, getClippingDefaults, getSourcePreview, listSources, listStyles, saveClippingDefaults, type ApiStyle, type ClippingDefaults, type SourcePreview } from "../dashboard/lib/control-api";
import { useDashboardStore } from "../dashboard/store";
import { CompactSelect } from "./controls";
import { aspectRatios, captionConfig, captionPresets, clock, cuttingModes, defaultLength, languages, lengths, type CuttingMode } from "./clipping-config";

type Source = NonNullable<SourcePreview["result"]> & { reused: boolean; sourceId?: string };
export function SourceConfiguration({ preflightId, sourceId }: { preflightId?: string; sourceId?: string }) {
  const router = useRouter();
  const { connection, balanceSeconds } = useDashboardStore();
  const [source, setSource] = useState<Source | null>(null);
  const [styles, setStyles] = useState<ApiStyle[]>([]);
  const [styleId, setStyleId] = useState("");
  const [mode, setMode] = useState<CuttingMode>("uniform");
  const [length, setLength] = useState("auto");
  const [language, setLanguage] = useState("auto");
  const [count, setCount] = useState("recommended");
  const [ratio, setRatio] = useState("9:16");
  const [caption, setCaption] = useState("original");
  const [range, setRange] = useState<number[]>([0, 0]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(attempt = 0) {
      try {
        let verified: Source;
        if (sourceId) {
          const sources = await listSources();
          const found = sources.items.find(item => item.id === sourceId && item.analyzedAt);
          if (!found?.durationMs) throw new Error("Источник недоступен. Выберите видео заново.");
          verified = { sourceId: found.id, reused: true, url: found.providerRef, title: String(found.metadata.title || "Видео"), authorName: null, thumbnailUrl: typeof found.metadata.thumbnailUrl === "string" ? found.metadata.thumbnailUrl : null, durationSeconds: Math.ceil(found.durationMs / 1000) };
        } else {
          const preview = await getSourcePreview(preflightId!);
          if (cancelled) return;
          if (preview.status === "failed") throw new Error(preview.error?.message || "Не удалось проверить источник.");
          if (preview.status !== "succeeded" || !preview.result) {
            timer = setTimeout(() => void poll(attempt + 1), Math.min(1000 + attempt * 500, 8000));
            return;
          }
          verified = { ...preview.result, reused: false };
        }
        const [styleResult, defaultsResult] = await Promise.all([listStyles(), getClippingDefaults()]);
        if (cancelled) return;
        const defaults = defaultsResult.defaults;
        const chosen = styleResult.items.find(item => item.versionId === defaults?.styleVersionId) || styleResult.items.find(item => item.isDefault) || styleResult.items[0];
        setSource(verified); setRange([0, verified.durationSeconds]); setStyles(styleResult.items); setStyleId(chosen?.versionId ?? "");
        if (defaults) {
          if (defaults.momentSettings.mode !== "uniform") {
            setNotice("В сохранённых настройках выбран поиск по смыслу. Сейчас доступна равномерная нарезка без языковой модели.");
          }
          setMode("uniform"); setLength(defaultLength(defaults)); setLanguage(defaults.speechLanguage);
          setCount(String(defaults.momentSettings.count));
          const exportConfig = defaults.projectOverrides?.export;
          if (exportConfig) setRatio(aspectRatios.find(item => item.width / item.height === exportConfig.width / exportConfig.height)?.id ?? "9:16");
          if (defaults.projectOverrides?.subtitles) setCaption(defaults.projectOverrides.subtitles.enabled ? defaults.projectOverrides.subtitles.preset : "none");
        }
        setReady(true); setError("");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить параметры.");
      }
    }
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [preflightId, sourceId, connection, retry]);

  const style = styles.find(item => item.versionId === styleId);
  const seconds = range[1] - range[0];
  const charge = source?.reused ? 0 : seconds;
  const enough = source?.reused || (balanceSeconds !== null && charge <= balanceSeconds);
  const valid = ready && source && style && seconds > 0 && (count === "recommended" || (Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 50));
  function settings(): ClippingDefaults {
    const duration = lengths.find(item => item.id === length)!;
    const aspect = aspectRatios.find(item => item.id === ratio)!;
    const overrides: Partial<StyleConfig> = {
      export: { ...style!.config.export, width: aspect.width, height: aspect.height },
      subtitles: captionConfig(style!.config.subtitles, caption),
    };
    return {
      momentSettings: { mode, count: count === "recommended" ? "recommended" : Number(count), durationMinSeconds: duration.min, durationMaxSeconds: duration.max, diversity: "high", selectionStrictness: "balanced", allowThoughtCompletion: true, excludedTopics: [] },
      speechLanguage: language as ClippingDefaults["speechLanguage"], styleVersionId: style!.versionId, projectOverrides: overrides,
    };
  }
  async function submit() {
    if (!valid || !enough || pending || !source) return;
    setPending(true); setError("");
    try {
      const defaults = settings();
      let origin: Parameters<typeof createProject>[0]["source"];
      if (source.reused) origin = { kind: "existing", sourceId: source.sourceId! };
      else if (source.url) origin = { kind: "youtube", url: source.url, preflightJobId: preflightId! };
      else {
        const raw = window.sessionStorage.getItem(`hashpix:source:${preflightId}`);
        const upload = raw ? JSON.parse(raw) as { uploadId?: string; originalFileName?: string } : null;
        if (!upload?.uploadId || !upload.originalFileName) throw new Error("Данные загрузки не сохранились. Загрузите файл заново.");
        origin = { kind: "upload", uploadId: upload.uploadId, originalFileName: upload.originalFileName, preflightJobId: preflightId! };
      }
      const input: Parameters<typeof createProject>[0] = { ...defaults, title: source.title, source: origin, processingMode: "auto_render", momentSettings: { ...defaults.momentSettings, ...(range[0] !== 0 || range[1] !== source.durationSeconds ? { sourceRange: { startSeconds: range[0], endSeconds: range[1] } } : {}) } };
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))))).map(byte => byte.toString(16).padStart(2, "0")).join("");
      const attemptKey = `hashpix:create-attempt:${sourceId || preflightId}`;
      let previous: { fingerprint?: string; key?: string } | null = null;
      try { previous = JSON.parse(window.sessionStorage.getItem(attemptKey) || "null"); } catch { /* Corrupt temporary state is not a server error. */ }
      const key = previous?.fingerprint === fingerprint && typeof previous.key === "string" ? previous.key : `project-create:${crypto.randomUUID()}`;
      window.sessionStorage.setItem(attemptKey, JSON.stringify({ fingerprint, key }));
      const result = await createProject(input, key);
      router.push(`/dashboard/projects?highlight=${result.project.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать проект."); setPending(false); }
  }
  async function saveDefaults() {
    if (!valid || pending) return;
    setPending(true); setNotice(""); setError("");
    try { await saveClippingDefaults(settings()); setNotice("Настройки сохранены для следующих видео."); }
    catch (cause) { setError(cause instanceof ControlApiError ? cause.message : "Не удалось сохранить настройки."); }
    finally { setPending(false); }
  }
  if (!ready) return <section className="hp-config"><h1 className="sr-only">Параметры видео</h1><p className="hp-empty" role="status">Проверяем источник и загружаем параметры…</p>{error ? <><p className="hp-error" role="alert">{error}</p><Button variant="secondary" onPress={() => setRetry(retry + 1)}>Повторить</Button></> : null}<Link href="/dashboard">Выбрать другое видео</Link></section>;
  return <section className="hp-config">
    <h1 className="sr-only">Параметры нарезки</h1>
    <div className="hp-config__source"><span title={source?.url || source?.title}>{source?.url || source?.title}</span><Link href="/dashboard">Заменить</Link></div>
    <Button className="hp-config__submit" variant="primary" isDisabled={!valid || !enough || pending} isPending={pending} onPress={() => void submit()}>Получить клипы</Button>
    <div className="hp-config__quote"><CompactSelect label="Язык речи" value={language} options={languages} onChange={setLanguage} disabled={Boolean(source?.reused) || pending} /><span>Стоимость: {charge === 0 ? "0 минут · источник уже обработан" : `${(charge / 60).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} мин · ${charge} сек`}</span></div>
    {!enough ? <p className="hp-error" role="alert">Недостаточно минут. Сократите диапазон или <Link href="/dashboard/billing">пополните баланс</Link>.</p> : null}
    {error ? <p className="hp-error" role="alert">{error}</p> : null}
    <div className="hp-config__thumbnail">{source?.thumbnailUrl ? <Image src={source.thumbnailUrl} alt={source.title} width={320} height={180} unoptimized /> : <p className="hp-empty">Превью источника недоступно</p>}<span>{clock(source!.durationSeconds)}</span></div>
    <p className="hp-config__rights">Загружайте только видео, на обработку которых у вас есть права.</p>
    <div className="hp-config__panel">
      <div className="hp-config__settings"><CompactSelect label="Способ нарезки" value={mode} options={cuttingModes} onChange={value => setMode(value as CuttingMode)} disabled={pending} /><CompactSelect label="Длительность" value={length} options={lengths} onChange={setLength} disabled={pending} /></div>
      <p className="hp-config__hint">Равномерно распределяем клипы по выбранному диапазону. Режим работает на локальном обработчике и не требует языковой модели.</p>
      <LockedField label="Поиск моментов по смыслу" reason="Для него нужна подключённая языковая модель. Пока доступна равномерная нарезка." />
      <Slider minValue={0} maxValue={source!.durationSeconds} step={1} value={range} onChange={value => { const values = value as number[]; const start = Math.min(values[0], source!.durationSeconds - 1); setRange([start, Math.max(start + 1, values[1])]); }} isDisabled={pending}>
        <Label>Диапазон обработки</Label><Slider.Track><Slider.Fill /><Slider.Thumb index={0} aria-label="Начало обработки" /><Slider.Thumb index={1} aria-label="Конец обработки" /></Slider.Track>
      </Slider>
      <div className="hp-config__range"><TextField type="number" aria-label="Начало, секунды" value={String(range[0])} onChange={value => setRange([Math.max(0, Math.min(Number(value) || 0, range[1] - 1)), range[1]])}><Input min={0} max={range[1] - 1} /></TextField><span>{clock(range[0])} — {clock(range[1])}</span><TextField type="number" aria-label="Конец, секунды" value={String(range[1])} onChange={value => setRange([range[0], Math.max(range[0] + 1, Math.min(Number(value) || 1, source!.durationSeconds))])}><Input min={range[0] + 1} max={source!.durationSeconds} /></TextField></div>
      <details className="hp-config__advanced"><summary>Дополнительные параметры</summary><CompactSelect label="Количество клипов" value={count} options={[{ id: "recommended", label: "Рекомендованное" }, ...Array.from({ length: 50 }, (_, index) => ({ id: String(index + 1), label: String(index + 1) }))]} onChange={setCount} disabled={pending} /></details>
    </div>
    <Tabs className="hp-config__templates" defaultSelectedKey="presets">
      <Tabs.ListContainer><Tabs.List aria-label="Оформление субтитров"><Tabs.Tab id="presets">Быстрые пресеты<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="templates">Мои шаблоны<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="presets"><ToggleButtonGroup className="hp-preset-grid" selectionMode="single" disallowEmptySelection selectedKeys={new Set([caption])} onSelectionChange={keys => { const key = [...keys][0]; if (key !== undefined) setCaption(String(key)); }} isDisabled={pending}>
        <ToggleButton id="original" className="hp-preset">Из шаблона</ToggleButton>
        {captionPresets.map(preset => <ToggleButton key={preset.id} id={preset.id} className="hp-preset">{preset.label}</ToggleButton>)}
      </ToggleButtonGroup><p className="hp-config__hint">{caption === "original" ? style?.name : captionPresets.find(preset => preset.id === caption)?.label} · {style?.config.subtitles.fontFamily}. Режим передаётся в рендер вместе с выбранным шаблоном.</p></Tabs.Panel>
      <Tabs.Panel id="templates"><ToggleButtonGroup className="hp-preset-grid" selectionMode="single" disallowEmptySelection selectedKeys={new Set([styleId])} onSelectionChange={keys => { const key = [...keys][0]; if (key !== undefined) { setStyleId(String(key)); setCaption("original"); } }} isDisabled={pending}>{styles.map(item => <ToggleButton key={item.versionId} id={item.versionId} className="hp-preset">{item.name}</ToggleButton>)}</ToggleButtonGroup></Tabs.Panel>
    </Tabs>
    <div className="hp-config__aspect"><CompactSelect label="Формат" value={ratio} options={aspectRatios} onChange={setRatio} disabled={pending} /></div>
    <Button variant="secondary" className="hp-config__save" isDisabled={!valid || pending} onPress={() => void saveDefaults()}>Сохранить настройки по умолчанию</Button>
    {notice ? <p className="hp-config__hint" role="status">{notice}</p> : null}
  </section>;
}
