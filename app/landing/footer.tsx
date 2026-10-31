import Link from "next/link";
import { footerColumns } from "./data";

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer__grid">
          <div className="lp-footer__about">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logo-narezai.svg" alt="Нарезай" width={112} height={23} />
            <p>Приложение для Mac и Windows, которое нарезает длинные видео на вертикальные клипы.</p>
          </div>
          {footerColumns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    {link.href.startsWith("/") ? <Link href={link.href}>{link.label}</Link> : <a href={link.href}>{link.label}</a>}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="lp-footer__meta">
          <span>© 2026 Нарезай</span>
          <span>Русский</span>
        </div>
      </div>
      <div className="lp-footer__word" aria-hidden="true"><span /></div>
    </footer>
  );
}
