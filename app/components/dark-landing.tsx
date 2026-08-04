"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Link2,
  Menu,
  Play,
  Upload,
  X,
} from "lucide-react";
import { faqItems, pricingPlans } from "../data/content";
import { track } from "../lib/analytics";

const Dithering = dynamic(
  () => import("@paper-design/shaders-react").then((module) => module.Dithering),
  { ssr: false },
);

const navigation = [
  { label: "Возможности", href: "#features" },
  { label: "Как это работает", href: "#workflow" },
  { label: "Тарифы", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
] as const;

const platformIconPaths = {
  youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  twitch: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
  vk: "m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z",
} as const;

const sourcePlatforms = [
  { id: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"], path: platformIconPaths.youtube },
  { id: "twitch", label: "Twitch", hosts: ["twitch.tv", "clips.twitch.tv"], path: platformIconPaths.twitch },
  { id: "rutube", label: "RuTube", hosts: ["rutube.ru"] },
  { id: "vk", label: "VK Видео", hosts: ["vk.com", "vkvideo.ru"], path: platformIconPaths.vk },
] as const;

const featureCards = [
  {
    title: "Находит моменты, которые можно смотреть отдельно",
    description: "Hashpix отделяет законченные мысли и сильные фрагменты от длинного разговора.",
    label: "AI-анализ",
    scene: "moments",
  },
  {
    title: "Собирает вертикальный кадр вокруг спикера",
    description: "Кадрирование и трекинг помогают удержать главное в безопасной зоне ролика.",
    label: "AI-кадрирование",
    scene: "frame",
  },
  {
    title: "Даёт материал для финальной правки",
    description: "Проверьте субтитры, выбранный момент и стиль до того, как отправить ролик дальше.",
    label: "Редактор",
    scene: "captions",
  },
] as const;

function isSupportedSourceUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return sourcePlatforms.some((platform) => platform.hosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    ));
  } catch {
    return false;
  }
}

function SourcePlatformLogo({ platform }: { platform: (typeof sourcePlatforms)[number] }) {
  if (platform.id === "rutube") {
    return <span className="source-platform-logo source-platform-logo--rutube" aria-hidden="true">R</span>;
  }

  return (
    <svg className={`source-platform-logo source-platform-logo--${platform.id}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={platform.path} />
    </svg>
  );
}

export function DarkLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [platformIndex, setPlatformIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setPlatformIndex((current) => (current + 1) % sourcePlatforms.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSupportedSourceUrl(url)) {
      setError("Вставьте ссылку на YouTube, Twitch, RuTube или VK Видео.");
      return;
    }

    track("hero_url_submit");
    window.location.assign(`/dashboard/new?source=${encodeURIComponent(url)}`);
  };

  const chooseFile = () => {
    track("hero_upload_click", { placement: "hero" });
    fileRef.current?.click();
  };

  const activePlatform = sourcePlatforms[platformIndex];

  return (
    <div className="dark-landing">
      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <Link className="landing-logo" href="/" aria-label="Hashpix — на главную">
            <Image src="/assets/logo-source.svg" alt="Hashpix" width={150} height={31} priority unoptimized />
          </Link>

          <nav className="landing-nav" aria-label="Основная навигация">
            {navigation.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}
          </nav>

          <div className="landing-header__actions">
            <Link className="landing-login" href="/dashboard">Войти</Link>
            <Link className="landing-button landing-button--small" href="/dashboard/new">Создать клипы</Link>
            <button
              className="landing-menu-button"
              type="button"
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav className="landing-mobile-nav" aria-label="Мобильная навигация">
            {navigation.map((item, index) => (
              <a className="landing-mobile-nav__link" href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>
                <span>{item.label}</span>{index < 2 ? <ChevronDown size={19} aria-hidden="true" /> : null}
              </a>
            ))}
            <Link className="landing-mobile-nav__link" href="/dashboard" onClick={() => setMenuOpen(false)}>Войти</Link>
            <Link className="landing-mobile-nav__action" href="/dashboard/new" onClick={() => setMenuOpen(false)}>Создать клипы <ArrowRight size={18} /></Link>
          </nav>
        ) : null}
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero__shader" aria-hidden="true">
            <Dithering
              width="100%"
              height="100%"
              colorBack="#000000"
              colorFront="#1c1c1c"
              shape="swirl"
              type="4x4"
              size={5.8}
              speed={reducedMotion ? 0 : 0.42}
              scale={2.28}
              rotation={360}
              offsetX={0}
              offsetY={0}
            />
          </div>
          <div className="landing-container landing-hero__copy">
            <div className="hero-social-proof" aria-label="Присоединяйтесь к 13 000 креаторов">
              <div className="hero-social-proof__avatars" aria-hidden="true">
                <span className="hero-social-proof__avatar hero-social-proof__avatar--one" />
                <span className="hero-social-proof__avatar hero-social-proof__avatar--two" />
                <span className="hero-social-proof__avatar hero-social-proof__avatar--three" />
              </div>
              <p>Присоединяйтесь к <strong>13 000</strong> креаторов</p>
            </div>
            <h1><span>Одно видео.</span><span>До 10 клипов, которые могут выстрелить.</span></h1>
            <p className="landing-lead">Hashpix находит сильные моменты, собирает вертикальные ролики и оставляет вам финальную правку.</p>

            <form className="hero-source-form" onSubmit={submit} noValidate>
              <div className={`hero-source-form__shell ${error ? "is-invalid" : ""}`}>
                <label className="sr-only" htmlFor="landing-video-url">Ссылка на YouTube, Twitch, RuTube или VK Видео</label>
                <input
                  id="landing-video-url"
                  name="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder=""
                  inputMode="url"
                  autoComplete="url"
                />
                {!url ? (
                  <span className="hero-source-form__placeholder" aria-hidden="true">
                    <span>Вставьте ссылку на</span>
                    <span className="hero-source-form__platform" key={activePlatform.id}>
                      <SourcePlatformLogo platform={activePlatform} />
                      {activePlatform.label}
                    </span>
                  </span>
                ) : null}
                <button className="landing-button hero-source-form__submit" type="submit">Создать клипы <ArrowRight size={17} /></button>
              </div>
              <span className="hero-source-form__divider" aria-hidden="true">или</span>
              <button className="landing-button landing-button--outline hero-source-form__upload" type="button" onClick={chooseFile}>
                <Upload size={17} /> Загрузить видео
              </button>
              {error ? <p className="hero-source-form__error" role="alert">{error}</p> : null}
              <input
                className="sr-only"
                ref={fileRef}
                type="file"
                accept="video/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  track("video_upload_start", { fileType: file.type });
                  track("video_upload_complete");
                  window.location.assign("/dashboard/new?upload=1");
                }}
              />
            </form>
          </div>

          <div className="landing-container hero-stage" aria-label="Иллюстрация: из длинного видео получаются короткие клипы">
            <div className="hero-stage__ambient" aria-hidden="true" />
            <div className="hero-stage__frame">
              <Image src="/assets/hero-landscape.webp" alt="" fill priority unoptimized sizes="(max-width: 760px) 100vw, 1000px" />
              <div className="hero-stage__shade" aria-hidden="true" />
              <span className="hero-stage__label">Исходное видео · 42:18</span>
            </div>
            <div className="hero-stage__clipping-glass" aria-hidden="true">
              <span><Link2 size={16} /> Длинное видео</span>
              <b>Найти клипы</b>
            </div>
            <div className="hero-stage__clip hero-stage__clip--one" aria-hidden="true"><span>00:27</span><b>Сильный хук</b></div>
            <div className="hero-stage__clip hero-stage__clip--two" aria-hidden="true"><span>00:38</span><b>Главная мысль</b></div>
            <div className="hero-stage__clip hero-stage__clip--three" aria-hidden="true"><span>00:31</span><b>Практический совет</b></div>
          </div>

          <div className="hero-capabilities" aria-label="Основные возможности">
            <span>Поиск моментов</span><span>Субтитры</span><span>Кадрирование</span><span>Редактор</span>
          </div>
        </section>

        <section className="landing-proof">
          <p>Для разговорных форматов, которые уже есть у вас</p>
          <div><span>Подкасты</span><span>Интервью</span><span>Вебинары</span><span>Уроки</span><span>Эфиры</span></div>
        </section>

        <section className="landing-section landing-gallery" id="examples">
          <div className="landing-container landing-section__intro landing-section__intro--compact">
            <h2>Ваша библиотека может выглядеть именно так.</h2>
            <p>Здесь оставлены живые слоты под ваши видео, обложки, фрагменты эфиров и кейсы — заменяйте их своими материалами.</p>
          </div>
          <div className="landing-container landing-gallery__grid">
            <article className="landing-media-slot landing-media-slot--wide">
              <span className="landing-media-slot__type">16:9 · исходный выпуск</span>
              <div className="landing-media-slot__play"><Play size={20} fill="currentColor" /></div>
              <p>Место для вашего длинного видео</p>
            </article>
            <article className="landing-media-slot landing-media-slot--portrait">
              <span className="landing-media-slot__type">9:16 · клип</span>
              <p>Вертикальный фрагмент</p>
            </article>
            <article className="landing-media-slot landing-media-slot--still">
              <span className="landing-media-slot__type">обложка / кадр</span>
              <p>Фото или скриншот результата</p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-clip-wall">
          <div className="landing-container landing-clip-wall__heading">
            <p>До публикации</p>
            <h2>Соберите ленту клипов из одного выпуска.</h2>
          </div>
          <div className="landing-container landing-clip-wall__grid" aria-label="Слоты для примеров готовых клипов">
            {[
              ["00:27", "Хук, который останавливает ленту"],
              ["00:41", "Мнение, на которое хочется ответить"],
              ["00:34", "Совет, который хочется сохранить"],
            ].map(([duration, title]) => (
              <article className="landing-clip-slot" key={duration}>
                <span>{duration}</span><i aria-hidden="true" /><p>{title}</p><small>Слот для вашего готового клипа</small>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-container landing-section__intro">
            <h2>AI понимает, где в видео начинается самостоятельная мысль.</h2>
            <p>Не перегружаем путь настройками: сначала сильные фрагменты, затем спокойная проверка и доработка.</p>
          </div>
          <div className="landing-container feature-grid">
            {featureCards.map((feature) => (
              <article className="feature-card" key={feature.label}>
                <div className={`feature-card__visual feature-card__visual--${feature.scene}`} aria-hidden="true">
                  {feature.scene === "moments" ? <><i /><i className="is-selected" /><i /><b>18:04 — 18:41</b></> : null}
                  {feature.scene === "frame" ? <><span className="feature-card__portrait" /><span className="feature-card__tracking" /><b>9:16</b></> : null}
                  {feature.scene === "captions" ? <><span>Главное —</span><b>донести мысль</b><i /></> : null}
                </div>
                <p>{feature.label}</p>
                <h3>{feature.title}</h3>
                <span>{feature.description}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-workflow" id="workflow">
          <div className="landing-container workflow-layout">
            <div><h2>От исходника до клипа — в одном коротком маршруте.</h2><p>Каждый шаг сообщает, что происходит дальше. Инструменты появляются только там, где для них есть причина.</p></div>
            <ol className="workflow-list">
              <li><span>01</span><div><h3>Добавьте исходник</h3><p>Ссылка на YouTube или видеофайл.</p></div></li>
              <li><span>02</span><div><h3>Выберите найденные моменты</h3><p>Посмотрите предложения и оставьте то, что хотите выпускать.</p></div></li>
              <li><span>03</span><div><h3>Проверьте и подготовьте клипы</h3><p>Субтитры, кадр и итоговый стиль остаются под вашим контролем.</p></div></li>
            </ol>
          </div>
        </section>

        <section className="landing-section" id="pricing">
          <div className="landing-container landing-section__intro landing-section__intro--compact">
            <h2>Выберите объём, который соответствует вашему ритму.</h2>
            <p>Минуты считаются по длительности исходного видео. Перед оплатой условия остаются прозрачными.</p>
          </div>
          <div className="landing-container pricing-grid-dark">
            {pricingPlans.map((plan) => (
              <article className={`pricing-card-dark ${plan.popular ? "is-featured" : ""}`} key={plan.id}>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <strong>{plan.monthly.toLocaleString("ru-RU")} ₽ <small>/ месяц</small></strong>
                <span>{plan.minutes} минут в месяц</span>
                <ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
                <Link className={`landing-button ${plan.popular ? "" : "landing-button--outline"}`} href="/dashboard/new">{plan.cta}<ArrowRight size={16} /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-faq" id="faq">
          <div className="landing-container faq-layout-dark">
            <div><h2>Вопросы до старта.</h2><p>Без мелкого шрифта и скрытых условий.</p></div>
            <div>{faqItems.slice(0, 6).map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={18} /></summary><p>{item.answer}</p></details>)}</div>
          </div>
        </section>

        <section className="landing-final">
          <div className="landing-container landing-final__panel">
            <div className="landing-final__light" aria-hidden="true" />
            <h2>Начните с видео, которое у вас уже есть.</h2>
            <p>Вставьте ссылку или загрузите файл — дальше Hashpix проведёт по рабочему процессу.</p>
            <Link className="landing-button" href="/dashboard/new">Создать первый проект <ArrowRight size={17} /></Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__top">
          <Image className="landing-footer__logo" src="/assets/logo-source.svg" alt="Hashpix" width={150} height={31} unoptimized />
          <div><Link href="/dashboard">Войти</Link><a href="#features">Возможности</a><a href="#faq">FAQ</a></div>
        </div>
        <div className="landing-container landing-footer__bottom"><span>© 2026 Hashpix</span><span>AI-инструменты для видео</span></div>
      </footer>
    </div>
  );
}
