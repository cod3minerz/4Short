import { Badge, Bar, Button, PageHead } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Account({ onDiag, onSignOut }: { onDiag: () => void; onSignOut: () => void }) {
  return (
    <div className="page">
      <PageHead title="Аккаунт" sub="you@mail.com">
        <Button variant="ghost" onClick={onSignOut}>Выйти</Button>
      </PageHead>
      <div className="two">
        <div className="card card--pad" style={{ display: "grid", gap: 14 }}>
          <div className="row"><span className="eyebrow">Тариф</span><span className="spacer" /><Badge tone="accent">Пробный</Badge></div>
          <div className="quota__nums"><b style={{ fontSize: 30, letterSpacing: "-0.03em" }}>42</b><span className="muted">из 60 минут ИИ</span></div>
          <Bar value={70} />
          <p className="muted" style={{ fontSize: 13 }}>Минуты тратятся только на поиск моментов и экспорт. Распознавание речи на вашем компьютере бесплатно и безлимитно.</p>
          <Button variant="primary" disabled>Оформить подписку (скоро)</Button>
        </div>
        <div className="card card--pad">
          <div className="row" style={{ marginBottom: 6 }}><span className="eyebrow">Устройства</span><span className="spacer" /><span className="muted">2 из 2</span></div>
          <div className="dev"><div className="dev__ic"><Icon name="monitor" /></div><div><b>MacBook Air</b><div className="faint" style={{ fontSize: 12 }}>Это устройство</div></div><span className="spacer" /><Badge tone="local">Активно</Badge></div>
          <div className="dev"><div className="dev__ic"><Icon name="monitor" /></div><div><b>Windows ПК</b><div className="faint" style={{ fontSize: 12 }}>Был в сети вчера</div></div><span className="spacer" /><Button size="sm" variant="ghost" icon="trash">Отключить</Button></div>
        </div>
      </div>
      <div className="card card--pad">
        <div className="eyebrow" style={{ marginBottom: 14 }}>Лицензия</div>
        <dl className="kv">
          <dt>Статус</dt><dd><Badge tone="local">Активна</Badge></dd>
          <dt>Работа без интернета</dt><dd>Редактирование до 72 часов. Экспорт и поиск моментов требуют сети.</dd>
          <dt>Приватность</dt><dd>На сервер уходит только текст речи. Видео и звук остаются на вашем компьютере.</dd>
        </dl>
      </div>
      <div className="row"><Button variant="ghost" icon="wrench" onClick={onDiag}>Диагностика</Button></div>
    </div>
  );
}
