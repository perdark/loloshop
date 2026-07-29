import { api } from "./api";

export type PayoutRecipientKind = "staff" | "tailor" | "workshop";

export interface PayoutAccount {
  provider: "superqi_mastercard";
  cardNumber: string | null;
  cardholderName: string | null;
  updatedAt: string | null;
  /** false for workshop crew — an admin sets their card, so the panel is hidden. */
  eligible: boolean;
}

interface ApiPayoutAccount {
  provider: "superqi_mastercard";
  card_number: string | null;
  cardholder_name: string | null;
  updated_at: string | null;
  eligible?: boolean;
}

export interface PayoutRecipient {
  userId: string;
  sourceId: string;
  name: string;
  recipientKind: PayoutRecipientKind;
  suggestedAmount: number;
  cardNumber: string | null;
  cardholderName: string | null;
  cardUpdatedAt: string | null;
  lastPayoutAmount: number | null;
  lastPayoutAt: string | null;
}

export interface ManualPayout {
  id: string;
  userId: string;
  sourceId: string;
  name: string;
  recipientKind: PayoutRecipientKind;
  amount: number;
  cardNumberSnapshot: string;
  note: string | null;
  paidAt: string;
  createdByName: string | null;
}

interface ApiPayoutRecipient {
  user_id: string;
  source_id: string;
  name: string;
  recipient_kind: PayoutRecipientKind;
  suggested_amount: number;
  card_number: string | null;
  cardholder_name: string | null;
  card_updated_at: string | null;
  last_payout_amount: number | null;
  last_payout_at: string | null;
}

interface ApiManualPayout {
  id: string;
  user_id: string;
  source_id: string;
  name: string;
  recipient_kind: PayoutRecipientKind;
  amount: number;
  card_number_snapshot: string;
  note: string | null;
  paid_at: string;
  created_by_name: string | null;
}

function mapAccount(account: ApiPayoutAccount): PayoutAccount {
  return {
    provider: account.provider,
    cardNumber: account.card_number,
    cardholderName: account.cardholder_name,
    updatedAt: account.updated_at,
    eligible: account.eligible !== false,
  };
}

function mapRecipient(row: ApiPayoutRecipient): PayoutRecipient {
  return {
    userId: row.user_id,
    sourceId: row.source_id,
    name: row.name,
    recipientKind: row.recipient_kind,
    suggestedAmount: Number(row.suggested_amount) || 0,
    cardNumber: row.card_number,
    cardholderName: row.cardholder_name,
    cardUpdatedAt: row.card_updated_at,
    lastPayoutAmount:
      row.last_payout_amount == null ? null : Number(row.last_payout_amount),
    lastPayoutAt: row.last_payout_at,
  };
}

export function formatPayoutCardNumber(cardNumber: string | null | undefined): string {
  const digits = String(cardNumber || "").replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function normalizePayoutCardNumber(value: string): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(eastern.indexOf(digit)))
    .replace(/\D/g, "")
    .slice(0, 16);
}

async function getAccount(path: string): Promise<PayoutAccount> {
  const { data } = await api.get<{ data: ApiPayoutAccount }>(path);
  return mapAccount(data.data);
}

async function saveAccount(
  path: string,
  cardNumber: string,
  cardholderName?: string
): Promise<PayoutAccount> {
  const { data } = await api.put<{ data: ApiPayoutAccount }>(path, {
    card_number: normalizePayoutCardNumber(cardNumber),
    cardholder_name: cardholderName?.trim() || undefined,
  });
  return mapAccount(data.data);
}

export function getMyStaffPayoutAccount(): Promise<PayoutAccount> {
  return getAccount("/payroll/me/payout-account");
}

export function saveMyStaffPayoutAccount(
  cardNumber: string,
  cardholderName?: string
): Promise<PayoutAccount> {
  return saveAccount("/payroll/me/payout-account", cardNumber, cardholderName);
}

// Workshop workers do not manage their own payout card — an admin sets it for them
// from /admin/payouts. The self-service endpoints were removed with the panel.

export async function getAdminPayouts(): Promise<{
  recipients: PayoutRecipient[];
  history: ManualPayout[];
}> {
  const { data } = await api.get<{
    data: { recipients: ApiPayoutRecipient[]; history: ApiManualPayout[] };
  }>("/admin/payouts");
  return {
    recipients: (data.data.recipients || []).map(mapRecipient),
    history: (data.data.history || []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      sourceId: row.source_id,
      name: row.name,
      recipientKind: row.recipient_kind,
      amount: Number(row.amount) || 0,
      cardNumberSnapshot: row.card_number_snapshot,
      note: row.note,
      paidAt: row.paid_at,
      createdByName: row.created_by_name,
    })),
  };
}

export function saveAdminPayoutAccount(
  userId: string,
  cardNumber: string,
  cardholderName?: string
): Promise<PayoutAccount> {
  return saveAccount(`/admin/payout-accounts/${userId}`, cardNumber, cardholderName);
}

export async function recordManualPayout(
  recipient: PayoutRecipient,
  amount: number,
  note?: string
): Promise<void> {
  await api.post("/admin/payouts", {
    user_id: recipient.userId,
    source_id: recipient.sourceId,
    recipient_kind: recipient.recipientKind,
    amount,
    note: note?.trim() || undefined,
  });
}
