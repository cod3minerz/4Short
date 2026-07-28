import { Buffer } from "node:buffer";
import { getEnv } from "../env.js";

export type YooPayment = {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  amount: { value: string; currency: "RUB" };
  confirmation?: { type: string; confirmation_url?: string };
  payment_method?: { id?: string; saved?: boolean };
  metadata?: Record<string, string>;
};

function credentials() {
  const env = getEnv();
  if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) {
    throw Object.assign(new Error("PAYMENT_PROVIDER_NOT_CONFIGURED"), { statusCode: 503 });
  }
  return `Basic ${Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString("base64")}`;
}

export async function createYooPayment(input: {
  idempotencyKey: string;
  amountKopecks: number;
  description: string;
  metadata: Record<string, string>;
}) {
  const env = getEnv();
  const response = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Authorization: credentials(),
      "Content-Type": "application/json",
      "Idempotence-Key": input.idempotencyKey.slice(0, 64),
    },
    body: JSON.stringify({
      amount: {
        value: (input.amountKopecks / 100).toFixed(2),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: env.PAYMENT_RETURN_URL,
      },
      save_payment_method: true,
      description: input.description.slice(0, 128),
      metadata: input.metadata,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw Object.assign(new Error("PAYMENT_PROVIDER_ERROR"), {
      statusCode: response.status >= 500 ? 503 : 400,
      details: details.slice(0, 1000),
    });
  }
  return response.json() as Promise<YooPayment>;
}

export async function getYooPayment(paymentId: string) {
  const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: credentials() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error("PAYMENT_VERIFICATION_FAILED"), { statusCode: 502 });
  return response.json() as Promise<YooPayment>;
}
