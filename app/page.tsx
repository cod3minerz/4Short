import type { Metadata } from "next";
import {
  ArrowDown,
  ArrowRight,
  Captions,
  Check,
  Clock3,
  Crop,
  FileVideo2,
  Focus,
  Pause,
  Play,
  ScanFace,
  Scissors,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { HeroCarousel, PlatformCycler } from "./components/hero-showcase";
import { InteractiveLanding } from "./components/interactive-landing";
import { Logo } from "./components/logo";
import { faqItems, pricingPlans } from "./data/content";

export const metadata: Metadata = {
  title: "4Short — AI-нарезка видео в Shorts, Reels и TikTok",
  description:
    "Превращайте длинные видео, подкасты и интервью в готовые вертикальные ролики. 4Short найдёт лучшие моменты, добавит субтитры и удержит спикера в кадре.",
  alternates: { canonical: "/" },
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

function MediaSlot({
  ratio = "vertical",
  label,
  className = "",
}: {
  ratio?: "vertical" | "wide";
  label: string;
  className?: string;
}) {
  return (
    <div className={`media-slot media-slot--${ratio} ${className}`}>
      <div className="media-grid" />
      <div className="media-slot__center">
        <Play aria-hidden="true" size={18} fill="currentColor" />
      </div>
      <span>{label}</span>
    </div>
  );
}

function AppLogo() {
  return <Logo className="site-logo" />;
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={`section-heading section-heading--${align}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export default function Home() {
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "4Short",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    description:
      "Сервис для автоматической нарезки длинных видео в вертикальные клипы.",
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <InteractiveLanding>
        <main>
          <section className="hero" id="top">
            <div className="hero__clouds" aria-hidden="true" />
            <div className="container hero__inner">
              <div className="hero__copy">
                <h1>
                  <span className="hero__title-line">ОДНО ВИДЕО.</span>
                  <span className="hero__title-line hero__title-line--accent">КОНТЕНТ НА НЕДЕЛИ.</span>
                </h1>
                <p className="hero__platform-line">
                  <span>Короткие видео из одного большого для</span>
                  <PlatformCycler />
                </p>
                <div data-form-slot="hero" />
              </div>

              <HeroCarousel />
              <a className="scroll-cue" href="#features" aria-label="К возможностям">
                <ArrowDown size={18} />
              </a>
            </div>
          </section>

          <section className="section" id="features">
            <div className="container">
              <SectionHeading
                align="center"
                eyebrow="Возможности"
                title="Настройте результат. Остальное сделает 4Short."
                description="Не десятки экранов и ручных действий — только параметры, которые действительно влияют на ролик."
              />
              <div className="bento">
                <article className="bento-card bento-card--transcript squircle">
                  <div className="card-copy">
                    <span className="card-icon"><Sparkles size={19} /></span>
                    <h3>Находит сильные моменты</h3>
                    <p>Анализирует смысл, законченность мысли и динамику речи.</p>
                  </div>
                  <div className="transcript-ui">
                    <div className="transcript-ui__meta">
                      <span>Транскрипт выпуска</span><span>18:42</span>
                    </div>
                    <p>Главная проблема не в количестве идей.</p>
                    <p className="is-active">
                      <span>Она в том, что мы слишком долго ждём идеального момента.</span>
                      <b>Сильный хук</b>
                    </p>
                    <p>Начните с малого и повторяйте регулярно.</p>
                    <div className="timeline"><span /></div>
                  </div>
                </article>

                <article className="bento-card bento-card--tracking squircle">
                  <div className="card-copy">
                    <span className="card-icon"><ScanFace size={19} /></span>
                    <h3>Спикер всегда в кадре</h3>
                    <p>Умное кадрирование следует за активным собеседником.</p>
                  </div>
                  <div className="tracking-ui">
                    <MediaSlot ratio="wide" label="Исходник 16:9" />
                    <ArrowRight className="tracking-ui__arrow" size={20} />
                    <div className="tracking-ui__result">
                      <MediaSlot label="Результат 9:16" />
                      <div className="face-frame" aria-hidden="true" />
                    </div>
                  </div>
                </article>

                <article className="bento-card bento-card--small squircle">
                  <Captions size={24} />
                  <h3>Автосубтитры</h3>
                  <div className="caption-demo">Смысл <mark>остаётся</mark> в центре</div>
                </article>
                <article className="bento-card bento-card--small squircle">
                  <Clock3 size={24} />
                  <h3>Количество и длина</h3>
                  <div className="range-demo"><span>4 клипа</span><span>30–60 сек.</span></div>
                </article>
                <article className="bento-card bento-card--small squircle">
                  <Pause size={24} />
                  <h3>Удаление молчания</h3>
                  <div className="wave-demo"><i /><i /><i className="is-gap" /><i /><i /></div>
                </article>
                <article className="bento-card bento-card--small squircle">
                  <Focus size={24} />
                  <h3>Разные смыслы</h3>
                  <div className="topic-chips"><span>Хук</span><span>История</span><span>Совет</span></div>
                </article>
              </div>
            </div>
          </section>

          <section className="section section--tint">
            <div className="container split-section">
              <div className="split-copy">
                <SectionHeading
                  eyebrow="Один исходник"
                  title="Загрузите один раз. Получайте контент снова и снова."
                  description="Один выпуск превращается в серию самостоятельных мыслей — каждая со своим началом, темой и темпом."
                />
                <div className="result-line">
                  <span>1 выпуск</span><ArrowRight size={18} />
                  <span>8 клипов</span><ArrowRight size={18} />
                  <strong>контент на неделю</strong>
                </div>
                <small>Демонстрационный пример результата</small>
              </div>
              <div className="source-flow squircle">
                <div className="source-flow__input">
                  <MediaSlot ratio="wide" label="Подкаст • 58:24" />
                  <div><strong>Как выпускать контент регулярно</strong><span>Исходное видео</span></div>
                </div>
                <div className="source-flow__process">
                  <span><Sparkles size={16} /> Поиск моментов</span>
                  <span><Crop size={16} /> Кадрирование</span>
                  <span><Captions size={16} /> Субтитры</span>
                  <b><Check size={15} /> Готово</b>
                </div>
                <div className="source-flow__outputs">
                  {["Сильный хук", "Личный опыт", "Практический совет", "Главный вывод"].map((label) => (
                    <MediaSlot key={label} label={label} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="how">
            <div className="container split-section split-section--reverse">
              <div className="workflow-panel squircle">
                <div className="workflow-panel__preview">
                  <MediaSlot ratio="wide" label="Видео добавлено" />
                </div>
                <div className="workflow-control">
                  <div><span>Количество клипов</span><strong>6</strong></div>
                  <div><span>Длительность</span><strong>30–60 сек.</strong></div>
                  <div><span>Субтитры</span><b className="toggle-on"><i /></b></div>
                </div>
                <button className="product-button" type="button">
                  <WandSparkles size={18} /> Найти лучшие моменты
                </button>
              </div>
              <div className="split-copy">
                <SectionHeading
                  eyebrow="Как это работает"
                  title="Три шага — и ролики готовы"
                  description="Вы задаёте направление. 4Short берёт на себя просмотр, поиск моментов и базовый монтаж."
                />
                <ol className="steps">
                  <li><span>01</span><div><h3>Добавьте видео</h3><p>Вставьте ссылку YouTube или выберите файл.</p></div></li>
                  <li><span>02</span><div><h3>Выберите результат</h3><p>Укажите количество, длительность и стиль.</p></div></li>
                  <li><span>03</span><div><h3>Получите клипы</h3><p>Проверьте найденные моменты и скачайте.</p></div></li>
                </ol>
              </div>
            </div>
          </section>

          <section className="section section--ink">
            <div className="container">
              <SectionHeading
                align="center"
                eyebrow="До и после"
                title="Из обычного фрагмента — в готовый Short"
                description="Меняется формат, темп и фокус. Смысл исходного фрагмента остаётся под вашим контролем."
              />
              <div className="before-after">
                <article>
                  <div className="visual-label">До · 01:04</div>
                  <MediaSlot ratio="wide" label="Два спикера • исходник 16:9" />
                </article>
                <div className="transform-list">
                  <span><Crop size={17} /> Кадрирование</span>
                  <span><Scissors size={17} /> Паузы −8 сек.</span>
                  <span><Captions size={17} /> Субтитры</span>
                </div>
                <article className="after-card">
                  <div className="visual-label">После · 00:42</div>
                  <MediaSlot label="Активный спикер • 9:16" />
                  <div className="after-card__captions">Главная мысль <mark>остаётся</mark> в кадре</div>
                </article>
              </div>
              <div className="metrics-strip">
                <span><b>16:9 → 9:16</b> формат</span>
                <span><b>01:04 → 00:42</b> длительность</span>
                <span><b>−8 сек.</b> паузы</span>
                <span><b>Добавлены</b> субтитры</span>
                <small>Демонстрационный пример</small>
              </div>
            </div>
          </section>

          <section className="section" id="audience">
            <div className="container">
              <SectionHeading
                eyebrow="Для кого"
                title="Для тех, у кого уже есть что сказать"
                description="4Short помогает чаще публиковать сильные мысли из контента, который вы уже создаёте."
              />
              <div data-audience-slot />
            </div>
          </section>

          <section className="section section--tint" id="pricing">
            <div className="container">
              <SectionHeading
                align="center"
                eyebrow="Тарифы"
                title="Выберите объём, который подходит вам"
                description="Минуты списываются по длительности исходного видео. Все условия ниже предварительные."
              />
              <div data-pricing-toggle-slot />
              <div className="pricing-grid">
                {pricingPlans.map((plan) => (
                  <article className={`price-card squircle ${plan.popular ? "is-popular" : ""}`} key={plan.name}>
                    {plan.popular ? <span className="popular-badge">Популярный</span> : null}
                    <div className="price-card__header">
                      <h3>{plan.name}</h3>
                      <p>{plan.description}</p>
                    </div>
                    <div className="price-card__price">
                      <strong data-monthly={plan.monthly} />
                      <span>₽ / мес.</span>
                    </div>
                    <div className="price-card__minutes">{plan.minutes} минут исходного видео</div>
                    <ul>
                      {plan.features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}
                    </ul>
                    <button className="price-button" data-plan={plan.name} type="button">
                      {plan.cta}<ArrowRight size={17} />
                    </button>
                  </article>
                ))}
              </div>
              <p className="pricing-note">300 минут ≈ до 5 выпусков по 60 минут. Демонстрационный расчёт.</p>
            </div>
          </section>

          <section className="section" id="minutes">
            <div className="container minutes-layout">
              <div className="minutes-copy">
                <SectionHeading
                  eyebrow="Дополнительные минуты"
                  title="Закончились минуты? Просто добавьте ещё"
                  description="Разовые пакеты не меняют тариф и добавляются к текущему балансу. Срок действия уточняется."
                />
                <div data-minutes-slot />
              </div>
              <aside className="balance-card squircle">
                <span className="balance-card__label">Баланс после покупки</span>
                <div className="balance-row"><span>Минуты тарифа</span><strong>184 / 300</strong></div>
                <div className="balance-row"><span>Дополнительные</span><strong data-extra-minutes>+180</strong></div>
                <hr />
                <div className="balance-total"><span>Итого</span><strong data-total-minutes>364 минуты</strong></div>
                <div className="balance-meter"><span /></div>
                <small>Демонстрационный пример. Минуты списываются по длине исходника.</small>
              </aside>
            </div>
          </section>

          <section className="section faq-section" id="faq">
            <div className="container faq-layout">
              <div>
                <Eyebrow>FAQ</Eyebrow>
                <h2>Коротко о главном</h2>
                <p>Если ответа пока нет, мы честно отмечаем, что условия ещё уточняются.</p>
              </div>
              <div data-faq-slot />
            </div>
          </section>

          <section className="section final-cta">
            <div className="container final-cta__card squircle">
              <div className="final-cta__icon"><FileVideo2 size={24} /></div>
              <h2>Одно видео уже может стать контентом на неделю</h2>
              <p>Вставьте ссылку на YouTube или загрузите файл — 4Short подготовит вертикальные ролики.</p>
              <div data-form-slot="final" />
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="container footer__grid">
            <div className="footer__brand">
              <AppLogo />
              <p>Длинные видео превращаются в короткий контент без часов ручного просмотра.</p>
              <span>Сервис готовится к запуску</span>
            </div>
            <div><h3>Продукт</h3><a href="#features">Возможности</a><a href="#how">Как это работает</a><a href="#pricing">Тарифы</a><a href="#minutes">Дополнительные минуты</a></div>
            <div><h3>Ресурсы</h3><a href="#faq">FAQ</a><a href="#audience">Для кого</a><a href="mailto:hello@4short.ru">Поддержка</a><span>Документация · скоро</span></div>
            <div><h3>Документы</h3><span>Политика конфиденциальности</span><span>Пользовательское соглашение</span><span>Условия оплаты</span><span>Политика возврата</span></div>
          </div>
          <div className="container footer__bottom">
            <span>© 2026 4Short</span><span>Русский</span><span>Реквизиты будут добавлены до запуска</span>
          </div>
        </footer>
      </InteractiveLanding>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </>
  );
}
