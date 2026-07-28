import type { Metadata } from "next";
import { HeroCarousel, PlatformCycler } from "./components/hero-showcase";
import {
  FaqSection,
  Header,
  MinutesSection,
  Notice,
  PricingSection,
  UrlActionForm,
} from "./components/interactive-landing";
import { Logo } from "./components/logo";
import { faqItems, navigation } from "./data/content";

export const metadata: Metadata = {
  title: "4Short — AI-нарезка видео в Shorts, Reels и TikTok",
  description:
    "Превращайте длинные видео, подкасты и интервью в готовые вертикальные ролики. 4Short найдёт сильные моменты, добавит субтитры и удержит спикера в кадре.",
  alternates: { canonical: "/" },
};

export default function Home() {
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "4Short",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    description: "Сервис для нарезки длинных видео в вертикальные клипы.",
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
      <Header />

      <main>
        <section className="hero" id="top">
          <div className="hero__clouds" aria-hidden="true" />
          <div className="container hero__inner">
            <div className="hero__copy">
              <span className="hero-kicker">AI-нарезка длинных видео</span>
              <h1>
                <span>ОДНО ВИДЕО.</span>
                <span>КОНТЕНТ НА НЕДЕЛИ.</span>
              </h1>
              <p className="hero__platform-line">
                <span>Короткие видео из одного большого для</span>
                <PlatformCycler />
              </p>
              <UrlActionForm placement="hero" />
            </div>

            <HeroCarousel />
          </div>
        </section>

        <PricingSection />
        <MinutesSection />
        <FaqSection />

        <section className="final-cta section">
          <div className="container final-cta__card squircle">
            <span className="section-index">Начните с исходника</span>
            <h2>ПРЕВРАТИТЕ ОДНО ВИДЕО В СЕРИЮ КЛИПОВ</h2>
            <p>Вставьте ссылку на YouTube или загрузите файл.</p>
            <UrlActionForm placement="final" />
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer__grid">
          <div className="footer__brand">
            <Logo tone="light" />
            <p>Длинные видео превращаются в короткий контент без часов ручного просмотра.</p>
          </div>

          <div>
            <h3>Навигация</h3>
            {navigation.map((item) => (
              <a href={item.href} key={item.href}>{item.label}</a>
            ))}
          </div>

          <div>
            <h3>Контакты</h3>
            <a href="mailto:hello@4short.ru">hello@4short.ru</a>
            <span>Поддержка</span>
            <span>Статус сервиса</span>
          </div>

          <div>
            <h3>Документы</h3>
            <span>Политика конфиденциальности</span>
            <span>Пользовательское соглашение</span>
            <span>Условия оплаты</span>
          </div>
        </div>

        <div className="container footer__bottom">
          <span>© 2026 4Short</span>
          <span>Русский</span>
          <span>Реквизиты будут добавлены до начала оплаты</span>
        </div>
      </footer>

      <Notice />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </>
  );
}
