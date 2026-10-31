import Link from "next/link";
import type { Release } from "@/lib/releases";
import { CaptionWords } from "./cut-scene";
import { faq, planColumns, presets, sourceExample } from "./data";
import { DownloadPair } from "./download";
import { MomentsExplorer } from "./explorer";

export function Hero({ release }: { release: Release | null }) {
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-container lp-hero__grid">
        <div>
          <h1 id="hero-title" className="lp-display-hero lp-hero__title">Из длинного видео — вертикальные клипы</h1>
          <p className="lp-body-3 lp-hero__lead">
            Приложение для Mac и Windows расшифровывает запись на вашем компьютере, находит законченные моменты и экспортирует их в 9:16 с субтитрами.
          </p>
          <div className="lp-hero__cta">
            <DownloadPair release={release} location="hero" />
          </div>
        </div>
        <dl className="lp-hero__facts">
          <div className="lp-fact"><dt>Расшифровка</dt><dd>на вашем компьютере, без сети</dd></div>
          <div className="lp-fact"><dt>Поиск моментов</dt><dd>на сервере, только по тексту</dd></div>
          <div className="lp-fact"><dt>Экспорт</dt><dd>9:16 с субтитрами, на вашем компьютере</dd></div>
          <div className="lp-fact"><dt>Системы</dt><dd>macOS 13+ (Apple Silicon), Windows 10 и 11</dd></div>
        </dl>
      </div>
    </section>
  );
}

const steps = [
  {
    title: "Добавьте видео",
    text: "Перетащите файл или вставьте ссылку. Ссылку приложение скачивает на ваш компьютер.",
    art: (
      <>
        <div className="lp-field"><span>Вставьте ссылку на видео</span><b>Добавить</b></div>
        <div className="lp-field"><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sourceExample.file}</span></div>
      </>
    ),
  },
  {
    title: "Приложение расшифровывает речь",
    text: "Распознавание идёт на вашем процессоре: видео и звук никуда не отправляются. Работу можно отменить в любой момент.",
    art: (
      <div className="lp-prog" style={{ marginTop: 0 }}>
        <div className="lp-prog__row"><span>Подготовка звука</span><span className="lp-mono">100%</span></div>
        <div className="lp-prog__bar"><i style={{ width: "100%" }} /></div>
        <div className="lp-prog__row"><span>Расшифровка речи</span><span className="lp-mono">62%</span></div>
        <div className="lp-prog__bar" style={{ marginBottom: 0 }}><i style={{ width: "62%" }} /></div>
      </div>
    ),
  },
  {
    title: "Выберите моменты",
    text: "Сервер получает текст и возвращает законченные фрагменты с заголовком и причиной выбора. Отметьте нужные и поправьте границы.",
    art: (
      <div className="lp-list">
        <div className="lp-list__row is-on"><span className="lp-check" /><span>Почему первый продукт почти всегда ошибается</span><span className="lp-mono lp-faint">00:47</span></div>
        <div className="lp-list__row is-on"><span className="lp-check" /><span>Три сигнала, что пора менять позиционирование</span><span className="lp-mono lp-faint">01:12</span></div>
        <div className="lp-list__row"><span className="lp-check" /><span>Как команда потеряла месяц на ненужной функции</span><span className="lp-mono lp-faint">00:45</span></div>
      </div>
    ),
  },
  {
    title: "Экспортируйте клипы",
    text: "Каждый клип собирается на компьютере в 9:16 с субтитрами. Перед экспортом приложение проверяет подписку.",
    art: (
      <dl className="lp-export">
        <div><dt>Формат</dt><dd>9:16</dd></div>
        <div><dt>Разрешение</dt><dd className="lp-mono">1080 × 1920</dd></div>
        <div><dt>Субтитры</dt><dd>Активное слово</dd></div>
      </dl>
    ),
  },
];

export function How() {
  return (
    <section className="lp-section" id="how" aria-labelledby="how-title">
      <div className="lp-container">
        <p className="lp-eyebrow">01 · Как это работает</p>
        <h2 id="how-title" className="lp-display-3 lp-section__title">Четыре шага от файла до клипа</h2>
        <ol className="lp-steps">
          {steps.map((step, i) => (
            <li className="lp-step" key={step.title}>
              <span className="lp-step__n">0{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              <div className="lp-art" aria-hidden="true">{step.art}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Moments() {
  return (
    <section className="lp-section lp-section--tight" id="moments" aria-labelledby="moments-title" style={{ borderTop: "1px solid var(--lp-line)" }}>
      <div className="lp-container">
        <p className="lp-eyebrow">02 · Поиск моментов</p>
        <h2 id="moments-title" className="lp-display-3 lp-section__title">Момент — это законченная мысль</h2>
        <p className="lp-body-3 lp-section__lead">
          Для каждого момента приложение показывает границы в расшифровке, тему и причину выбора. Фрагмент можно сдвинуть или убрать до экспорта.
        </p>
        <MomentsExplorer />
      </div>
    </section>
  );
}

export function Subtitles() {
  return (
    <section className="lp-section" id="subtitles" aria-labelledby="subs-title" style={{ borderTop: "1px solid var(--lp-line)" }}>
      <div className="lp-container">
        <div className="lp-subs">
          <div>
            <p className="lp-eyebrow">03 · Субтитры</p>
            <h2 id="subs-title" className="lp-display-3 lp-section__title">Подсветка слова, которое звучит</h2>
          </div>
          <p className="lp-body-3 lp-muted" style={{ maxWidth: 520 }}>
            Субтитры строятся по времени каждого слова из расшифровки. Пресет выбирается для проекта и меняется в редакторе, текст можно исправить вручную.
          </p>
        </div>
        <div className="lp-presets">
          {presets.map((preset) => (
            <figure className="lp-preset" key={preset.id}>
              <div className={`lp-frame${preset.id === "active_word" ? "" : " lp-frame--static"}`} aria-hidden="true">
                <CaptionWords
                  words={preset.words}
                  className={preset.id === "clean" ? "lp-cap--clean" : preset.id === "bold" ? "lp-cap--bold" : preset.id === "minimal_box" ? "lp-cap--box" : ""}
                />
              </div>
              <figcaption><span>{preset.name}</span><code>{preset.id}</code></figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

const flow = [
  { where: "На компьютере", title: "Файл или ссылка", text: "Файл остаётся там, где лежит. Ссылка скачивается в папку приложения.", out: "Ничего" },
  { where: "На компьютере", title: "Звук и текст", text: "Речь распознаётся локально, с отметкой времени у каждого слова.", out: "Ничего" },
  { where: "На сервере", title: "Поиск моментов", text: "Сервер получает текст и подбирает законченные фрагменты.", out: "Текст расшифровки и длительность", server: true },
  { where: "На компьютере", title: "Правка", text: "Границы, текст субтитров и пресет меняются в редакторе.", out: "Ничего" },
  { where: "На компьютере", title: "Экспорт", text: "Клип собирается из исходного файла. Сервер только подтверждает подписку.", out: "Запрос на экспорт, без видео" },
] as const;

export function Device() {
  return (
    <section className="lp-section" id="device" aria-labelledby="device-title" style={{ borderTop: "1px solid var(--lp-line)" }}>
      <div className="lp-container">
        <p className="lp-eyebrow">04 · На вашем компьютере</p>
        <h2 id="device-title" className="lp-display-3 lp-section__title">Видео не покидает компьютер</h2>
        <p className="lp-body-3 lp-section__lead">Только один шаг из пяти выполняется на сервере, и ему нужен лишь текст.</p>
        <div className="lp-flow">
          {flow.map((node) => (
            <div className={`lp-flow__node${"server" in node ? " is-server" : ""}`} key={node.title}>
              <span className="lp-flow__where">{node.where}</span>
              <h3>{node.title}</h3>
              <p>{node.text}</p>
              <p className="lp-flow__out"><span>Уходит с компьютера</span>{node.out}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Requirements() {
  return (
    <section className="lp-section lp-section--tight" id="requirements" aria-labelledby="req-title" style={{ borderTop: "1px solid var(--lp-line)" }}>
      <div className="lp-container lp-req">
        <div>
          <p className="lp-eyebrow">05 · Требования</p>
          <h2 id="req-title" className="lp-display-3 lp-section__title">Что нужно для запуска</h2>
        </div>
        <table className="lp-table">
          <tbody>
            <tr><th scope="row">Mac</th><td>macOS 13 и новее, процессор Apple Silicon (M1 и новее). Intel не поддерживается.</td></tr>
            <tr><th scope="row">Windows</th><td>Windows 10 или 11, 64-разрядная.</td></tr>
            <tr><th scope="row">Место на диске</th><td>Около 0,6 ГБ под речевую модель при первом запуске, около 0,2 ГБ на компьютерах с малым объёмом памяти. Плюс место под видео и клипы.</td></tr>
            <tr><th scope="row">Сеть</th><td>Нужна для поиска моментов, проверки подписки и экспорта. Расшифровка работает без сети.</td></tr>
            <tr><th scope="row">Язык</th><td>Расшифровка настроена на русский.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

const rub = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;

export function Pricing() {
  return (
    <section className="lp-section" id="pricing" aria-labelledby="pricing-title" style={{ borderTop: "1px solid var(--lp-line)" }}>
      <div className="lp-container">
        <p className="lp-eyebrow">06 · Тарифы</p>
        <h2 id="pricing-title" className="lp-display-3 lp-section__title">Подписка по минутам исходного видео</h2>
        <div className="lp-price-wrap">
          <table className="lp-price">
            <thead>
              <tr>
                <th scope="col"><span className="lp-sample">в месяц</span></th>
                {planColumns.map((plan) => (
                  <th scope="col" key={plan.code}>{plan.name}<small>{plan.price === 0 ? "0 ₽" : rub(plan.price)}</small></th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">Минут исходного видео</th>{planColumns.map((p) => <td key={p.code}>{p.minutes.toLocaleString("ru-RU")}</td>)}</tr>
              <tr><th scope="row">Разрешение экспорта</th>{planColumns.map((p) => <td key={p.code}>{p.resolution}</td>)}</tr>
              <tr><th scope="row">Водяной знак</th>{planColumns.map((p) => <td key={p.code}>{p.watermark ? "Есть" : "Нет"}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="lp-note">
          Подписка оформляется в приложении после входа. Минуты считаются по длительности исходного видео и действуют в оплаченном месяце.
        </p>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="lp-section" id="faq" aria-labelledby="faq-title" style={{ borderTop: "1px solid var(--lp-line)" }}>
      <div className="lp-container lp-faq">
        <div>
          <p className="lp-eyebrow">07 · Вопросы</p>
          <h2 id="faq-title" className="lp-display-3 lp-section__title">Частые вопросы</h2>
        </div>
        <div>
          {faq.map((item) => (
            <details className="lp-qa" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Final({ release }: { release: Release | null }) {
  return (
    <section className="lp-final" id="download" aria-labelledby="final-title">
      <div className="lp-container lp-final__grid">
        <div>
          <p className="lp-eyebrow">08 · Скачать</p>
          <h2 id="final-title" className="lp-display-4">Скачайте Нарезай для Mac или Windows</h2>
          <p className="lp-body-3 lp-section__lead">Бесплатный тариф включает 30 минут исходного видео в месяц. Вход по коду из письма.</p>
          <div className="lp-final__cta"><DownloadPair release={release} location="final" /></div>
          <p className="lp-hero__fine lp-body-1">
            Уже есть аккаунт? <Link href="/sign-in" style={{ textDecoration: "underline" }}>Войти</Link>
          </p>
        </div>
        <div className="lp-open">
          <h3>Система предупреждает при запуске</h3>
          <p className="lp-muted" style={{ marginTop: 8 }}>Сборки пока не подписаны сертификатом разработчика. Приложение можно открыть вручную.</p>
          <ol>
            <li><strong>Mac:</strong> перенесите приложение в «Программы», нажмите на него правой кнопкой и выберите «Открыть», затем подтвердите.</li>
            <li><strong>Windows:</strong> в окне SmartScreen нажмите «Подробнее», затем «Выполнить в любом случае».</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
