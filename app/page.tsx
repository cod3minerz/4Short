import type { Metadata } from "next";
import "./public-boundary.css";
import { DarkLanding } from "./components/dark-landing";
import { faqItems } from "./data/content";

export const metadata: Metadata = {
  title: "Narezai — AI-клипы из длинных видео",
  description:
    "Narezai находит сильные моменты в длинных видео и помогает подготовить вертикальные клипы для публикации.",
  alternates: { canonical: "/" },
};

export default function Home() {
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Narezai",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    description: "Сервис для подготовки вертикальных клипов из длинных видео.",
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.slice(0, 6).map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <div className="public-boundary">
      <DarkLanding />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  );
}
