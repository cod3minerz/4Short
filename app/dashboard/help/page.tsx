import { ArrowRight, BookOpenText, CircleHelp, MessageCircle, PlayCircle } from "lucide-react";
import Link from "next/link";
import { PageHeading } from "../components/page-heading";

const helpCards = [
  { icon: PlayCircle, title: "Первый проект", text: "Как добавить видео, выбрать моменты и получить готовые клипы." },
  { icon: BookOpenText, title: "Настройки результата", text: "Длительность, кадрирование, субтитры, паузы и баннеры." },
  { icon: CircleHelp, title: "Минуты и списания", text: "Когда резервируются минуты и в каких случаях они возвращаются." },
];

export default function HelpPage() {
  return (
    <main className="dash-page">
      <PageHeading
        eyebrow="Поддержка"
        title="ПОМОЩЬ"
        description="Короткие ответы о работе конвейера 4Short."
      />
      <section className="help-grid">
        {helpCards.map(({ icon: Icon, title, text }) => (
          <Link href="/blog/ai-video-clipping" key={title}>
            <span><Icon size={22} /></span>
            <h2>{title}</h2>
            <p>{text}</p>
            <b>Открыть руководство <ArrowRight size={16} /></b>
          </Link>
        ))}
      </section>
      <section className="help-contact">
        <span><MessageCircle size={24} /></span>
        <div><span className="dash-eyebrow">Не нашли ответ?</span><h2>Напишите в поддержку</h2><p>Сохраним контекст проекта и поможем разобраться с конкретным этапом.</p></div>
        <button type="button">Открыть чат</button>
      </section>
    </main>
  );
}
