import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env.js";

type TokenValue = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];

export type TBankPayload = Record<string, TokenValue>;

export type TBankPayment = {
  Success: boolean;
  ErrorCode: string;
  Message?: string;
  Details?: string;
  TerminalKey?: string;
  Status?: string;
  PaymentId?: string | number;
  OrderId?: string;
  Amount?: number;
  PaymentURL?: string;
  RebillId?: string;
  Token?: string;
};

function credentials() {
  const env = getEnv();
  if (!env.TBANK_TERMINAL_KEY || !env.TBANK_PASSWORD) {
    throw Object.assign(new Error("PAYMENT_PROVIDER_NOT_CONFIGURED"), { statusCode: 503 });
  }
  return { terminalKey: env.TBANK_TERMINAL_KEY, password: env.TBANK_PASSWORD };
}

/**
 * T-Bank signs top-level scalar values only. Nested DATA/Receipt objects and
 * the Token itself are deliberately excluded before alphabetic concatenation.
 */
export function createTBankToken(payload: TBankPayload, password: string) {
  const values: Record<string, string> = { Password: password };
  for (const [key, value] of Object.entries(payload)) {
    if (key === "Token" || value === null || value === undefined || typeof value === "object") continue;
    values[key] = String(value);
  }
  const source = Object.keys(values).sort().map((key) => values[key]).join("");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function verifyTBankNotification(payload: TBankPayload) {
  const token = typeof payload.Token === "string" ? payload.Token : "";
  const { password } = credentials();
  if (token.length !== 64) return false;
  const expected = Buffer.from(createTBankToken(payload, password), "hex");
  const received = Buffer.from(token.toLowerCase(), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function callTBank(method: "Init" | "GetState" | "Charge", payload: TBankPayload) {
  const env = getEnv();
  const { terminalKey, password } = credentials();
  const body = { TerminalKey: terminalKey, ...payload };
  const signed = { ...body, Token: createTBankToken(body, password) };
  const response = await fetch(`${env.TBANK_API_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signed),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error("PAYMENT_PROVIDER_UNAVAILABLE"), {
      statusCode: response.status >= 500 ? 503 : 400,
    });
  }
  const result = await response.json() as TBankPayment;
  if (!result.Success) {
    throw Object.assign(new Error("PAYMENT_PROVIDER_ERROR"), {
      statusCode: result.ErrorCode === "9999" ? 503 : 400,
      details: `${result.ErrorCode}: ${result.Message ?? result.Details ?? "T-Bank rejected request"}`,
    });
  }
  return result;
}

export function createTBankOrderId(idempotencyKey: string) {
  return `4s-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
}

export async function createTBankPayment(input: {
  idempotencyKey: string;
  amountKopecks: number;
  description: string;
  workspaceId: string;
  packageCode: string;
}) {
  const env = getEnv();
  return callTBank("Init", {
    Amount: input.amountKopecks,
    OrderId: createTBankOrderId(input.idempotencyKey),
    Description: input.description.slice(0, 140),
    PayType: "O",
    Language: "ru",
    NotificationURL: `${env.API_PUBLIC_URL}/v1/billing/tbank/webhook`,
    SuccessURL: env.PAYMENT_RETURN_URL,
    FailURL: env.PAYMENT_RETURN_URL,
    DATA: {
      workspaceId: input.workspaceId,
      packageCode: input.packageCode,
      OperationInitiatorType: "0",
    },
  });
}

export async function getTBankPayment(paymentId: string) {
  return callTBank("GetState", { PaymentId: paymentId });
}

export function mapTBankStatus(status?: string) {
  if (status === "CONFIRMED") return "succeeded" as const;
  if (status === "AUTHORIZED") return "waiting_for_capture" as const;
  if (status === "REFUNDED" || status === "PARTIAL_REFUNDED") return "refunded" as const;
  if (["REJECTED", "AUTH_FAIL", "DEADLINE_EXPIRED", "CANCELED"].includes(status ?? "")) {
    return "cancelled" as const;
  }
  return "pending" as const;
}
