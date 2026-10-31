import type { Metadata } from "next";
import { Landing } from "./landing/page-body";
import { faq } from "./landing/data";

export const metadata: Metadata = {
  title: "Нарезай — приложение для нарезки длинных видео на клипы",
  description:
    "Приложение для Mac и Windows: расшифровывает видео на вашем компьютере, находит законченные моменты и экспортирует вертикальные клипы 9:16 с субтитрами.",
  alternates: { canonical: "/" },
};

export default function Home() {
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Нарезай",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "macOS, Windows",
    description: "Приложение для нарезки длинных видео на вертикальные клипы.",
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <Landing />
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
