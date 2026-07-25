// Mapper row ↔ domínio do agregado Document (módulo Financial).
//
// Padrão: `drizzle-orm-expert §"Templates: Mapper com Result"`.
// Cada campo de domínio é reidratado via smart constructor — corrupção no banco
// vira erro tipado (Result), nunca exception cruzando a borda
// (.claude/rules/adapters.md §"Mappers retornam Result<T, MapperError>").
//
// Decisões de mapeamento:
//   - `bigint(mode:'number')` → number no TS; Money.fromCents valida negativo e MAX_SAFE_INTEGER.
//   - `datetime(mode:'date')` → Date nativo (Drizzle converte automaticamente).
//   - `date(mode:'date')` → Date nativo (apenas data-calendário).
//   - Status lido do banco como string e narrowado antes de bifurcar o shape.
//   - Draft: campos opcionais persistem como NULL; mapper reidrata cada um como nullable.
//   - Open/Approved: qualquer NULL nos campos obrigatórios → erro de mapeamento (corrupção).
//   - Demais status (Transmitted/Refused/Paid/Reconciled): shape Open+status passado.
//   - UserRef: reidratado via `UserRef.rehydrate()` (síncrono — sem import dinâmico).
//   - Retenções e impostos: recebidos como rows prontas (o repo já leu as tabelas filhas).
//   - IDs branded: `rehydrate()` valida formato UUID v4 (síncrono).

import { type Result, ok, err } from '../../../../../shared/primitives/result.ts';
import { newUuid } from '../../../../../shared/utils/id.ts';
import * as Money from '../../../../../shared/kernel/money.ts';
import * as UserRef from '../../../../../shared/kernel/user-ref.ts';
import * as DocumentId from '../../../domain/shared/document-id.ts';
import * as PayableId from '../../../domain/shared/payable-id.ts';
import {
  ContractRef,
  BudgetPlanRef,
  CategoryRef,
  SubcategoryRef,
  CostCenterRef,
  ProgramRef,
  type ContractRef as ContractRefType,
  type BudgetPlanRef as BudgetPlanRefType,
  type CategoryRef as CategoryRefType,
  type SubcategoryRef as SubcategoryRefType,
  type CostCenterRef as CostCenterRefType,
  type ProgramRef as ProgramRefType,
} from '../../../domain/shared/refs.ts';
import { SupplierRef } from '#src/modules/partners/public-api/refs.ts';
import * as Retention from '../../../domain/shared/retention.ts';
import type { RetentionType } from '../../../domain/shared/retention.ts';
import * as RegisteredTax from '../../../domain/shared/registered-tax.ts';
import {
  isPayeeKind,
  type DocumentType,
  type PaymentMethod,
  type PayeeKind,
  type DocumentStatus,
  type DocumentCore,
  type DraftDocument,
  type OpenDocument,
  type ApprovedDocument,
  type Document,
} from '../../../domain/document/types.ts';
import type { Payable, Payables } from '../../../domain/payable/types.ts';
import type {
  DocumentRow,
  NewDocumentRow,
  PayableRow,
  NewPayableRow,
  RetentionRow,
  NewRetentionRow,
  RegisteredTaxRow,
  NewRegisteredTaxRow,
} from '../schemas/mysql.ts';

// ─── Tipos de erro do mapper ──────────────────────────────────────────────────

import * as Competencia from '#src/modules/financial/domain/document/competencia.ts';
import * as SourceFileRef from '#src/modules/financial/domain/document/source-file-ref.ts';

export type DocumentMapperError =
  | 'mapper-invalid-competencia'
  | 'mapper-invalid-source-file'
  | 'mapper-invalid-document-id'
  | 'mapper-invalid-supplier-ref'
  | 'mapper-invalid-contract-ref'
  | 'mapper-invalid-budget-plan-ref'
  | 'mapper-invalid-category-ref'
  | 'mapper-invalid-subcategory-ref'
  | 'mapper-invalid-cost-center-ref'
  | 'mapper-invalid-program-ref'
  | 'mapper-invalid-approver-ref'
  | 'mapper-invalid-approved-by'
  | 'mapper-invalid-status'
  | 'mapper-invalid-document-type'
  | 'mapper-invalid-payment-method'
  | 'mapper-invalid-payee-kind'
  | 'mapper-invalid-money'
  | 'mapper-invalid-due-date'
  | 'mapper-invalid-retention'
  | 'mapper-invalid-registered-tax'
  | 'mapper-invalid-payable-id'
  | 'mapper-invalid-payable-kind'
  | 'mapper-invalid-payable-retention-type'
  | 'mapper-corrupt-approved-document';

// ─── Helpers de narrowing ─────────────────────────────────────────────────────

const KNOWN_STATUSES: ReadonlySet<string> = new Set<DocumentStatus>([
  'Draft',
  'Open',
  'Approved',
  'Transmitted',
  'Refused',
  'Paid',
  'Reconciled',
]);

const KNOWN_TYPES: ReadonlySet<string> = new Set<DocumentType>([
  'NFS-e',
  'DANFE',
  'RPA',
  'Fatura',
  'Boleto',
  'Recibo',
  'Imposto',
]);

const KNOWN_PAYMENT_METHODS: ReadonlySet<string> = new Set<PaymentMethod>([
  'TED',
  'TransferenciaBancaria',
  'PIX',
  'Boleto',
  'CartaoCorporativo',
  'Cambio',
  'GuiaRecolhimento',
  'Outro',
]);

const KNOWN_RETENTION_TYPES: ReadonlySet<string> = new Set<RetentionType>([
  'ISS',
  'IRRF',
  'INSS',
  'CSRF',
]);

const isStatus = (v: string): v is DocumentStatus => KNOWN_STATUSES.has(v);
const isDocumentType = (v: string): v is DocumentType => KNOWN_TYPES.has(v);
const isPaymentMethod = (v: string): v is PaymentMethod => KNOWN_PAYMENT_METHODS.has(v);
const isRetentionType = (v: string): v is RetentionType => KNOWN_RETENTION_TYPES.has(v);

// ─── Row → Money helpers ──────────────────────────────────────────────────────
//
// `bigint(mode:'number')` no Drizzle entrega `number`. Money.fromCents blinda
// contra negativo e > MAX_SAFE_INTEGER (money.ts §"Defeito #8").

const toMoney = (
  cents: number | null | undefined,
): Result<Money.Money | null, DocumentMapperError> => {
  if (cents === null || cents === undefined) return ok(null);
  const r = Money.fromCents(cents);
  return r.ok ? ok(r.value) : err('mapper-invalid-money');
};

const toMoneyRequired = (
  cents: number | null | undefined,
): Result<Money.Money, DocumentMapperError> => {
  if (cents === null || cents === undefined) return err('mapper-invalid-money');
  const r = Money.fromCents(cents);
  return r.ok ? ok(r.value) : err('mapper-invalid-money');
};

// ─── Retention rows → domain Retention[] ─────────────────────────────────────

const mapRetentionRows = (
  rows: readonly Readonly<RetentionRow>[],
): Result<readonly Retention.Retention[], DocumentMapperError> => {
  const retentions: Retention.Retention[] = [];
  for (const row of rows) {
    const r = Retention.create({
      type: row.type,
      baseCents: row.base,
      rateBps: row.rateBps,
      valueCents: row.value,
    });
    if (!r.ok) return err('mapper-invalid-retention');
    retentions.push(r.value);
  }
  return ok(retentions);
};

// ─── RegisteredTax rows → domain RegisteredTax[] ─────────────────────────────

const mapRegisteredTaxRows = (
  rows: readonly Readonly<RegisteredTaxRow>[],
): Result<readonly RegisteredTax.RegisteredTax[], DocumentMapperError> => {
  const taxes: RegisteredTax.RegisteredTax[] = [];
  for (const row of rows) {
    const r = RegisteredTax.create({
      type: row.type,
      baseCents: row.base,
      rateBps: row.rateBps,
      valueCents: row.value,
    });
    if (!r.ok) return err('mapper-invalid-registered-tax');
    taxes.push(r.value);
  }
  return ok(taxes);
};

// ─── DocumentRow → Document (union Draft|Open|Approved) ──────────────────────
//
// Reidrata o agregado Document no estado certo a partir do `status`.
// O caller passa as tabelas filhas já lidas para evitar N+1 no repo.

export type MapDocumentInput = Readonly<{
  documentRow: Readonly<DocumentRow>;
  retentionRows: readonly Readonly<RetentionRow>[];
  registeredTaxRows: readonly Readonly<RegisteredTaxRow>[];
}>;

// Reidrata o comprovante-fonte (#62) das colunas source_file_* — todas nulas → null; presentes → VO.
const rehydrateSourceFile = (
  row: MapDocumentInput['documentRow'],
): Result<SourceFileRef.SourceFileRef | null, DocumentMapperError> => {
  if (row.sourceFileBucket == null) {
    // bucket NULL mas alguma irmã preenchida = escrita parcial corrompida → erro, não perda silenciosa.
    const anyPresent = [
      row.sourceFileKey,
      row.sourceFileHashSha256,
      row.sourceFileSizeBytes,
      row.sourceFileMime,
    ].some((v) => v != null);
    return anyPresent ? err('mapper-invalid-source-file') : ok(null);
  }
  const sf = SourceFileRef.create({
    bucket: row.sourceFileBucket,
    key: row.sourceFileKey ?? '',
    hashSha256: row.sourceFileHashSha256 ?? '',
    sizeBytes: row.sourceFileSizeBytes ?? 0,
    mimeType: row.sourceFileMime ?? '',
  });
  return sf.ok ? ok(sf.value) : err('mapper-invalid-source-file');
};

// Colunas source_file_* a partir do VO (#62) — null quando ausente.
const sourceFileCols = (
  ref: SourceFileRef.SourceFileRef | null,
): Readonly<{
  sourceFileBucket: string | null;
  sourceFileKey: string | null;
  sourceFileHashSha256: string | null;
  sourceFileSizeBytes: number | null;
  sourceFileMime: string | null;
}> => ({
  sourceFileBucket: ref?.bucket ?? null,
  sourceFileKey: ref?.key ?? null,
  sourceFileHashSha256: ref?.hashSha256 ?? null,
  sourceFileSizeBytes: ref?.sizeBytes ?? null,
  sourceFileMime: ref?.mimeType ?? null,
});

export const mapRowToDocument = (
  input: MapDocumentInput,
): Result<Document, DocumentMapperError> => {
  const { documentRow: row, retentionRows, registeredTaxRows } = input;

  const idR = DocumentId.rehydrate(row.id);
  if (!idR.ok) return err('mapper-invalid-document-id');
  const id = idR.value;

  // Status — narrowing antes de bifurcar.
  if (!isStatus(row.status)) return err('mapper-invalid-status');
  const status = row.status;

  // Tabelas filhas.
  const retentionsR = mapRetentionRows(retentionRows);
  if (!retentionsR.ok) return retentionsR;

  const taxesR = mapRegisteredTaxRows(registeredTaxRows);
  if (!taxesR.ok) return taxesR;

  // ─── Draft ─────────────────────────────────────────────────────────────────
  if (status === 'Draft') {
    let supplier: SupplierRef | null = null;
    if (row.supplierRef !== null) {
      const r = SupplierRef.rehydrate(row.supplierRef);
      if (!r.ok) return err('mapper-invalid-supplier-ref');
      supplier = r.value;
    }

    let payeeKind: PayeeKind | null = null;
    if (row.payeeKind !== null) {
      if (!isPayeeKind(row.payeeKind)) return err('mapper-invalid-payee-kind');
      payeeKind = row.payeeKind;
    }

    let approverRef: UserRef.UserRef | null = null;
    if (row.approverRef !== null) {
      const r = UserRef.rehydrate(row.approverRef);
      if (!r.ok) return err('mapper-invalid-approver-ref');
      approverRef = r.value;
    }

    let contractRef: ContractRefType | null = null;
    if (row.contractRef !== null) {
      const r = ContractRef.rehydrate(row.contractRef);
      if (!r.ok) return err('mapper-invalid-contract-ref');
      contractRef = r.value;
    }

    let budgetPlanRef: BudgetPlanRefType | null = null;
    if (row.budgetPlanRef !== null) {
      const r = BudgetPlanRef.rehydrate(row.budgetPlanRef);
      if (!r.ok) return err('mapper-invalid-budget-plan-ref');
      budgetPlanRef = r.value;
    }

    let categoryRef: CategoryRefType | null = null;
    if (row.categoryRef !== null) {
      const r = CategoryRef.rehydrate(row.categoryRef);
      if (!r.ok) return err('mapper-invalid-category-ref');
      categoryRef = r.value;
    }

    let subcategoryRef: SubcategoryRefType | null = null;
    if (row.subcategoryRef !== null) {
      const r = SubcategoryRef.rehydrate(row.subcategoryRef);
      if (!r.ok) return err('mapper-invalid-subcategory-ref');
      subcategoryRef = r.value;
    }

    let costCenterRef: CostCenterRefType | null = null;
    if (row.costCenterRef !== null) {
      const r = CostCenterRef.rehydrate(row.costCenterRef);
      if (!r.ok) return err('mapper-invalid-cost-center-ref');
      costCenterRef = r.value;
    }

    let programRef: ProgramRefType | null = null;
    if (row.programRef !== null) {
      const r = ProgramRef.rehydrate(row.programRef);
      if (!r.ok) return err('mapper-invalid-program-ref');
      programRef = r.value;
    }

    let type: DocumentType | null = null;
    if (row.type !== null) {
      if (!isDocumentType(row.type)) return err('mapper-invalid-document-type');
      type = row.type;
    }

    let paymentMethod: PaymentMethod | null = null;
    if (row.paymentMethod !== null) {
      if (!isPaymentMethod(row.paymentMethod)) return err('mapper-invalid-payment-method');
      paymentMethod = row.paymentMethod;
    }

    const grossValueR = toMoney(row.grossValue);
    if (!grossValueR.ok) return grossValueR;

    const sourceDiscountsR = toMoney(row.sourceDiscounts);
    if (!sourceDiscountsR.ok) return sourceDiscountsR;

    const discountsR = toMoney(row.discounts);
    if (!discountsR.ok) return discountsR;

    const penaltyR = toMoney(row.penalty);
    if (!penaltyR.ok) return penaltyR;

    const interestR = toMoney(row.interest);
    if (!interestR.ok) return interestR;

    let competencia: Competencia.Competencia | null = null;
    if (row.competencia != null) {
      const c = Competencia.fromString(row.competencia);
      if (!c.ok) return err('mapper-invalid-competencia');
      competencia = c.value;
    }

    const sourceFileR = rehydrateSourceFile(row);
    if (!sourceFileR.ok) return sourceFileR;

    const draft: DraftDocument = {
      id,
      status: 'Draft',
      documentNumber: row.documentNumber ?? null,
      series: row.series ?? null,
      type,
      supplier,
      payeeKind,
      contractRef,
      budgetPlanRef,
      categoryRef,
      subcategoryRef,
      costCenterRef,
      programRef,
      paymentMethod,
      grossValue: grossValueR.value,
      sourceDiscounts: sourceDiscountsR.value,
      discounts: discountsR.value,
      penalty: penaltyR.value,
      interest: interestR.value,
      retentions: retentionsR.value,
      registeredTaxes: taxesR.value,
      dueDate: row.dueDate ?? null,
      issueDate: row.issueDate ?? null,
      description: row.description ?? null,
      approverRef,
      accessKey: row.accessKey ?? null,
      competencia,
      debitAccountRef: row.debitAccountRef ?? null,
      paymentDetail: row.paymentDetail ?? null,
      sourceFileRef: sourceFileR.value,
    };
    return ok(draft);
  }

  // ─── Open / Approved / demais ───────────────────────────────────────────────
  // Campos obrigatórios a partir de Open. NULL aqui = corrupção → erro.

  if (row.supplierRef === null) return err('mapper-invalid-supplier-ref');
  const supplierR = SupplierRef.rehydrate(row.supplierRef);
  if (!supplierR.ok) return err('mapper-invalid-supplier-ref');

  // payeeKind (#90): legacy null → 'supplier' (back-compat); valor inválido no banco → erro.
  let payeeKind: PayeeKind = 'supplier';
  if (row.payeeKind !== null) {
    if (!isPayeeKind(row.payeeKind)) return err('mapper-invalid-payee-kind');
    payeeKind = row.payeeKind;
  }

  let approverRef: UserRef.UserRef | null = null;
  if (row.approverRef !== null) {
    const r = UserRef.rehydrate(row.approverRef);
    if (!r.ok) return err('mapper-invalid-approver-ref');
    approverRef = r.value;
  }

  if (row.type === null || !isDocumentType(row.type)) return err('mapper-invalid-document-type');

  if (row.paymentMethod === null || !isPaymentMethod(row.paymentMethod))
    return err('mapper-invalid-payment-method');

  const grossValueR = toMoneyRequired(row.grossValue);
  if (!grossValueR.ok) return grossValueR;

  const sourceDiscountsR = toMoneyRequired(row.sourceDiscounts);
  if (!sourceDiscountsR.ok) return sourceDiscountsR;

  const discountsR = toMoneyRequired(row.discounts);
  if (!discountsR.ok) return discountsR;

  const penaltyR = toMoneyRequired(row.penalty);
  if (!penaltyR.ok) return penaltyR;

  const interestR = toMoneyRequired(row.interest);
  if (!interestR.ok) return interestR;

  const netValueR = toMoneyRequired(row.netValue);
  if (!netValueR.ok) return netValueR;

  if (row.dueDate === null) return err('mapper-invalid-due-date');

  // Refs cross-BC opcionais (podem ser null mesmo em Open/Approved).
  let contractRef: ContractRefType | null = null;
  if (row.contractRef !== null) {
    const r = ContractRef.rehydrate(row.contractRef);
    if (!r.ok) return err('mapper-invalid-contract-ref');
    contractRef = r.value;
  }

  let budgetPlanRef: BudgetPlanRefType | null = null;
  if (row.budgetPlanRef !== null) {
    const r = BudgetPlanRef.rehydrate(row.budgetPlanRef);
    if (!r.ok) return err('mapper-invalid-budget-plan-ref');
    budgetPlanRef = r.value;
  }

  let categoryRef: CategoryRefType | null = null;
  if (row.categoryRef !== null) {
    const r = CategoryRef.rehydrate(row.categoryRef);
    if (!r.ok) return err('mapper-invalid-category-ref');
    categoryRef = r.value;
  }

  let subcategoryRef: SubcategoryRefType | null = null;
  if (row.subcategoryRef !== null) {
    const r = SubcategoryRef.rehydrate(row.subcategoryRef);
    if (!r.ok) return err('mapper-invalid-subcategory-ref');
    subcategoryRef = r.value;
  }

  let costCenterRef: CostCenterRefType | null = null;
  if (row.costCenterRef !== null) {
    const r = CostCenterRef.rehydrate(row.costCenterRef);
    if (!r.ok) return err('mapper-invalid-cost-center-ref');
    costCenterRef = r.value;
  }

  let programRef: ProgramRefType | null = null;
  if (row.programRef !== null) {
    const r = ProgramRef.rehydrate(row.programRef);
    if (!r.ok) return err('mapper-invalid-program-ref');
    programRef = r.value;
  }

  let competencia: Competencia.Competencia | null = null;
  if (row.competencia != null) {
    const c = Competencia.fromString(row.competencia);
    if (!c.ok) return err('mapper-invalid-competencia');
    competencia = c.value;
  }

  const coreSourceFileR = rehydrateSourceFile(row);
  if (!coreSourceFileR.ok) return coreSourceFileR;

  // Núcleo compartilhado entre Open e Approved.
  const core: DocumentCore = {
    id,
    documentNumber: row.documentNumber ?? '',
    series: row.series ?? null,
    type: row.type,
    supplier: supplierR.value,
    payeeKind,
    contractRef,
    budgetPlanRef,
    categoryRef,
    subcategoryRef,
    costCenterRef,
    programRef,
    paymentMethod: row.paymentMethod,
    grossValue: grossValueR.value,
    sourceDiscounts: sourceDiscountsR.value,
    retentions: retentionsR.value,
    registeredTaxes: taxesR.value,
    discounts: discountsR.value,
    penalty: penaltyR.value,
    interest: interestR.value,
    netValue: netValueR.value,
    description: row.description ?? null,
    dueDate: row.dueDate,
    issueDate: row.issueDate ?? null,
    approverRef,
    accessKey: row.accessKey ?? null,
    competencia,
    debitAccountRef: row.debitAccountRef ?? null,
    paymentDetail: row.paymentDetail ?? null,
    sourceFileRef: coreSourceFileR.value,
  };

  if (status === 'Approved') {
    // Approved exige approvedAt + approvedBy (defesa em profundidade — CHECK no schema).
    if (row.approvedAt === null) return err('mapper-corrupt-approved-document');
    if (row.approvedBy === null) return err('mapper-corrupt-approved-document');

    // approvedBy é UserRef (UUID v4). Reidrata via smart constructor síncrono.
    const approvedByR = UserRef.rehydrate(row.approvedBy);
    if (!approvedByR.ok) return err('mapper-invalid-approved-by');

    const approved: ApprovedDocument = {
      ...core,
      status: 'Approved',
      approvedAt: row.approvedAt,
      approvedBy: approvedByR.value,
    };
    return ok(approved);
  }

  // Open e demais status (Transmitted/Refused/Paid/Reconciled nesta fatia não têm
  // shape próprio no domínio — são tratados como Open+status. O tipo `Document`
  // é `DraftDocument | OpenDocument | ApprovedDocument`; os demais status são
  // persistidos mas o shape reidratado é OpenDocument com o status correto.
  // Cast via `as unknown as DocumentStatus` é necessário porque OpenDocument
  // declara `status: 'Open'` mas no banco pode vir outro valor válido do enum.
  // Isso é intencional nesta fatia: tipos refinados para Transmitted+ são
  // trabalho de fatia futura.
  const open: OpenDocument = { ...core, status: 'Open' };
  // Se o status real for diferente de 'Open', transportamos via cast seguro:
  // o CHECK no banco garante que só chegam valores do enum de 7.
  if (status !== 'Open') {
    // deno-lint-ignore no-explicit-any
    return ok({ ...open, status } as any as OpenDocument);
  }
  return ok(open);
};

// ─── Payable rows → Payables ──────────────────────────────────────────────────
//
// Reconstrói `Payables` a partir das rows de fin_payables para um documento.
// O caller já filtrou pelo documentId antes de chamar.

export const mapPayableRows = (
  rows: readonly Readonly<PayableRow>[],
): Result<Payables | null, DocumentMapperError> => {
  if (rows.length === 0) return ok(null);

  const mapPayable = (row: Readonly<PayableRow>): Result<Payable, DocumentMapperError> => {
    const idR = PayableId.rehydrate(row.id);
    if (!idR.ok) return err('mapper-invalid-payable-id');

    const originR = DocumentId.rehydrate(row.documentId);
    if (!originR.ok) return err('mapper-invalid-document-id');

    if (row.kind !== 'Parent' && row.kind !== 'Child') return err('mapper-invalid-payable-kind');

    if (!isStatus(row.status)) return err('mapper-invalid-status');

    const valueR = Money.fromCents(row.value);
    if (!valueR.ok) return err('mapper-invalid-money');

    if (!isPaymentMethod(row.paymentMethod)) return err('mapper-invalid-payment-method');

    let retentionType: RetentionType | null = null;
    if (row.retentionType !== null) {
      if (!isRetentionType(row.retentionType)) return err('mapper-invalid-payable-retention-type');
      retentionType = row.retentionType;
    }

    const payable: Payable = {
      id: idR.value,
      origin: originR.value,
      kind: row.kind,
      retentionType,
      status: row.status,
      value: valueR.value,
      dueDate: row.dueDate,
      paymentMethod: row.paymentMethod,
      paidAt: row.paidAt,
    };
    return ok(payable);
  };

  const parentRows = rows.filter((r) => r.kind === 'Parent');
  const childRows = rows.filter((r) => r.kind === 'Child');

  const parentRow = parentRows[0];
  if (parentRow === undefined) return err('mapper-invalid-payable-kind');

  const parentR = mapPayable(parentRow);
  if (!parentR.ok) return parentR;

  const children: Payable[] = [];
  for (const childRow of childRows) {
    const r = mapPayable(childRow);
    if (!r.ok) return r;
    children.push(r.value);
  }

  return ok({ parent: parentR.value, children });
};

// ─── Document → NewDocumentRow (INSERT/UPDATE) ────────────────────────────────
//
// `version` é passado pelo repo (lido do banco + incrementado antes do UPDATE).

export const mapDocumentToRow = (document: Document, version: number): NewDocumentRow => {
  const now = new Date();

  if (document.status === 'Draft') {
    return {
      id: document.id as unknown as string,
      documentNumber: document.documentNumber ?? null,
      series: document.series ?? null,
      type: document.type ?? null,
      supplierRef: document.supplier !== null ? (document.supplier as unknown as string) : null,
      payeeKind: document.payeeKind ?? null,
      contractRef:
        document.contractRef !== null ? (document.contractRef as unknown as string) : null,
      budgetPlanRef:
        document.budgetPlanRef !== null ? (document.budgetPlanRef as unknown as string) : null,
      categoryRef:
        document.categoryRef !== null ? (document.categoryRef as unknown as string) : null,
      subcategoryRef:
        document.subcategoryRef !== null ? (document.subcategoryRef as unknown as string) : null,
      costCenterRef:
        document.costCenterRef !== null ? (document.costCenterRef as unknown as string) : null,
      programRef: document.programRef !== null ? (document.programRef as unknown as string) : null,
      paymentMethod: document.paymentMethod ?? null,
      grossValue: document.grossValue?.cents ?? null,
      sourceDiscounts: document.sourceDiscounts?.cents ?? 0,
      discounts: document.discounts?.cents ?? 0,
      penalty: document.penalty?.cents ?? 0,
      interest: document.interest?.cents ?? 0,
      netValue: null,
      status: document.status,
      description: document.description ?? null,
      dueDate: document.dueDate ?? null,
      issueDate: document.issueDate ?? null,
      accessKey: document.accessKey ?? null,
      competencia:
        document.competencia === null ? null : Competencia.toString(document.competencia),
      debitAccountRef: document.debitAccountRef ?? null,
      paymentDetail: document.paymentDetail ?? null,
      ...sourceFileCols(document.sourceFileRef),
      readByOcr: false,
      ocrOriginalValue: null,
      divergenceDetected: false,
      version,
      createdAt: now,
      approvedAt: null,
      approvedBy: null,
      approverRef:
        document.approverRef !== null ? (document.approverRef as unknown as string) : null,
    };
  }

  // Open, Approved e demais: todos têm o shape de DocumentCore.
  const core = document;
  return {
    id: core.id as unknown as string,
    documentNumber: core.documentNumber,
    series: core.series ?? null,
    type: core.type,
    supplierRef: core.supplier as unknown as string,
    payeeKind: core.payeeKind,
    contractRef: core.contractRef !== null ? (core.contractRef as unknown as string) : null,
    budgetPlanRef: core.budgetPlanRef !== null ? (core.budgetPlanRef as unknown as string) : null,
    categoryRef: core.categoryRef !== null ? (core.categoryRef as unknown as string) : null,
    subcategoryRef:
      core.subcategoryRef !== null ? (core.subcategoryRef as unknown as string) : null,
    costCenterRef: core.costCenterRef !== null ? (core.costCenterRef as unknown as string) : null,
    programRef: core.programRef !== null ? (core.programRef as unknown as string) : null,
    paymentMethod: core.paymentMethod,
    grossValue: core.grossValue.cents,
    sourceDiscounts: core.sourceDiscounts.cents,
    discounts: core.discounts.cents,
    penalty: core.penalty.cents,
    interest: core.interest.cents,
    netValue: core.netValue.cents,
    status: core.status,
    description: core.description ?? null,
    dueDate: core.dueDate,
    issueDate: core.issueDate,
    accessKey: core.accessKey,
    competencia: core.competencia === null ? null : Competencia.toString(core.competencia),
    debitAccountRef: core.debitAccountRef,
    paymentDetail: core.paymentDetail ?? null,
    ...sourceFileCols(core.sourceFileRef),
    readByOcr: false,
    ocrOriginalValue: null,
    divergenceDetected: false,
    version,
    createdAt: now,
    approvedAt: document.status === 'Approved' ? document.approvedAt : null,
    approvedBy: document.status === 'Approved' ? (document.approvedBy as unknown as string) : null,
    approverRef: core.approverRef !== null ? (core.approverRef as unknown as string) : null,
  };
};

// ─── Payables → NewPayableRow[] (INSERT em lote) ─────────────────────────────

export const mapPayablesToRows = (
  payables: Payables,
  documentId: string,
): readonly NewPayableRow[] => {
  const now = new Date();

  const mapOne = (p: Payable): NewPayableRow => ({
    id: p.id as unknown as string,
    documentId,
    kind: p.kind,
    retentionType: p.retentionType ?? null,
    status: p.status,
    value: p.value.cents,
    dueDate: p.dueDate,
    paymentMethod: p.paymentMethod,
    paidAt: p.paidAt,
    createdAt: now,
  });

  return [mapOne(payables.parent), ...payables.children.map(mapOne)];
};

// ─── Retentions → NewRetentionRow[] (INSERT em lote) ─────────────────────────

export const mapRetentionsToRows = (
  retentions: readonly Retention.Retention[],
  documentId: string,
): readonly NewRetentionRow[] =>
  retentions.map((r) => ({
    id: newUuid(),
    documentId,
    type: r.type,
    base: r.base.cents,
    rateBps: r.rateBps,
    value: r.value.cents,
  }));

// ─── RegisteredTaxes → NewRegisteredTaxRow[] (INSERT em lote) ────────────────

export const mapRegisteredTaxesToRows = (
  taxes: readonly RegisteredTax.RegisteredTax[],
  documentId: string,
): readonly NewRegisteredTaxRow[] =>
  taxes.map((t) => ({
    id: newUuid(),
    documentId,
    type: t.type,
    base: t.base.cents,
    rateBps: t.rateBps,
    value: t.value.cents,
  }));
