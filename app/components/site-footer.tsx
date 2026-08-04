import Link from "next/link";
import { navigation } from "../data/content";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <Logo tone="light" />
          <p>Длинные видео превращаются в короткий контент без часов ручного просмотра.</p>
        </div>

        <div>
          <h3>Навигация</h3>
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </div>

        <div>
          <h3>Контакты</h3>
          <a href="mailto:hello@hashpix.ru">hello@hashpix.ru</a>
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
        <span>© 2026 Hashpix</span>
        <span>Русский</span>
        <span>Реквизиты будут добавлены до начала оплаты</span>
      </div>
    </footer>
  );
}
