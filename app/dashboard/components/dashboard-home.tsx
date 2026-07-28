"use client";

import { Button, Input } from "@heroui/react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileUp,
  Plus,
  Sparkles,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trackApp } from "../lib/track-app";
import { minuteBalance, projects, styles } from "../data";
import { PageHeading } from "./page-heading";
import { ProjectCard } from "./project-card";

export function DashboardHome() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => trackApp("dashboard_view"), []);

  const submitUrl = () => {
    const value = url.trim();
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(value)) {
      setError("Вставьте полную ссылку на YouTube");
      return;
    }
    trackApp("source_url_submit");
    router.push(`/dashboard/new?source=${encodeURIComponent(value)}`);
  };

  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Личный кабинет"
        title="ДОБРЫЙ ДЕНЬ, КИРИЛЛ"
        description="Запустите новый конвейер или продолжите проекты, которым нужна проверка."
        actions={
          <Link className="dash-primary-link" href="/dashboard/new">
            <Plus size={18} />
            Новое видео
          </Link>
        }
      />

      <section className="dash-create-card" aria-labelledby="create-title">
        <div className="dash-create-card__copy">
          <span className="dash-eyebrow">Новый проект</span>
          <h2 id="create-title">ИЗ ДЛИННОГО ВИДЕО — СЕРИЯ ГОТОВЫХ КЛИПОВ</h2>
          <p>Добавьте исходник. Настройки займут ещё два коротких шага.</p>
        </div>
        <div className="dash-source-form">
          <div className="dash-source-form__input">
            <Youtube size={21} aria-hidden="true" />
            <Input
              aria-label="Ссылка на YouTube"
              className="dash-input"
              placeholder="Вставьте ссылку на YouTube"
              type="url"
              value={url}
              variant="secondary"
              onChange={(event) => {
                setUrl(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitUrl();
              }}
            />
            <Button isIconOnly aria-label="Продолжить со ссылкой" onPress={submitUrl}>
              <ArrowRight size={19} />
            </Button>
          </div>
          {error ? <span className="dash-field-error" role="alert">{error}</span> : null}
          <button className="dash-upload-button" type="button" onClick={() => fileRef.current?.click()}>
            <FileUp size={19} />
            Загрузить видео
            <small>MP4, MOV, WebM · до 10 ГБ</small>
          </button>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(event) => {
              if (!event.target.files?.[0]) return;
              trackApp("source_upload_start");
              router.push("/dashboard/new?upload=1");
            }}
          />
        </div>
      </section>

      <section className="dash-overview-grid" aria-label="Баланс и активные задачи">
        <Link className="dash-overview-card dash-overview-card--balance" href="/dashboard/billing">
          <div>
            <span className="dash-eyebrow">Минуты</span>
            <strong>{minuteBalance.planUsed} <small>/ {minuteBalance.planTotal}</small></strong>
            <p>Основной баланс · обновится {minuteBalance.renewsAt}</p>
          </div>
          <div className="dash-overview-card__extra">
            <span>Дополнительные</span>
            <b>+{minuteBalance.extra}</b>
          </div>
        </Link>
        <Link className="dash-overview-card" href="/dashboard/projects/podcast-24">
          <span className="dash-overview-card__icon"><Sparkles size={21} /></span>
          <div>
            <span className="dash-eyebrow">Нужна проверка</span>
            <strong className="dash-overview-card__title">8 моментов готовы</strong>
            <p>Подкаст №24 — выберите клипы для рендера</p>
          </div>
          <ArrowRight size={20} />
        </Link>
        <Link className="dash-overview-card" href="/dashboard/projects">
          <span className="dash-overview-card__icon is-dark"><Clock3 size={21} /></span>
          <div>
            <span className="dash-eyebrow">В обработке</span>
            <strong className="dash-overview-card__title">3 из 6 клипов</strong>
            <p>Вебинар: системные продажи</p>
          </div>
          <ArrowRight size={20} />
        </Link>
      </section>

      <section className="dash-section-block">
        <div className="dash-section-head">
          <div>
            <span className="dash-eyebrow">Продолжить работу</span>
            <h2>Последние проекты</h2>
          </div>
          <Link href="/dashboard/projects">Все проекты <ArrowRight size={16} /></Link>
        </div>
        <div className="dash-project-grid">
          {projects.slice(0, 3).map((project) => <ProjectCard project={project} key={project.id} />)}
        </div>
      </section>

      <section className="dash-section-block">
        <div className="dash-section-head">
          <div>
            <span className="dash-eyebrow">Оформление</span>
            <h2>Быстрый выбор стиля</h2>
          </div>
          <Link href="/dashboard/styles">Настроить стили <ArrowRight size={16} /></Link>
        </div>
        <div className="dash-style-strip">
          {styles.map((style) => (
            <Link className="dash-style-mini" href="/dashboard/styles" key={style.id}>
              <span
                className="dash-style-mini__preview"
                style={{ "--style-a": style.colors[0], "--style-b": style.colors[1] } as React.CSSProperties}
              >
                <i>ОДНА МЫСЛЬ</i>
                <i>МОЖЕТ СТАТЬ</i>
                <i>ЦЕЛЫМ КЛИПОМ</i>
              </span>
              <span>
                <strong>{style.name}</strong>
                <small>{style.captions}</small>
              </span>
              {style.isDefault ? <CheckCircle2 size={18} aria-label="Стиль по умолчанию" /> : null}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

