import type { Metadata } from "next";
import { HeroBackground } from "./components/hero-background";
import { HeroCarousel, PlatformCycler } from "./components/hero-showcase";
import {
  FaqSection,
  Header,
  MinutesSection,
  Notice,
  PricingSection,
  UrlActionForm,
} from "./components/interactive-landing";
import { ProductSections } from "./components/product-sections";
import { SiteFooter } from "./components/site-footer";
import { faqItems } from "./data/content";

export const metadata: Metadata = {
  title: "Hashpix — AI-нарезка видео в Shorts, Reels и TikTok",
  description:
    "Превращайте длинные видео, подкасты и интервью в готовые вертикальные ролики. Hashpix найдёт сильные моменты, добавит субтитры и удержит спикера в кадре.",
  alternates: { canonical: "/" },
};

export default function Home() {
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Hashpix",
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
          <HeroBackground />
          <div className="container hero__inner">
            <div className="hero__copy">
              <span className="hero-kicker">AI-нарезка длинных видео</span>
              <h1>
                <span>ОДНО ВИДЕО.</span>
                <span className="hero-title-secondary">
                  <span>КОНТЕНТ</span>
                  <span>НА НЕДЕЛИ.</span>
                </span>
              </h1>
              <p className="hero__platform-line">
                <span>Короткие видео из одного большого</span>
                <span className="hero__platform-tail">
                  <span>для</span>
                  <PlatformCycler />
                </span>
              </p>
              <UrlActionForm placement="hero" />
            </div>

            <HeroCarousel />
          </div>
        </section>

        <ProductSections />
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

      <SiteFooter />

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
