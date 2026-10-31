import { useRef, useState } from "react";
import { Button, Badge } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Login({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"email" | "code" | "device">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[i] = d;
    setCode(next);
    if (d && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <div className="login">
      <div className="glass login__card">
        <div className="brand"><span className="brand__mark"><Icon name="scissors" size={16} /></span>Нарезай</div>

        {step === "email" && (
          <>
            <div>
              <h2 style={{ fontSize: 24, letterSpacing: "-0.03em" }}>Войдите, чтобы начать</h2>
              <p className="muted" style={{ marginTop: 6 }}>Пришлём код на почту. Пароль не нужен.</p>
            </div>
            <label className="field">
              <Icon name="user" />
              <input type="email" placeholder="you@mail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <Button variant="primary" size="lg" disabled={!/.+@.+\..+/.test(email)} onClick={() => setStep("code")}>Получить код</Button>
          </>
        )}

        {step === "code" && (
          <>
            <div>
              <h2 style={{ fontSize: 24, letterSpacing: "-0.03em" }}>Введите код из письма</h2>
              <p className="muted" style={{ marginTop: 6 }}>Отправили на {email}</p>
            </div>
            <div className="otp">
              {code.map((d, i) => (
                <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" value={d} onChange={(e) => setDigit(i, e.target.value)} aria-label={`Цифра ${i + 1}`} />
              ))}
            </div>
            <Button variant="primary" size="lg" disabled={code.some((d) => !d)} onClick={() => setStep("device")}>Продолжить</Button>
            <Button variant="ghost" onClick={() => setStep("email")}>Другая почта</Button>
          </>
        )}

        {step === "device" && (
          <>
            <div>
              <h2 style={{ fontSize: 24, letterSpacing: "-0.03em" }}>Активировать это устройство</h2>
              <p className="muted" style={{ marginTop: 6 }}>Подписка работает на двух устройствах. Это будет первым.</p>
            </div>
            <div className="card card--pad row">
              <Icon name="monitor" />
              <div><b>Это устройство</b><div className="faint" style={{ fontSize: 12 }}>Ключ хранится в защищённом хранилище системы</div></div>
              <span className="spacer" />
              <Badge tone="local">1 из 2</Badge>
            </div>
            <Button variant="primary" size="lg" onClick={onDone}>Активировать</Button>
          </>
        )}

        <div className="row faint" style={{ fontSize: 12 }}>
          <Icon name="lock" size={14} /> Видео остаётся на вашем компьютере
        </div>
      </div>
    </div>
  );
}
