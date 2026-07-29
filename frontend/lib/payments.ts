import { api } from "./api";

export type PayoutRecipientKind = "staff" | "tailor" | "workshop";

export interface PayoutAccount {
  provider: "superqi_mastercard";
  cardNumber: string | null;
  /** 9-digit SuperQi account number — required alongside the card since 073. */
  accountNumber: string | null;
  cardholderName: string | null;
  updatedAt: string | null;
  /** false for workshop crew — an admin sets their card, so the panel is hidden. */
  eligible: boolean;
}

/** Both numbers are required on every save; the server rejects a half account. */
export interface PayoutAccountInput {
  cardNumber: string;
  accountNumber: string;
  cardholderName?: string;
}

interface ApiPayoutAccount {
  provider: "superqi_mastercard";
  card_number: string | null;
  account_number: string | null;
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
  accountNumber: string | null;
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
  /** null on transfers recorded before migration 073. */
  accountNumberSnapshot: string | null;
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
  account_number: string | null;
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
  account_number_snapshot: string | null;
  note: string | null;
  paid_at: string;
  created_by_name: string | null;
}

function mapAccount(account: ApiPayoutAccount): PayoutAccount {
  return {
    provider: account.provider,
    cardNumber: account.card_number,
    accountNumber: account.account_number ?? null,
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
    accountNumber: row.account_number ?? null,
    cardholderName: row.cardholder_name,
    cardUpdatedAt: row.card_updated_at,
    lastPayoutAmount:
      row.last_payout_amount == null ? null : Number(row.last_payout_amount),
    lastPayoutAt: row.last_payout_at,
  };
}

/** Mirrors backend/lib/payoutAccount.js — Arabic-Indic keypads are accepted. */
function toLatinDigits(value: string): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(eastern.indexOf(digit)))
    .replace(/\D/g, "");
}

export function formatPayoutCardNumber(cardNumber: string | null | undefined): string {
  const digits = toLatinDigits(String(cardNumber || "")).slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function normalizePayoutCardNumber(value: string): string {
  return toLatinDigits(value).slice(0, 16);
}

export function formatPayoutAccountNumber(
  accountNumber: string | null | undefined
): string {
  const digits = toLatinDigits(String(accountNumber || "")).slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export function normalizePayoutAccountNumber(value: string): string {
  return toLatinDigits(value).slice(0, 9);
}

async function getAccount(path: string): Promise<PayoutAccount> {
  const { data } = await api.get<{ data: ApiPayoutAccount }>(path);
  return mapAccount(data.data);
}

async function saveAccount(
  path: string,
  input: PayoutAccountInput
): Promise<PayoutAccount> {
  const { data } = await api.put<{ data: ApiPayoutAccount }>(path, {
    card_number: normalizePayoutCardNumber(input.cardNumber),
    account_number: normalizePayoutAccountNumber(input.accountNumber),
    cardholder_name: input.cardholderName?.trim() || undefined,
  });
  return mapAccount(data.data);
}

export function getMyStaffPayoutAccount(): Promise<PayoutAccount> {
  return getAccount("/payroll/me/payout-account");
}

export function saveMyStaffPayoutAccount(
  input: PayoutAccountInput
): Promise<PayoutAccount> {
  return saveAccount("/payroll/me/payout-account", input);
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
      accountNumberSnapshot: row.account_number_snapshot ?? null,
      note: row.note,
      paidAt: row.paid_at,
      createdByName: row.created_by_name,
    })),
  };
}

export function saveAdminPayoutAccount(
  userId: string,
  input: PayoutAccountInput
): Promise<PayoutAccount> {
  return saveAccount(`/admin/payout-accounts/${userId}`, input);
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
