/**
 * Enterprise Hospital Management System - UMR-Centered Universal / Central Billing Database
 *
 * CORE PRINCIPLE:
 * The patient's UMR (Unique Medical Record) is the permanent central financial anchor for all
 * clinical encounters, hospital stays, departments, services, charges, invoices, payments,
 * insurance claims, and outstanding balances.
 *
 * Hierarchy:
 * Patient → UMR → Encounter / Hospital Stay → Department → Service / Order → Charge → UMR Ledger → Central Billing → Invoice → Payment / Claim → Receipt → Settled
 *
 * Clinical departments (OP, ER, Inpatient, ICU, Surgery, Laboratory, Radiology) digitize orders
 * & care delivery without paper OP books, ER slips, or physical K-Sheets.
 * Finalized charges flow directly to Central Billing for verification, invoicing, and settlement.
 *
 * All financial amounts formatted in Indian Rupees (₹ - INR).
 */

import { apiFetch } from "../lib/api"
import { BillingRbacManager } from "./billingRbac"
import { safeLocalStorageSetItem } from "../utils/storageQuotaManager"

import { db, DBPatient, DBOPEncounter } from "./db";
import { getDoctorConsultationFee } from "./doctorMaster";
import { encounterArrivalIso } from "./encounterTime"
import { OpReportsService } from "./opReportsDb"
import {
  resolveInvestigationDepartment,
  isRadiologyTest,
  isLaboratoryTest,
  getModalityForTest,
} from "../utils/testClassifier"
import { DiagnosticTariffDatabase } from "./diagnosticTariffDb"
import {
  applyServerPaymentLocally,
  getServerClaims,
  syncServerBilling,
  onBillingSync,
  postServerPayment,
  retainBillingSync,
} from "./billingSync"

import { ErDatabase, ErVisitRecord } from "./erDb"

import { BedDatabase, BedRecord } from "./bedDb"

export type DepartmentType = "Emergency" | "Inpatient" | "ICU" | "Outpatient" | "Radiology" | "Laboratory" | "Surgery" | "Pharmacy"

export interface InvoiceItem {
  id: string

  description: string

  category: "Consultation" | "Room / Bed Charges" | "Nursing" | "Procedure / Surgery" | "Laboratory" | "Radiology / Imaging" | "Consumables"

  cptCode: string

  quantity: number

  unitPrice: number

  total: number

  insuranceCovered: number

  patientPayable: number

  orderedBy?: string

  orderedAt?: string
}

export interface PaymentRecord {
  id: string

  invoiceId: string

  receiptNo: string

  amount: number

  paymentDate: string

  paymentMethod: "Cash" | "Credit Card" | "Debit Card" | "Insurance Copay" | "UPI / Digital" | "Bank Transfer" | "Cheque"

  transactionRef?: string

  collectedBy: string

  notes?: string
}

export type ClaimStatus = "Draft" | "Ready" | "Submitted" | "Accepted" | "Rejected" | "Denied" | "Appeal" | "Paid" | "Voided"

export interface ClaimRecord {
  id: string // e.g. "CLM-8921"

  /** Set on bills that live on the server (billing-service invoices); see billingSync.ts. */
  serverInvoiceId?: number

  /** Set on a running IP bill (patient still in a bed; no final invoice yet). */
  runningAdmissionId?: number

  invoiceNo: string // e.g. "INV-2026-0811"

  patientId: string // UMR e.g. "UMR100501" or "UMR10001"

  patientName: string

  mrn: string

  age: number

  gender: "Male" | "Female" | "Other"

  phone: string
  email?: string

  department: DepartmentType

  carePathway?: string // e.g. "ER → ICU → 3N Ward Consolidated Stay" or "OP Consultation & Diagnostics"

  dateOfService: string

  encounterId?: string

  hospitalStayId?: string

  admissionId?: number

  bedId?: number

  insuranceProvider: string // "Star Health", "HDFC ERGO", "ICICI Lombard", "Care Health", "Bajaj Allianz", "PM-JAY (Ayushman Bharat)", "Self-Pay"

  policyNumber: string

  preAuthCode?: string

  status: ClaimStatus

  items: InvoiceItem[]

  subtotal: number

  discount: number

  tax: number

  totalAmount: number

  insurancePortion: number

  patientPortion: number

  amountPaid: number

  balanceDue: number

  payments: PaymentRecord[]

  denialReason?: string

  appealNotes?: string

  diagnosisCodes: string[] // ICD-10 codes

  attendingDoctor: string

  finalizedByNurse?: string

  /** Insurance / TPA workflow for the bill (mainly inpatient stays). */
  tpa?: TpaWorkflow

  createdAt: string

  updatedAt: string
}

// ── Who can be billed to insurance ─────────────────────────────────────────
//
// Cashless insurance in Indian hospitals covers hospitalisation. OP visits
// (consultation, walk-in lab / radiology / pharmacy) are paid by the patient
// at the counter; an emergency visit is covered only when it ends in an
// admission. This rule is the single source of truth for every screen.

export const CASHLESS_DEPARTMENTS: DepartmentType[] = ["Inpatient", "ICU", "Surgery"]

/** An emergency visit that became an admission (ICU / ward / cath lab / OT). */
const ADMITTED_PATHWAY = /\b(icu|ccu|nicu|picu|ward|admi(t|ssion)|inpatient|cath|ot|surgery|theatre|hdu)\b/i

export function isCashlessEligible(c: Pick<ClaimRecord, "department" | "carePathway">): boolean {
  if (CASHLESS_DEPARTMENTS.includes(c.department)) return true
  return c.department === "Emergency" && ADMITTED_PATHWAY.test(c.carePathway || "")
}

export type PreAuthStatus =
  | "Not Raised"
  | "Requested"
  | "Approved"
  | "Enhancement Requested"
  | "Rejected"

export interface TpaEvent {
  at: string
  action: string
  detail?: string
  amount?: number
}

/**
 * The cashless-insurance lifecycle of one bill: pre-authorisation (and any
 * enhancement while the stay runs), claim submission, TPA queries, the final
 * approval -- whose deductions move from the insurer's share to the
 * patient's -- and the insurer's settlement.
 */
export interface TpaWorkflow {
  tpaName?: string
  preAuthStatus?: PreAuthStatus
  preAuthRequested?: number
  preAuthSanctioned?: number
  enhancementRequested?: number
  queryOpen?: boolean
  queryNote?: string
  /** Set when the billing counter hands the whole bill to insurance. */
  billedAt?: string
  billedBy?: string
  /** Amount claimed from the insurer (the bill as handed over). */
  claimAmount?: number
  approvedAmount?: number
  /** Amount the insurer disallowed. */
  deduction?: number
  deductionReason?: string
  /**
   * Who absorbs a deduction. The patient left with nothing to pay, so by
   * default the hospital writes it off; "patient" reopens their balance.
   */
  shortfallTo?: "writeoff" | "patient"
  settledAmount?: number
  settlementRef?: string
  settledAt?: string
  events?: TpaEvent[]
}

// ── Department Charge Record (Clinical Running Ledger / Digital K-Sheet) ─────

export interface DepartmentChargeRecord {
  id: string // e.g. "DCHG-2026-101"

  patientId: string // UMR e.g. "UMR100501"

  mrn: string // "100501"

  patientName: string

  age: number

  gender: "Male" | "Female" | "Other"

  phone: string

  encounterId: string // e.g. "ENC-OP-100501" or "ER-2026-00001" or "IP-BED-204"

  hospitalStayId?: string // e.g. "STAY-2026-881" for multi-department continuous stay

  department: DepartmentType

  carePathway?: string // e.g. "ER → ICU → 3N Ward Consolidated Stay"

  dateOfService: string

  insuranceProvider: string

  policyNumber: string

  preAuthCode?: string

  attendingDoctor: string

  diagnosisCodes: string[]

  items: InvoiceItem[]

  subtotal: number

  totalAmount: number

  status: "Accumulating Charges" | "Pending Dept Verification" | "Finalized by Dept" | "Invoiced in Central Billing"

  verifiedByNurse?: string

  finalizedAt?: string

  invoiceId?: string

  createdAt: string

  notes?: string
}

// ── UMR Financial Ledger Summary Models ─────────────────────────────────────

export interface EncounterChargeSummary {
  encounterId: string

  encounterType: "Outpatient" | "Emergency" | "Inpatient Ward" | "ICU" | "Surgery" | "Laboratory" | "Radiology"

  department: DepartmentType

  date: string

  doctor: string

  status: string

  items: InvoiceItem[]

  totalCharges: number

  isFinalized: boolean

  isInvoiced: boolean

  invoiceId?: string

  invoiceNo?: string
}

export interface UmrFinancialLedger {
  umr: string

  patientName: string

  mrn: string

  age: number

  gender: "Male" | "Female" | "Other"

  phone: string

  insuranceProvider: string

  policyNumber: string

  totalHistoricalCharges: number

  totalInvoiced: number

  totalPaid: number

  outstandingBalance: number

  insurancePending: number

  encounters: EncounterChargeSummary[]

  invoices: ClaimRecord[]

  payments: PaymentRecord[]

  activeHospitalStayId?: string
}

export interface FinancialMetrics {
  totalChargesMtd: number

  insurancePending: number

  patientBalance: number

  deniedCount: number

  deniedAmount: number

  collectionsRate: number

  daysInAr: number

  firstPassRate: number

  avgClaimValue: number

  paidCount: number

  totalClaimsCount: number
}

export interface PayerMixItem {
  payer: string

  claimCount: number

  totalAmount: number

  pct: number

  color: string
}

export interface ArAgingItem {
  bucket: string

  amount: number

  pct: number

  color: string

  count: number
}

// ── Diagnostic Order Interfaces with Pre-Payment Clearance ──────────────────

export interface LabResultItem {
  component: string

  value: string

  unit: string

  ref: string

  flag: "H" | "L" | "HH" | "LL" | "Critical" | ""
}

export interface LabOrderRecord {
  id: string

  patient: string

  mrn: string

  umr?: string

  invoiceNo?: string

  encounterId?: string;

  department?: string;

  diagnosis?: string

  orderedItems?: Array<{
    description: string
    cptCode?: string
    price: number
    quantity: number
  }>

  test: string

  category?: string

  priority: "STAT" | "Routine"

  sampleType?: string

  accessionNo?: string

  collected?: string

  collectedAt?: string

  collectedBy?: string

  analyzer?: string

  status: "Pending" | "Collected" | "Processing" | "Completed" | "Critical"

  provider: string

  price: number

  paymentStatus: "Paid" | "Payment Pending"

  paymentStatusDisplay?: "PAID" | "PENDING"

  normalizedReportStatus?: string

  paidReceiptNo?: string

  paidAt?: string

  results?: LabResultItem[]

  verifiedBy?: string

  verifiedAt?: string

  billingClearedAt?: string

  eligibleAt?: string

  orderedAt?: string

  createdAt?: string

  comments?: string

  criticalNotified?: {
    notified: boolean

    notifiedTo?: string

    notifiedAt?: string

    channel?: string

    readBackVerified?: boolean
  }
}

export interface RadiologyStudyRecord {
  id: string

  patient: string

  mrn: string

  umr?: string

  opNumber?: string

  age?: number

  gender?: string

  invoiceNo?: string

  encounterId?: string;

  department?: string;

  diagnosis?: string

  orderedItems?: Array<{
    description: string
    cptCode?: string
    price: number
    quantity: number
  }>

  study: string

  modality: "XR" | "CT" | "MR" | "US" | "NM"

  priority: "STAT" | "Routine" | "Elective"

  ordered: string

  orderDate?: string

  orderedAt?: string

  createdAt?: string

  provider: string

  status: "Orders" | "Scheduled" | "In Progress" | "Done" | "Images Ready" | "Reporting" | "Final" | "Sent for Reporting"

  room: string

  price: number

  paymentStatus: "Paid" | "Payment Pending"

  paymentStatusDisplay?: "PAID" | "PENDING"

  normalizedReportStatus?: string

  paidReceiptNo?: string

  paidAt?: string

  billingClearedAt?: string

  eligibleAt?: string

  scanningStartedAt?: string

  scanningCompletedAt?: string

  transferredToReportingAt?: string

  reportingQueuedAt?: string

  accessionNo?: string

  technician?: string

  indication?: string

  technique?: string

  findings?: string[]

  impression?: string[]

  comparison?: string

  radiologist?: string

  reportStatus?: "Draft" | "Final" | "Finalized" | "Pending Report" | "Submitted for Review" | "Needs Correction"

  workflowStatus?: "READY_TO_START" | "IN_PROGRESS" | "COMPLETED" | "SENT_TO_REPORTING" | "DRAFT" | "SUBMITTED_FOR_REVIEW" | "CORRECTION_REQUIRED" | "FINALIZED"

  sentToReporting?: boolean

  sentToReportingAt?: string

  sentToReportingBy?: string

  scanningStage?: number

  scanStartedAt?: string

  scanCompletedAt?: string

  patientVerified?: boolean

  patientVerifiedAt?: string

  safetyCleared?: boolean

  safetyClearedAt?: string

  safetyChecklist?: {
    twoPointId: boolean
    protocolReconciled: boolean
    pregnancySafety: boolean
    contrastAllergy: boolean
    metallicImplant: boolean
    ivAccess: boolean
  }

  actualProtocol?: string

  operationalNotes?: string

  submittedForReviewAt?: string

  submittedForReviewBy?: string

  submittedForReviewRole?: string

  returnedForCorrectionAt?: string

  returnedForCorrectionBy?: string

  correctionNotes?: string

  templateId?: string

  templateName?: string

  templateVersion?: number

  fieldValues?: Record<string, any>

  dicomImages?: string[]

  digitalStudyUrl?: string

  technicianNotes?: string

  technicianSignature?: string

  digitalReceiptRef?: string

  signedAt?: string

  nurseVerified?: boolean
  nurseVerifiedBy?: string
  nurseVerifiedAt?: string
  completedAt?: string
  completedBy?: string
  completionNotes?: string
  finalizedBy?: string
  finalizedRole?: string
  finalizedAt?: string
  history?: any[]
}

const STORAGE_KEY_CLAIMS = "hosp_billing_claims_inr_v11"

const STORAGE_KEY_DEPT_CHARGES = "hosp_billing_dept_charges_v11"

const STORAGE_KEY_LAB_ORDERS = "hosp_lab_orders_v1"

const STORAGE_KEY_RAD_STUDIES = "hosp_rad_studies_v1"

const BILLING_UPDATE_EVENT = "hospital_billing_updated"
/** Fired when the server refused a payment taken on a server bill. */
export const BILLING_PAYMENT_FAILED_EVENT = "hospital_billing_payment_failed"

export const INITIAL_LAB_ORDERS: LabOrderRecord[] = []

export const INITIAL_RAD_STUDIES: RadiologyStudyRecord[] = []

export function normalizeUmr(umr?: string): string {
  if (!umr) return ""
  const str = String(umr).trim().toUpperCase()
  return str.replace(/^(UMR|PAT|MRN|PATIENT|P)[-_]?/, "") || str
}

export function cleanEnc(val?: string): string {
  if (!val) return ""
  const stripped = String(val).trim().toLowerCase().replace(/^(op|enc|visit|v|ip|adm|clm)[-_]?/, "")
  const withoutZeros = stripped.replace(/^0+/, "")
  return withoutZeros || stripped
}

export function matchesEncounter(
  item: { encounterId?: string; opNumber?: string; umr?: string; mrn?: string },
  enc: { id: string; opNumber?: string; umr?: string }
): boolean {
  const itemUmr = normalizeUmr(item.umr || item.mrn)
  const encUmr = normalizeUmr(enc.umr)
  if (itemUmr && encUmr && itemUmr !== encUmr) {
    return false
  }
  const itemEnc = cleanEnc(item.encounterId)
  const itemOp = cleanEnc(item.opNumber)
  const encId = cleanEnc(enc.id)
  const encOp = cleanEnc(enc.opNumber)

  if (item.encounterId && enc.id && item.encounterId.toLowerCase() === enc.id.toLowerCase()) return true
  if (item.encounterId && enc.opNumber && item.encounterId.toLowerCase() === enc.opNumber.toLowerCase()) return true
  if (item.opNumber && enc.opNumber && item.opNumber.toLowerCase() === enc.opNumber.toLowerCase()) return true
  if (item.opNumber && enc.id && item.opNumber.toLowerCase() === enc.id.toLowerCase()) return true
  if (itemEnc && encId && itemEnc === encId) return true
  if (itemEnc && encOp && itemEnc === encOp) return true
  if (itemOp && encOp && itemOp === encOp) return true
  if (itemUmr && encUmr && itemUmr === encUmr && !item.encounterId && !item.opNumber) {
    return true
  }
  return false
}

// ── Department Tariff & Service Catalogs (Streamlined Small Amounts) ──────────

export const DEPARTMENT_TARIFF_CATALOG: Record<DepartmentType, {
  category: InvoiceItem["category"]
  description: string
  cpt: string
  price: number
}[]> = {
  Outpatient: [
    {
      category: "Consultation",
      description: "Specialist Comprehensive Outpatient Consultation",
      cpt: "99205",
      price: 150,
    },

    {
      category: "Consultation",
      description: "General OPD Medical Consultation",
      cpt: "99203",
      price: 100,
    },

    {
      category: "Consultation",
      description: "Follow-up Consultation / Review",
      cpt: "99213",
      price: 50,
    },

    {
      category: "Procedure / Surgery",
      description: "Minor OPD Dressing & Suture Removal",
      cpt: "12001",
      price: 40,
    },

    {
      category: "Consumables",
      description: "OPD Diagnostic & Clinical Supplies Kit",
      cpt: "A4649",
      price: 30,
    },
  ],

  Emergency: [
    {
      category: "Consultation",
      description: "Emergency Resuscitation & High-Acuity Triage (Level B1)",
      cpt: "99285",
      price: 250,
    },

    {
      category: "Consultation",
      description: "Emergency Acute Evaluation & Stabilization (Level B2)",
      cpt: "99284",
      price: 150,
    },

    {
      category: "Consultation",
      description: "Urgent Care Minor Trauma Assessment (Level B3)",
      cpt: "99283",
      price: 100,
    },

    {
      category: "Procedure / Surgery",
      description: "Complex Multi-Layer Wound Suture & Hemostasis",
      cpt: "12002",
      price: 120,
    },

    {
      category: "Procedure / Surgery",
      description: "Emergency Intubation & Airway Stabilization",
      cpt: "31500",
      price: 200,
    },

    {
      category: "Nursing",
      description: "STAT Emergency Nursing & IV Cannulation Protocol",
      cpt: "99505",
      price: 50,
    },

    {
      category: "Consumables",
      description: "Emergency Trauma Procedure Pack & Sterile Trays",
      cpt: "A4649",
      price: 60,
    },
  ],

  Inpatient: [
    {
      category: "Room / Bed Charges",
      description: "General Medical Ward Daily Bed Rate (per day)",
      cpt: "99222",
      price: 100,
    },

    {
      category: "Room / Bed Charges",
      description: "Semi-Private Ward Daily Bed Rate (per day)",
      cpt: "99223",
      price: 150,
    },

    {
      category: "Room / Bed Charges",
      description: "Private Deluxe Room Daily Rate (per day)",
      cpt: "99224",
      price: 250,
    },

    {
      category: "Consultation",
      description: "Attending Inpatient Physician Daily Rounds (per day)",
      cpt: "99233",
      price: 50,
    },

    {
      category: "Nursing",
      description:
        "24-Hour Continuous Inpatient Nursing & Vitals Care (per day)",
      cpt: "99505",
      price: 40,
    },

    {
      category: "Procedure / Surgery",
      description: "Inpatient Bedside Paracentesis / Thoracentesis",
      cpt: "49082",
      price: 120,
    },

    {
      category: "Consumables",
      description: "Inpatient Infusion & Sterile Nursing Consumables Pack",
      cpt: "A4649",
      price: 50,
    },
  ],

  ICU: [
    {
      category: "Room / Bed Charges",
      description: "ICU Intensive Care Daily Bed Rate (per day)",
      cpt: "99291",
      price: 350,
    },

    {
      category: "Consultation",
      description: "Critical Care Specialist Daily Comprehensive Management",
      cpt: "99292",
      price: 100,
    },

    {
      category: "Nursing",
      description: "1:1 Continuous Critical Care Specialized Nursing Care",
      cpt: "99505",
      price: 80,
    },

    {
      category: "Procedure / Surgery",
      description: "Emergency Endotracheal Intubation & Ventilator Setup",
      cpt: "31500",
      price: 200,
    },

    {
      category: "Procedure / Surgery",
      description: "Arterial Line & Central Venous Line Placement",
      cpt: "36556",
      price: 180,
    },

    {
      category: "Procedure / Surgery",
      description: "Continuous Mechanical Ventilation Management (24h)",
      cpt: "94002",
      price: 120,
    },

    {
      category: "Consumables",
      description: "ICU High-Acuity Hemodynamic & Airway Consumables",
      cpt: "A4649",
      price: 100,
    },
  ],

  Surgery: [
    {
      category: "Procedure / Surgery",
      description: "Laparoscopic Cholecystectomy / Abdominal Surgery",
      cpt: "47562",
      price: 800,
    },

    {
      category: "Procedure / Surgery",
      description: "Emergency Appendectomy Procedure",
      cpt: "44970",
      price: 600,
    },

    {
      category: "Room / Bed Charges",
      description: "Major Operation Theatre (OT) Infrastructure Rate",
      cpt: "99291",
      price: 300,
    },

    {
      category: "Consultation",
      description: "Chief Operating Surgeon Professional Fee",
      cpt: "99205",
      price: 400,
    },

    {
      category: "Consultation",
      description: "Consultant Anesthesiologist Pre-Op & Intra-Op Care",
      cpt: "00840",
      price: 200,
    },

    {
      category: "Nursing",
      description: "PACU Post-Anesthesia Recovery Care & Monitoring",
      cpt: "99505",
      price: 80,
    },

    {
      category: "Consumables",
      description: "Sterile Surgical Laparoscopic Disposable Pack & Drapes",
      cpt: "A4649",
      price: 150,
    },
  ],

  Laboratory: [
    {
      category: "Laboratory",
      description: "Complete Blood Count w/ Differential (CBC)",
      cpt: "85025",
      price: 50,
    },

    {
      category: "Laboratory",
      description: "Comprehensive Metabolic Panel (CMP / LFT + KFT)",
      cpt: "80053",
      price: 120,
    },

    {
      category: "Laboratory",
      description: "Lipid Profile Panel (Cholesterol, HDL, LDL, Triglycerides)",
      cpt: "80061",
      price: 80,
    },

    {
      category: "Laboratory",
      description: "Liver Function Tests (LFT Complete)",
      cpt: "80076",
      price: 70,
    },

    {
      category: "Laboratory",
      description: "Renal Function Tests / Kidney Panel (KFT)",
      cpt: "80069",
      price: 60,
    },

    {
      category: "Laboratory",
      description: "STAT High-Sensitivity Cardiac Troponin-I POCT",
      cpt: "84484",
      price: 100,
    },

    {
      category: "Laboratory",
      description: "Arterial Blood Gas Analysis (ABG with Electrolytes)",
      cpt: "82803",
      price: 80,
    },

    {
      category: "Laboratory",
      description: "Glycated Hemoglobin (HbA1c Assay)",
      cpt: "83036",
      price: 60,
    },

    {
      category: "Laboratory",
      description: "Blood & Wound Culture with Antibiotic Sensitivity",
      cpt: "87070",
      price: 90,
    },

    {
      category: "Laboratory",
      description: "Routine Urinalysis & Microscopy",
      cpt: "81001",
      price: 30,
    },
  ],

  Radiology: [
    {
      category: "Radiology / Imaging",
      description: "Digital Chest X-Ray (PA & Lateral Views)",
      cpt: "71046",
      price: 60,
    },

    {
      category: "Radiology / Imaging",
      description: "Contrast-Enhanced CT Scan - Chest / Abdomen / Pelvis",
      cpt: "74177",
      price: 250,
    },

    {
      category: "Radiology / Imaging",
      description: "Brain MRI with & without Contrast Study",
      cpt: "70553",
      price: 350,
    },

    {
      category: "Radiology / Imaging",
      description: "Whole Abdomen & Pelvis Ultrasound (USG)",
      cpt: "76700",
      price: 100,
    },

    {
      category: "Radiology / Imaging",
      description: "2D Echocardiography with Color Doppler",
      cpt: "93306",
      price: 200,
    },

    {
      category: "Radiology / Imaging",
      description: "Digital Lumbo-Sacral Spine X-Ray (AP & Lateral)",
      cpt: "72100",
      price: 70,
    },

    {
      category: "Radiology / Imaging",
      description: "Bedside Point-of-Care Ultrasound (POCUS)",
      cpt: "93308",
      price: 90,
    },
  ],
  Pharmacy: [
    {
      category: "Consumables",
      description: "Dispensed Medicines & Pharmacy Consumables",
      cpt: "PHARM-DISP",
      price: 50,
    },
  ],
}

const STANDARD_SERVICES = [
  ...DEPARTMENT_TARIFF_CATALOG.Outpatient,

  ...DEPARTMENT_TARIFF_CATALOG.Emergency,

  ...DEPARTMENT_TARIFF_CATALOG.Inpatient,

  ...DEPARTMENT_TARIFF_CATALOG.ICU,

  ...DEPARTMENT_TARIFF_CATALOG.Surgery,

  ...DEPARTMENT_TARIFF_CATALOG.Laboratory,

  ...DEPARTMENT_TARIFF_CATALOG.Radiology,
]

// ── INITIAL SEED DEPARTMENT CHARGES (Streamlined Small Amounts) ─────────────

const INITIAL_DEPARTMENT_CHARGES: DepartmentChargeRecord[] = []

// ── INITIAL SEED CENTRAL INVOICES & CLAIMS (Streamlined Small Amounts) ──────

const INITIAL_HOSPITAL_CLAIMS: ClaimRecord[] = []

export class BillingDatabase {
  private static _cachedRadStudies: RadiologyStudyRecord[] | null = null
  private static _radStudiesCacheTime = 0
  private static readonly RAD_STUDIES_TTL = 1000

  static invalidateRadiologyStudiesCache(): void {
    this._cachedRadStudies = null
    this._radStudiesCacheTime = 0
  }

  private static load<T,>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  private static save<T,>(key: string, data: T): void {
    const toStore =
      key === STORAGE_KEY_CLAIMS && Array.isArray(data)
        ? (data as ClaimRecord[]).filter((c) => !c.serverInvoiceId && !c.runningAdmissionId)
        : data
    const serialized = JSON.stringify(toStore)
    const saved = safeLocalStorageSetItem(key, serialized)
    if (!saved) {
      console.warn(`[BillingDatabase] Write to localStorage throttled for "${key}". Changes retained in memory.`)
    }
    this.dispatchUpdate()
  }

  static dispatchUpdate(): void {
    this._cachedRadStudies = null
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(BILLING_UPDATE_EVENT))
    }
  }

  static emitUpdate(): void {
    this.dispatchUpdate()
  }

  /**
   * Kept for existing callers (the doctor live board). Bills now come from
   * the server's invoices via billingSync, with each invoice's insurance
   * claim attached to it -- the old version turned every insurance claim into
   * a second, separate bill filled with placeholder details.
   */
  static syncClaimsWithBackend(): void {
    void syncServerBilling()
  }

  static addDepartmentCharge(charge: any): ClaimRecord {
    return this.createClaim(charge)
  }

  /**
   * Live updates for billing screens. Fires on any change that alters a bill:
   * a write in this tab, the server's invoices changing (polled while any
   * billing screen is open), a new OP visit at reception, and bill or visit
   * writes from other tabs. Bursts are batched into one callback.
   */
  static onUpdate(callback: () => void): () => void {
    if (typeof window === "undefined") return () => {}

    let queued = false
    const handler = () => {
      if (queued) return
      queued = true
      // A timer, not requestAnimationFrame: rAF is paused in background tabs,
      // so a billing screen behind another tab would never catch up.
      setTimeout(() => {
        queued = false
        callback()
      }, 30)
    }
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === STORAGE_KEY_CLAIMS || e.key.startsWith("hospai_db_") || e.key.startsWith("hosp_billing_")) handler()
    }

    window.addEventListener(BILLING_UPDATE_EVENT, handler)
    window.addEventListener("storage", onStorage)
    const unSync = onBillingSync(handler)
    const release = retainBillingSync()
    const unDb = db.subscribe(handler)

    return () => {
      window.removeEventListener(BILLING_UPDATE_EVENT, handler)
      window.removeEventListener("storage", onStorage)
      unSync()
      release()
      unDb()
    }
  }

  static getStandardServices() {
    return STANDARD_SERVICES
  }

  static getDepartmentTariffCatalog() {
    return DEPARTMENT_TARIFF_CATALOG
  }

  // ── INVOICES & CLAIMS ───────────────────────────────────────────────────────

  static saveClaims(claims: ClaimRecord[]): void {
    this.save(STORAGE_KEY_CLAIMS, claims)
  }

  static ensureInpatientClaims(): void {
    try {
      const beds = BedDatabase.getBeds()
      const occupied = beds.filter((b) => b.status === "Occupied" && (b.patient_id || b.patient_name))
      if (occupied.length === 0) return

      let claims = this.load<ClaimRecord[]>(STORAGE_KEY_CLAIMS, [])
      let updated = false

      for (const b of occupied) {
        const pId = b.patient_id || `IP-${b.id}`
        const pName = b.patient_name || "Inpatient"
        const exists = claims.some(
          (c) =>
            (c.patientId === pId || (c.patientName && c.patientName.toLowerCase() === pName.toLowerCase())) &&
            (c.department === "Inpatient" || c.department === "ICU") &&
            c.status !== "Voided" &&
            c.status !== "Paid"
        )

        if (!exists) {
          const admitTime = b.admission_date
            ? new Date(b.admission_date).getTime()
            : b.allocated_at
            ? new Date(b.allocated_at).getTime()
            : Date.now() - 86400000 * 2
          const days = Math.max(1, Math.ceil((Date.now() - admitTime) / (1000 * 60 * 60 * 24)))
          const dailyRate = b.daily_rate || (b.ward === "ICU" ? 5500 : 2000)
          const roomTotal = days * dailyRate
          const nursingTotal = days * 600
          const docTotal = days * 1000
          const total = roomTotal + nursingTotal + docTotal

          const maxClaimNum = claims.reduce((max, c) => {
            const num = parseInt((c.id || "").replace(/\D/g, ""), 10)
            return !isNaN(num) && num > max ? num : max
          }, 8937)
          const claimNum = maxClaimNum + 1

          const maxInvNum = claims.reduce((max, c) => {
            const match = (c.invoiceNo || "").match(/(\d+)$/)
            const num = match ? parseInt(match[1], 10) : 0
            return num > max ? num : max
          }, 827)
          const invNum = maxInvNum + 1

          const items: InvoiceItem[] = [
            {
              id: `item-${Date.now()}-${b.id}-1`,
              code: "IP-BED",
              description: `${b.ward || "Inpatient Ward"} - Bed ${b.bed_no || b.id} Accommodation (${days} day${days > 1 ? "s" : ""})`,
              quantity: days,
              unitPrice: dailyRate,
              total: roomTotal,
              patientPayable: roomTotal,
              insuranceCovered: 0,
              department: b.ward === "ICU" ? "ICU" : "Inpatient",
              date: b.admission_date || new Date().toISOString(),
            },
            {
              id: `item-${Date.now()}-${b.id}-2`,
              code: "IP-NURS",
              description: "24-Hour Continuous Inpatient Nursing Care",
              quantity: days,
              unitPrice: 600,
              total: nursingTotal,
              patientPayable: nursingTotal,
              insuranceCovered: 0,
              department: b.ward === "ICU" ? "ICU" : "Inpatient",
              date: b.admission_date || new Date().toISOString(),
            },
            {
              id: `item-${Date.now()}-${b.id}-3`,
              code: "IP-DOC",
              description: "Attending Consultant / Inpatient Rounds",
              quantity: days,
              unitPrice: 1000,
              total: docTotal,
              patientPayable: docTotal,
              insuranceCovered: 0,
              department: b.ward === "ICU" ? "ICU" : "Inpatient",
              date: b.admission_date || new Date().toISOString(),
            },
          ]

          const newClaim: ClaimRecord = {
            id: `CLM-${claimNum}`,
            invoiceNo: `INV-2026-${String(invNum).padStart(4, "0")}`,
            patientId: pId,
            patientName: pName,
            age: b.patient_age || 42,
            gender: (b.patient_gender as any) || "Male",
            contactPhone: b.patient_phone || "(617) 555-0100",
            department: b.ward === "ICU" ? "ICU" : "Inpatient",
            encounterType: b.ward === "ICU" ? "ICU" : "Inpatient Ward",
            ward: b.ward || "General Ward",
            bedNumber: `${b.room_no || "R1"}-${b.bed_no || "B1"}`,
            admissionDate: b.admission_date || new Date(Date.now() - 86400000 * days).toISOString(),
            dischargeDate: undefined,
            carePathway: "Inpatient",
            items,
            subtotal: total,
            discount: 0,
            tax: 0,
            totalAmount: total,
            paidAmount: 0,
            balanceDue: total,
            patientPortion: total,
            insurancePortion: 0,
            tpa: undefined,
            preAuthCode: undefined,
            status: "Draft",
            paymentStatus: "Pending",
            paymentMode: "Cash",
            isCashless: false,
            settlementStatus: "Unsettled",
            createdAt: b.admission_date || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }

          claims.unshift(newClaim)
          updated = true
        }
      }

      if (updated) {
        this.save(STORAGE_KEY_CLAIMS, claims)
      }
    } catch (e) {
      console.warn("Failed to ensure inpatient claims from beds:", e)
    }
  }

  static getClaims(filter?: {
    status?: ClaimStatus | "All"

    department?: DepartmentType | "All"

    search?: string

    umr?: string
  }): ClaimRecord[] {
    this.ensureInpatientClaims()
    let claims = this.load<ClaimRecord[]>(
      STORAGE_KEY_CLAIMS,
      [],
    )

    // Open OP / non-admitted bills that carry insurance are patient-pay.
    // Settled ("Paid") history is left exactly as it happened.
    {
      let changed = false
      claims = claims.map((c) => {
        const insured =
          (c.insuranceProvider && c.insuranceProvider !== "Self-Pay") ||
          (c.insurancePortion || 0) > 0 ||
          !!c.tpa
        if (!insured || c.status === "Paid" || isCashlessEligible(c)) return c
        changed = true
        const items = c.items.map((it) => ({
          ...it,
          insuranceCovered: 0,
          patientPayable: Number(it.total || 0),
        }))
        const patientPortion = c.totalAmount
        return {
          ...c,
          items,
          insuranceProvider: "Self-Pay",
          policyNumber: "",
          preAuthCode: undefined,
          tpa: undefined,
          denialReason: undefined,
          insurancePortion: 0,
          patientPortion,
          balanceDue: Math.max(0, patientPortion - (c.amountPaid || 0)),
          status: (c.amountPaid || 0) >= patientPortion ? "Paid" : "Ready",
          updatedAt: new Date().toISOString(),
        }
      })
      if (changed) this.save(STORAGE_KEY_CLAIMS, claims)
    }


    // Auto-sync OP Encounters and consolidate with Laboratory & Radiology investigations
    const derivedOp = new Set<string>()
    try {
      const opEncs = db.getEncounters()
      const rawLab = typeof window !== "undefined" ? window.localStorage.getItem("hospai_lab_orders_v2") : null
      const allLabOrders: any[] = rawLab ? JSON.parse(rawLab) : []
      const rawRad = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY_RAD_STUDIES) : null
      const allRadStudies: any[] = rawRad ? JSON.parse(rawRad) : []

      // Track all encounter IDs and items that have been consolidated
      const consolidatedEncounterIds = new Set<string>()
      const consolidatedLabOrderIds = new Set<string>()
      const consolidatedRadStudyIds = new Set<string>()

      opEncs.forEach((enc) => {
        const claimId = `CLM-${enc.id}`
        const encOp = enc.opNumber || `OP-${enc.umr.replace(/\D/g, "") || "1001"}`
        const invoiceNo = `INV-${encOp}`

        // Find associated Lab Orders
        const matchingLabOrders = allLabOrders.filter((o) => matchesEncounter(o, enc))
        // Find associated Radiology Studies
        const matchingRadStudies = allRadStudies.filter((s) => matchesEncounter(s, enc))

        const hasInvestigations = matchingLabOrders.length > 0 || matchingRadStudies.length > 0

        if (hasInvestigations) {
          consolidatedEncounterIds.add(enc.id.toLowerCase())
          if (enc.opNumber) consolidatedEncounterIds.add(enc.opNumber.toLowerCase())
          matchingLabOrders.forEach((o) => { if (o.id) consolidatedLabOrderIds.add(String(o.id)) })
          matchingRadStudies.forEach((s) => { if (s.id) consolidatedRadStudyIds.add(String(s.id)) })

          const cleanId = cleanEnc(enc.id)
          const cleanOp = cleanEnc(enc.opNumber)
          const normUmr = normalizeUmr(enc.umr)

          const existingClaimIdx = claims.findIndex((c) => {
            if (c.id === claimId || c.invoiceNo === invoiceNo) return true
            if (enc.opNumber && c.id === `CLM-${enc.opNumber}`) return true
            const cEnc = cleanEnc(c.encounterId)
            if (cEnc && (cEnc === cleanId || (cleanOp && cEnc === cleanOp))) return true
            const cUmr = normalizeUmr(c.patientId || c.mrn)
            if (cUmr && normUmr && cUmr === normUmr) {
              if (c.encounterId && (c.encounterId.toLowerCase() === enc.id.toLowerCase() || (enc.opNumber && c.encounterId.toLowerCase() === enc.opNumber.toLowerCase()))) return true
              if (c.id === `CLM-${enc.id}` || (enc.opNumber && c.id === `CLM-${enc.opNumber}`)) return true
            }
            return false
          })

          let items: InvoiceItem[] = []
          if (existingClaimIdx >= 0) {
            const existing = claims[existingClaimIdx]
            // Retain existing items (e.g. bedside services), strictly remove Registration fee & generic placeholders
            items = (existing.items || []).filter(
              (it) => it.category !== "Registration" && !it.id.startsWith("ITEM-REG-") && it.id !== `ITEM-LAB-${enc.id}` && it.description !== "Diagnostic Investigations & Services"
            )
          }

          // Merge Laboratory items
          matchingLabOrders.forEach((ord: any) => {
            (ord.tests || []).forEach((t: any, i: number) => {
              const itemId = `ITEM-LAB-${ord.id}-${i + 1}`
              const exists = items.some(
                (it) => it.id === itemId || (it.category === "Laboratory" && it.description.toLowerCase().trim() === (t.name || "").toLowerCase().trim())
              )
              if (!exists) {
                items.push({
                  id: itemId,
                  description: t.name,
                  category: "Laboratory",
                  cptCode: t.code || "80050",
                  quantity: 1,
                  unitPrice: t.price || 0,
                  total: t.price || 0,
                  insuranceCovered: 0,
                  patientPayable: t.price || 0,
                  orderedBy: ord.doctorName || enc.assignedDoctor || "Attending Doctor",
                  orderedAt: ord.createdAt || new Date().toISOString(),
                })
              }
            })
          })

          // Merge Radiology items
          matchingRadStudies.forEach((rs: any) => {
            const itemId = `ITEM-RAD-${rs.id}`
            const exists = items.some(
              (it) =>
                it.id === itemId ||
                (((it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology") &&
                  (it.description.toLowerCase().trim() === `${rs.study} (${rs.modality})`.toLowerCase().trim() ||
                   it.description.toLowerCase().trim() === (rs.study || "").toLowerCase().trim()))
            )
            if (!exists) {
              items.push({
                id: itemId,
                description: `${rs.study} (${rs.modality})`,
                category: "Radiology / Imaging",
                cptCode: `RAD-${rs.modality || "IMG"}`,
                quantity: 1,
                unitPrice: rs.price || 0,
                total: rs.price || 0,
                insuranceCovered: 0,
                patientPayable: rs.price || 0,
                orderedBy: rs.provider || enc.assignedDoctor || "Attending Doctor",
                orderedAt: rs.createdAt || rs.orderedAt || new Date().toISOString(),
              })
            }
          })

          // Ensure NO registration fee in investigation billing
          items = items.filter((it) => it.category !== "Registration" && !it.id.startsWith("ITEM-REG-"))

          const subtotal = items.reduce((s, it) => s + (it.total || 0), 0)
          const existingClaim = existingClaimIdx >= 0 ? claims[existingClaimIdx] : null
          const recordedPayments = (existingClaim?.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0)

          const isLabPaid = matchingLabOrders.length === 0 || matchingLabOrders.every((o) => o.billing?.status === "Paid")
          const isRadPaid = matchingRadStudies.length === 0 || matchingRadStudies.every((s) => s.isPaid || s.paymentStatus === "Paid")
          const allInvestigationsPaidInStore = isLabPaid && isRadPaid && (matchingLabOrders.length + matchingRadStudies.length > 0)

          const isFullyPaid = allInvestigationsPaidInStore || (recordedPayments >= subtotal && subtotal > 0)
          const amountPaid = isFullyPaid
            ? subtotal
            : Math.min(subtotal, Math.max(existingClaim?.amountPaid || 0, recordedPayments))
          const balanceDue = isFullyPaid ? 0 : Math.max(0, subtotal - amountPaid)

          const hasLab = items.some((it) => it.category === "Laboratory")
          const hasRad = items.some((it) => (it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology")
          const department: DepartmentType = (hasLab && hasRad) ? "Outpatient" : hasLab ? "Laboratory" : hasRad ? "Radiology" : "Outpatient"
          const carePathway = (hasLab && hasRad) ? "Laboratory & Radiology Investigations" : hasLab ? "Laboratory Diagnostics" : hasRad ? "Radiology Imaging" : `${enc.dept} Consultation (${encOp})`

          const visitIso = (() => {
            try {
              return encounterArrivalIso(enc)
            } catch {
              return ""
            }
          })()
          const visitAt = visitIso && !Number.isNaN(new Date(visitIso).getTime()) ? new Date(visitIso).toISOString() : new Date().toISOString()
          derivedOp.add(claimId)

          const claimRecord: ClaimRecord = {
            ...(existingClaim || {}),
            id: claimId,
            invoiceNo,
            encounterId: enc.id,
            patientId: enc.umr,
            patientName: enc.patientName,
            mrn: enc.umr.replace("UMR", ""),
            age: enc.age || 30,
            gender: enc.sex === "Female" ? "Female" : "Male",
            phone: enc.phone || "",
            payments: existingClaim?.payments || [],
            department,
            carePathway,
            dateOfService: OpReportsService.getEncounterDate(enc) || (enc as any).createdAt?.split("T")[0] || visitAt.split("T")[0],
            insuranceProvider: existingClaim?.insuranceProvider || "Self-Pay",
            policyNumber: existingClaim?.policyNumber || "N/A",
            status: isFullyPaid ? "Paid" : "Draft",
            attendingDoctor: enc.assignedDoctor || "Attending Doctor",
            diagnosisCodes: [enc.icd10 || enc.diagnosis || "Z01.89"],
            items,
            subtotal,
            discount: 0,
            tax: 0,
            totalAmount: subtotal,
            insurancePortion: 0,
            patientPortion: subtotal,
            amountPaid,
            balanceDue,
            createdAt: existingClaim?.createdAt || visitAt,
            updatedAt: new Date().toISOString(),
          }

          if (existingClaimIdx >= 0) {
            claims[existingClaimIdx] = claimRecord
          } else {
            claims.push(claimRecord)
          }
        } else {
          // No investigations: standard Outpatient consultation claim
          consolidatedEncounterIds.add(enc.id.toLowerCase())
          if (enc.opNumber) consolidatedEncounterIds.add(enc.opNumber.toLowerCase())
          const cleanId = cleanEnc(enc.id)
          const cleanOp = cleanEnc(enc.opNumber)
          const normUmr = normalizeUmr(enc.umr)

          const existingClaimIdx = claims.findIndex((c) => {
            if (c.id === claimId || c.invoiceNo === invoiceNo) return true
            if (enc.opNumber && c.id === `CLM-${enc.opNumber}`) return true
            const cEnc = cleanEnc(c.encounterId)
            if (cEnc && (cEnc === cleanId || (cleanOp && cEnc === cleanOp))) return true
            const cUmr = normalizeUmr(c.patientId || c.mrn)
            if (cUmr && normUmr && cUmr === normUmr) {
              if (c.encounterId && (c.encounterId.toLowerCase() === enc.id.toLowerCase() || (enc.opNumber && c.encounterId.toLowerCase() === enc.opNumber.toLowerCase()))) return true
              if (c.id === `CLM-${enc.id}` || (enc.opNumber && c.id === `CLM-${enc.opNumber}`)) return true
            }
            return false
          })
          const regFee = enc.billing?.registrationFee ?? (enc.isNew === false ? 0 : 20)
          const consultFee = enc.billing?.consultationFee ?? getDoctorConsultationFee(enc.assignedDoctor)

          let items: InvoiceItem[] = []
          if (existingClaimIdx >= 0) {
            items = claims[existingClaimIdx].items || []
          } else {
            if (regFee > 0) {
              items.push({
                id: `ITEM-REG-${enc.id}`,
                description: `Patient Registration Fee – ₹${regFee}`,
                category: "Registration" as any,
                cptCode: "99201",
                quantity: 1,
                unitPrice: regFee,
                total: regFee,
                insuranceCovered: 0,
                patientPayable: regFee,
                orderedBy: "Front Desk Registration",
                orderedAt: enc.registrationTime,
              })
            }
            items.push({
              id: `ITEM-CONSULT-${enc.id}`,
              description: `Physician Consultation Fee (${enc.assignedDoctor || enc.dept || "Attending Specialist"})`,
              category: "Consultation",
              cptCode: "99205",
              quantity: 1,
              unitPrice: consultFee,
              total: consultFee,
              insuranceCovered: 0,
              patientPayable: consultFee,
              orderedBy: enc.assignedDoctor || "OP Physician",
              orderedAt: enc.registrationTime,
            })
          }

          const subtotal = items.reduce((s, it) => s + (it.total || 0), 0)
          const isRegPaid = enc.billing?.status === "Paid"
          const existing = existingClaimIdx >= 0 ? claims[existingClaimIdx] : null
          const recordedPayments = (existing?.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0)
          const wasFullySettled = existing?.status === "Paid" || (existing !== null && (existing.balanceDue || 0) <= 0 && (existing.amountPaid || 0) > 0)
          const amountPaid = wasFullySettled
            ? subtotal
            : Math.min(subtotal, Math.max(existing?.amountPaid || 0, recordedPayments || (isRegPaid ? subtotal : 0)))
          const balanceDue = wasFullySettled ? 0 : Math.max(0, subtotal - amountPaid)
          const isFullyPaid = balanceDue === 0 && subtotal > 0

          const visitIso = (() => {
            try {
              return encounterArrivalIso(enc)
            } catch {
              return ""
            }
          })()
          const visitAt = visitIso && !Number.isNaN(new Date(visitIso).getTime()) ? new Date(visitIso).toISOString() : new Date().toISOString()
          derivedOp.add(claimId)

          const opClaim: ClaimRecord = {
            ...(existing || {}),
            id: claimId,
            invoiceNo,
            encounterId: enc.id,
            patientId: enc.umr,
            patientName: enc.patientName,
            mrn: enc.umr.replace("UMR", ""),
            age: enc.age || 30,
            gender: enc.sex === "Female" ? "Female" : "Male",
            phone: enc.phone || "",
            payments: existing?.payments || [],
            department: "Outpatient",
            carePathway: `${enc.dept} Consultation (${encOp})`,
            dateOfService: OpReportsService.getEncounterDate(enc) || (enc as any).createdAt?.split("T")[0] || visitAt.split("T")[0],
            insuranceProvider: "Self-Pay",
            policyNumber: "N/A",
            status: isFullyPaid ? "Paid" : "Draft",
            attendingDoctor: enc.assignedDoctor || "OP Physician",
            diagnosisCodes: [enc.icd10 || "Z00.00"],
            items,
            subtotal,
            discount: 0,
            tax: 0,
            totalAmount: subtotal,
            insurancePortion: 0,
            patientPortion: subtotal,
            amountPaid,
            balanceDue,
            createdAt: existing?.createdAt || visitAt,
            updatedAt: visitAt,
          }

          if (existingClaimIdx >= 0) {
            claims[existingClaimIdx] = opClaim
          } else {
            claims.push(opClaim)
          }
        }
      })

      // Consolidated Standalone Investigations (Laboratory + Radiology without matching OP encounter)
      // Group unmerged lab orders and radiology studies by (patientKey, encounterKey)
      const unmergedGroups = new Map<string, { labOrders: any[]; radStudies: any[]; patient: any }>()

      allLabOrders.forEach((ord: any) => {
        if (consolidatedLabOrderIds.has(String(ord.id))) return
        const encId = (ord.encounterId || "").toLowerCase()
        const opId = (ord.opNumber || "").toLowerCase()
        if ((encId && consolidatedEncounterIds.has(encId)) || (opId && consolidatedEncounterIds.has(opId))) return
        const patientKey = normalizeUmr(ord.umr) || (ord.patientName || "").trim().toLowerCase() || "PAT"
        const encKey = (ord.encounterId || ord.opNumber || "STANDALONE").trim().toLowerCase().replace(/^op[-_]?/, "")
        const groupKey = `${patientKey}|${encKey}`

        const group = unmergedGroups.get(groupKey) || { labOrders: [], radStudies: [], patient: ord }
        group.labOrders.push(ord)
        unmergedGroups.set(groupKey, group)
      })

      allRadStudies.forEach((rs: any) => {
        if (consolidatedRadStudyIds.has(String(rs.id))) return
        const encId = (rs.encounterId || "").toLowerCase()
        const opId = ((rs as any).opNumber || "").toLowerCase()
        if ((encId && consolidatedEncounterIds.has(encId)) || (opId && consolidatedEncounterIds.has(opId))) return
        const patientKey = normalizeUmr(rs.umr || rs.mrn) || (rs.patient || "").trim().toLowerCase() || "PAT"
        const encKey = (rs.encounterId || (rs as any).opNumber || "STANDALONE").trim().toLowerCase().replace(/^op[-_]?/, "")
        const groupKey = `${patientKey}|${encKey}`

        const group = unmergedGroups.get(groupKey) || { labOrders: [], radStudies: [], patient: rs }
        group.radStudies.push(rs)
        unmergedGroups.set(groupKey, group)
      })

      // Process each standalone consolidated group -> EXACTLY ONE billing entry
      unmergedGroups.forEach((group) => {
        const primary = group.radStudies[0] || group.labOrders[0]
        const rawEnc = primary.encounterId || primary.opNumber || primary.id
        const cleanRawEnc = String(rawEnc).replace(/^(RAD|LAB|ORD)[-_]/i, "")
        const claimId = primary.encounterId ? `CLM-${primary.encounterId}` : `CLM-INV-${cleanRawEnc}`
        const invoiceNo = primary.invoiceNo && !primary.invoiceNo.startsWith("INV-RAD-")
          ? primary.invoiceNo
          : `INV-${primary.opNumber || cleanRawEnc}`

        const existingIdx = claims.findIndex(
          (c) => c.id === claimId || c.invoiceNo === invoiceNo || (c.encounterId && c.encounterId.toLowerCase() === String(rawEnc).toLowerCase())
        )

        if (existingIdx >= 0) {
          const existing = claims[existingIdx]
          if (
            existing.department === "Inpatient" ||
            existing.department === "Emergency" ||
            existing.department === "ICU" ||
            existing.department === "Surgery"
          ) {
            // Inpatient or emergency claims already manage their own consolidated investigation charges.
            // Never overwrite an Inpatient admission running bill or emergency invoice with a standalone investigation stub.
            return
          }
        }

        let items: InvoiceItem[] = existingIdx >= 0 ? [...(claims[existingIdx].items || [])] : []

        // Merge Lab items
        group.labOrders.forEach((ord) => {
          (ord.tests || []).forEach((t: any, i: number) => {
            const itemId = `ITEM-LAB-${ord.id}-${i + 1}`
            const exists = items.some(
              (it) => it.id === itemId || (it.category === "Laboratory" && it.description.toLowerCase().trim() === (t.name || "").toLowerCase().trim())
            )
            if (!exists) {
              items.push({
                id: itemId,
                description: t.name,
                category: "Laboratory",
                cptCode: t.code || "80050",
                quantity: 1,
                unitPrice: t.price || 0,
                total: t.price || 0,
                insuranceCovered: 0,
                patientPayable: t.price || 0,
                orderedBy: ord.doctorName || "Attending Doctor",
                orderedAt: ord.createdAt || new Date().toISOString(),
              })
            }
          })
        })

        // Merge Radiology items
        group.radStudies.forEach((rs) => {
          const itemId = `ITEM-RAD-${rs.id}`
          const exists = items.some(
            (it) =>
              it.id === itemId ||
              (((it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology") &&
                (it.description.toLowerCase().trim() === `${rs.study} (${rs.modality})`.toLowerCase().trim() ||
                 it.description.toLowerCase().trim() === (rs.study || "").toLowerCase().trim()))
          )
          if (!exists) {
            items.push({
              id: itemId,
              description: `${rs.study} (${rs.modality})`,
              category: "Radiology / Imaging",
              cptCode: `RAD-${rs.modality || "IMG"}`,
              quantity: 1,
              unitPrice: rs.price || 0,
              total: rs.price || 0,
              insuranceCovered: 0,
              patientPayable: rs.price || 0,
              orderedBy: rs.provider || "Attending Doctor",
              orderedAt: rs.createdAt || rs.orderedAt || new Date().toISOString(),
            })
          }
        })

        const subtotal = items.reduce((s, it) => s + (it.total || 0), 0)
        const isLabPaid = group.labOrders.length === 0 || group.labOrders.every((o) => o.billing?.status === "Paid")
        const isRadPaid = group.radStudies.length === 0 || group.radStudies.every((s) => s.isPaid || s.paymentStatus === "Paid")
        const existingClaim = existingIdx >= 0 ? claims[existingIdx] : null
        const wasFullySettled = existingClaim?.status === "Paid" || (existingClaim !== null && (existingClaim.balanceDue || 0) <= 0 && (existingClaim.amountPaid || 0) > 0)
        const isPaid = wasFullySettled || (isLabPaid && isRadPaid && items.length > 0)
        const recordedPayments = (existingClaim?.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
        const amountPaid = isPaid ? subtotal : Math.min(subtotal, Math.max(existingClaim?.amountPaid || 0, recordedPayments))
        const balanceDue = isPaid ? 0 : Math.max(0, subtotal - amountPaid)

        const hasLab = items.some((it) => it.category === "Laboratory")
        const hasRad = items.some((it) => (it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology")
        const department: DepartmentType = (hasLab && hasRad) ? "Outpatient" : hasLab ? "Laboratory" : hasRad ? "Radiology" : "Outpatient"
        const carePathway = (hasLab && hasRad) ? "Laboratory & Radiology Investigations" : hasLab ? `Laboratory Diagnostics (${group.labOrders[0]?.id || "LAB"})` : hasRad ? `Radiology Imaging — ${group.radStudies[0]?.study || "Imaging"}` : "Diagnostic Services"

        const standaloneClaim: ClaimRecord = {
          ...(existingIdx >= 0 ? claims[existingIdx] : {}),
          id: claimId,
          invoiceNo,
          encounterId: rawEnc,
          patientId: primary.umr || primary.mrn || "WALK-IN",
          patientName: primary.patientName || primary.patient || "Patient",
          mrn: (primary.umr || primary.mrn || "").replace("UMR", ""),
          age: primary.age || 35,
          gender: primary.sex === "Female" || primary.gender === "Female" ? "Female" : "Male",
          phone: primary.phone || "",
          payments: existingIdx >= 0 ? claims[existingIdx].payments || [] : [],
          department,
          carePathway,
          dateOfService: (primary.orderDate || primary.ordered || primary.createdAt || "").split("T")[0].split(" · ")[0] || new Date().toISOString().split("T")[0],
          insuranceProvider: "Self-Pay",
          policyNumber: "N/A",
          status: isPaid ? "Paid" : "Draft",
          attendingDoctor: primary.doctorName || primary.provider || "Attending Specialist",
          diagnosisCodes: [primary.diagnosis || "Z01.89"],
          items,
          subtotal,
          discount: 0,
          tax: 0,
          totalAmount: subtotal,
          insurancePortion: 0,
          patientPortion: subtotal,
          amountPaid,
          balanceDue,
          createdAt: primary.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        if (existingIdx >= 0) {
          claims[existingIdx] = standaloneClaim
        } else {
          claims.push(standaloneClaim)
        }
      })

      // Strip any split/orphan individual study claims or lab claims that have been consolidated
      claims = claims.filter((c) => {
        // Never strip Inpatient, ICU, Emergency, or Surgery bills
        if (
          c.department === "Inpatient" ||
          c.department === "Emergency" ||
          c.department === "ICU" ||
          c.department === "Surgery"
        ) {
          return true
        }
        if (c.id && c.id.startsWith("CLM-RAD-")) return false
        if (c.id && consolidatedRadStudyIds.has(c.id.replace("CLM-", ""))) return false
        if (c.id && consolidatedLabOrderIds.has(c.id.replace("CLM-LAB-", ""))) return false
        return true
      })
    } catch {
      // ignore
    }

    // The hospital's server invoices (billing-service), kept live by
    // billingSync. A bill this browser derived from an OP visit is dropped when
    // the server already holds that patient's OP invoice for the same day --
    // reception writes the visit there too, and a patient must not see the
    // same consultation billed twice.
    const server = getServerClaims()
    if (server.length) {
      const serverOp = new Set(
        server
          .filter((c) => c.department === "Outpatient")
          .map((c) => `${c.patientId.toUpperCase()}|${c.dateOfService}`),
      )
      claims = claims.filter(
        (c) => !(derivedOp.has(c.id) && serverOp.has(`${c.patientId.toUpperCase()}|${c.dateOfService}`)),
      )
      claims = [...claims, ...server]
    }

    // Authoritative Settlement & Deduplication Reconciliation
    // Invariant: Exactly one billing entry per patient encounter.
    // A settled bill (balanceDue <= 0 and fully paid) MUST have status "Paid" and must NEVER appear as Draft/Due.
    // If duplicate claims exist for the same encounter, merge them and preserve the settled/paid one.
    const dedupedMap = new Map<string, ClaimRecord>()

    claims.forEach((claim) => {
      const recordedPayments = (claim.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
      const currentPaid = Math.max(claim.amountPaid || 0, recordedPayments)
      const patientTotal = claim.patientPortion !== undefined ? claim.patientPortion : claim.totalAmount

      let balanceDue = claim.balanceDue !== undefined ? claim.balanceDue : Math.max(0, patientTotal - currentPaid)
      let status = claim.status

      const isIns = (claim.insuranceProvider && claim.insuranceProvider !== "Self-Pay") || (claim.insurancePortion || 0) > 0 || !!claim.tpa
      const isInsSettled = isIns && (!!claim.tpa?.settledAt || claim.status === "Paid")

      if (!isIns) {
        if ((currentPaid >= patientTotal && patientTotal > 0) || (patientTotal === 0 && balanceDue === 0)) {
          balanceDue = 0
          status = "Paid"
        } else {
          balanceDue = Math.max(0, patientTotal - currentPaid)
          status = "Draft"
        }
      } else {
        if (isInsSettled && balanceDue <= 0) {
          balanceDue = 0
          status = "Paid"
        } else if (balanceDue > 0 && status === "Paid") {
          status = "Draft"
        }
      }

      const reconciledClaim: ClaimRecord = {
        ...claim,
        amountPaid: status === "Paid" && balanceDue === 0 ? Math.max(currentPaid, patientTotal) : currentPaid,
        balanceDue,
        status,
      }

      const normUmr = normalizeUmr(claim.patientId || claim.mrn)
      const cleanEncId = cleanEnc(claim.encounterId)
      const cleanInv = (claim.invoiceNo || "").toLowerCase().trim()

      const primaryKey = normUmr && cleanEncId ? `${normUmr}|${cleanEncId}` : cleanInv || claim.id

      if (!dedupedMap.has(primaryKey)) {
        dedupedMap.set(primaryKey, reconciledClaim)
      } else {
        const existing = dedupedMap.get(primaryKey)!
        const existingIsPaid = existing.status === "Paid" || existing.balanceDue === 0
        const newIsPaid = reconciledClaim.status === "Paid" || reconciledClaim.balanceDue === 0

        const mergedPayments = [...(existing.payments || [])]
        ;(reconciledClaim.payments || []).forEach((p) => {
          if (!mergedPayments.some((ep) => ep.id === p.id || ep.receiptNo === p.receiptNo)) {
            mergedPayments.push(p)
          }
        })

        const mergedItems = [...(existing.items || [])]
        ;(reconciledClaim.items || []).forEach((it) => {
          if (!mergedItems.some((ei) => ei.id === it.id || (ei.description === it.description && ei.category === it.category))) {
            mergedItems.push(it)
          }
        })

        const winner = (newIsPaid && !existingIsPaid) ? reconciledClaim : existing
        const loser = (winner === reconciledClaim) ? existing : reconciledClaim

        const subtotal = Math.max(winner.subtotal || 0, loser.subtotal || 0, mergedItems.reduce((s, it) => s + (it.total || 0), 0))
        const totalAmount = subtotal
        const patientPortion = subtotal
        const recordedTotalPaid = mergedPayments.reduce((s, p) => s + (p.amount || 0), 0)
        const totalPaid = (existingIsPaid && newIsPaid)
          ? totalAmount
          : Math.min(totalAmount, Math.max(winner.amountPaid || 0, loser.amountPaid || 0, recordedTotalPaid))
        const finalBal = Math.max(0, totalAmount - totalPaid)
        const finalStatus = (finalBal === 0 && totalAmount > 0) ? "Paid" : "Draft"

        dedupedMap.set(primaryKey, {
          ...winner,
          subtotal,
          totalAmount,
          patientPortion,
          amountPaid: totalPaid,
          balanceDue: finalBal,
          status: finalStatus,
          items: mergedItems,
          payments: mergedPayments,
        })
      }
    })

    claims = Array.from(dedupedMap.values())

    if (filter) {
      if (filter.status && filter.status !== "All") {
        claims = claims.filter((c) => c.status === filter.status)
      }

      if (filter.department && filter.department !== "All") {
        claims = claims.filter((c) => c.department === filter.department)
      }

      if (filter.umr && filter.umr.trim()) {
        const u = filter.umr.trim().toLowerCase()

        claims = claims.filter(
          (c) => c.patientId.toLowerCase() === u || c.mrn.toLowerCase() === u,
        )
      }

      if (filter.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase()

        claims = claims.filter(
          (c) =>
            c.patientName.toLowerCase().includes(q) ||
            c.mrn.toLowerCase().includes(q) ||
            c.patientId.toLowerCase().includes(q) ||
            c.invoiceNo.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            c.insuranceProvider.toLowerCase().includes(q) ||
            (c.encounterId && c.encounterId.toLowerCase().includes(q)) ||
            (c.hospitalStayId && c.hospitalStayId.toLowerCase().includes(q)) ||
            c.items.some(
              (it) =>
                it.description.toLowerCase().includes(q) ||
                it.cptCode.toLowerCase().includes(q),
            ),
        )
      }
    }

    return claims.sort((a, b) => {
      const timeB = new Date(b.createdAt || b.dateOfService || 0).getTime()
      const timeA = new Date(a.createdAt || a.dateOfService || 0).getTime()
      return timeB - timeA
    })
  }

  static getClaimById(id: string): ClaimRecord | undefined {
    const claims = this.getClaims()

    return claims.find((c) => c.id === id || c.invoiceNo === id)
  }

  static createClaim(data: Partial<ClaimRecord>): ClaimRecord {
    let claims = this.load<ClaimRecord[]>(
      STORAGE_KEY_CLAIMS,
      [],
    )

    // OP / non-admitted bills never carry insurance: the patient's policy on
    // their registration is irrelevant to an OP visit.
    if (
      data.department &&
      !isCashlessEligible({ department: data.department, carePathway: data.carePathway }) &&
      data.insuranceProvider &&
      data.insuranceProvider !== "Self-Pay"
    ) {
      data = {
        ...data,
        insuranceProvider: "Self-Pay",
        policyNumber: "",
        preAuthCode: undefined,
        items: (data.items || []).map((it) => ({
          ...it,
          insuranceCovered: 0,
          patientPayable: Number(it.total || 0),
        })),
      }
    }

    const maxClaimNum = claims.reduce((max, c) => {
      const num = parseInt((c.id || "").replace(/\D/g, ""), 10);
      return !isNaN(num) && num > max ? num : max;
    }, 8937);
    const claimNum = maxClaimNum + 1;

    const maxInvNum = claims.reduce((max, c) => {
      const match = (c.invoiceNo || "").match(/(\d+)$/);
      const num = match ? parseInt(match[1], 10) : 0;
      return num > max ? num : max;
    }, 827);
    const invNum = maxInvNum + 1;

    const nowIso = new Date().toISOString()

    const items: InvoiceItem[] = data.items || []

    const subtotal = items.reduce((sum, it) => sum + Number(it.total || 0), 0)

    const discount = Number(data.discount || 0)

    const tax = Number(data.tax || 0)

    const totalAmount = Math.max(0, subtotal - discount + tax)

    // Calculate insurance & patient portions

    const isSelfPay = (data.insuranceProvider || "Self-Pay") === "Self-Pay"

    const insurancePortion = isSelfPay
      ? 0
      : items.reduce((sum, it) => sum + Number(it.insuranceCovered || 0), 0)

    const patientPortion = isSelfPay
      ? totalAmount
      : Math.max(0, totalAmount - insurancePortion)

    // Upsert: If an invoice already exists for this encounter, update it directly

    const existingIndex = claims.findIndex(
      (c) =>
        (data.id && c.id === data.id) ||
        (data.encounterId && c.encounterId === data.encounterId && (!data.department || c.department === data.department)),
    )

    if (existingIndex >= 0) {
      const existing = claims[existingIndex]

      const finalAmountPaid =
        data.amountPaid !== undefined ? data.amountPaid : existing.amountPaid;
      const finalBalanceDue =
        data.balanceDue !== undefined
          ? data.balanceDue
          : Math.max(0, patientPortion - finalAmountPaid);
      const finalStatus =
        data.status ||
        (finalAmountPaid >= patientPortion ? "Paid" : "Accepted");

      const updatedClaim: ClaimRecord = {
        ...existing,

        ...data,

        id: existing.id,

        invoiceNo: existing.invoiceNo,

        items,

        subtotal,

        discount,

        tax,

        totalAmount,

        insurancePortion,

        patientPortion,

        amountPaid: finalAmountPaid,

        balanceDue: finalBalanceDue,

        status: finalStatus,

        updatedAt: nowIso,
      }

      claims[existingIndex] = updatedClaim

      this.save(STORAGE_KEY_CLAIMS, claims)
      this.emitUpdate()

      return updatedClaim
    }

    const newClaim: ClaimRecord = {
      id: data.id || `CLM-${claimNum}`,

      invoiceNo:
        data.invoiceNo || `INV-2026-${String(invNum).padStart(4, "0")}`,

      patientId:
        data.patientId || `UMR${Math.floor(100000 + Math.random() * 900000)}`,

      patientName: data.patientName || "Hospital Patient",

      mrn: data.mrn || `100${Math.floor(100 + Math.random() * 899)}`,

      age: data.age || 40,

      gender: data.gender || "Other",

      phone: data.phone || "+91 98765 43210",

      department: data.department || "Outpatient",

      carePathway: data.carePathway,

      dateOfService:
        data.dateOfService || new Date().toISOString().split("T")[0],

      encounterId: data.encounterId,

      hospitalStayId: data.hospitalStayId,

      admissionId: data.admissionId,

      bedId: data.bedId,

      insuranceProvider: data.insuranceProvider || "Self-Pay",

      policyNumber:
        data.policyNumber || (isSelfPay ? "N/A - Self Pay" : "POL-UNSPECIFIED"),

      preAuthCode: data.preAuthCode,

      status: data.status || "Accepted",

      items,

      subtotal,

      discount,

      tax,

      totalAmount,

      insurancePortion,

      patientPortion,

      amountPaid: 0,

      balanceDue: patientPortion,

      payments: [],

      denialReason: data.denialReason,

      appealNotes: data.appealNotes,

      diagnosisCodes:
        data.diagnosisCodes && data.diagnosisCodes.length > 0
          ? data.diagnosisCodes
          : ["Z00.00"],

      attendingDoctor: data.attendingDoctor || "Dr. Staff Physician",

      finalizedByNurse: data.finalizedByNurse,

      createdAt: nowIso,

      updatedAt: nowIso,
    }

    claims.unshift(newClaim)

    this.save(STORAGE_KEY_CLAIMS, claims)
    this.emitUpdate()

    BillingRbacManager.logEvent({
      action: "INVOICE_CREATED",

      patientId: newClaim.patientId,

      patientName: newClaim.patientName,

      mrn: newClaim.mrn,

      invoiceNo: newClaim.invoiceNo,

      claimId: newClaim.id,

      financialAmount: newClaim.totalAmount,

      department: newClaim.department,

      reason: `Direct invoice created for ${newClaim.department} under UMR ${newClaim.patientId} (${newClaim.items.length} services).`,
    })

    // Backend write-through for invoice, items, and insurance claim
    apiFetch("/api/billing/invoices", {
      method: "POST",
      body: JSON.stringify({
        patient_id: newClaim.patientId,
        module: newClaim.department || "OP",
        doctor_name: (data as any).consultingDoctor || "Dr. Staff",
        total_amount: newClaim.totalAmount,
        paid_amount: newClaim.amountPaid || 0,
        due_amount: newClaim.balanceDue || 0,
        status: newClaim.balanceDue === 0 ? "paid" : (newClaim.amountPaid || 0) > 0 ? "partial" : "due",
      }),
    }).then((invRes) => {
      if (invRes && invRes.invoice_id) {
        if (newClaim.items && newClaim.items.length > 0) {
          apiFetch(`/api/billing/invoices/${invRes.invoice_id}/items`, {
            method: "POST",
            body: JSON.stringify({
              items: newClaim.items.map((it) => ({
                service_name: (it as any).serviceName || (it as any).description || "Medical Service",
                quantity: it.quantity || 1,
                unit_price: it.unitPrice || it.total || 0,
                amount: it.total || 0,
                department: newClaim.department || "General",
              })),
            }),
          }).catch(() => {})
        }
        if (newClaim.insuranceProvider && newClaim.insuranceProvider !== "Self-Pay") {
          apiFetch("/api/billing/claims", {
            method: "POST",
            body: JSON.stringify({
              invoice_id: invRes.invoice_id,
              insurer_name: newClaim.insuranceProvider,
              claim_amount: newClaim.insurancePortion || newClaim.totalAmount,
              status: newClaim.status ? newClaim.status.toLowerCase() : "submitted",
              pre_auth_code: newClaim.preAuthCode,
              notes: `Policy #${newClaim.policyNumber}`,
            }),
          }).catch(() => {})
        }
      }
    }).catch(() => {})

    return newClaim
  }

  static updateClaim(id: string, updates: Partial<ClaimRecord>): ClaimRecord {
    if (/^(SRV|RUN)-/i.test(String(id))) {
      throw new Error(
        "This bill is held by the hospital server (or is a running admission bill) and cannot be edited here. Changes are made on the server's invoice.",
      )
    }
    const claims = this.load<ClaimRecord[]>(
      STORAGE_KEY_CLAIMS,
      [],
    )

    const idx = claims.findIndex((c) => c.id === id || c.invoiceNo === id)

    if (idx < 0) throw new Error("Claim not found")

    const current = claims[idx]

    const items = updates.items || current.items

    const subtotal = items.reduce((sum, it) => sum + Number(it.total || 0), 0)

    const discount =
      updates.discount !== undefined
        ? Number(updates.discount)
        : current.discount

    const tax = updates.tax !== undefined ? Number(updates.tax) : current.tax

    const totalAmount = Math.max(0, subtotal - discount + tax)

    const isSelfPay =
      (updates.insuranceProvider || current.insuranceProvider) === "Self-Pay"

    const tpa = updates.tpa !== undefined ? updates.tpa : current.tpa
    const covered = items.reduce(
      (sum, it) => sum + Number(it.insuranceCovered || 0),
      0,
    )
    // An insurer deduction only lands on the patient when the insurance
    // department chose to recover it; otherwise the hospital writes it off
    // and the patient's share stays as billed.
    const recoveredFromPatient =
      tpa?.shortfallTo === "patient" ? Number(tpa?.deduction || 0) : 0
    const insurancePortion = isSelfPay
      ? 0
      : Math.max(0, covered - recoveredFromPatient)

    const patientPortion = isSelfPay
      ? totalAmount
      : Math.max(0, totalAmount - insurancePortion)

    const amountPaid =
      updates.amountPaid !== undefined
        ? Number(updates.amountPaid)
        : current.amountPaid

    const balanceDue = Math.max(0, patientPortion - amountPaid)

    let status = updates.status || current.status

    if (
      balanceDue === 0 &&
      (status === "Accepted" || status === "Ready" || status === "Draft")
    ) {
      if (
        amountPaid >= patientPortion &&
        (isSelfPay || current.status === "Accepted")
      ) {
        status = "Paid"
      }
    }

    const updatedClaim: ClaimRecord = {
      ...current,

      ...updates,

      items,

      subtotal,

      discount,

      tax,

      totalAmount,

      insurancePortion,

      patientPortion,

      amountPaid,

      balanceDue,

      status,

      updatedAt: new Date().toISOString(),
    }

    claims[idx] = updatedClaim

    this.save(STORAGE_KEY_CLAIMS, claims)
    this.emitUpdate()

    return updatedClaim
  }

  static submitClaim(id: string): ClaimRecord {
    const claim = this.getClaimById(id)

    if (!claim) throw new Error("Claim not found")

    const newStatus: ClaimStatus =
      claim.insuranceProvider === "Self-Pay" ? "Ready" : "Submitted"

    const updated = this.updateClaim(id, {
      status: newStatus,

      updatedAt: new Date().toISOString(),
    })

    BillingRbacManager.logEvent({
      action: "CLAIM_SUBMITTED",

      patientId: claim.patientId,

      patientName: claim.patientName,

      mrn: claim.mrn,

      invoiceNo: claim.invoiceNo,

      claimId: claim.id,

      financialAmount: claim.insurancePortion,

      department: claim.department,

      reason: `Claim submitted to clearinghouse / payer (${claim.insuranceProvider}) for ₹${claim.insurancePortion.toLocaleString("en-IN")}.`,
    })

    const numericClaimId = parseInt(id.replace(/\D/g, ""))
    if (!isNaN(numericClaimId)) {
      apiFetch(`/api/billing/claims/${numericClaimId}`, {
        method: "PUT",
        body: JSON.stringify({
          status: updated.status ? updated.status.toLowerCase() : undefined,
          approved_amount: updated.amountPaid || updated.insurancePortion,
        }),
      }).catch(() => {})
    }

    return updated
  }

  static resetClaimToUnpaid(query: string): boolean {
    if (/^(SRV|RUN)-/i.test(String(query))) return false
    const claims = this.load<ClaimRecord[]>(
      STORAGE_KEY_CLAIMS,
      [],
    )

    const q = (query || "").toLowerCase().trim()

    let modified = false

    const updated = claims.map((c) => {
      const match =
        (c.encounterId && c.encounterId.toLowerCase().includes(q)) ||
        (c.patientId && c.patientId.toLowerCase().includes(q)) ||
        (c.patientName && c.patientName.toLowerCase().includes(q)) ||
        (c.invoiceNo && c.invoiceNo.toLowerCase().includes(q)) ||
        (c.id && c.id.toLowerCase().includes(q))

      if (match) {
        modified = true

        const total = c.patientPortion || c.totalAmount || 4000

        return {
          ...c,

          status: "Accepted" as const,

          amountPaid: 0,

          balanceDue: total,

          patientPortion: total,

          payments: [],

          updatedAt: new Date().toISOString(),
        }
      }

      return c
    })

    if (modified) {
      this.save(STORAGE_KEY_CLAIMS, updated)

      return true
    }

    return false
  }

  static resetClaimToUnbilled(query: string): boolean {
    if (/^(SRV|RUN)-/i.test(String(query))) return false
    const claims = this.load<ClaimRecord[]>(
      STORAGE_KEY_CLAIMS,
      [],
    )

    const q = (query || "").toLowerCase().trim()

    const filtered = claims.filter((c) => {
      const match =
        (c.encounterId && c.encounterId.toLowerCase().includes(q)) ||
        (c.patientId && c.patientId.toLowerCase().includes(q)) ||
        (c.patientName && c.patientName.toLowerCase().includes(q)) ||
        (c.invoiceNo && c.invoiceNo.toLowerCase().includes(q)) ||
        (c.id && c.id.toLowerCase().includes(q))

      return !match
    })

    if (filtered.length !== claims.length) {
      this.save(STORAGE_KEY_CLAIMS, filtered)

      return true
    }

    return false
  }

  static bulkSubmitClaims(ids: string[]): number {
    let count = 0

    ids.forEach((id) => {
      try {
        this.submitClaim(id)

        count++
      } catch (e) {
        console.error(`Failed to submit claim ${id}:`, e)
      }
    })

    if (count > 0) {
      BillingRbacManager.logEvent({
        action: "CLAIM_BULK_SUBMITTED",

        patientId: "BATCH",

        patientName: `Batch (${count} Claims)`,

        mrn: "N/A",

        invoiceNo: "BATCH-SUBMIT",

        reason: `Bulk submission of ${count} claims processed to clearinghouse.`,
      })
    }

    return count
  }

  static resubmitClaim(id: string, notes?: string): ClaimRecord {
    const claim = this.getClaimById(id)

    if (!claim) throw new Error("Claim not found")

    const updated = this.updateClaim(id, {
      status: "Submitted",

      denialReason: undefined,

      appealNotes:
        notes ||
        `Corrected claim re-submitted to payer with updated clinical codes.`,

      updatedAt: new Date().toISOString(),
    })

    BillingRbacManager.logEvent({
      action: "CLAIM_RESUBMITTED",

      patientId: claim.patientId,

      patientName: claim.patientName,

      mrn: claim.mrn,

      invoiceNo: claim.invoiceNo,

      claimId: claim.id,

      financialAmount: claim.insurancePortion,

      department: claim.department,

      reason: `Claim resubmitted with corrections: ${notes || "Updated pre-authorization & diagnosis codes"}`,
    })

    return updated
  }

  static appealClaim(id: string, appealNotes: string): ClaimRecord {
    const claim = this.getClaimById(id)

    if (!claim) throw new Error("Claim not found")

    const updated = this.updateClaim(id, {
      status: "Appeal",

      appealNotes,

      updatedAt: new Date().toISOString(),
    })

    BillingRbacManager.logEvent({
      action: "CLAIM_APPEALED",

      patientId: claim.patientId,

      patientName: claim.patientName,

      mrn: claim.mrn,

      invoiceNo: claim.invoiceNo,

      claimId: claim.id,

      financialAmount: claim.insurancePortion,

      department: claim.department,

      reason: `Formal appeal filed: ${appealNotes}`,
    })

    return updated
  }

  // ── Insurance / TPA workflow ────────────────────────────────────────────

  private static tpaStep(
    id: string,
    patch: Partial<TpaWorkflow>,
    event: TpaEvent,
    extra: Partial<ClaimRecord> = {},
    audit?: {
      action: Parameters<typeof BillingRbacManager.logEvent>[0]["action"]
      amount?: number
    },
  ): ClaimRecord {
    const claim = this.getClaimById(id)
    if (!claim) throw new Error("Claim not found")
    const tpa: TpaWorkflow = {
      ...(claim.tpa ?? {}),
      ...patch,
      events: [...(claim.tpa?.events ?? []), event],
    }
    const updated = this.updateClaim(claim.id, { ...extra, tpa })
    if (audit) {
      BillingRbacManager.logEvent({
        action: audit.action,
        patientId: claim.patientId,
        patientName: claim.patientName,
        mrn: claim.mrn,
        invoiceNo: claim.invoiceNo,
        claimId: claim.id,
        financialAmount: audit.amount ?? claim.insurancePortion,
        department: claim.department,
        reason: `${event.action}${event.detail ? ` — ${event.detail}` : ""}`,
      })
    }
    this.emitUpdate()
    return updated
  }

  /**
   * Cashless billing: the counter hands the bill to insurance. The insurer
   * takes everything the patient has not already paid, so the patient's
   * balance becomes zero and the bill leaves the counter's queue. From here
   * the insurance department owns it (see the Insurance > Claims Desk).
   */
  static billToInsurance(
    id: string,
    input?: {
      provider?: string
      tpaName?: string
      policyNumber?: string
      preAuthCode?: string
      note?: string
      billedBy?: string
      /**
       * Insurer's share per charge line (item id -> amount). Whatever is not
       * covered is the patient's co-pay, collected at the counter. Omit it and
       * insurance takes everything the patient has not already paid.
       */
      coverage?: Record<string, number>
    },
  ): ClaimRecord {
    const claim = this.getClaimById(id)
    if (!claim) throw new Error("Claim not found")
    if (!isCashlessEligible(claim))
      throw new Error("Insurance covers admitted patients only — an OP visit is paid by the patient.")
    if (input?.coverage) return this.applyInsuranceSplit(claim, input.coverage, "handover", input)

    const provider =
      input?.provider?.trim() ||
      (claim.insuranceProvider && claim.insuranceProvider !== "Self-Pay"
        ? claim.insuranceProvider
        : "Pending Insurance Assignment")
    const policyNumber =
      input?.policyNumber?.trim() ||
      claim.policyNumber ||
      "Pending KYC"

    const claimAmount = Math.max(0, claim.totalAmount - (claim.amountPaid || 0))
    if (claimAmount <= 0) throw new Error("Nothing left on this bill to claim.")

    // Spread the claim across the lines in proportion; the last line takes
    // the rounding so the lines add up to the claim exactly.
    const ratio = claim.totalAmount > 0 ? claimAmount / claim.totalAmount : 0
    let assigned = 0
    const items = claim.items.map((it, i) => {
      const insuranceCovered =
        i === claim.items.length - 1
          ? claimAmount - assigned
          : Math.round(it.total * ratio)
      assigned += insuranceCovered
      return {
        ...it,
        insuranceCovered,
        patientPayable: Math.max(0, it.total - insuranceCovered),
      }
    })

    const now = new Date().toISOString()
    const detail = input?.provider
      ? `${provider}${input.tpaName ? ` via ${input.tpaName}` : ""} · policy ${policyNumber}${input.note ? ` · ${input.note}` : ""}`
      : "Pushed to Insurance Department from billing counter"

    return this.tpaStep(
      claim.id,
      {
        tpaName: input?.tpaName,
        billedAt: now,
        billedBy: input?.billedBy || "Billing Counter",
        claimAmount,
        preAuthStatus: input?.preAuthCode ? "Approved" : claim.tpa?.preAuthStatus || "Not Raised",
        shortfallTo: "writeoff",
      },
      {
        at: now,
        action: "Billed to insurance at counter",
        detail,
        amount: claimAmount,
      },
      {
        items,
        insuranceProvider: provider,
        policyNumber: policyNumber,
        preAuthCode: input?.preAuthCode || claim.preAuthCode,
        status: "Ready",
      },
      { action: "INSURANCE_ATTACHED", amount: claimAmount },
    )
  }

  /**
   * Change how a bill is split between insurer and patient. Allowed until the
   * claim is submitted to the insurer -- after that the insurer's decision
   * governs and the split is locked.
   */
  static setInsuranceSplit(id: string, coverage: Record<string, number>): ClaimRecord {
    const claim = this.getClaimById(id)
    if (!claim) throw new Error("Claim not found")
    if (!claim.tpa?.billedAt) throw new Error("This bill has not been billed to insurance.")
    if (claim.status !== "Ready" && claim.status !== "Draft")
      throw new Error("The claim is already with the insurer; its split can no longer be edited.")
    return this.applyInsuranceSplit(claim, coverage, "edit")
  }

  private static applyInsuranceSplit(
    claim: ClaimRecord,
    coverage: Record<string, number>,
    mode: "handover" | "edit",
    input?: { provider?: string ;tpaName?: string ;policyNumber?: string ;preAuthCode?: string ;note?: string ;billedBy?: string },
  ): ClaimRecord {
    // Clamp every line to 0..line total, in whole rupees.
    const items = claim.items.map((it) => {
      const raw = coverage[it.id]
      const insuranceCovered =
        raw === undefined ? Number(it.insuranceCovered || 0) : Math.max(0, Math.min(it.total, Math.round(Number(raw) || 0)))
      return { ...it, insuranceCovered, patientPayable: Math.max(0, it.total - insuranceCovered) }
    })
    const claimAmount = items.reduce((a, it) => a + it.insuranceCovered, 0)
    if (claimAmount <= 0) throw new Error("Insurance must cover at least one charge.")
    // The patient's share cannot fall below what they have already paid.
    const patientShare = claim.totalAmount - claimAmount
    if (patientShare < (claim.amountPaid || 0))
      throw new Error(
        `The patient has already paid ₹${(claim.amountPaid || 0).toLocaleString("en-IN")}; insurance can cover at most ₹${(claim.totalAmount - (claim.amountPaid || 0)).toLocaleString("en-IN")}.`,
      )

    const now = new Date().toISOString()
    const provider =
      input?.provider?.trim() ||
      (claim.insuranceProvider && claim.insuranceProvider !== "Self-Pay"
        ? claim.insuranceProvider
        : "Pending Insurance Assignment")
    const copay = Math.max(0, patientShare)
    return this.tpaStep(
      claim.id,
      mode === "handover"
        ? {
            tpaName: input?.tpaName ?? claim.tpa?.tpaName,
            billedAt: now,
            billedBy: input?.billedBy || "Billing Counter",
            claimAmount,
            preAuthStatus: input?.preAuthCode ? "Approved" : claim.tpa?.preAuthStatus || "Not Raised",
            shortfallTo: "writeoff",
          }
        : { claimAmount },
      {
        at: now,
        action: mode === "handover" ? "Billed to insurance at counter" : "Insurance split edited",
        detail: `Insurance ₹${claimAmount.toLocaleString("en-IN")} · patient co-pay ₹${copay.toLocaleString("en-IN")}${input?.note ? ` · ${input.note}` : ""}`,
        amount: claimAmount,
      },
      mode === "handover"
        ? {
            items,
            insuranceProvider: provider,
            policyNumber: input?.policyNumber?.trim() || claim.policyNumber || "Pending KYC",
            preAuthCode: input?.preAuthCode || claim.preAuthCode,
            status: "Ready",
          }
        : { items },
      { action: "INSURANCE_ATTACHED", amount: claimAmount },
    )
  }

  static updateInsuranceDetails(
    id: string,
    details: {
      insuranceProvider?: string
      tpaName?: string
      policyNumber?: string
      preAuthCode?: string
    },
  ): ClaimRecord {
    const claim = this.getClaimById(id)
    if (!claim) throw new Error("Claim not found")
    const now = new Date().toISOString()
    const provider = details.insuranceProvider || claim.insuranceProvider
    const policy = details.policyNumber || claim.policyNumber
    return this.tpaStep(
      id,
      {
        tpaName: details.tpaName !== undefined ? details.tpaName : claim.tpa?.tpaName,
      },
      {
        at: now,
        action: "Insurance details updated by Insurance Desk",
        detail: `${provider} · policy ${policy}`,
      },
      {
        insuranceProvider: provider,
        policyNumber: policy,
        preAuthCode: details.preAuthCode !== undefined ? details.preAuthCode : claim.preAuthCode,
      },
      { action: "INSURANCE_ATTACHED" },
    )
  }

  static requestPreAuth(id: string, amount: number, note?: string): ClaimRecord {
    return this.tpaStep(
      id,
      { preAuthStatus: "Requested", preAuthRequested: amount },
      {
        at: new Date().toISOString(),
        action: "Pre-authorisation requested",
        detail: note,
        amount,
      },
      {},
      { action: "PREAUTH_REQUESTED", amount },
    )
  }

  static approvePreAuth(
    id: string,
    sanctioned: number,
    code: string,
  ): ClaimRecord {
    return this.tpaStep(
      id,
      {
        preAuthStatus: "Approved",
        preAuthSanctioned: sanctioned,
        enhancementRequested: undefined,
      },
      {
        at: new Date().toISOString(),
        action: "Pre-authorisation approved",
        detail: code,
        amount: sanctioned,
      },
      { preAuthCode: code },
      { action: "PREAUTH_APPROVED", amount: sanctioned },
    )
  }

  /** Ask the TPA to raise the sanction because the stay has grown. */
  static requestEnhancement(
    id: string,
    amount: number,
    reason: string,
  ): ClaimRecord {
    return this.tpaStep(
      id,
      { preAuthStatus: "Enhancement Requested", enhancementRequested: amount },
      {
        at: new Date().toISOString(),
        action: "Enhancement requested",
        detail: reason,
        amount,
      },
      {},
      { action: "PREAUTH_ENHANCEMENT", amount },
    )
  }

  static recordTpaQuery(id: string, note: string): ClaimRecord {
    return this.tpaStep(
      id,
      { queryOpen: true, queryNote: note },
      { at: new Date().toISOString(), action: "TPA query raised", detail: note },
      {},
      { action: "TPA_QUERY" },
    )
  }

  static answerTpaQuery(id: string, reply: string): ClaimRecord {
    return this.tpaStep(
      id,
      { queryOpen: false },
      { at: new Date().toISOString(), action: "Query answered", detail: reply },
    )
  }

  /**
   * Final approval. Whatever the insurer does not approve is a deduction:
   * written off by the hospital by default, or -- if the insurance desk says
   * so -- recovered from the patient, which reopens their balance at billing.
   */
  static recordTpaApproval(
    id: string,
    approvedAmount: number,
    deductionReason?: string,
    shortfallTo: "writeoff" | "patient" = "writeoff",
  ): ClaimRecord {
    const claim = this.getClaimById(id)
    if (!claim) throw new Error("Claim not found")
    const covered = claim.items.reduce(
      (a, it) => a + Number(it.insuranceCovered || 0),
      0,
    )
    const deduction = Math.max(0, covered - approvedAmount)
    return this.tpaStep(
      id,
      { approvedAmount, deduction, deductionReason, shortfallTo, queryOpen: false },
      {
        at: new Date().toISOString(),
        action: "Claim approved by insurer",
        detail:
          deduction > 0
            ? `₹${deduction.toLocaleString("en-IN")} deducted (${
                shortfallTo === "patient" ? "recover from patient" : "hospital write-off"
              }) — ${deductionReason || "not payable"}`
            : "Approved in full",
        amount: approvedAmount,
      },
      { status: "Accepted", denialReason: undefined },
      { action: "TPA_APPROVED", amount: approvedAmount },
    )
  }

  static recordTpaDenial(id: string, reason: string): ClaimRecord {
    return this.tpaStep(
      id,
      { queryOpen: false },
      { at: new Date().toISOString(), action: "Claim denied", detail: reason },
      { status: "Denied", denialReason: reason },
      { action: "TPA_DENIED" },
    )
  }

  /** The insurer's money has arrived (UTR / NEFT reference). */
  static recordTpaSettlement(id: string, amount: number, ref: string): ClaimRecord {
    const claim = this.getClaimById(id)
    if (!claim) throw new Error("Claim not found")
    return this.tpaStep(
      id,
      {
        settledAmount: amount,
        settlementRef: ref,
        settledAt: new Date().toISOString(),
      },
      {
        at: new Date().toISOString(),
        action: "Insurer settlement received",
        detail: ref,
        amount,
      },
      { status: claim.balanceDue > 0 ? "Accepted" : "Paid" },
      { action: "TPA_SETTLED", amount },
    )
  }

  static recordPayment(
    invoiceId: string,

    payment: {
      amount: number

      paymentMethod: PaymentRecord["paymentMethod"]

      transactionRef?: string

      collectedBy: string

      notes?: string
    },
  ): { claim: ClaimRecord; payment: PaymentRecord } {
    const claims = this.getClaims();

    const target = (invoiceId || "").toLowerCase().trim();
    const norm = (v?: string) => (v || "").toLowerCase().trim()

    // Exact identity first. The old loose match (id.includes / endsWith) found
    // the *first* bill whose id merely contained the target -- paying SRV-1
    // could credit SRV-12. A partial match is accepted only when exactly one
    // bill fits, so a payment can never land on another patient's bill.
    let idx = claims.findIndex((c) => {
      const cId = norm(c.id)
      const cInv = norm(c.invoiceNo)
      const cEnc = norm(c.encounterId)
      return (
        cId === target ||
        cInv === target ||
        (!!cEnc && cEnc === target) ||
        (!!cEnc && `clm-${cEnc}` === target) ||
        `inv-${cInv}` === target
      )
    })
    if (idx < 0 && target.length > 3) {
      const loose = claims
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => {
          const cId = norm(c.id)
          const cInv = norm(c.invoiceNo)
          return cId.endsWith(target) || target.endsWith(cId) || cId.includes(target) || cInv.includes(target)
        })
      if (loose.length === 1) idx = loose[0].i
    }

    if (idx < 0) throw new Error("Invoice not found")

    const claim = claims[idx]

    if (claim.runningAdmissionId) {
      throw new Error(
        "This is a running bill -- the patient is still admitted. The final IP bill is raised when the bed is released at discharge; collect payment on that bill.",
      )
    }

    const newAmountPaid = (claim.amountPaid || 0) + payment.amount

    const newBalanceDue = Math.max(0, claim.patientPortion - newAmountPaid)

    const rcptNum =
      5500 +
      (claim.payments?.length || 0) +
      Math.floor(100 + Math.random() * 899)

    const newPayment: PaymentRecord = {
      id: `PAY-${Date.now()}`,

      invoiceId: claim.id,

      receiptNo: `RCPT-2026-${rcptNum}`,

      amount: payment.amount,

      paymentDate: new Date().toISOString(),

      paymentMethod: payment.paymentMethod,

      transactionRef:
        payment.transactionRef || `TXN-${Date.now().toString().slice(-6)}`,

      collectedBy: payment.collectedBy,

      notes: payment.notes,
    }

    const updatedPayments = [...(claim.payments || []), newPayment]

    let newStatus = claim.status

    if (newBalanceDue === 0) {
      // A bill handed to insurance is only "Paid" once the insurer has
      // settled too -- a patient paying their co-pay must not make the
      // Claims Desk read the claim as settled.
      const awaitingInsurer = !!claim.tpa?.billedAt && !claim.tpa?.settledAt
      if (
        claim.insuranceProvider === "Self-Pay" ||
        (claim.status === "Accepted" && !awaitingInsurer) ||
        claim.insurancePortion === 0
      ) {
        newStatus = "Paid"
      }
    }

    const updatedClaim: ClaimRecord = {
      ...claim,

      amountPaid: newAmountPaid,

      balanceDue: newBalanceDue,

      status: newStatus,

      payments: updatedPayments,

      updatedAt: new Date().toISOString(),
    }

    claims[idx] = updatedClaim

    if (newBalanceDue === 0) {
      claims.forEach((c, cIdx) => {
        if (cIdx !== idx) {
          const matchesThisEnc =
            (c.encounterId && updatedClaim.encounterId && (
              norm(c.encounterId) === norm(updatedClaim.encounterId) ||
              cleanEnc(c.encounterId) === cleanEnc(updatedClaim.encounterId)
            )) ||
            (c.invoiceNo && updatedClaim.invoiceNo && norm(c.invoiceNo) === norm(updatedClaim.invoiceNo)) ||
            (normalizeUmr(c.patientId) && normalizeUmr(updatedClaim.patientId) && normalizeUmr(c.patientId) === normalizeUmr(updatedClaim.patientId) && c.dateOfService === updatedClaim.dateOfService && c.department === updatedClaim.department)

          if (matchesThisEnc) {
            claims[cIdx] = {
              ...c,
              amountPaid: c.totalAmount,
              balanceDue: 0,
              status: newStatus,
              payments: updatedPayments,
              updatedAt: new Date().toISOString(),
            }
          }
        }
      })
    }

    if (claim.serverInvoiceId) {
      // A server bill: show the payment now, make it real on the server (so
      // every desk sees it), then re-sync. If the server refuses, the next
      // sync puts the bill back as it really is and the counter is told.
      applyServerPaymentLocally(updatedClaim)
      this.dispatchUpdate()
      void postServerPayment(claim.serverInvoiceId, payment).then((res) => {
        if (!res.ok && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(BILLING_PAYMENT_FAILED_EVENT, {
              detail: { invoiceNo: claim.invoiceNo, error: res.error },
            }),
          )
        }
        this.dispatchUpdate()
      })
    } else {
      this.save(STORAGE_KEY_CLAIMS, claims)
      this.dispatchUpdate()
    }

    // Sync underlying OP encounter in db.ts
    if (updatedClaim.encounterId || updatedClaim.patientId) {
      try {
        const enc = db.getEncounters().find(
          (e) =>
            e.id === updatedClaim.encounterId ||
            (e.id && updatedClaim.encounterId && e.id.toLowerCase() === updatedClaim.encounterId.toLowerCase()) ||
            (e.opNumber && updatedClaim.encounterId && e.opNumber.toLowerCase() === updatedClaim.encounterId.toLowerCase()) ||
            (cleanEnc(e.id) && cleanEnc(updatedClaim.encounterId) && cleanEnc(e.id) === cleanEnc(updatedClaim.encounterId)) ||
            (cleanEnc(e.opNumber) && cleanEnc(updatedClaim.encounterId) && cleanEnc(e.opNumber) === cleanEnc(updatedClaim.encounterId)) ||
            (normalizeUmr(e.umr) && normalizeUmr(updatedClaim.patientId) && normalizeUmr(e.umr) === normalizeUmr(updatedClaim.patientId))
        ) || (updatedClaim.encounterId ? db.getEncounterById(updatedClaim.encounterId) : undefined);
        if (enc) {
          db.updateEncounter(enc.id, {
            billing: {
              ...enc.billing,
              status: newBalanceDue === 0 ? "Paid" : "Pending",
              mode: payment.paymentMethod,
            },
            status:
              newBalanceDue === 0
                ? "Billing Completed"
                : enc.status === "Doctor Assigned" || enc.status === "Registered"
                  ? "In Queue"
                  : enc.status,
          });
        }
      } catch {}
    }

    // Atomic Synchronization: When claim is fully settled (newBalanceDue === 0),
    // clear both Laboratory orders and Radiology studies immediately.
    if (newBalanceDue === 0) {
      const nowIso = new Date().toISOString()
      const receiptNo = newPayment.receiptNo

      // 1. Sync Laboratory Orders (hospai_lab_orders_v2)
      try {
        if (typeof window !== "undefined") {
          const rawOrders = window.localStorage.getItem("hospai_lab_orders_v2")
          if (rawOrders) {
            const parsed = JSON.parse(rawOrders)
            let labChanged = false
            const updatedLab = parsed.map((o: any) => {
              const matchEnc = (o.encounterId && updatedClaim.encounterId && (
                o.encounterId.toLowerCase() === updatedClaim.encounterId.toLowerCase() ||
                cleanEnc(o.encounterId) === cleanEnc(updatedClaim.encounterId) ||
                (o.opNumber && cleanEnc(o.opNumber) === cleanEnc(updatedClaim.encounterId))
              )) || (o.opNumber && updatedClaim.encounterId && (
                o.opNumber.toLowerCase() === updatedClaim.encounterId.toLowerCase() ||
                cleanEnc(o.opNumber) === cleanEnc(updatedClaim.encounterId)
              ))
              const matchInv = o.billing?.invoiceNo && (
                (claim.invoiceNo && o.billing.invoiceNo.toLowerCase() === claim.invoiceNo.toLowerCase()) ||
                o.billing.invoiceNo.toLowerCase() === (claim.id || "").toLowerCase()
              )
              const matchUmr = normalizeUmr(o.umr) && (
                (claim.patientId && normalizeUmr(o.umr) === normalizeUmr(claim.patientId)) ||
                (claim.mrn && normalizeUmr(o.umr) === normalizeUmr(claim.mrn))
              )
              if (matchEnc || matchInv || (matchUmr && o.billing?.status !== "Paid")) {
                labChanged = true
                return {
                  ...o,
                  status: o.status === "Awaiting Billing" ? "Billed" : o.status,
                  billing: {
                    ...(o.billing || {}),
                    status: "Paid",
                    paidAt: newPayment.paymentDate || nowIso,
                    receiptNo,
                    mode: payment.paymentMethod,
                  },
                  tests: (o.tests || []).map((t: any) => ({
                    ...t,
                    status: t.status === "Ordered" ? "Pending" : t.status,
                  })),
                  history: [
                    ...(o.history || []),
                    {
                      at: nowIso,
                      actor: "Central Billing Cashier",
                      action: "Payment Confirmed & Cleared",
                      detail: `Payment settled via ${payment.paymentMethod}. Official Receipt: ${receiptNo}. Ready for sample collection.`,
                    },
                  ],
                }
              }
              return o
            })
            if (labChanged) {
              window.localStorage.setItem("hospai_lab_orders_v2", JSON.stringify(updatedLab))
              try {
                new BroadcastChannel("hospai_lab_orders").postMessage("changed")
              } catch {}
            }
          }
        }
      } catch (err) {
        console.warn("Laboratory payment sync error:", err)
      }

      // 2. Sync Radiology Studies (STORAGE_KEY_RAD_STUDIES)
      try {
        const radStudies = this.load<RadiologyStudyRecord[]>(STORAGE_KEY_RAD_STUDIES, [])
        let radChanged = false
        radStudies.forEach((rs: any) => {
          const matchInv = rs.invoiceNo && (
            (claim.invoiceNo && rs.invoiceNo.toLowerCase() === claim.invoiceNo.toLowerCase()) ||
            rs.invoiceNo.toLowerCase() === (claim.id || "").toLowerCase()
          )
          const matchEnc = (rs.encounterId && updatedClaim.encounterId && (
            rs.encounterId.toLowerCase() === updatedClaim.encounterId.toLowerCase() ||
            (rs.opNumber && rs.opNumber.toLowerCase() === updatedClaim.encounterId.toLowerCase())
          )) || (rs.opNumber && updatedClaim.encounterId && rs.opNumber.toLowerCase() === updatedClaim.encounterId.toLowerCase())
          const matchUmr = normalizeUmr(rs.umr || rs.mrn) && (
            normalizeUmr(rs.umr || rs.mrn) === normalizeUmr(claim.patientId) ||
            normalizeUmr(rs.umr || rs.mrn) === normalizeUmr(claim.mrn)
          )
          const matchStudyInClaim = (claim.items || []).some(
            (it) => it.id === `ITEM-RAD-${rs.id}` ||
              (((it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology") &&
                (it.description.toLowerCase().includes((rs.study || "").toLowerCase()) ||
                 (rs.study && it.description.toLowerCase().includes(rs.study.toLowerCase()))))
          )

          if ((matchEnc || matchInv || matchStudyInClaim || (matchUmr && rs.paymentStatus !== "Paid")) && rs.paymentStatus !== "Paid") {
            rs.paymentStatus = "Paid"
            rs.paymentStatusDisplay = "PAID"
            rs.isPaid = true
            rs.paidReceiptNo = rs.paidReceiptNo || receiptNo
            rs.paidAt = rs.paidAt || newPayment.paymentDate || nowIso
            rs.billingClearedAt = rs.billingClearedAt || newPayment.paymentDate || nowIso
            rs.eligibleAt = rs.eligibleAt || newPayment.paymentDate || nowIso
            rs.billingStatus = "Cleared / Paid"
            rs.normalizedStatus = rs.status === "Orders" ? "ORDERED" : rs.normalizedStatus || "ORDERED"
            rs.history = [
              ...(rs.history || []),
              {
                timestamp: nowIso,
                action: "Payment Confirmed (Central Cashier)",
                actor: "Central Billing Cashier",
                details: `Payment settled via ${payment.paymentMethod}. Official Receipt: ${receiptNo}. Cleared for scanning.`,
              },
            ]
            radChanged = true
          }
        })
        if (radChanged) {
          this.save(STORAGE_KEY_RAD_STUDIES, radStudies)
          this.invalidateRadiologyStudiesCache()
          try {
            new BroadcastChannel("hospai_rad_channel").postMessage("changed")
          } catch {}
        }
      } catch (err) {
        console.warn("Radiology payment sync error:", err)
      }
    }

    BillingRbacManager.logEvent({
      action: "PAYMENT_RECORDED",

      patientId: claim.patientId,

      patientName: claim.patientName,

      mrn: claim.mrn,

      invoiceNo: claim.invoiceNo,

      claimId: claim.id,

      financialAmount: newPayment.amount,

      department: claim.department,

      reason: `Payment receipt ${newPayment.receiptNo} of ₹${newPayment.amount.toLocaleString("en-IN")} collected via ${newPayment.paymentMethod} (Ref: ${newPayment.transactionRef}). Remaining due: ₹${newBalanceDue.toLocaleString("en-IN")}.`,
    })

    const numericInvId = parseInt((claim.invoiceNo || invoiceId).replace(/\D/g, "")) || 1
    apiFetch(`/api/billing/invoices/${numericInvId}/payments`, {
      method: "POST",
      body: JSON.stringify({
        amount: payment.amount,
        payment_mode: payment.paymentMethod ? payment.paymentMethod.toLowerCase() : "cash",
        gateway_ref: payment.transactionRef || newPayment.transactionRef,
      }),
    }).catch(() => {})

    // Automatically dispatch financial clearance to Radiology & Laboratory ONLY when fully settled (newBalanceDue === 0)
    try {
      if (newBalanceDue === 0) {
        const hasRad = claim.department === "Radiology" || (claim.items || []).some((it) => it.category === "Radiology / Imaging" || it.category === "Radiology")
        const hasLab = claim.department === "Laboratory" || (claim.items || []).some((it) => it.category === "Laboratory" || it.category === "Lab")

        if (hasRad) {
          this.dispatchClearanceToDepartment(
            claim.patientName || claim.patientId,
            "Radiology",
            newPayment.receiptNo,
          )
        }
        if (hasLab) {
          this.dispatchClearanceToDepartment(
            claim.patientName || claim.patientId,
            "Laboratory",
            newPayment.receiptNo,
          )
        }
      }
      // Also invalidate radiology workflow in-memory cache so payment reflects instantly
      if (typeof window !== "undefined") {
        try {
          new BroadcastChannel("hospai_rad_channel").postMessage("changed")
        } catch {}
      }
    } catch (err) {
      console.warn("Radiology/Lab clearance dispatch error:", err)
    }

    return { claim: updatedClaim, payment: newPayment }
  }

  // ── MANUAL DEPARTMENT FINANCIAL CLEARANCE DISPATCH ─────────────────────────

  static dispatchClearanceToDepartment(
    patientIdOrName: string,
    department: "Laboratory" | "Radiology",
    receiptNo?: string,
    optionalTestName?: string,
  ): { success: boolean; updatedCount: number; message: string } {
    const targetName = (patientIdOrName || "").toLowerCase().trim();
    const targetMrn = targetName.replace("umr", "").replace("p-", "").trim();
    const nowIso = new Date().toISOString();

    let updatedCount = 0;

    // Resolve matching claim to get canonical details
    const matchingClaim = this.getClaims().find((c) => {
      const cName = (c.patientName || "").toLowerCase().trim();
      const cMrn = (c.mrn || c.patientId || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
      const cEnc = (c.encounterId || "").toLowerCase().trim();
      return (
        cName === targetName ||
        (targetName.length > 4 && (cName.includes(targetName) || targetName.includes(cName))) ||
        (targetMrn && cMrn === targetMrn) ||
        (targetName && cEnc === targetName)
      );
    });

    const resolvedMrn = matchingClaim?.mrn || matchingClaim?.patientId || targetMrn || "100999";
    const resolvedPatientName = matchingClaim?.patientName || patientIdOrName;
    const resolvedEncounterId = matchingClaim?.encounterId;
    const effectiveReceiptNo =
      receiptNo ||
      matchingClaim?.payments?.[matchingClaim.payments.length - 1]?.receiptNo ||
      `RCPT-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    if (department === "Laboratory") {
      const labOrders = this.getLabOrders();
      let labChanged = false;

      const updatedLabOrders = labOrders.map((lo) => {
        const loName = (lo.patient || "").toLowerCase().trim();
        const loMrn = (lo.mrn || lo.umr || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
        const loEnc = ((lo as any).encounterId || "").toLowerCase().trim();
        const loInv = (lo.invoiceNo || "").toLowerCase().trim();

        const matchName = targetName && (loName === targetName || (targetName.length > 4 && (loName.includes(targetName) || targetName.includes(loName))));
        const matchMrn = targetMrn && loMrn && (loMrn === targetMrn || loMrn.includes(targetMrn) || targetMrn.includes(loMrn));
        const matchEnc = resolvedEncounterId && loEnc && loEnc === resolvedEncounterId.toLowerCase();
        const matchInv = matchingClaim?.invoiceNo && loInv && loInv === matchingClaim.invoiceNo.toLowerCase();

        if (matchName || matchMrn || matchEnc || matchInv) {
          labChanged = true;
          updatedCount += 1;
          return {
            ...lo,
            paymentStatus: "Paid" as const,
            paidReceiptNo: effectiveReceiptNo,
            paidAt: nowIso,
          };
        }
        return lo;
      });

      // Also sync to LabOrderDatabase (hospai_lab_orders_v2)
      try {
        if (typeof window !== "undefined") {
          const rawOrders = window.localStorage.getItem("hospai_lab_orders_v2");
          if (rawOrders) {
            const parsed = JSON.parse(rawOrders);
            let hasOrderChanged = false;
            const updated = parsed.map((o: any) => {
              const oName = (o.patientName || "").toLowerCase().trim();
              const oUmr = (o.umr || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
              const oEnc = (o.encounterId || "").toLowerCase().trim();
              const matchName = targetName && (oName === targetName || (targetName.length > 4 && (oName.includes(targetName) || targetName.includes(oName))));
              const matchMrn = targetMrn && oUmr && (oUmr === targetMrn || oUmr.includes(targetMrn) || targetMrn.includes(oUmr));
              const matchEnc = resolvedEncounterId && oEnc && oEnc === resolvedEncounterId.toLowerCase();

              if (matchName || matchMrn || matchEnc) {
                hasOrderChanged = true;
                updatedCount = Math.max(updatedCount, (o.tests || []).length || 1);
                return {
                  ...o,
                  status: o.status === "Awaiting Billing" ? "Billed" : o.status,
                  billing: {
                    ...(o.billing || {}),
                    status: "Paid",
                    paidAt: nowIso,
                    receiptNo: effectiveReceiptNo,
                  },
                  tests: (o.tests || []).map((t: any) => ({
                    ...t,
                    status: t.status === "Ordered" ? "Pending" : t.status,
                  })),
                  history: [
                    ...(o.history || []),
                    {
                      at: nowIso,
                      actor: "Central Billing Cashier",
                      action: "Payment Verified & Dispatched",
                      detail: `Financially cleared and released to Laboratory worklist. Receipt: ${effectiveReceiptNo}.`,
                    },
                  ],
                };
              }
              return o;
            });
            if (hasOrderChanged) {
              window.localStorage.setItem("hospai_lab_orders_v2", JSON.stringify(updated));
              try {
                new BroadcastChannel("hospai_lab_orders").postMessage("changed");
              } catch {}
            }
          }
        }
      } catch (e) {
        console.warn("Could not sync to LabOrderDatabase:", e);
      }

      if (labChanged) {
        this.save(STORAGE_KEY_LAB_ORDERS, updatedLabOrders);
        this.emitUpdate();
        return {
          success: true,
          updatedCount: Math.max(1, updatedCount),
          message: `✓ Clearance dispatched to Laboratory for ${Math.max(1, updatedCount)} test(s). Receipt: ${effectiveReceiptNo}.`,
        };
      } else {
        // Find matching claim to see if there were lab items
        const labItems = matchingClaim
          ? matchingClaim.items.filter(
              (i) =>
                i.category === "Laboratory" ||
                (i.category as string) === "Lab" ||
                (i.category as string) === "Investigation" ||
                /(cbc|hemogram|blood|glucose|sugar|urine|creatinine|urea|electrolyte|kft|rft|lft|bilirubin|serology|culture|pathology|troponin|ecg|ekg|lipid|biochemistry|hematology|diagnostic:|investigation:|stool|wbc|platelet|d-dimer|dimer|abg|vbg|lactate|procalcitonin|thyroid|tsh|crp|esr|ferritin|hba1c|inr|coagulation|amylase|lipase|smear|widal|swab|profile|bmp|cmp)/i.test(
                  i.description,
                ),
            )
          : [];

        if (labItems.length === 0) {
          // Do not inject phantom lab orders when patient has no laboratory tests ordered
          this.emitUpdate();
          return {
            success: true,
            updatedCount: 0,
            message: "No laboratory investigations pending clearance.",
          };
        }

        const testName =
          optionalTestName ||
          (labItems.length > 0
            ? labItems.map((i) => i.description).join(", ")
            : "Laboratory Diagnostic Panel");

        const totalLabPrice = labItems.reduce((s, i) => s + (i.total || i.unitPrice || 0), 0) || 150;

        const newLabOrder: LabOrderRecord = {
          id: `LAB-${Date.now().toString().slice(-4)}`,
          patient: resolvedPatientName,
          mrn: resolvedMrn,
          umr: matchingClaim?.patientId || resolvedMrn,
          invoiceNo: matchingClaim?.invoiceNo,
          encounterId: resolvedEncounterId,
          test: testName,
          category: "Clinical Laboratory",
          priority: matchingClaim?.department === "Emergency" ? "STAT" : "Routine",
          sampleType: "Blood / Plasma Specimen",
          accessionNo: `ACC-2026-${(matchingClaim?.invoiceNo || "").replace(/\D/g, "").slice(-4) || Math.floor(1000 + Math.random() * 9000)}`,
          collected: "—",
          status: "Pending",
          provider: matchingClaim?.attendingDoctor || "Attending Specialist",
          price: totalLabPrice,
          paymentStatus: "Paid",
          paidReceiptNo: effectiveReceiptNo,
          paidAt: nowIso,
          department: matchingClaim?.department || "Central Clinic",
        };

        const newLabOrders = [newLabOrder, ...labOrders];
        this.save(STORAGE_KEY_LAB_ORDERS, newLabOrders);

        // Also add to hospai_lab_orders_v2 so it shows in Lab Worklist
        try {
          if (typeof window !== "undefined") {
            const rawOrders = window.localStorage.getItem("hospai_lab_orders_v2");
            const parsed = rawOrders ? JSON.parse(rawOrders) : [];
            const newOrderObj = {
              id: `ORD-${Date.now().toString().slice(-5)}`,
              encounterId: resolvedEncounterId || `ENC-${Date.now().toString().slice(-4)}`,
              umr: resolvedMrn,
              patientName: resolvedPatientName,
              age: matchingClaim?.age || 35,
              sex: matchingClaim?.gender || "Male",
              phone: matchingClaim?.phone || "+91 98765 43210",
              opNumber: resolvedEncounterId || "OP-100",
              doctorId: "DOC-1",
              doctorName: matchingClaim?.attendingDoctor || "Attending Specialist",
              department: matchingClaim?.department || "Central Clinic",
              diagnosis: "Clinical Diagnostics Investigation",
              tests: [
                {
                  id: `LT-1`,
                  name: testName,
                  category: "Pathology",
                  urgency: "Routine",
                  price: totalLabPrice,
                  status: "Pending",
                },
              ],
              status: "Billed",
              createdAt: nowIso,
              updatedAt: nowIso,
              billing: {
                status: "Paid",
                invoiceNo: matchingClaim?.invoiceNo || `INV-${Date.now().toString().slice(-4)}`,
                subtotal: totalLabPrice,
                discount: 0,
                total: totalLabPrice,
                paidAt: nowIso,
                receiptNo: effectiveReceiptNo,
              },
              history: [
                {
                  at: nowIso,
                  actor: "Central Billing Cashier",
                  action: "Payment Verified & Dispatched",
                  detail: `Financially cleared and released to Laboratory worklist.`,
                },
              ],
            };
            window.localStorage.setItem("hospai_lab_orders_v2", JSON.stringify([newOrderObj, ...parsed]));
            try {
              new BroadcastChannel("hospai_lab_orders").postMessage("changed");
            } catch {}
          }
        } catch (e) {
          console.warn("Could not insert to hospai_lab_orders_v2:", e);
        }

        this.emitUpdate();
        return {
          success: true,
          updatedCount: 1,
          message: `✓ Clearance dispatched to Laboratory for ${testName}. Receipt: ${effectiveReceiptNo}.`,
        };
      }
    } else if (department === "Radiology") {
      const radStudies = this.getRadiologyStudies();
      let radChanged = false;

      const radItems = matchingClaim
        ? matchingClaim.items.filter(
            (i) =>
              i.category === "Radiology / Imaging" ||
              (i.category as string) === "Radiology" ||
              (i.category as string) === "Imaging" ||
              /(x-ray|xray|radiograph|\bct\b|ct\s|ct-|ct scan|computed tomography|hrct|\bmri\b|mr\s|magnetic resonance|ultrasound|usg|sonograph|doppler|echo|echocardiography|mammograph|dexa|fluoroscop|pet scan)/i.test(
                i.description,
              ),
          )
        : [];

      // Only match by exact invoice number, encounter ID, or specific study name if this claim has radiology items
      const updatedRadStudies = radStudies.map((rs) => {
        const rsInv = (rs.invoiceNo || "").toLowerCase().trim();
        const matchInv = matchingClaim?.invoiceNo && rsInv && rsInv === matchingClaim.invoiceNo.toLowerCase();

        const rsEnc = ((rs as any).encounterId || "").toLowerCase().trim();
        const matchEnc = resolvedEncounterId && rsEnc && rsEnc === resolvedEncounterId.toLowerCase();

        // Also check if study name matches any item in the cleared invoice for this patient
        const rsUmr = (rs.umr || rs.mrn || "").toLowerCase().trim();
        const targetUmrClean = targetMrn ? targetMrn.toLowerCase().trim() : "";
        const umrMatches = targetUmrClean && rsUmr && (rsUmr === targetUmrClean || rsUmr.includes(targetUmrClean));

        const itemMatches = umrMatches && radItems.some((item) =>
          rs.study && (
            rs.study.toLowerCase() === item.description.toLowerCase() ||
            rs.study.toLowerCase().includes(item.description.toLowerCase()) ||
            item.description.toLowerCase().includes(rs.study.toLowerCase())
          )
        );

        if (matchInv || matchEnc || itemMatches) {
          radChanged = true;
          updatedCount += 1;
          return {
            ...rs,
            invoiceNo: rs.invoiceNo || matchingClaim?.invoiceNo,
            paymentStatus: "Paid" as const,
            paymentStatusDisplay: "PAID" as const,
            isPaid: true,
            paidReceiptNo: effectiveReceiptNo,
            paidAt: nowIso,
            billingClearedAt: nowIso,
            eligibleAt: nowIso,
            billingStatus: "Cleared / Paid",
            normalizedStatus: "ORDERED" as const,
          };
        }
        return rs;
      });

      if (radChanged) {
        this.save(STORAGE_KEY_RAD_STUDIES, updatedRadStudies);
        try {
          new BroadcastChannel("hospai_rad_channel").postMessage("changed");
        } catch {}
        this.emitUpdate();
        return {
          success: true,
          updatedCount,
          message: `✓ Clearance dispatched to Radiology for ${updatedCount} study(ies). Receipt: ${effectiveReceiptNo}.`,
        };
      } else if (radItems.length > 0 || optionalTestName) {
        // Only create a record if actual radiology items were in this claim
        const itemsToCreate = radItems.length > 0 ? radItems : [{ description: optionalTestName || "Radiology Examination", total: 500, unitPrice: 500 }];
        const newStudies: RadiologyStudyRecord[] = [];

        for (const item of itemsToCreate) {
          const studyName = item.description;
          const lowerName = studyName.toLowerCase();
          const modality = /\b(ct|computed tomography)\b/i.test(lowerName)
            ? "CT"
            : lowerName.includes("mri") || lowerName.includes("magnetic")
              ? "MR"
              : lowerName.includes("ultra") || lowerName.includes("echo") || lowerName.includes("usg") || lowerName.includes("doppler")
                ? "US"
                : lowerName.includes("pet") || lowerName.includes("nuclear")
                  ? "NM"
                  : "XR";

          const nowIso = new Date().toISOString();
          const todayDateStr = nowIso.split("T")[0];
          const nowTimeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          const newRadStudy: RadiologyStudyRecord = {
            id: `RAD-${Date.now().toString().slice(-4)}-${Math.floor(10 + Math.random() * 90)}`,
            patient: resolvedPatientName,
            mrn: resolvedMrn,
            umr: matchingClaim?.patientId || resolvedMrn,
            invoiceNo: matchingClaim?.invoiceNo,
            encounterId: resolvedEncounterId,
            study: studyName,
            modality: modality as any,
            priority: matchingClaim?.department === "Emergency" ? "STAT" : "Routine",
            createdAt: nowIso,
            orderedAt: nowIso,
            orderDate: todayDateStr,
            ordered: `${todayDateStr} · ${nowTimeStr}`,
            provider: matchingClaim?.attendingDoctor || "Attending Specialist",
            status: "Orders",
            room: modality === "CT" ? "CT-1" : modality === "MR" ? "MR-1" : modality === "US" ? "US-1" : "XR-1",
            price: item.total || item.unitPrice || 500,
            paymentStatus: "Paid",
            paidReceiptNo: effectiveReceiptNo,
            paidAt: nowIso,
            accessionNo: `RAD-ACC-${(matchingClaim?.invoiceNo || "").replace(/\D/g, "").slice(-4) || Math.floor(1000 + Math.random() * 9000)}`,
            department: matchingClaim?.department || "Central Clinic",
          };
          newStudies.push(newRadStudy);
        }

        const newRadStudies = [...newStudies, ...radStudies];
        this.save(STORAGE_KEY_RAD_STUDIES, newRadStudies);
        try {
          new BroadcastChannel("hospai_rad_channel").postMessage("changed");
        } catch {}
        this.emitUpdate();
        return {
          success: true,
          updatedCount: newStudies.length,
          message: `✓ Clearance dispatched to Radiology for ${newStudies.map(s => s.study).join(", ")}. Receipt: ${effectiveReceiptNo}.`,
        };
      } else {
        return {
          success: true,
          updatedCount: 0,
          message: "No radiology examination items found in cleared claim.",
        };
      }
    }

    return {
      success: false,
      updatedCount: 0,
      message: `No pending ${department} orders found for this patient.`,
    }
  }


  static getDepartmentClearanceStatus(
    patientIdOrName: string,

    claimContext?: ClaimRecord | null,
  ): {
    hasLabOrders: boolean

    labPaidCount: number

    labPendingCount: number

    labTestNames: string[]

    hasRadStudies: boolean

    radPaidCount: number

    radPendingCount: number

    radStudyNames: string[]

    isNonDiagnostic: boolean
  } {
    // For Outpatient visits prior to doctor consultation (no prescribed investigations in encounter),
    // diagnostic clearance is NOT applicable because no lab/radiology tests have been prescribed yet.
    if (claimContext && claimContext.department === "Outpatient") {
      let encInvestigations: string[] = [];
      if (claimContext.encounterId) {
        try {
          const enc = db.getEncounterById(claimContext.encounterId);
          if (enc && enc.investigations) {
            encInvestigations = enc.investigations;
          }
        } catch {}
      }
      const hasExplicitLabItemInClaim = (claimContext.items || []).some(
        (i) => i.category === "Laboratory" && i.unitPrice > 0,
      );
      const hasExplicitRadItemInClaim = (claimContext.items || []).some(
        (i) =>
          ((i.category as any) === "Radiology / Imaging" ||
            (i.category as any) === "Radiology") &&
          i.unitPrice > 0,
      );

      if (
        encInvestigations.length === 0 &&
        !hasExplicitLabItemInClaim &&
        !hasExplicitRadItemInClaim
      ) {
        return {
          hasLabOrders: false,
          labPaidCount: 0,
          labPendingCount: 0,
          labTestNames: [],
          hasRadStudies: false,
          radPaidCount: 0,
          radPendingCount: 0,
          radStudyNames: [],
          isNonDiagnostic: true,
        };
      }
    }

    const targetName = (claimContext?.patientName || patientIdOrName || "").toLowerCase().trim();
    const targetMrn = (claimContext?.mrn || claimContext?.patientId || targetName).toLowerCase().replace("umr", "").replace("p-", "").trim();
    const targetEncounter = (claimContext?.encounterId || "").toLowerCase().trim();
    const targetInvoice = (claimContext?.invoiceNo || "").toLowerCase().trim();

    const LAB_REGEX =
      /(cbc|hemogram|blood|glucose|sugar|urine|creatinine|urea|electrolyte|kft|rft|lft|bilirubin|serology|culture|pathology|troponin|ecg|ekg|lipid|biochemistry|hematology|diagnostic:|investigation:|stool|wbc|platelet|d-dimer|dimer|abg|vbg|lactate|procalcitonin|thyroid|tsh|crp|esr|ferritin|hba1c|inr|coagulation|amylase|lipase|smear|widal|swab|profile|bmp|cmp)/i;

    const RAD_REGEX =
      /(x-ray|xray|radiograph|\bct\b|ct\s|ct-|ct scan|computed tomography|hrct|\bmri\b|mr\s|magnetic resonance|ultrasound|usg|sonograph|doppler|echo|echocardiography|mammograph|dexa|fluoroscop|pet scan)/i;

    const labOrders = this.getLabOrders().filter((lo) => {
      const loName = (lo.patient || "").toLowerCase().trim();
      const loMrn = (lo.mrn || lo.umr || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
      const loInv = (lo.invoiceNo || "").toLowerCase().trim();
      const loEnc = ((lo as any).encounterId || "").toLowerCase().trim();

      const matchName = targetName && (loName === targetName || (targetName.length > 5 && loName === targetName));
      const matchMrn = targetMrn && loMrn && loMrn === targetMrn;
      const matchInv = targetInvoice && loInv && loInv === targetInvoice;
      const matchEnc = targetEncounter && loEnc && loEnc === targetEncounter;

      return Boolean(matchMrn || matchEnc || (matchInv && matchName));
    });

    const radStudies = this.getRadiologyStudies().filter((rs) => {
      const rsName = (rs.patient || "").toLowerCase().trim();
      const rsMrn = (rs.mrn || rs.umr || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
      const rsInv = (rs.invoiceNo || "").toLowerCase().trim();
      const rsEnc = ((rs as any).encounterId || "").toLowerCase().trim();

      const matchName = targetName && (rsName === targetName || (targetName.length > 4 && (rsName.includes(targetName) || targetName.includes(rsName))));
      const matchMrn = targetMrn && rsMrn && (rsMrn === targetMrn || rsMrn.includes(targetMrn) || targetMrn.includes(rsMrn));
      const matchInv = targetInvoice && rsInv && rsInv === targetInvoice;
      const matchEnc = targetEncounter && rsEnc && rsEnc === targetEncounter;

      return Boolean(matchName || matchMrn || matchInv || matchEnc);
    });

    // Also check LabOrderDatabase (hospai_lab_orders_v2)
    const extraLabTestNames: string[] = [];
    try {
      if (typeof window !== "undefined") {
        const rawOrders = window.localStorage.getItem("hospai_lab_orders_v2");
        if (rawOrders) {
          const parsed = JSON.parse(rawOrders);
          parsed.forEach((o: any) => {
            const oName = (o.patientName || "").toLowerCase().trim();
            const oUmr = (o.umr || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
            const oEnc = (o.encounterId || "").toLowerCase().trim();
            const matchName = targetName && (oName === targetName || (targetName.length > 4 && (oName.includes(targetName) || targetName.includes(oName))));
            const matchMrn = targetMrn && oUmr && (oUmr === targetMrn || oUmr.includes(targetMrn) || targetMrn.includes(oUmr));
            const matchEnc = targetEncounter && oEnc && oEnc === targetEncounter;
            if (matchName || matchMrn || matchEnc) {
              (o.tests || []).forEach((t: any) => {
                if (t.name && !extraLabTestNames.includes(t.name)) {
                  extraLabTestNames.push(t.name);
                }
              });
            }
          });
        }
      }
    } catch {}

    // Check if claim items contain lab/radiology
    let claimLabItems: InvoiceItem[] = [];
    let claimRadItems: InvoiceItem[] = [];

    if (claimContext && claimContext.items) {
      claimContext.items.forEach((i) => {
        const desc = i.description || "";
        const cat = (i.category || "") as string;
        if (
          cat === "Radiology / Imaging" ||
          cat === "Radiology" ||
          cat === "Imaging" ||
          claimContext.department === "Radiology" ||
          RAD_REGEX.test(desc)
        ) {
          claimRadItems.push(i);
        } else if (
          cat === "Laboratory" ||
          cat === "Lab" ||
          cat === "Pathology" ||
          cat === "Biochemistry" ||
          cat === "Hematology" ||
          cat === "Microbiology" ||
          claimContext.department === "Laboratory" ||
          LAB_REGEX.test(desc) ||
          cat === "Investigation"
        ) {
          claimLabItems.push(i);
        }
      });
    }

    // Also check department charges for this patient
    try {
      const deptCharges = this.getDepartmentCharges().filter((d) => {
        const dName = (d.patientName || "").toLowerCase().trim();
        const dMrn = (d.mrn || d.patientId || "").toLowerCase().replace("umr", "").replace("p-", "").trim();
        const dEnc = (d.encounterId || "").toLowerCase().trim();
        return (
          (targetEncounter && dEnc === targetEncounter) ||
          (targetMrn && dMrn === targetMrn) ||
          (targetName && dName === targetName)
        );
      });

      deptCharges.forEach((dept) => {
        (dept.items || []).forEach((it) => {
          const desc = it.description || "";
          const cat = (it.category || "") as string;
          if (
            cat === "Radiology / Imaging" ||
            cat === "Radiology" ||
            cat === "Imaging" ||
            RAD_REGEX.test(desc)
          ) {
            if (!claimRadItems.some((x) => x.description === desc)) {
              claimRadItems.push(it);
            }
          } else if (
            cat === "Laboratory" ||
            cat === "Lab" ||
            cat === "Pathology" ||
            cat === "Biochemistry" ||
            cat === "Hematology" ||
            cat === "Microbiology" ||
            LAB_REGEX.test(desc) ||
            cat === "Investigation"
          ) {
            if (!claimLabItems.some((x) => x.description === desc)) {
              claimLabItems.push(it);
            }
          }
        });
      });
    } catch {}

    // Check ErVisit investigations if applicable (read-only)
    try {
      const allVisits = ErDatabase.getVisits("all");
      const vMatch = allVisits.find((v) => {
        const vNo = (v.visit_no || "").toLowerCase().trim();
        const vId = String(v.id).trim();
        const vName = [v.patient_name, v.patient_last_name].filter(Boolean).join(" ").toLowerCase().trim();
        return (
          (targetEncounter && (vNo === targetEncounter || vId === targetEncounter || `er-${vId}` === targetEncounter)) ||
          (targetName && vName === targetName)
        );
      });

      if (vMatch && vMatch.investigations && vMatch.investigations.length > 0) {
        vMatch.investigations.forEach((inv) => {
          const tName = inv.test_name || "";
          if (!tName) return;
          if (RAD_REGEX.test(tName) || (inv as any).modality) {
            if (!claimRadItems.some((x) => x.description === tName)) {
              claimRadItems.push({
                id: `INV-RAD-${Date.now()}`,
                description: tName,
                category: "Radiology / Imaging",
                cptCode: "71045",
                quantity: 1,
                unitPrice: 500,
                total: 500,
                insuranceCovered: 0,
                patientPayable: 500,
              });
            }
          } else {
            if (!claimLabItems.some((x) => x.description === tName)) {
              claimLabItems.push({
                id: `INV-LAB-${Date.now()}`,
                description: tName,
                category: "Laboratory",
                cptCode: "80050",
                quantity: 1,
                unitPrice: 400,
                total: 400,
                insuranceCovered: 0,
                patientPayable: 400,
              });
            }
          }
        });
      }
    } catch {}

    const hasLab =
      labOrders.length > 0 ||
      claimLabItems.length > 0 ||
      extraLabTestNames.length > 0;

    const hasRad = radStudies.length > 0 || claimRadItems.length > 0

    const labTestNames = [
      ...labOrders.map((o) => o.test),
      ...extraLabTestNames,
    ];

    if (claimLabItems.length > 0) {
      claimLabItems.forEach((i) => {
        if (!labTestNames.includes(i.description)) {
          labTestNames.push(i.description);
        }
      });
    }

    const radStudyNames = radStudies.map((s) => s.study)

    if (claimRadItems.length > 0) {
      claimRadItems.forEach((i) => {
        if (!radStudyNames.includes(i.description)) {
          radStudyNames.push(i.description);
        }
      });
    }

    const labPaid = labOrders.filter((lo) => lo.paymentStatus === "Paid").length

    const labPending = labOrders.filter(
      (lo) => lo.paymentStatus === "Payment Pending",
    ).length

    const radPaid = radStudies.filter(
      (rs) => rs.paymentStatus === "Paid",
    ).length

    const radPending = radStudies.filter(
      (rs) => rs.paymentStatus === "Payment Pending",
    ).length

    return {
      hasLabOrders: hasLab,
      labPaidCount: labPaid,
      labPendingCount:
        labPending > 0
          ? labPending
          : claimLabItems.length > 0 && labPaid === 0
            ? claimLabItems.length
            : 0,
      labTestNames,
      hasRadStudies: hasRad,
      radPaidCount: radPaid,
      radPendingCount:
        radPending > 0
          ? radPending
          : claimRadItems.length > 0 && radPaid === 0
            ? claimRadItems.length
            : 0,
      radStudyNames,
      isNonDiagnostic: !hasLab && !hasRad,
    }
  }

  // ── DIAGNOSTIC PRE-PAYMENT CLEARANCE ACCESS METHODS ────────────────────────

  static getLabOrders(): LabOrderRecord[] {
    const orders = this.load<LabOrderRecord[]>(
      STORAGE_KEY_LAB_ORDERS,
      INITIAL_LAB_ORDERS,
    )

    const claims = this.getClaims()

    const syncedOrders = [...orders]

    claims.forEach((claim) => {
      const labItems = claim.items.filter(
        (it) =>
          it.category === "Laboratory" ||
          it.description.toLowerCase().includes("blood") ||
          it.description.toLowerCase().includes("cbc") ||
          it.description.toLowerCase().includes("lft") ||
          it.description.toLowerCase().includes("bmp") ||
          it.description.toLowerCase().includes("profile") ||
          it.description.toLowerCase().includes("troponin") ||
          it.description.toLowerCase().includes("urine") ||
          it.description.toLowerCase().includes("glucose") ||
          it.description.toLowerCase().includes("lactate") ||
          it.description.toLowerCase().includes("culture") ||
          it.description.toLowerCase().includes("hba1c") ||
          it.description.toLowerCase().includes("coagulation"),
      )

      if (labItems.length > 0) {
        const isPaid = claim.status === "Paid" || claim.balanceDue === 0

        const receiptNo =
          claim.payments?.[0]?.receiptNo ||
          (isPaid
            ? `RCPT-2026-${(claim.invoiceNo || "").replace(/\D/g, "").slice(-4) || "5501"}`
            : undefined)

        const targetName = (claim.patientName || "").toLowerCase().trim()

        const targetMrn = (claim.mrn || claim.patientId || "")
          .toLowerCase()
          .trim()

        const existingIdx = syncedOrders.findIndex((o) => {
          const oName = (o.patient || "").toLowerCase().trim()

          const oMrn = (o.mrn || "").toLowerCase().trim()

          const oInv = o.invoiceNo?.toLowerCase().trim()

          return (
            (oInv && oInv === claim.invoiceNo.toLowerCase().trim()) ||
            (oName === targetName &&
              o.test
                .toLowerCase()
                .includes(labItems[0].description.toLowerCase())) ||
            (targetMrn &&
              oMrn === targetMrn &&
              o.test
                .toLowerCase()
                .includes(labItems[0].description.toLowerCase()))
          )
        })

        if (existingIdx >= 0) {
          const current = syncedOrders[existingIdx]

          syncedOrders[existingIdx] = {
            ...current,

            paymentStatus: isPaid ? "Paid" : current.paymentStatus,

            paidReceiptNo: isPaid
              ? current.paidReceiptNo || receiptNo
              : current.paidReceiptNo,

            paidAt: isPaid
              ? current.paidAt || claim.payments?.[0]?.paymentDate || current.orderedAt || current.createdAt
              : current.paidAt,

            billingClearedAt: isPaid
              ? current.billingClearedAt || current.paidAt || claim.payments?.[0]?.paymentDate || current.orderedAt || current.createdAt
              : current.billingClearedAt,

            eligibleAt: isPaid
              ? current.eligibleAt || current.billingClearedAt || current.paidAt || claim.payments?.[0]?.paymentDate || current.orderedAt || current.createdAt
              : current.eligibleAt,

            invoiceNo: claim.invoiceNo,

            umr: claim.patientId,

            department: claim.department,

            diagnosis: claim.diagnosisCodes?.join(", "),

            orderedItems: labItems.map((it) => ({
              description: it.description,

              cptCode: it.cptCode,

              price: it.unitPrice || it.total,

              quantity: it.quantity || 1,
            })),
          }
        } else {
          const testSummary = labItems.map((it) => it.description).join(" + ")

          const totalLabPrice = labItems.reduce(
            (sum, it) =>
              sum + (it.total || (it.unitPrice || 0) * (it.quantity || 1)),

            0,
          )

          syncedOrders.push({
            id: `LAB-INV-${(claim.invoiceNo || "").replace(/\D/g, "").slice(-4) || Math.floor(100 + Math.random() * 900)}`,

            patient: claim.patientName,

            mrn: claim.mrn || claim.patientId.replace(/\D/g, "") || "10001",

            umr: claim.patientId,

            invoiceNo: claim.invoiceNo,

            test: testSummary,

            category: "Clinical Laboratory",

            priority: claim.department === "Emergency" ? "STAT" : "Routine",

            sampleType: "Blood / Plasma Specimen",

            accessionNo: `ACC-2026-${(claim.invoiceNo || "").replace(/\D/g, "").slice(-4) || Math.floor(1000 + Math.random() * 9000)}`,

            collected: "—",

            status: "Pending",

            provider: claim.attendingDoctor || "Attending Physician",

            price: totalLabPrice || 150,

            paymentStatus: isPaid ? "Paid" : "Payment Pending",

            paidReceiptNo: receiptNo,

            paidAt: isPaid ? claim.payments?.[0]?.paymentDate || new Date().toISOString() : undefined,

            billingClearedAt: isPaid ? claim.payments?.[0]?.paymentDate || new Date().toISOString() : undefined,

            eligibleAt: isPaid ? claim.payments?.[0]?.paymentDate || new Date().toISOString() : undefined,

            department: claim.department,

            diagnosis: claim.diagnosisCodes?.join(", "),

            orderedItems: labItems.map((it) => ({
              description: it.description,

              cptCode: it.cptCode,

              price: it.unitPrice || it.total,

              quantity: it.quantity || 1,
            })),
          })
        }
      }
    })

    const deptCharges = this.getDepartmentCharges()

    deptCharges.forEach((dept) => {
      const labItems = (dept.items || []).filter(
        (it) =>
          it.category === "Laboratory" ||
          it.description.toLowerCase().includes("blood") ||
          it.description.toLowerCase().includes("cbc") ||
          it.description.toLowerCase().includes("lft") ||
          it.description.toLowerCase().includes("bmp") ||
          it.description.toLowerCase().includes("profile") ||
          it.description.toLowerCase().includes("troponin") ||
          it.description.toLowerCase().includes("urine") ||
          it.description.toLowerCase().includes("glucose") ||
          it.description.toLowerCase().includes("lactate") ||
          it.description.toLowerCase().includes("culture") ||
          it.description.toLowerCase().includes("hba1c") ||
          it.description.toLowerCase().includes("coagulation"),
      )

      if (labItems.length > 0) {
        const targetName = (dept.patientName || "").toLowerCase().trim()

        const targetMrn = (dept.mrn || dept.patientId || "")
          .toLowerCase()
          .trim()

        const existingIdx = syncedOrders.findIndex((o) => {
          const oName = (o.patient || "").toLowerCase().trim()

          const oMrn = (o.mrn || "").toLowerCase().trim()

          return (
            (dept.invoiceId &&
              o.invoiceNo?.toLowerCase().trim() ===
                dept.invoiceId.toLowerCase().trim()) ||
            (oName === targetName &&
              o.test
                .toLowerCase()
                .includes(labItems[0].description.toLowerCase())) ||
            (targetMrn &&
              oMrn === targetMrn &&
              o.test
                .toLowerCase()
                .includes(labItems[0].description.toLowerCase()))
          )
        })

        if (existingIdx < 0) {
          const testSummary = labItems.map((it) => it.description).join(" + ")

          const totalLabPrice = labItems.reduce(
            (sum, it) =>
              sum + (it.total || (it.unitPrice || 0) * (it.quantity || 1)),

            0,
          )

          syncedOrders.push({
            id: `LAB-DCHG-${(dept.id || "").replace(/\D/g, "").slice(-4) || Math.floor(100 + Math.random() * 900)}`,

            patient: dept.patientName,

            mrn: dept.mrn || dept.patientId.replace(/\D/g, "") || "10001",

            umr: dept.patientId,

            invoiceNo: dept.invoiceId || dept.id,

            test: testSummary,

            category: "Clinical Laboratory",

            priority: dept.department === "Emergency" ? "STAT" : "Routine",

            sampleType: "Blood / Plasma Specimen",

            accessionNo: `ACC-2026-${(dept.id || "").replace(/\D/g, "").slice(-4) || Math.floor(1000 + Math.random() * 9000)}`,

            collected: "—",

            status: "Pending",

            provider: dept.attendingDoctor || "Attending Physician",

            price: totalLabPrice || 150,

            paymentStatus: "Payment Pending",

            department: dept.department,

            diagnosis: dept.diagnosisCodes?.join(", ") || dept.notes,

            orderedItems: labItems.map((it) => ({
              description: it.description,

              cptCode: it.cptCode,

              price: it.unitPrice || it.total,

              quantity: it.quantity || 1,
            })),
          })
        }
      }
    })

    return syncedOrders
  }

  static createLabOrder(
    orderData: Omit<LabOrderRecord, "id"> & { id?: string },
  ): LabOrderRecord {
    const orders = this.getLabOrders()

    const id = orderData.id || `LAB-${Math.floor(100 + Math.random() * 900)}`

    const newOrder: LabOrderRecord = {
      ...orderData,

      id,

      accessionNo:
        orderData.accessionNo ||
        `ACC-2026-${Math.floor(1000 + Math.random() * 9000)}`,

      collected: orderData.collected || "—",

      status: orderData.status || "Pending",
    }

    const updated = [newOrder, ...orders.filter((o) => o.id !== id)]

    this.save(STORAGE_KEY_LAB_ORDERS, updated)

    this.emitUpdate()

    return newOrder
  }

  static updateLabOrder(
    id: string,
    updates: Partial<LabOrderRecord>,
  ): LabOrderRecord {
    const orders = this.getLabOrders()

    const idx = orders.findIndex((o) => o.id === id)

    if (idx < 0) throw new Error("Lab order not found")

    const updated = { ...orders[idx], ...updates }

    orders[idx] = updated

    this.save(STORAGE_KEY_LAB_ORDERS, orders)

    this.emitUpdate()

    return updated
  }

  static deleteLabOrder(id: string): void {
    const orders = this.getLabOrders().filter((o) => o.id !== id)

    this.save(STORAGE_KEY_LAB_ORDERS, orders)

    this.emitUpdate()
  }

  static getRadiologyStudies(): RadiologyStudyRecord[] {
    const now = Date.now()
    if (this._cachedRadStudies && (now - this._radStudiesCacheTime < this.RAD_STUDIES_TTL)) {
      return this._cachedRadStudies
    }
    const studies = this.load<RadiologyStudyRecord[]>(
      STORAGE_KEY_RAD_STUDIES,
      INITIAL_RAD_STUDIES,
    )

    const claims = this.getClaims()

    const syncedStudies = [...studies]

    claims.forEach((claim) => {
      const radItems = claim.items.filter(
        (it) =>
          it.category === "Radiology / Imaging" ||
          (it.category as string) === "Radiology" ||
          it.description.toLowerCase().includes("x-ray") ||
          it.description.toLowerCase().includes("xray") ||
          /\b(ct|ct scan|computed tomography|hrct|cect|ncct)\b/i.test(it.description) ||
          it.description.toLowerCase().includes("mri") ||
          it.description.toLowerCase().includes("ultrasound") ||
          it.description.toLowerCase().includes("usg") ||
          it.description.toLowerCase().includes("echo") ||
          it.description.toLowerCase().includes("dexa"),
      )

      if (radItems.length > 0) {
        const isPaid = claim.status === "Paid" || claim.balanceDue === 0

        const receiptNo =
          claim.payments?.[0]?.receiptNo ||
          (isPaid
            ? `RCPT-2026-${(claim.invoiceNo || "").replace(/\D/g, "").slice(-4) || "5501"}`
            : undefined)

        const targetName = (claim.patientName || "").toLowerCase().trim()

        const targetMrn = (claim.mrn || claim.patientId || "")
          .toLowerCase()
          .trim()

        const matchingIndices: number[] = []
        syncedStudies.forEach((s, idx) => {
          const sName = (s.patient || "").toLowerCase().trim()
          const sMrn = normalizeUmr(s.mrn || s.umr)
          const cMrn = normalizeUmr(claim.patientId || claim.mrn)
          const sInv = s.invoiceNo?.toLowerCase().trim()
          const matchInv = sInv && (sInv === claim.invoiceNo.toLowerCase().trim() || sInv === (claim.id || "").toLowerCase().trim())
          const matchEnc = matchesEncounter(s, { id: claim.encounterId, opNumber: claim.encounterId, umr: claim.patientId })
          const matchItem = radItems.some((it) =>
            it.id === `ITEM-RAD-${s.id}` ||
            (s.study && (
              it.description.toLowerCase().includes(s.study.toLowerCase()) ||
              s.study.toLowerCase().includes(it.description.toLowerCase())
            ))
          )
          const matchPatient = (sName && sName === targetName) || (sMrn && cMrn && sMrn === cMrn)

          if (matchInv || matchEnc || (matchPatient && matchItem)) {
            matchingIndices.push(idx)
          }
        })

        if (matchingIndices.length > 0) {
          matchingIndices.forEach((idx) => {
            const current = syncedStudies[idx]
            syncedStudies[idx] = {
              ...current,
              paymentStatus: isPaid ? "Paid" : (claim.balanceDue > 0 ? "Payment Pending" : current.paymentStatus),
              paidReceiptNo: isPaid ? (current.paidReceiptNo || receiptNo) : current.paidReceiptNo,
              paidAt: isPaid ? (current.paidAt || claim.payments?.[0]?.paymentDate || current.orderedAt || current.createdAt) : current.paidAt,
              billingClearedAt: isPaid ? (current.billingClearedAt || current.paidAt || claim.payments?.[0]?.paymentDate || current.orderedAt || current.createdAt) : current.billingClearedAt,
              eligibleAt: isPaid ? (current.eligibleAt || current.billingClearedAt || current.paidAt || claim.payments?.[0]?.paymentDate || current.orderedAt || current.createdAt) : current.eligibleAt,
              invoiceNo: claim.invoiceNo,
              umr: claim.patientId || current.umr,
              department: claim.department || current.department,
            }
          })
        } else {
          const studySummary = radItems.map((it) => it.description).join(" + ")

          const totalRadPrice = radItems.reduce(
            (sum, it) =>
              sum + (it.total || (it.unitPrice || 0) * (it.quantity || 1)),

            0,
          )

          const modality = /\b(ct|computed tomography)\b/i.test(studySummary)
            ? "CT"
            : studySummary.toLowerCase().includes("mri") ||
                studySummary.toLowerCase().includes("mr ")
              ? "MR"
              : studySummary.toLowerCase().includes("ultra") ||
                  studySummary.toLowerCase().includes("echo")
                ? "US"
                : "XR"

          const room =
            modality === "CT"
              ? "CT-1"
              : modality === "MR"
                ? "MR-1"
                : modality === "US"
                  ? "US-1"
                  : "XR-1"

          const claimDateStr = claim.dateOfService || (claim as any).createdAt?.split("T")[0] || new Date().toISOString().split("T")[0];
          const claimNowIso = (claim as any).createdAt || (claim.dateOfService ? `${claim.dateOfService}T09:00:00.000Z` : new Date().toISOString());

          syncedStudies.push({
            id: `RAD-INV-${(claim.invoiceNo || "").replace(/\D/g, "").slice(-4) || (claim.id || claim.patientId || "101").replace(/\D/g, "").slice(-4) || "1036"}`,

            patient: claim.patientName,

            mrn: claim.mrn || claim.patientId.replace(/\D/g, "") || "10001",

            umr: claim.patientId,

            invoiceNo: claim.invoiceNo,

            study: studySummary,

            modality: modality as any,

            priority: claim.department === "Emergency" ? "STAT" : "Routine",

            createdAt: claimNowIso,
            orderedAt: claimNowIso,
            orderDate: claimDateStr,
            ordered: `${claimDateStr} · ${new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`,

            provider: claim.attendingDoctor || "Referring Specialist",

            status: "Orders",

            room,

            price: totalRadPrice || 250,

            paymentStatus: isPaid ? "Paid" : "Payment Pending",

            paidReceiptNo: receiptNo,

            paidAt: isPaid ? claim.payments?.[0]?.paymentDate || new Date().toISOString() : undefined,

            billingClearedAt: isPaid ? claim.payments?.[0]?.paymentDate || new Date().toISOString() : undefined,

            eligibleAt: isPaid ? claim.payments?.[0]?.paymentDate || new Date().toISOString() : undefined,

            accessionNo: `RAD-ACC-${(claim.invoiceNo || "").replace(/\D/g, "").slice(-4) || (claim.id || claim.patientId || "101").replace(/\D/g, "").slice(-4) || "1036"}`,

            department: claim.department,

            indication:
              claim.carePathway ||
              `Clinical Evaluation (${claim.diagnosisCodes?.join(", ") || "General Diagnostics"})`,

            orderedItems: radItems.map((it) => ({
              description: it.description,

              cptCode: it.cptCode,

              price: it.unitPrice || it.total,

              quantity: it.quantity || 1,
            })),
          })
        }
      }
    })

    const deptChargesRad = this.getDepartmentCharges()

    deptChargesRad.forEach((dept) => {
      const radItems = (dept.items || []).filter(
        (it) =>
          it.category === "Radiology / Imaging" ||
          (it.category as string) === "Radiology" ||
          it.description.toLowerCase().includes("x-ray") ||
          it.description.toLowerCase().includes("xray") ||
          /\b(ct|ct scan|computed tomography|hrct|cect|ncct)\b/i.test(it.description) ||
          it.description.toLowerCase().includes("mri") ||
          it.description.toLowerCase().includes("ultrasound") ||
          it.description.toLowerCase().includes("usg") ||
          it.description.toLowerCase().includes("echo") ||
          it.description.toLowerCase().includes("dexa"),
      )

      if (radItems.length > 0) {
        const targetName = (dept.patientName || "").toLowerCase().trim()

        const targetMrn = (dept.mrn || dept.patientId || "")
          .toLowerCase()
          .trim()

        const existingIdx = syncedStudies.findIndex((s) => {
          const sName = (s.patient || "").toLowerCase().trim()

          const sMrn = (s.mrn || "").toLowerCase().trim()

          return (
            (dept.invoiceId &&
              s.invoiceNo?.toLowerCase().trim() ===
                dept.invoiceId.toLowerCase().trim()) ||
            (sName === targetName &&
              s.study
                .toLowerCase()
                .includes(radItems[0].description.toLowerCase())) ||
            (targetMrn &&
              sMrn === targetMrn &&
              s.study
                .toLowerCase()
                .includes(radItems[0].description.toLowerCase()))
          )
        })

        if (existingIdx < 0) {
          const studySummary = radItems.map((it) => it.description).join(" + ")

          const totalRadPrice = radItems.reduce(
            (sum, it) =>
              sum + (it.total || (it.unitPrice || 0) * (it.quantity || 1)),

            0,
          )

          const modality = /\b(ct|computed tomography)\b/i.test(studySummary)
            ? "CT"
            : studySummary.toLowerCase().includes("mri") ||
                studySummary.toLowerCase().includes("mr ")
              ? "MR"
              : studySummary.toLowerCase().includes("ultra") ||
                  studySummary.toLowerCase().includes("echo")
                ? "US"
                : "XR"

          const room =
            modality === "CT"
              ? "CT-1"
              : modality === "MR"
                ? "MR-1"
                : modality === "US"
                  ? "US-1"
                  : "XR-1"

          const deptDateStr = (dept as any).date || (dept as any).createdAt?.split("T")[0] || new Date().toISOString().split("T")[0];
          const deptNowIso = (dept as any).createdAt || ((dept as any).date ? `${(dept as any).date}T09:00:00.000Z` : new Date().toISOString());

          syncedStudies.push({
            id: `RAD-DCHG-${(dept.id || "").replace(/\D/g, "").slice(-4) || (dept.patientId || "101").replace(/\D/g, "").slice(-4) || "1036"}`,

            patient: dept.patientName,

            mrn: dept.mrn || dept.patientId.replace(/\D/g, "") || "10001",

            umr: dept.patientId,

            invoiceNo: dept.invoiceId || dept.id,

            study: studySummary,

            modality: modality as any,

            priority: dept.department === "Emergency" ? "STAT" : "Routine",

            createdAt: deptNowIso,
            orderedAt: deptNowIso,
            orderDate: deptDateStr,
            ordered: `${deptDateStr} · ${new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`,

            provider: dept.attendingDoctor || "Referring Specialist",

            status: "Orders",

            room,

            price: totalRadPrice || 250,

            paymentStatus: "Payment Pending",

            accessionNo: `RAD-ACC-${(dept.id || "").replace(/\D/g, "").slice(-4) || (dept.patientId || "101").replace(/\D/g, "").slice(-4) || "1036"}`,

            department: dept.department,

            indication:
              dept.carePathway ||
              dept.notes ||
              `Clinical Evaluation (${dept.diagnosisCodes?.join(", ") || "General Diagnostics"})`,

            orderedItems: radItems.map((it) => ({
              description: it.description,

              cptCode: it.cptCode,

              price: it.unitPrice || it.total,

              quantity: it.quantity || 1,
            })),
          })
        }
      }
    })

    const seenStudyKeys = new Set<string>()
    const deduplicatedStudies: RadiologyStudyRecord[] = []
    for (const s of syncedStudies) {
      if (s.study === "Diagnostic Imaging Study") {
        const hasSpecificStudy = syncedStudies.some(
          (other) =>
            other !== s &&
            ((other.umr && s.umr && other.umr === s.umr) || (other.patient && s.patient && other.patient === s.patient)) &&
            other.study !== "Diagnostic Imaging Study"
        )
        if (hasSpecificStudy) continue
      }
      const pKey = (s.encounterId || s.umr || s.mrn || s.patient || "").toLowerCase().trim()
      const sBase = (s.study || "").toLowerCase().replace(/\s*\([^\)]*\)/g, "").trim()
      const key = `${pKey}::${sBase}`
      if (!seenStudyKeys.has(key)) {
        seenStudyKeys.add(key)
        let ord = s.ordered || ""
        const timeMatch = ord.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i)
        const timePart = timeMatch ? timeMatch[1] : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

        const dateMatch = ord.match(/\d{4}-\d{2}-\d{2}/)
        let resolvedDate = dateMatch ? dateMatch[0] : ""

        if (!resolvedDate && (s.umr || s.mrn)) {
          try {
            const pat = db.getPatientByUmr(s.umr || s.mrn)
            if (pat?.createdAt) resolvedDate = pat.createdAt.split("T")[0]
          } catch {}
        }
        if (!resolvedDate && s.encounterId) {
          try {
            const enc = db.getEncounterById(s.encounterId)
            if (enc) resolvedDate = OpReportsService.getEncounterDate(enc)
          } catch {}
        }
        if (!resolvedDate && s.invoiceNo) {
          const matchingClaim = claims.find((c) => c.invoiceNo === s.invoiceNo)
          if (matchingClaim?.dateOfService) resolvedDate = matchingClaim.dateOfService
        }
        if (!resolvedDate && s.paidAt) {
          resolvedDate = s.paidAt.split("T")[0]
        }
        if (!resolvedDate) {
          resolvedDate = new Date().toISOString().split("T")[0]
        }

        const fullOrdered = `${resolvedDate} · ${timePart}`
        const parsedTime = new Date(`${resolvedDate} ${timePart}`).getTime()
        const fallbackIso = !isNaN(parsedTime) && parsedTime > 0 ? new Date(parsedTime).toISOString() : new Date().toISOString()

        deduplicatedStudies.push({
          ...s,
          orderDate: s.orderDate || resolvedDate,
          orderedAt: (s as any).orderedAt || (s as any).createdAt || fallbackIso,
          createdAt: (s as any).createdAt || (s as any).orderedAt || fallbackIso,
          ordered: fullOrdered,
        })
      }
    }
    return deduplicatedStudies.sort((a, b) => {
      const getStudyTimestamp = (study: any): number => {
        if (study.orderedAt) {
          const t = new Date(study.orderedAt).getTime()
          if (!isNaN(t) && t > 0) return t
        }
        if (study.createdAt) {
          const t = new Date(study.createdAt).getTime()
          if (!isNaN(t) && t > 0) return t
        }
        if (study.orderDate && study.ordered) {
          const cleanOrd = String(study.ordered).replace(/[·,]/g, " ").replace(/\s+/g, " ").trim()
          const ordHasDate = /\d{4}-\d{2}-\d{2}/.test(cleanOrd)
          const targetStr = ordHasDate ? cleanOrd : `${study.orderDate} ${cleanOrd}`
          const t = new Date(targetStr).getTime()
          if (!isNaN(t) && t > 0) return t
        }
        if (study.ordered) {
          const clean = String(study.ordered).replace(/[·,]/g, " ").replace(/\s+/g, " ").trim()
          const t = new Date(clean).getTime()
          if (!isNaN(t) && t > 0) return t
          // Time-only string check (e.g. 02:30 PM)
          if (/^\d{1,2}:\d{2}/.test(clean)) {
            const today = new Date().toISOString().split("T")[0]
            const tToday = new Date(`${today} ${clean}`).getTime()
            if (!isNaN(tToday) && tToday > 0) return tToday
          }
        }
        if (study.orderDate) {
          const t = new Date(study.orderDate).getTime()
          if (!isNaN(t) && t > 0) return t
        }
        if (study.paidAt) {
          const t = new Date(study.paidAt).getTime()
          if (!isNaN(t) && t > 0) return t
        }
        return 0
      }
      const timeB = getStudyTimestamp(b)
      const timeA = getStudyTimestamp(a)
      if (timeA !== timeB) return timeB - timeA // Newest records strictly at the top
      return (b.id || "").localeCompare(a.id || "")
    })
  }

  static ensureConsolidatedInvestigationClaim(payload: {
    encounter: {
      id: string
      umr: string
      patientName: string
      age?: number
      sex?: string
      phone?: string
      opNumber?: string
      dept?: string
      assignedDoctor?: string
      isNew?: boolean
      billing?: any
      diagnosis?: string
      registrationTime?: string
    }
    doctor?: { id?: string; name?: string; staffId?: string; specialty?: string }
    labOrder?: any
    radiologyStudies?: RadiologyStudyRecord[]
  }): ClaimRecord {
    try {
      const claims = this.load<ClaimRecord[]>(STORAGE_KEY_CLAIMS, [])
      const encId = payload.encounter.id
      const encUmr = payload.encounter.umr
      const encOp = payload.encounter.opNumber || `OP-${encUmr.replace(/\D/g, "") || "1001"}`
      const invoiceNo = `INV-${encOp}`

      // Check if consolidated claim already exists for this encounter
      let claimIdx = claims.findIndex(
        (c) =>
          c.id === `CLM-${encId}` ||
          (c.encounterId && (c.encounterId.toLowerCase() === encId.toLowerCase() || c.encounterId.toLowerCase() === encOp.toLowerCase())) ||
          c.invoiceNo === invoiceNo
      )

      let claim: ClaimRecord
      if (claimIdx >= 0) {
        claim = { ...claims[claimIdx] }
      } else {
        const items: InvoiceItem[] = []
        // Note: As per Requirement 3, OP registration fee is strictly NOT included in investigation billing.
        claim = {
          id: `CLM-${encId}`,
          invoiceNo,
          encounterId: encId,
          patientId: encUmr,
          patientName: payload.encounter.patientName,
          mrn: encUmr.replace("UMR", ""),
          age: payload.encounter.age || 30,
          gender: payload.encounter.sex === "Female" ? "Female" : "Male",
          phone: payload.encounter.phone || "",
          payments: [],
          department: "Outpatient",
          carePathway: `${payload.encounter.dept || "Outpatient"} Consultation & Diagnostic Investigations`,
          dateOfService: OpReportsService.getEncounterDate(payload.encounter as any) || new Date().toISOString().split("T")[0],
          insuranceProvider: "Self-Pay",
          policyNumber: "N/A",
          status: "Draft",
          attendingDoctor: payload.doctor?.name || payload.encounter.assignedDoctor || "Attending Doctor",
          diagnosisCodes: [payload.encounter.diagnosis || "Z00.00"],
          items,
          subtotal: 0,
          discount: 0,
          tax: 0,
          totalAmount: 0,
          insurancePortion: 0,
          patientPortion: 0,
          amountPaid: 0,
          balanceDue: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }

      // Preserve existing items (such as doctor bedside clinical services), strictly filter out registration fee & generic placeholders
      let updatedItems = (claim.items || []).filter(
        (it) => it.category !== "Registration" && !it.id.startsWith("ITEM-REG-") && it.id !== `ITEM-LAB-${encId}` && it.description !== "Diagnostic Investigations & Services"
      )

      // Add / sync Laboratory items
      if (payload.labOrder && Array.isArray(payload.labOrder.tests)) {
        payload.labOrder.tests.forEach((t: any, i: number) => {
          const itemId = `ITEM-LAB-${payload.labOrder.id}-${i + 1}`
          const exists = updatedItems.some(
            (it) => it.id === itemId || (it.category === "Laboratory" && it.description.toLowerCase().trim() === (t.name || "").toLowerCase().trim())
          )
          if (!exists) {
            updatedItems.push({
              id: itemId,
              description: t.name,
              category: "Laboratory",
              cptCode: t.code || "80050",
              quantity: 1,
              unitPrice: t.price || 0,
              total: t.price || 0,
              insuranceCovered: 0,
              patientPayable: t.price || 0,
              orderedBy: payload.doctor?.name || payload.encounter.assignedDoctor || "Attending Doctor",
              orderedAt: payload.labOrder.createdAt || new Date().toISOString(),
            })
          }
        })
      }

      // Add / sync Radiology items
      if (payload.radiologyStudies && Array.isArray(payload.radiologyStudies)) {
        payload.radiologyStudies.forEach((s: any) => {
          const itemId = `ITEM-RAD-${s.id}`
          const exists = updatedItems.some(
            (it) =>
              it.id === itemId ||
              (((it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology") &&
                (it.description.toLowerCase().trim() === `${s.study} (${s.modality})`.toLowerCase().trim() ||
                 it.description.toLowerCase().trim() === (s.study || "").toLowerCase().trim()))
          )
          if (!exists) {
            updatedItems.push({
              id: itemId,
              description: `${s.study} (${s.modality})`,
              category: "Radiology / Imaging",
              cptCode: `RAD-${s.modality || "IMG"}`,
              quantity: 1,
              unitPrice: s.price || 0,
              total: s.price || 0,
              insuranceCovered: 0,
              patientPayable: s.price || 0,
              orderedBy: payload.doctor?.name || payload.encounter.assignedDoctor || "Attending Doctor",
              orderedAt: s.createdAt || s.orderedAt || new Date().toISOString(),
            })
          }
        })
      }

      // Ensure NO registration fee in investigation billing
      updatedItems = updatedItems.filter((it) => it.category !== "Registration" && !it.id.startsWith("ITEM-REG-"))

      // Set department and pathway based on included investigations
      const hasLab = updatedItems.some((it) => it.category === "Laboratory")
      const hasRad = updatedItems.some((it) => (it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology")
      if (hasLab && hasRad) {
        claim.department = "Outpatient"
        claim.carePathway = "Laboratory & Radiology Investigations"
      } else if (hasLab) {
        claim.department = "Laboratory"
        claim.carePathway = "Laboratory Diagnostics"
      } else if (hasRad) {
        claim.department = "Radiology"
        claim.carePathway = "Radiology Imaging"
      }

      // Recalculate totals with strict separation of registration vs investigation balances
      const subtotal = updatedItems.reduce((sum, it) => sum + (it.total || 0), 0)
      const recordedPayments = (claim.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0)
      const amountPaid = Math.min(subtotal, Math.max(claim.amountPaid || 0, recordedPayments))
      const balanceDue = Math.max(0, subtotal - amountPaid)
      const isPaid = balanceDue === 0 && subtotal > 0

      claim.items = updatedItems
      claim.subtotal = subtotal
      claim.totalAmount = subtotal
      claim.patientPortion = subtotal
      claim.amountPaid = amountPaid
      claim.balanceDue = balanceDue
      claim.status = isPaid ? "Paid" : "Draft"
      claim.updatedAt = new Date().toISOString()

      // Suppress any split/orphan claims for this encounter
      const filteredClaims = claims.filter((c) => {
        if (c.id === claim.id) return false
        if (c.encounterId && (c.encounterId.toLowerCase() === encId.toLowerCase() || c.encounterId.toLowerCase() === encOp.toLowerCase()) && c.id !== claim.id) return false
        if (payload.labOrder?.id && c.id === `CLM-LAB-${payload.labOrder.id}`) return false
        if (payload.radiologyStudies && payload.radiologyStudies.some((s) => c.id === `CLM-${s.id}` || c.id === `CLM-RAD-${s.id}`)) return false
        return true
      })

      filteredClaims.unshift(claim)
      this.save(STORAGE_KEY_CLAIMS, filteredClaims)

      // Ensure Lab Order in hospai_lab_orders_v2 holds the consolidated invoiceNo
      if (payload.labOrder && typeof window !== "undefined") {
        try {
          const rawOrders = window.localStorage.getItem("hospai_lab_orders_v2")
          if (rawOrders) {
            const parsed = JSON.parse(rawOrders)
            let updatedLab = false
            const nextOrders = parsed.map((o: any) => {
              if (o.id === payload.labOrder.id || (o.encounterId && (o.encounterId === encId || o.encounterId === encOp))) {
                updatedLab = true
                return {
                  ...o,
                  billing: {
                    ...(o.billing || {}),
                    invoiceNo: claim.invoiceNo,
                  },
                }
              }
              return o
            })
            if (updatedLab) {
              window.localStorage.setItem("hospai_lab_orders_v2", JSON.stringify(nextOrders))
            }
          }
        } catch {}
      }

      // Ensure Radiology Studies in STORAGE_KEY_RAD_STUDIES hold the consolidated invoiceNo
      if (payload.radiologyStudies && payload.radiologyStudies.length > 0) {
        try {
          const radStudies = this.load<RadiologyStudyRecord[]>(STORAGE_KEY_RAD_STUDIES, [])
          let updatedRad = false
          const nextRad = radStudies.map((rs: any) => {
            if (rs.encounterId && (rs.encounterId === encId || rs.encounterId === encOp)) {
              updatedRad = true
              return {
                ...rs,
                invoiceNo: claim.invoiceNo,
                opNumber: encOp,
              }
            }
            return rs
          })
          if (updatedRad) {
            this.save(STORAGE_KEY_RAD_STUDIES, nextRad)
            this.invalidateRadiologyStudiesCache()
          }
        } catch {}
      }

      // Synchronize OP Encounter billing in db.ts
      try {
        const enc = db.getEncounterById(encId)
        if (enc) {
          db.updateEncounter(encId, {
            billing: {
              ...(enc.billing || {}),
              labFee: subtotal,
              total: subtotal,
              status: balanceDue === 0 ? "Paid" : "Pending",
            },
            status: balanceDue === 0 ? "Billing Completed" : "Awaiting Billing",
          })
        }
      } catch {}

      this.emitUpdate()
      return claim
    } catch (err) {
      console.warn("ensureConsolidatedInvestigationClaim error:", err)
      throw err
    }
  }

  static ensureRadiologyClaim(study: RadiologyStudyRecord): void {
    try {
      const enc = db.getEncounters().find((e) => matchesEncounter(study, e))
      if (enc) {
        this.ensureConsolidatedInvestigationClaim({
          encounter: enc,
          radiologyStudies: [study],
        })
        return
      }

      // Standalone or walk-in radiology study (no OP encounter found in db)
      const claims = this.load<ClaimRecord[]>(STORAGE_KEY_CLAIMS, [])
      const studyUmr = normalizeUmr(study.umr || study.mrn)
      const studyEnc = (study.encounterId || study.opNumber || "").toLowerCase()
      const radItem: InvoiceItem = {
        id: `ITEM-RAD-${study.id}`,
        description: `${study.study} (${study.modality})`,
        category: "Radiology / Imaging",
        cptCode: `RAD-${study.modality || "IMG"}`,
        quantity: 1,
        unitPrice: study.price || 0,
        total: study.price || 0,
        insuranceCovered: 0,
        patientPayable: study.price || 0,
        orderedBy: study.provider || "Attending Doctor",
        orderedAt: study.createdAt || study.orderedAt || new Date().toISOString(),
      }

      // Check if consolidated claim already exists for this patient and encounter
      const existingIdx = claims.findIndex((c) => {
        const cUmr = normalizeUmr(c.patientId || c.mrn)
        const cEnc = (c.encounterId || "").toLowerCase()
        if (studyEnc && cEnc && studyEnc === cEnc) return true
        if (studyUmr && cUmr && studyUmr === cUmr && (!studyEnc || studyEnc === cEnc)) return true
        if (study.invoiceNo && !study.invoiceNo.startsWith("INV-RAD-") && c.invoiceNo === study.invoiceNo) return true
        return false
      })

      if (existingIdx >= 0) {
        const existing = claims[existingIdx]
        const hasItem = (existing.items || []).some(
          (it) => it.id === radItem.id ||
            (((it.category as string) === "Radiology / Imaging" || (it.category as string) === "Radiology") &&
              it.description.toLowerCase().trim() === radItem.description.toLowerCase().trim())
        )
        const updatedItems = hasItem ? existing.items : [...(existing.items || []), radItem]
        const subtotal = updatedItems.reduce((s, it) => s + (it.total || 0), 0)
        const recordedPayments = (existing.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
        const amountPaid = Math.min(subtotal, Math.max(existing.amountPaid || 0, recordedPayments))
        const balanceDue = Math.max(0, subtotal - amountPaid)
        const isPaid = balanceDue === 0 && subtotal > 0

        claims[existingIdx] = {
          ...existing,
          items: updatedItems,
          subtotal,
          totalAmount: subtotal,
          patientPortion: subtotal,
          amountPaid,
          balanceDue,
          status: isPaid ? "Paid" : "Draft",
          updatedAt: new Date().toISOString(),
        }
        this.save(STORAGE_KEY_CLAIMS, claims)
        this.emitUpdate()
        return
      }

      // If no claim exists at all, create ONE consolidated claim for this patient & encounter
      const encKey = study.opNumber || study.encounterId || study.id
      const invoiceNo = study.invoiceNo && !study.invoiceNo.startsWith("INV-RAD-")
        ? study.invoiceNo
        : `INV-${study.opNumber || study.encounterId || study.id.replace(/\D/g, "") || Date.now().toString().slice(-4)}`

      const newClaim: ClaimRecord = {
        id: `CLM-${encKey}`,
        invoiceNo,
        encounterId: study.encounterId || encKey,
        patientId: study.umr || study.mrn || "WALK-IN",
        patientName: study.patient || "Radiology Patient",
        mrn: (study.mrn || study.umr || "").replace("UMR", ""),
        age: (study as any).age || 35,
        gender: (study as any).gender || "Male",
        phone: (study as any).phone || "",
        payments: [],
        department: "Radiology",
        carePathway: `Radiology Imaging — ${study.study}`,
        dateOfService: (study.orderDate || study.ordered || "").split(" · ")[0] || new Date().toISOString().split("T")[0],
        insuranceProvider: "Self-Pay",
        policyNumber: "N/A",
        status: study.isPaid || study.paymentStatus === "Paid" ? "Paid" : "Draft",
        attendingDoctor: study.provider || "Attending Doctor",
        diagnosisCodes: [study.diagnosis || "Z01.89"],
        items: [radItem],
        subtotal: study.price || 0,
        discount: 0,
        tax: 0,
        totalAmount: study.price || 0,
        insurancePortion: 0,
        patientPortion: study.price || 0,
        amountPaid: study.isPaid || study.paymentStatus === "Paid" ? (study.price || 0) : 0,
        balanceDue: study.isPaid || study.paymentStatus === "Paid" ? 0 : (study.price || 0),
        createdAt: study.createdAt || new Date().toISOString(),
        updatedAt: study.createdAt || new Date().toISOString(),
      }

      claims.unshift(newClaim)
      this.save(STORAGE_KEY_CLAIMS, claims)
      this.emitUpdate()
    } catch (err) {
      console.warn("ensureRadiologyClaim error:", err)
    }
  }

  static ensureLaboratoryClaim(order: any): void {
    try {
      const enc = db.getEncounters().find((e) => matchesEncounter(order, e))
      if (enc) {
        this.ensureConsolidatedInvestigationClaim({
          encounter: enc,
          labOrder: order,
        })
        return
      }

      const claims = this.load<ClaimRecord[]>(STORAGE_KEY_CLAIMS, [])
      const orderUmr = normalizeUmr(order.umr)
      const orderEnc = (order.encounterId || "").toLowerCase()
      const existingIdx = claims.findIndex(
        (c) =>
          c.department === "Laboratory" &&
          (c.id === `CLM-LAB-${order.id}` ||
            c.invoiceNo === order.billing?.invoiceNo ||
            (orderEnc && c.encounterId && c.encounterId.toLowerCase() === orderEnc) ||
            (orderUmr && normalizeUmr(c.patientId || c.mrn) === orderUmr && (!orderEnc || (c.encounterId || "").toLowerCase() === orderEnc)))
      )

      const isPaid = order.billing?.status === "Paid"
      const subtotal = order.billing?.total || (order.tests || []).reduce((s: number, t: any) => s + (t.price || 0), 0)
      const labItems: InvoiceItem[] = (order.tests || []).map((t: any, i: number) => ({
        id: `ITEM-LAB-${order.id}-${i + 1}`,
        description: t.name,
        category: "Laboratory",
        cptCode: t.code || "80050",
        quantity: 1,
        unitPrice: t.price || 0,
        total: t.price || 0,
        insuranceCovered: 0,
        patientPayable: t.price || 0,
        orderedBy: order.doctorName || "Attending Doctor",
        orderedAt: order.createdAt || new Date().toISOString(),
      }))

      if (existingIdx >= 0) {
        const existing = claims[existingIdx]
        existing.status = isPaid ? "Paid" : existing.status
        existing.amountPaid = isPaid ? subtotal : existing.amountPaid
        existing.balanceDue = isPaid ? 0 : Math.max(0, existing.totalAmount - existing.amountPaid)
        claims[existingIdx] = existing
        this.save(STORAGE_KEY_CLAIMS, claims)
        this.emitUpdate()
        return
      }

      const newClaim: ClaimRecord = {
        id: `CLM-${order.encounterId || order.id}`,
        invoiceNo: order.billing?.invoiceNo || `INV-${order.encounterId || (order.id || "").replace(/\D/g, "") || Date.now().toString().slice(-4)}`,
        encounterId: order.encounterId,
        patientId: order.umr,
        patientName: order.patientName,
        mrn: (order.umr || "").replace("UMR", ""),
        age: order.age || 30,
        gender: order.sex === "Female" ? "Female" : "Male",
        phone: order.phone || "",
        payments: [],
        department: "Laboratory",
        carePathway: `Laboratory Diagnostics (${order.id})`,
        dateOfService: order.createdAt ? order.createdAt.split("T")[0] : new Date().toISOString().split("T")[0],
        insuranceProvider: "Self-Pay",
        policyNumber: "N/A",
        status: isPaid ? "Paid" : "Draft",
        attendingDoctor: order.doctorName || "Attending Specialist",
        diagnosisCodes: [order.diagnosis || "Z00.00"],
        items: labItems,
        subtotal,
        discount: 0,
        tax: 0,
        totalAmount: subtotal,
        insurancePortion: 0,
        patientPortion: subtotal,
        amountPaid: isPaid ? subtotal : 0,
        balanceDue: isPaid ? 0 : subtotal,
        createdAt: order.createdAt || new Date().toISOString(),
        updatedAt: order.updatedAt || order.createdAt || new Date().toISOString(),
      }

      claims.unshift(newClaim)
      this.save(STORAGE_KEY_CLAIMS, claims)
      this.emitUpdate()
    } catch (err) {
      console.warn("ensureLaboratoryClaim error:", err)
    }
  }

  static createRadiologyStudy(
    studyData: Omit<RadiologyStudyRecord, "id"> & { id?: string },
  ): RadiologyStudyRecord {
    const studies = this.getRadiologyStudies()

    let resolvedPatientName = studyData.patient || ""
    if (
      resolvedPatientName &&
      (resolvedPatientName.startsWith("PAT-") ||
        resolvedPatientName.startsWith("UMR") ||
        /^\d+$/.test(resolvedPatientName))
    ) {
      try {
        const p =
          db.getPatientByUmr(resolvedPatientName) ||
          db
            .getPatients()
            .find(
              (pt) =>
                pt.umr === resolvedPatientName ||
                pt.name === resolvedPatientName,
            )
        if (p && p.name) resolvedPatientName = p.name
      } catch {}
    }

    const id = studyData.id || `RAD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`

    // Dynamically resolve patient's original date & time, age, gender, OP number, and canonical invoiceNo
    const resolvedEncounter = db.getEncounters().find((e) =>
      matchesEncounter({ encounterId: studyData.encounterId, opNumber: (studyData as any).opNumber, umr: studyData.umr, mrn: studyData.mrn }, e)
    )

    let dynamicDate = ""
    let resolvedAge = (studyData as any).age
    let resolvedGender = (studyData as any).gender
    let resolvedOpNumber = (studyData as any).opNumber || resolvedEncounter?.opNumber
    if (resolvedEncounter) {
      dynamicDate = OpReportsService.getEncounterDate(resolvedEncounter)
      if (resolvedAge === undefined && resolvedEncounter.age) resolvedAge = resolvedEncounter.age
      if (!resolvedGender && resolvedEncounter.sex) resolvedGender = resolvedEncounter.sex
    }

    if ((resolvedAge === undefined || !resolvedGender || !dynamicDate) && (studyData.umr || studyData.mrn)) {
      try {
        const pat = db.getPatientByUmr(studyData.umr || studyData.mrn)
        if (pat) {
          if (!dynamicDate && pat.createdAt) dynamicDate = pat.createdAt.split("T")[0]
          if (resolvedAge === undefined && pat.age) resolvedAge = pat.age
          if (!resolvedGender && pat.gender) resolvedGender = pat.gender
        }
      } catch {}
    }
    if (!resolvedOpNumber) {
      resolvedOpNumber = studyData.encounterId?.startsWith("OP-")
        ? studyData.encounterId
        : `OP-${(studyData.umr || studyData.mrn || "1002").replace(/\D/g, "")}`
    }

    const invoiceNo =
      studyData.invoiceNo && !studyData.invoiceNo.startsWith("INV-RAD-")
        ? studyData.invoiceNo
        : `INV-${resolvedOpNumber}`

    const nowIso = new Date().toISOString()
    const todayStr = new Date().toISOString().split("T")[0]
    const effectiveDate = dynamicDate || todayStr

    let effectiveOrdered = studyData.ordered || ""
    if (effectiveOrdered && /\d{4}-\d{2}-\d{2}/.test(effectiveOrdered)) {
      // Already has full date
    } else if (effectiveOrdered) {
      effectiveOrdered = `${effectiveDate} · ${effectiveOrdered}`
    } else {
      const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      effectiveOrdered = `${effectiveDate} · ${nowTime}`
    }
    const newStudy: RadiologyStudyRecord = {
      ...studyData,
      id,
      patient: resolvedPatientName,
      age: resolvedAge,
      gender: resolvedGender,
      opNumber: resolvedOpNumber,
      invoiceNo,
      accessionNo:
        studyData.accessionNo ||
        `RAD-ACC-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: (studyData as any).createdAt || nowIso,
      orderedAt: (studyData as any).orderedAt || nowIso,
      orderDate: studyData.orderDate || effectiveDate || nowIso.split("T")[0],
      ordered: effectiveOrdered,
      status: studyData.status || "Orders",
      paymentStatus: studyData.paymentStatus || "Payment Pending",
    }

    const updated = [newStudy, ...studies.filter((s) => s.id !== id)]

    this.save(STORAGE_KEY_RAD_STUDIES, updated)
    this.invalidateRadiologyStudiesCache()

    if (newStudy.paymentStatus === "Payment Pending") {
      this.ensureRadiologyClaim(newStudy)
    }

    try {
      new BroadcastChannel("hospai_rad_channel").postMessage("changed")
    } catch {}

    this.emitUpdate()

    return newStudy
  }

  static updateRadiologyStudy(
    id: string,
    updates: Partial<RadiologyStudyRecord>,
  ): RadiologyStudyRecord {
    const studies = this.load<RadiologyStudyRecord[]>(
      STORAGE_KEY_RAD_STUDIES,
      INITIAL_RAD_STUDIES,
    )

    const target = (id || "").trim().toLowerCase()
    let idx = studies.findIndex((s) => s.id && s.id.toLowerCase() === target)
    if (idx < 0) {
      idx = studies.findIndex(
        (s) =>
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target) ||
          (s.mrn && s.mrn.toLowerCase() === target),
      )
    }

    if (idx < 0) {
      // Check if study exists in initial seed studies
      const initialMatch = INITIAL_RAD_STUDIES.find(
        (s) =>
          (s.id && s.id.toLowerCase() === target) ||
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target),
      )
      if (initialMatch) {
        const newRecord = { ...initialMatch, ...updates, id: initialMatch.id || id }
        const updatedList = [newRecord, ...studies]
        this.save(STORAGE_KEY_RAD_STUDIES, updatedList)
        this.invalidateRadiologyStudiesCache()
        this.emitUpdate()
        try {
          new BroadcastChannel("hospai_rad_channel").postMessage("changed")
        } catch {}
        return newRecord
      }
      // If neither exists, do NOT synthesize a placeholder "Diagnostic Imaging Study"
      console.warn(`Radiology study '${id}' not found in active records or seed catalog; skipping phantom record creation.`)
      return null as unknown as RadiologyStudyRecord
    }

    const updated = { ...studies[idx], ...updates }
    for (const key of Object.keys(updates)) {
      if ((updates as any)[key] === undefined) {
        delete (updated as any)[key]
      }
    }

    studies[idx] = updated

    this.save(STORAGE_KEY_RAD_STUDIES, studies)
    this.invalidateRadiologyStudiesCache()

    this.emitUpdate()

    try {
      new BroadcastChannel("hospai_rad_channel").postMessage("changed")
    } catch {}

    return updated
  }

  static deleteRadiologyStudy(id: string): void {
    const studies = this.getRadiologyStudies().filter((s) => s.id !== id)

    this.save(STORAGE_KEY_RAD_STUDIES, studies)
    this.invalidateRadiologyStudiesCache()
    this.emitUpdate()
    try {
      new BroadcastChannel("hospai_rad_channel").postMessage("changed")
    } catch {}
  }

  // ── EMERGENCY DEPARTMENT DISCHARGE / BED TRANSFER FINANCIAL CLEARANCE ──────

  static getErFinancialClearance(
    visitNoOrPatientId: string,
    optionalPatientName?: string,
  ): {
    isCleared: boolean

    status: "paid" | "due" | "unbilled"

    hasActiveBill: boolean

    balanceDue: number

    totalAmount: number

    unbilledAmount: number

    receiptNo?: string

    invoiceNo?: string

    claimId?: string

    patientName?: string

    hasPendingCharges?: boolean

    pendingInvoices?: {
      invoiceNo: string
      dueAmount: number
      department: string
    }[]
  } {
    const claims = this.getClaims()

    const deptCharges = this.getDepartmentCharges()

    const query = (visitNoOrPatientId || "").toLowerCase().trim()

    const nameQuery = (optionalPatientName || "").toLowerCase().trim()

    const mrnClean = query.replace("umr", "").trim()

    const isEncounterQuery = Boolean(
      query &&
        (query.startsWith("er-") ||
          query.startsWith("enc-") ||
          /^\d+$/.test(query)),
    );

    const matchingClaims = claims.filter((c) => {
      if (c.status === "Voided") return false

      const pId = (c.patientId || "").toLowerCase().trim()

      const encId = (c.encounterId || "").toLowerCase().trim()

      const invNo = (c.invoiceNo || "").toLowerCase().trim()

      const cId = (c.id || "").toLowerCase().trim()

      const cName = (c.patientName || "").toLowerCase().trim()

      const cMrn = (c.mrn || "").toLowerCase().trim()

      // 1. Exact encounter match or invoice or claim ID match
      if (
        query &&
        (encId === query ||
          invNo === query ||
          cId === query ||
          encId === `er-${query}`)
      )
        return true;

      // If query is an encounter ID, claims with a different encounter ID belong to other visits!
      if (
        isEncounterQuery &&
        encId &&
        encId !== query &&
        encId !== `er-${query}`
      ) {
        return false;
      }
      // 2. Match by MRN or patientId ONLY for Emergency department and if claim has no conflicting encounter
      if (
        !isEncounterQuery &&
        query &&
        (pId === query ||
          cMrn === query ||
          (mrnClean &&
            (cMrn === mrnClean ||
              pId.replace("umr", "").replace("p-", "") === mrnClean)))
      ) {
        if (c.department === "Emergency" && (!encId || encId === query))
          return true;
      }

      // 3. Match by exact patient name ONLY for Emergency department if claim has no conflicting encounter
      if (
        !isEncounterQuery &&
        nameQuery &&
        nameQuery.length >= 3 &&
        nameQuery !== "patient" &&
        nameQuery !== "unknown" &&
        cName === nameQuery
      ) {
        if (c.department === "Emergency" && (!encId || encId === query))
          return true;
      }

      return false
    })

    // Prioritize exact encounter match, then Emergency department, then active balance due, then newest
    matchingClaims.sort((a, b) => {
      const aEnc =
        query && (a.encounterId || "").toLowerCase().trim() === query ? 1 : 0;
      const bEnc =
        query && (b.encounterId || "").toLowerCase().trim() === query ? 1 : 0;
      if (bEnc !== aEnc) return bEnc - aEnc;

      const aEr = a.department === "Emergency" ? 1 : 0;
      const bEr = b.department === "Emergency" ? 1 : 0;
      if (bEr !== aEr) return bEr - aEr;

      const aDue = (a.balanceDue || 0) > 0 ? 1 : 0;
      const bDue = (b.balanceDue || 0) > 0 ? 1 : 0;
      if (bDue !== aDue) return bDue - aDue;

      return (
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
      );
    });

    const matchingDeptCharges = deptCharges.filter((d) => {
      const pId = (d.patientId || "").toLowerCase().trim()

      const encId = (d.encounterId || "").toLowerCase().trim()

      const dName = (d.patientName || "").toLowerCase().trim()

      if (d.department !== "Emergency") return false

      if (query && (encId === query || encId === `er-${query}`)) return true;

      if (!isEncounterQuery) {
        if (query && pId === query) return true;

        if (
          nameQuery.length >= 3 &&
          nameQuery !== "patient" &&
          nameQuery !== "unknown" &&
          dName === nameQuery
        ) {
          return true;
        }
      }

      return false;
    });

    const unInvoicedCharges = matchingDeptCharges.filter(
      (d) => d.status !== "Invoiced in Central Billing",
    )

    let totalUnbilledCharges = unInvoicedCharges.reduce(
      (sum, d) => sum + (d.totalAmount || 0),
      0,
    )

    // Also look up the ErVisit record to count charted medications, treatments, or procedures not yet staged in deptCharges
    if (totalUnbilledCharges === 0) {
      try {
        const allVisits = ErDatabase.getVisits("all");
        const visit = allVisits.find((v) => {
          const vNo = (v.visit_no || "").toLowerCase().trim();
          const vId = String(v.id).trim();
          return (
            (query &&
              (vNo === query || vId === query || `er-${vId}` === query)) ||
            (nameQuery &&
              nameQuery !== "patient" &&
              nameQuery !== "unknown" &&
              [v.patient_name, v.patient_last_name]
                .filter(Boolean)
                .join(" ")
                .toLowerCase() === nameQuery)
          );
        });

        if (visit) {
          // 1. Charted treatments / medications on the visit
          if (visit.treatments && visit.treatments.length > 0) {
            visit.treatments.forEach((t) => {
              const medName = t.description || t.intervention_type || "";
              if (medName) {
                const tariff = resolveErItemPrice(medName, "medication");
                totalUnbilledCharges += tariff.unitPrice;
              }
            });
          }

          // 2. Charted investigations
          if (visit.investigations && visit.investigations.length > 0) {
            visit.investigations.forEach((inv) => {
              const testName = inv.test_name || "";
              if (testName) {
                const tariff = resolveErItemPrice(testName, "investigation");
                totalUnbilledCharges += tariff.unitPrice;
              }
            });
          }

          // 3. Charted timeline medication events
          if (visit.timeline_events && visit.timeline_events.length > 0) {
            visit.timeline_events.forEach((ev) => {
              if (
                ev.event_type === "medication_given" ||
                ev.event_type === "intervention_given"
              ) {
                const evName = ev.event_name || ev.notes || "";
                const lower = evName.toLowerCase();
                if (
                  lower.includes("bill") ||
                  lower.includes("invoice") ||
                  lower.includes("central billing") ||
                  lower.includes("dispatch") ||
                  lower.includes("arrival") ||
                  lower.includes("registered") ||
                  lower.includes("triage")
                ) {
                  return;
                }
                if (evName) {
                  const tariff = resolveErItemPrice(
                    evName,
                    ev.event_type === "medication_given"
                      ? "medication"
                      : "intervention",
                  );
                  totalUnbilledCharges += tariff.unitPrice;
                }
              }
            });
          }
        }
      } catch {
        // Safe fallback
      }
    }

    if (matchingClaims.length === 0) {
      return {
        isCleared: false,
        status: "unbilled",
        hasActiveBill: false,
        balanceDue: 0,
        totalAmount: totalUnbilledCharges,
        unbilledAmount: totalUnbilledCharges,
        invoiceNo: unInvoicedCharges[0]?.id,
        claimId: unInvoicedCharges[0]?.id,
        patientName: unInvoicedCharges[0]?.patientName,
        hasPendingCharges: totalUnbilledCharges > 0,
        pendingInvoices: [],
      }
    }

    const claimBalanceDue = matchingClaims.reduce(
      (sum, c) => sum + (c.balanceDue || 0),
      0,
    );

    const claimTotal = matchingClaims.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0,
    );

    const latestClaim = matchingClaims[0];

    const latestPayment =
      latestClaim?.payments && latestClaim.payments.length > 0
        ? latestClaim.payments[latestClaim.payments.length - 1]
        : undefined;

    const isDue = claimBalanceDue > 0;

    const isPaid =
      !isDue &&
      (claimTotal > 0 || !!latestPayment || latestClaim?.status === "Paid");

    const status: "paid" | "due" | "unbilled" = isDue
      ? "due"
      : isPaid
        ? "paid"
        : "unbilled";

    const pendingInvoices = matchingClaims
      .filter((c) => (c.balanceDue || 0) > 0)
      .map((c) => ({
        invoiceNo: c.invoiceNo,
        dueAmount: c.balanceDue || 0,
        department: c.department,
      }));

    return {
      isCleared: isPaid,
      status,
      hasActiveBill: true,
      balanceDue: claimBalanceDue,
      totalAmount: claimTotal,
      unbilledAmount: totalUnbilledCharges,
      receiptNo:
        latestPayment?.receiptNo ||
        (isPaid
          ? latestClaim.payments?.[0]?.receiptNo || "RCPT-2026-5501"
          : undefined),
      invoiceNo: latestClaim?.invoiceNo,
      claimId: latestClaim?.id,
      patientName: latestClaim?.patientName,
      hasPendingCharges: totalUnbilledCharges > 0,
      pendingInvoices,
    };
  }

  /**
   * Set preselected claim ID or invoice number to automatically focus on in Central Billing POS
   */

  static setPreselectedClaimForBilling(idOrInvoiceNo: string): void {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(
          "hospai_billing_preselected_claim",
          idOrInvoiceNo,
        )
      }
    } catch {
      // Ignore in non-browser environment
    }
  }

  /**
   * Get and clear preselected claim ID for Central Billing POS
   */

  static getPreselectedClaimForBilling(clear = false): string | null {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        const item = window.sessionStorage.getItem(
          "hospai_billing_preselected_claim",
        );

        if (item && clear) {
          window.sessionStorage.removeItem("hospai_billing_preselected_claim");
        }

        return item || null;
      }
    } catch {
      // Ignore in non-browser environment
    }

    return null;
  }

  static clearPreselectedClaimForBilling(): void {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.removeItem("hospai_billing_preselected_claim");
      }
    } catch {}
  }

  /**
   * Add a real-time clinical charge (Medication, Investigation, or Intervention) to ER encounter
   * If a formal bill has already been dispatched to Central Billing, updates that claim.
   * If not yet dispatched, stages the charge as unbilled in Department Charges without premature "Pending" balance at Central Billing.
   */

  static addErClinicalCharge(
    encounterIdOrVisitNo: string,

    patientInfo: {
      patientId: string

      patientName: string

      mrn?: string

      age?: number

      gender?: string

      phone?: string

      assignedDoctor?: string
    },

    item: {
      description: string

      category: InvoiceItem["category"]

      unitPrice: number

      quantity?: number

      cptCode?: string
    },
  ): { totalAdded: number ;newBalance: number ;description: string } {
    const claims = this.load<ClaimRecord[]>(
      STORAGE_KEY_CLAIMS,
      [],
    )

    const deptCharges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    const query = (encounterIdOrVisitNo || "").toLowerCase().trim()

    const pIdQuery = (patientInfo.patientId || "").toLowerCase().trim()

    const pNameQuery = (patientInfo.patientName || "").toLowerCase().trim()

    const nowIso = new Date().toISOString()

    const qty = item.quantity || 1

    const total = item.unitPrice * qty

    const newItem: InvoiceItem = {
      id: `ITEM-ER-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`,

      description: item.description,

      category: item.category,

      cptCode: item.cptCode || "99285",

      quantity: qty,

      unitPrice: item.unitPrice,

      total,

      insuranceCovered: 0,

      patientPayable: total,
    }

    const isSpecificVisit = Boolean(
      query &&
        (query.startsWith("er-") ||
          query.startsWith("enc-") ||
          /^\d+$/.test(query)),
    )

    // Check if an existing active dispatched Claim exists for this ER encounter

    const claimIdx = claims.findIndex((c) => {
      if (c.status === "Voided") return false

      const pId = (c.patientId || "").toLowerCase().trim()

      const encId = (c.encounterId || "").toLowerCase().trim()

      const invNo = (c.invoiceNo || "").toLowerCase().trim()

      const cId = (c.id || "").toLowerCase().trim()

      const cName = (c.patientName || "").toLowerCase().trim()

      if (query && (encId === query || invNo === query || cId === query))
        return true

      if (!isSpecificVisit && c.department === "Emergency") {
        if (pIdQuery && pId === pIdQuery) return true

        if (
          pNameQuery &&
          pNameQuery.length >= 3 &&
          (cName === pNameQuery ||
            cName.includes(pNameQuery) ||
            pNameQuery.includes(cName))
        )
          return true
      }

      return false
    })

    if (claimIdx >= 0) {
      const current = claims[claimIdx]

      const updatedItems = [...current.items, newItem]

      const subtotal = updatedItems.reduce(
        (sum, it) => sum + Number(it.total || 0),
        0,
      )

      const totalAmount = Math.max(
        0,
        subtotal - (current.discount || 0) + (current.tax || 0),
      )

      const patientPortion = totalAmount

      const balanceDue = Math.max(0, patientPortion - (current.amountPaid || 0))

      const updatedClaim: ClaimRecord = {
        ...current,

        items: updatedItems,

        subtotal,

        totalAmount,

        patientPortion,

        balanceDue,

        status: balanceDue > 0 ? "Accepted" : "Paid",

        updatedAt: nowIso,
      }

      claims[claimIdx] = updatedClaim

      this.save(STORAGE_KEY_CLAIMS, claims)

      BillingRbacManager.logEvent({
        action: "CHARGE_ADDED",

        patientId: updatedClaim.patientId,

        patientName: updatedClaim.patientName,

        mrn: updatedClaim.mrn,

        invoiceNo: updatedClaim.invoiceNo,

        claimId: updatedClaim.id,

        financialAmount: total,

        department: "Emergency",

        reason: `ER Clinical Charge attached to active invoice: "${item.description}" (+₹${total.toLocaleString("en-IN")}). Total Due: ₹${balanceDue.toLocaleString("en-IN")}.`,
      })

      return {
        totalAdded: total,
        newBalance: balanceDue,
        description: item.description,
      }
    }

    // If no active claim has been dispatched yet, stage charge in DepartmentChargeRecord as "Accumulating Charges"

    const deptIdx = deptCharges.findIndex((d) => {
      const encId = (d.encounterId || "").toLowerCase().trim()

      const pId = (d.patientId || "").toLowerCase().trim()

      const dName = (d.patientName || "").toLowerCase().trim()

      if (d.department !== "Emergency") return false

      if (isSpecificVisit) {
        return encId === query
      }

      return (
        (query && (encId === query || pId === query)) ||
        (pNameQuery.length >= 3 &&
          (dName === pNameQuery ||
            dName.includes(pNameQuery) ||
            pNameQuery.includes(dName)))
      )
    })

    if (deptIdx >= 0) {
      const existing = deptCharges[deptIdx]

      const updatedItems = [...existing.items, newItem]

      const subtotal = updatedItems.reduce(
        (sum, it) => sum + Number(it.total || 0),
        0,
      )

      const updatedDept: DepartmentChargeRecord = {
        ...existing,

        items: updatedItems,

        subtotal,

        totalAmount: subtotal,

        status:
          existing.status === "Invoiced in Central Billing"
            ? "Accumulating Charges"
            : existing.status,
      }

      deptCharges[deptIdx] = updatedDept

      this.save(STORAGE_KEY_DEPT_CHARGES, deptCharges);
      this.emitUpdate();

      return {
        totalAdded: total,
        newBalance: subtotal,
        description: item.description,
      }
    }

    const newDeptCharge: DepartmentChargeRecord = {
      id: `DCHG-${Date.now().toString().slice(-6)}`,

      patientId:
        patientInfo.patientId ||
        `UMR${Math.floor(100000 + Math.random() * 900000)}`,

      mrn: patientInfo.mrn || "100245",

      patientName: patientInfo.patientName || "Emergency Patient",

      age: Number(patientInfo.age) || 30,

      gender: patientInfo.gender as any || "Other",

      phone: patientInfo.phone || "+91 98765 43210",

      department: "Emergency",

      encounterId: encounterIdOrVisitNo,

      carePathway: "ER Emergency Clinical Care",

      dateOfService: nowIso.split("T")[0],

      insuranceProvider: "Self-Pay",

      policyNumber: "N/A - Self Pay",

      attendingDoctor: patientInfo.assignedDoctor || "Emergency Attending",

      diagnosisCodes: ["R07.9"],

      items: [newItem],

      subtotal: total,

      totalAmount: total,

      status: "Accumulating Charges",

      createdAt: nowIso,
    }

    deptCharges.unshift(newDeptCharge)

    this.save(STORAGE_KEY_DEPT_CHARGES, deptCharges);
    this.emitUpdate();

    return {
      totalAdded: total,
      newBalance: total,
      description: item.description,
    }
  }

  // ── INPATIENT WARD / ICU DISCHARGE FINANCIAL CLEARANCE ──────────────────────

  static getInpatientFinancialClearance(
    patientIdOrBedId: string | number,
    optionalPatientName?: string,
  ): {
    isCleared: boolean

    balanceDue: number

    totalAmount: number

    receiptNo?: string

    invoiceNo?: string

    claimId?: string

    patientName?: string

    hasPendingCharges?: boolean

    pendingInvoices?: {
      invoiceNo: string
      dueAmount: number
      department: string
    }[]
  } {
    const claims = this.getClaims()

    const deptCharges = this.getDepartmentCharges()

    const query = String(patientIdOrBedId || "")
      .toLowerCase()
      .trim()

    const nameQuery = (optionalPatientName || "").toLowerCase().trim()

    const mrnClean = query.replace("umr", "").trim()

    const matchingClaims = claims.filter((c) => {
      const pId = (c.patientId || "").toLowerCase().trim()

      const pMrn = (c.mrn || "").toLowerCase().trim()

      const encId = (c.encounterId || "").toLowerCase().trim()

      const invNo = (c.invoiceNo || "").toLowerCase().trim()

      const cId = (c.id || "").toLowerCase().trim()

      const cName = (c.patientName || "").toLowerCase().trim()

      return (
        (query &&
          (pId === query ||
            pMrn === mrnClean ||
            encId === query ||
            invNo === query ||
            cId === query)) ||
        (query.length >= 4 &&
          (pId.includes(query) ||
            encId.includes(query) ||
            pMrn.includes(mrnClean))) ||
        (nameQuery.length >= 3 &&
          (cName.includes(nameQuery) || nameQuery.includes(cName)))
      )
    })

    const matchingDeptCharges = deptCharges.filter((d) => {
      const pId = (d.patientId || "").toLowerCase().trim()

      const pMrn = (d.mrn || "").toLowerCase().trim()

      const encId = (d.encounterId || "").toLowerCase().trim()

      const dName = (d.patientName || "").toLowerCase().trim()

      return (
        (d.department === "Inpatient" ||
          d.department === "ICU" ||
          d.department === "Surgery") &&
        ((query && (pId === query || pMrn === mrnClean || encId === query)) ||
          (query.length >= 4 &&
            (pId.includes(query) || encId.includes(query))) ||
          (nameQuery.length >= 3 &&
            (dName.includes(nameQuery) || nameQuery.includes(dName))))
      )
    })

    if (matchingClaims.length === 0 && matchingDeptCharges.length === 0) {
      return {
        isCleared: true,
        balanceDue: 0,
        totalAmount: 0,
        pendingInvoices: [],
      }
    }

    const claimBalanceDue = matchingClaims.reduce(
      (sum, c) => sum + (c.balanceDue || 0),
      0,
    )

    const claimTotal = matchingClaims.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0,
    )

    const unInvoicedCharges = matchingDeptCharges.filter(
      (d) => d.status !== "Invoiced in Central Billing",
    )

    const deptChargesDue = unInvoicedCharges.reduce(
      (sum, d) => sum + (d.totalAmount || 0),
      0,
    )

    const totalBalanceDue =
      claimBalanceDue + (matchingClaims.length === 0 ? deptChargesDue : 0)

    const totalAmount = claimTotal || deptChargesDue

    const latestClaim = matchingClaims[0]

    const latestPayment =
      latestClaim?.payments && latestClaim.payments.length > 0
        ? latestClaim.payments[latestClaim.payments.length - 1]
        : undefined

    const pendingInvoices = matchingClaims

      .filter((c) => (c.balanceDue || 0) > 0)

      .map((c) => ({
        invoiceNo: c.invoiceNo,

        dueAmount: c.balanceDue || 0,

        department: c.department,
      }))

    return {
      isCleared: totalBalanceDue === 0,

      balanceDue: totalBalanceDue,

      totalAmount,

      receiptNo:
        latestPayment?.receiptNo ||
        (totalBalanceDue === 0 ? "RCPT-2026-5501" : undefined),

      invoiceNo: latestClaim?.invoiceNo || unInvoicedCharges[0]?.id,

      claimId: latestClaim?.id || unInvoicedCharges[0]?.id,

      patientName:
        latestClaim?.patientName || unInvoicedCharges[0]?.patientName,

      hasPendingCharges: unInvoicedCharges.length > 0,

      pendingInvoices,
    }
  }

  static getAllPayments(): (PaymentRecord & {
    patientName: string;
    patientId: string;
    mrn: string;
    invoiceNo: string;
    department: DepartmentType;
  })[] {
    const claims = this.getClaims()

    const paymentsList: (PaymentRecord & {
      patientName: string;
      patientId: string;
      mrn: string;
      invoiceNo: string;
      department: DepartmentType;
    })[] = []

    claims.forEach((c) => {
      ;(c.payments || []).forEach((p) => {
        paymentsList.push({
          ...p,
          patientName: c.patientName,
          patientId: c.patientId,
          mrn: c.mrn,
          invoiceNo: c.invoiceNo,
          department: c.department,
        })
      })
    })

    // Ingest paid lab orders from hospai_lab_orders_v2
    try {
      if (typeof window !== "undefined") {
        const rawOrders = window.localStorage.getItem("hospai_lab_orders_v2")
        if (rawOrders) {
          const parsed = JSON.parse(rawOrders)
          parsed.forEach((order: any) => {
            if (order.billing?.status === "Paid" && order.billing?.receiptNo) {
              const alreadyExists = paymentsList.some(
                (p) => p.receiptNo === order.billing.receiptNo || p.invoiceNo === order.id
              )
              if (!alreadyExists) {
                const mappedMethod =
                  order.billing.mode === "UPI"
                    ? "UPI / Digital"
                    : order.billing.mode === "Card"
                    ? "Debit Card"
                    : order.billing.mode === "Insurance"
                    ? "Insurance Copay"
                    : order.billing.mode === "Corporate"
                    ? "Bank Transfer"
                    : "Cash"

                paymentsList.push({
                  id: `PAY-LAB-${order.id}`,
                  invoiceId: order.id,
                  receiptNo: order.billing.receiptNo,
                  amount: Number(order.billing.total || order.billing.subtotal || 0),
                  paymentDate: order.billing.paidAt || order.createdAt || new Date().toISOString(),
                  paymentMethod: mappedMethod as any,
                  collectedBy: order.billing.collectedBy || "Laboratory Billing Desk",
                  patientName: order.patientName || "Patient",
                  patientId: order.umr || order.patientId || "",
                  mrn: order.umr || order.patientId || "",
                  invoiceNo: order.id,
                  department: "Laboratory",
                })
              }
            }
          })
        }
      }
    } catch {}

    // Ingest paid lab orders from STORAGE_KEY_LAB_ORDERS
    try {
      const storedLabOrders = this.load<any[]>(STORAGE_KEY_LAB_ORDERS, [])
      storedLabOrders.forEach((lo) => {
        if (lo.paymentStatus === "Paid" && (lo.paidReceiptNo || lo.receiptNo)) {
          const rcpt = lo.paidReceiptNo || lo.receiptNo
          const alreadyExists = paymentsList.some((p) => p.receiptNo === rcpt)
          if (!alreadyExists) {
            paymentsList.push({
              id: `PAY-LAB-${lo.id}`,
              invoiceId: lo.id,
              receiptNo: rcpt,
              amount: Number(lo.price || lo.total || lo.amount || 0),
              paymentDate: lo.paidAt || lo.date || new Date().toISOString(),
              paymentMethod: "Cash",
              collectedBy: "Laboratory Billing Desk",
              patientName: lo.patientName || "Patient",
              patientId: lo.umr || lo.patientId || lo.mrn || "",
              mrn: lo.umr || lo.patientId || lo.mrn || "",
              invoiceNo: lo.id || lo.orderId,
              department: "Laboratory",
            })
          }
        }
      })
    } catch {}

    return paymentsList.sort(
      (a, b) =>
        new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime(),
    )
  }

  static voidClaim(id: string, reason: string): ClaimRecord {
    const claim = this.getClaimById(id)

    if (!claim) throw new Error("Invoice not found")

    const updated = this.updateClaim(id, {
      status: "Voided",

      balanceDue: 0,

      denialReason: `Voided / Reversed: ${reason}`,

      updatedAt: new Date().toISOString(),
    })

    BillingRbacManager.logEvent({
      action: "INVOICE_VOIDED",

      patientId: claim.patientId,

      patientName: claim.patientName,

      mrn: claim.mrn,

      invoiceNo: claim.invoiceNo,

      claimId: claim.id,

      financialAmount: claim.totalAmount,

      department: claim.department,

      originalValue: `Status: ${claim.status}, Total: ₹${claim.totalAmount.toLocaleString("en-IN")}`,

      newValue: "Status: Voided, Balance Due: ₹0",

      reason: `Authorized invoice void: ${reason}`,
    })

    return updated
  }

  static applyDirectAdjustment(
    id: string,

    amount: number,

    adjustmentType: string,

    reason: string,
  ): ClaimRecord {
    const claim = this.getClaimById(id)

    if (!claim) throw new Error("Invoice not found")

    const newDiscount = (claim.discount || 0) + amount

    const newTotal = Math.max(
      0,
      claim.subtotal - newDiscount + (claim.tax || 0),
    )

    const newPatientPortion = Math.max(0, claim.patientPortion - amount)

    const newBalanceDue = Math.max(
      0,
      newPatientPortion - (claim.amountPaid || 0),
    )

    const updated = this.updateClaim(id, {
      discount: newDiscount,

      totalAmount: newTotal,

      patientPortion: newPatientPortion,

      balanceDue: newBalanceDue,

      updatedAt: new Date().toISOString(),
    })

    BillingRbacManager.logEvent({
      action: "ADJUSTMENT_APPLIED",

      patientId: claim.patientId,

      patientName: claim.patientName,

      mrn: claim.mrn,

      invoiceNo: claim.invoiceNo,

      claimId: claim.id,

      financialAmount: amount,

      department: claim.department,

      reason: `Direct adjustment applied (${adjustmentType}) for ₹${amount.toLocaleString("en-IN")}: ${reason}`,
    })

    return updated
  }

  static deleteClaim(id: string): void {
    this.voidClaim(id, "Administrative removal / reversal requested")
  }

  // ── DEPARTMENT-TO-BILLING WORKQUEUE METHODS ─────────────────────────────────

  static getDepartmentCharges(filter?: {
    status?: string

    department?: DepartmentType | "All"

    search?: string

    umr?: string
  }): DepartmentChargeRecord[] {
    let charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    // Deduplicate charges by encounterId (keep the latest record if duplicates exist)

    const seenEncounters = new Set<string>()

    const deduplicated: DepartmentChargeRecord[] = []

    for (const c of charges) {
      const key = c.encounterId ? `${c.patientId || ""}-${c.encounterId}` : c.id

      if (!seenEncounters.has(key)) {
        seenEncounters.add(key)

        deduplicated.push(c)
      }
    }

    charges = deduplicated

    if (filter) {
      if (filter.department && filter.department !== "All") {
        charges = charges.filter((c) => c.department === filter.department)
      }

      if (filter.status && filter.status !== "All") {
        charges = charges.filter((c) => c.status === filter.status)
      }

      if (filter.umr && filter.umr.trim()) {
        const u = filter.umr.trim().toLowerCase()

        charges = charges.filter(
          (c) => c.patientId.toLowerCase() === u || c.mrn.toLowerCase() === u,
        )
      }

      if (filter.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase()

        charges = charges.filter(
          (c) =>
            c.patientName.toLowerCase().includes(q) ||
            c.mrn.toLowerCase().includes(q) ||
            c.patientId.toLowerCase().includes(q) ||
            c.encounterId.toLowerCase().includes(q) ||
            (c.hospitalStayId && c.hospitalStayId.toLowerCase().includes(q)) ||
            c.items.some(
              (it) =>
                it.description.toLowerCase().includes(q) ||
                it.cptCode.toLowerCase().includes(q),
            ),
        )
      }
    }

    return charges.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }

  static getDepartmentChargeById(
    id: string,
  ): DepartmentChargeRecord | undefined {
    const charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    return charges.find((c) => c.id === id || c.encounterId === id)
  }

  static createDepartmentCharge(
    data: Partial<DepartmentChargeRecord>,
  ): DepartmentChargeRecord {
    let charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    const nowIso = new Date().toISOString()

    const id = `DCHG-${Date.now().toString().slice(-6)}`

    const items = data.items || []

    const subtotal = items.reduce((sum, it) => sum + Number(it.total || 0), 0)

    // Upsert: If a charge packet already exists for this encounter, update it instead of creating a duplicate

    const existingIndex = charges.findIndex(
      (c) =>
        (data.encounterId && c.encounterId === data.encounterId) ||
        (data.id && c.id === data.id),
    )

    if (existingIndex >= 0) {
      const existing = charges[existingIndex]

      const updatedRecord: DepartmentChargeRecord = {
        ...existing,

        ...data,

        id: existing.id,

        items,

        subtotal,

        totalAmount: subtotal,

        status: data.status || existing.status,

        finalizedAt: data.finalizedAt || existing.finalizedAt || nowIso,
      }

      charges[existingIndex] = updatedRecord

      // Also purge any historical duplicate packets with same encounterId

      if (data.encounterId) {
        charges = charges.filter(
          (c, idx) =>
            idx === existingIndex || c.encounterId !== data.encounterId,
        )
      }

      this.save(STORAGE_KEY_DEPT_CHARGES, charges)

      return updatedRecord
    }

    const newRecord: DepartmentChargeRecord = {
      id,

      patientId:
        data.patientId || `UMR${Math.floor(100000 + Math.random() * 900000)}`,

      mrn: data.mrn || `100${Math.floor(100 + Math.random() * 899)}`,

      patientName: data.patientName || "Department Patient",

      age: data.age || 40,

      gender: data.gender || "Other",

      phone: data.phone || "+91 98765 43210",

      encounterId: data.encounterId || `ENC-${Date.now().toString().slice(-6)}`,

      hospitalStayId: data.hospitalStayId,

      department: data.department || "Outpatient",

      carePathway: data.carePathway,

      dateOfService: data.dateOfService || nowIso.split("T")[0],

      insuranceProvider: data.insuranceProvider || "Star Health",

      policyNumber: data.policyNumber || "SH-POL-2026",

      preAuthCode: data.preAuthCode,

      attendingDoctor: data.attendingDoctor || "Dr. Staff Physician",

      diagnosisCodes: data.diagnosisCodes || ["Z00.00"],

      items,

      subtotal,

      totalAmount: subtotal,

      status: data.status || "Accumulating Charges",

      verifiedByNurse: data.verifiedByNurse,

      finalizedAt: data.finalizedAt,

      createdAt: nowIso,

      notes: data.notes,
    }

    charges.unshift(newRecord)

    this.save(STORAGE_KEY_DEPT_CHARGES, charges)

    BillingRbacManager.logEvent({
      action: "CHARGE_ADDED",

      patientId: newRecord.patientId,

      patientName: newRecord.patientName,

      mrn: newRecord.mrn,

      invoiceNo: "DEPT-RUNNING",

      financialAmount: newRecord.totalAmount,

      department: newRecord.department,

      reason: `Department charge sheet created for ${newRecord.department} under UMR ${newRecord.patientId} (${newRecord.items.length} services attached).`,
    })

    return newRecord
  }

  static addServiceToDepartmentCharge(
    chargeId: string,
    item: Omit<InvoiceItem, "id">,
  ): DepartmentChargeRecord {
    const charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    const idx = charges.findIndex((c) => c.id === chargeId)

    if (idx < 0) throw new Error("Department charge sheet not found")

    const current = charges[idx]

    const newItem: InvoiceItem = {
      ...item,

      id: `IT-${Date.now().toString().slice(-4)}-${Math.floor(10 + Math.random() * 89)}`,
    }

    const updatedItems = [...current.items, newItem]

    const subtotal = updatedItems.reduce(
      (sum, it) => sum + Number(it.total || 0),
      0,
    )

    const updated: DepartmentChargeRecord = {
      ...current,

      items: updatedItems,

      subtotal,

      totalAmount: subtotal,
    }

    charges[idx] = updated

    this.save(STORAGE_KEY_DEPT_CHARGES, charges)

    BillingRbacManager.logEvent({
      action: "CHARGE_ADDED",

      patientId: current.patientId,

      patientName: current.patientName,

      mrn: current.mrn,

      invoiceNo: "DEPT-RUNNING",

      financialAmount: newItem.total,

      department: current.department,

      reason: `Service added under UMR ${current.patientId} (${current.department}): "${newItem.description}" (₹${newItem.total.toLocaleString("en-IN")}).`,
    })

    return updated
  }

  static finalizeDepartmentCharges(
    chargeId: string,
    verifiedByNurse: string,
    notes?: string,
  ): DepartmentChargeRecord {
    const charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    const idx = charges.findIndex((c) => c.id === chargeId)

    if (idx < 0) throw new Error("Department charge sheet not found")

    const current = charges[idx]

    const nowIso = new Date().toISOString()

    const updated: DepartmentChargeRecord = {
      ...current,

      status: "Finalized by Dept",

      verifiedByNurse,

      finalizedAt: nowIso,

      notes:
        notes ||
        current.notes ||
        "All clinical charges verified and finalized by department nurse. Transferred to Universal Billing.",
    }

    charges[idx] = updated

    this.save(STORAGE_KEY_DEPT_CHARGES, charges)

    BillingRbacManager.logEvent({
      action: "CHARGE_ADDED",

      patientId: current.patientId,

      patientName: current.patientName,

      mrn: current.mrn,

      invoiceNo: "DEPT-FINALIZED",

      financialAmount: current.totalAmount,

      department: current.department,

      reason: `Department charges finalized by ${verifiedByNurse} for UMR ${current.patientId} (Total: ₹${current.totalAmount.toLocaleString("en-IN")}). Sent to Central Billing queue.`,
    })

    return updated
  }

  static convertDepartmentChargeToInvoice(
    chargeId: string,

    billingStaffName: string,

    customOptions?: {
      insuranceProvider?: string
      preAuthCode?: string
      discount?: number
    },
  ): ClaimRecord {
    const charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    const idx = charges.findIndex((c) => c.id === chargeId)

    if (idx < 0) throw new Error("Department charge packet not found")

    const deptRecord = charges[idx]

    const payer =
      customOptions?.insuranceProvider ||
      deptRecord.insuranceProvider ||
      "Star Health"

    const isSelfPay = payer === "Self-Pay"

    const mappedItems: InvoiceItem[] = deptRecord.items.map((it) => {
      const ins = isSelfPay ? 0 : Math.round(it.total * 0.8)

      const pt = it.total - ins

      return {
        ...it,

        insuranceCovered: ins,

        patientPayable: pt,
      }
    })

    const newClaim = this.createClaim({
      patientId: deptRecord.patientId,

      patientName: deptRecord.patientName,

      mrn: deptRecord.mrn,

      age: deptRecord.age,

      gender: deptRecord.gender,

      phone: deptRecord.phone,

      department: deptRecord.department,

      carePathway: deptRecord.carePathway,

      dateOfService: deptRecord.dateOfService,

      encounterId: deptRecord.encounterId,

      hospitalStayId: deptRecord.hospitalStayId,

      insuranceProvider: payer,

      policyNumber: deptRecord.policyNumber,

      preAuthCode: customOptions?.preAuthCode || deptRecord.preAuthCode,

      attendingDoctor: deptRecord.attendingDoctor,

      diagnosisCodes: deptRecord.diagnosisCodes,

      finalizedByNurse: deptRecord.verifiedByNurse,

      discount: customOptions?.discount || 0,

      status: "Ready",

      items: mappedItems,
    })

    // Mark department record as invoiced

    deptRecord.status = "Invoiced in Central Billing"

    deptRecord.invoiceId = newClaim.id

    charges[idx] = deptRecord

    this.save(STORAGE_KEY_DEPT_CHARGES, charges)

    BillingRbacManager.logEvent({
      action: "INVOICE_FINALIZED",

      patientId: newClaim.patientId,

      patientName: newClaim.patientName,

      mrn: newClaim.mrn,

      invoiceNo: newClaim.invoiceNo,

      claimId: newClaim.id,

      financialAmount: newClaim.totalAmount,

      department: newClaim.department,

      reason: `Central billing generated official invoice ${newClaim.invoiceNo} from finalized ${deptRecord.department} charge packet (Staff: ${billingStaffName}).`,
    })

    return newClaim
  }

  static consolidateHospitalStayInvoices(
    hospitalStayId: string,

    billingStaffName: string,
  ): ClaimRecord {
    const charges = this.load<DepartmentChargeRecord[]>(
      STORAGE_KEY_DEPT_CHARGES,
      INITIAL_DEPARTMENT_CHARGES,
    )

    const stayCharges = charges.filter(
      (c) =>
        (c.hospitalStayId === hospitalStayId ||
          c.encounterId === hospitalStayId) &&
        c.status !== "Invoiced in Central Billing",
    )

    if (stayCharges.length === 0)
      throw new Error("No active stay charges found to consolidate")

    const primary = stayCharges[0]

    const allItems: InvoiceItem[] = []

    stayCharges.forEach((c) => {
      allItems.push(...c.items)
    })

    const isSelfPay = primary.insuranceProvider === "Self-Pay"

    const mappedItems = allItems.map((it) => {
      const ins = isSelfPay ? 0 : Math.round(it.total * 0.8)

      const pt = it.total - ins

      return {
        ...it,

        insuranceCovered: ins,

        patientPayable: pt,
      }
    })

    const consolidatedClaim = this.createClaim({
      patientId: primary.patientId,

      patientName: primary.patientName,

      mrn: primary.mrn,

      age: primary.age,

      gender: primary.gender,

      phone: primary.phone,

      department: "Inpatient",

      carePathway: `Consolidated Hospital Stay (${stayCharges.map((s) => s.department).join(" → ")})`,

      dateOfService: primary.dateOfService,

      hospitalStayId,

      insuranceProvider: primary.insuranceProvider,

      policyNumber: primary.policyNumber,

      preAuthCode: primary.preAuthCode,

      attendingDoctor: primary.attendingDoctor,

      diagnosisCodes: primary.diagnosisCodes,

      status: "Ready",

      items: mappedItems,
    })

    stayCharges.forEach((sc) => {
      sc.status = "Invoiced in Central Billing"

      sc.invoiceId = consolidatedClaim.id
    })

    this.save(STORAGE_KEY_DEPT_CHARGES, charges)

    BillingRbacManager.logEvent({
      action: "INVOICE_FINALIZED",

      patientId: consolidatedClaim.patientId,

      patientName: consolidatedClaim.patientName,

      mrn: consolidatedClaim.mrn,

      invoiceNo: consolidatedClaim.invoiceNo,

      claimId: consolidatedClaim.id,

      financialAmount: consolidatedClaim.totalAmount,

      department: "Inpatient",

      reason: `Consolidated single hospital stay invoice ${consolidatedClaim.invoiceNo} created across ${stayCharges.length} departments for UMR ${consolidatedClaim.patientId} (Staff: ${billingStaffName}).`,
    })

    return consolidatedClaim
  }

  // ── UMR CENTRAL FINANCIAL LEDGER ENGINE ─────────────────────────────────────

  /**
   * Constructs the complete, authoritative financial ledger for any patient by UMR.
   * Aggregates all OP, ER, Inpatient, ICU, Surgery, Lab, and Radiology charges,
   * invoices, claims, and payment records without missing or duplicating transactions.
   */

  static getUmrLedger(umrQuery: string): UmrFinancialLedger | null {
    if (!umrQuery || !umrQuery.trim()) return null

    const cleanQuery = umrQuery.trim().toUpperCase()

    // 1. Search comprehensively across all collections

    const allClaimsList = this.getClaims()

    const allDeptChargesList = this.getDepartmentCharges()

    const opPatients = db.getPatients()

    const erPatients = ErDatabase.getPatients()

    const beds = BedDatabase.getBeds()

    // Priority 1: Exact UMR match

    let matchedUmr = ""

    let matchedName = ""

    let matchedMrn = ""

    let matchedAge = 40

    let matchedGender: "Male" | "Female" | "Other" = "Male"

    let matchedPhone = "+91 98765 43210"

    let matchedPayer = "Self-Pay"

    let matchedPolicy = "N/A"

    const exactClaim = allClaimsList.find(
      (c) => c.patientId.toUpperCase() === cleanQuery,
    )

    const exactDept = allDeptChargesList.find(
      (c) => c.patientId.toUpperCase() === cleanQuery,
    )

    const exactOp = opPatients.find((p) => p.umr.toUpperCase() === cleanQuery)

    const exactEr = erPatients.find(
      (p) => p.patient_id.toUpperCase() === cleanQuery,
    )

    if (exactClaim) {
      matchedUmr = exactClaim.patientId

      matchedName = exactClaim.patientName

      matchedMrn = exactClaim.mrn

      matchedAge = exactClaim.age

      matchedGender = exactClaim.gender

      matchedPhone = exactClaim.phone

      matchedPayer = exactClaim.insuranceProvider

      matchedPolicy = exactClaim.policyNumber
    } else if (exactDept) {
      matchedUmr = exactDept.patientId

      matchedName = exactDept.patientName

      matchedMrn = exactDept.mrn

      matchedAge = exactDept.age

      matchedGender = exactDept.gender

      matchedPhone = exactDept.phone

      matchedPayer = exactDept.insuranceProvider

      matchedPolicy = exactDept.policyNumber
    } else if (exactOp) {
      matchedUmr = exactOp.umr

      matchedName = exactOp.name

      matchedMrn = exactOp.umr.replace(/\D/g, "") || "100501"

      matchedAge = exactOp.age

      matchedGender = ((exactOp.sex === "Female" ? "Female" : "Male") as any)

      matchedPhone = exactOp.phone

      matchedPayer = (exactOp as any).insurance || "Self-Pay"
    } else if (exactEr) {
      matchedUmr = exactEr.patient_id

      matchedName = `${exactEr.name} ${exactEr.last_name}`.trim()

      matchedMrn = exactEr.patient_id.replace(/\D/g, "") || "100501"

      matchedAge = exactEr.age

      matchedGender = ((exactEr.gender === "Female" ? "Female" : "Male") as any)

      matchedPhone = exactEr.phone
    } else {
      // Priority 2: Substring Name or Phone or MRN match

      const nameOp = opPatients.find(
        (p) =>
          p.name.toUpperCase().includes(cleanQuery) ||
          p.phone.includes(cleanQuery),
      )

      const nameClaim = allClaimsList.find(
        (c) =>
          c.patientName.toUpperCase().includes(cleanQuery) ||
          c.phone.includes(cleanQuery) ||
          c.mrn.includes(cleanQuery),
      )

      const nameDept = allDeptChargesList.find(
        (c) =>
          c.patientName.toUpperCase().includes(cleanQuery) ||
          c.phone.includes(cleanQuery) ||
          c.mrn.includes(cleanQuery),
      )

      const nameEr = erPatients.find(
        (p) =>
          `${p.name} ${p.last_name}`.toUpperCase().includes(cleanQuery) ||
          p.phone.includes(cleanQuery),
      )

      if (nameOp) {
        matchedUmr = nameOp.umr

        matchedName = nameOp.name

        matchedAge = nameOp.age

        matchedGender = ((nameOp.sex === "Female" ? "Female" : "Male") as any)

        matchedPhone = nameOp.phone
      } else if (nameClaim) {
        matchedUmr = nameClaim.patientId

        matchedName = nameClaim.patientName

        matchedAge = nameClaim.age

        matchedGender = nameClaim.gender

        matchedPhone = nameClaim.phone
      } else if (nameDept) {
        matchedUmr = nameDept.patientId

        matchedName = nameDept.patientName

        matchedAge = nameDept.age

        matchedGender = nameDept.gender

        matchedPhone = nameDept.phone
      } else if (nameEr) {
        matchedUmr = nameEr.patient_id

        matchedName = `${nameEr.name} ${nameEr.last_name}`.trim()

        matchedAge = nameEr.age

        matchedGender = ((
          nameEr.gender === "Female" ? "Female" : "Male"
        ) as any)

        matchedPhone = nameEr.phone
      } else {
        matchedUmr = cleanQuery

        matchedName = "Hospital Patient"
      }
    }

    const effectiveUmr = matchedUmr || cleanQuery

    const effectiveName = matchedName || "Hospital Patient"

    const mrn = matchedMrn || effectiveUmr.replace(/\D/g, "") || "100501"

    const age = matchedAge || 40

    const gender = matchedGender || "Male"

    const phone = matchedPhone || "+91 98765 43210"

    // 2. Fetch all Invoices & Claims linked to this UMR

    const allClaims = this.getClaims({ umr: effectiveUmr })

    // 3. Fetch all Department Charge packets linked to this UMR

    const allDeptCharges = this.getDepartmentCharges({ umr: effectiveUmr })

    // 4. Build Encounters list from OP, ER, Bed DB, and Dept Charges

    const encounters: EncounterChargeSummary[] = []

    const seenEncIds = new Set<string>()

    // Add from Dept Charges

    allDeptCharges.forEach((dc) => {
      if (!seenEncIds.has(dc.encounterId)) {
        seenEncIds.add(dc.encounterId)

        encounters.push({
          encounterId: dc.encounterId,

          encounterType:
            dc.department === "Outpatient"
              ? "Outpatient"
              : dc.department === "Emergency"
                ? "Emergency"
                : dc.department === "ICU"
                  ? "ICU"
                  : dc.department === "Surgery"
                    ? "Surgery"
                    : "Inpatient Ward",

          department: dc.department,

          date: dc.dateOfService,

          doctor: dc.attendingDoctor,

          status: dc.status,

          items: dc.items,

          totalCharges: dc.totalAmount,

          isFinalized:
            dc.status === "Finalized by Dept" ||
            dc.status === "Invoiced in Central Billing",

          isInvoiced: dc.status === "Invoiced in Central Billing",

          invoiceId: dc.invoiceId,
        })
      }
    })

    // Add OP Encounters from db.ts if not yet in Dept Charges

    const opEncounters = db.getEncountersForPatient(effectiveUmr)

    opEncounters.forEach((enc) => {
      if (!seenEncIds.has(enc.id)) {
        seenEncIds.add(enc.id)

        const items: InvoiceItem[] = [
          {
            id: `OP-IT-${enc.id}-1`,

            description: `${enc.dept} Doctor Consultation (${enc.assignedDoctor || "Attending Specialist"})`,

            category: "Consultation",

            cptCode: "99205",

            quantity: 1,

            unitPrice: 100,

            total: 100,

            insuranceCovered: 80,

            patientPayable: 20,

            orderedBy: enc.assignedDoctor || "OP Physician",

            orderedAt: enc.registrationTime,
          },
        ]

        // Add Lab / Rad investigations ordered by doctor
        ;(enc.investigations || []).forEach((inv, idx) => {
          const isRad =
            inv.toLowerCase().includes("x-ray") ||
            /\b(ct|ct scan|computed tomography|hrct|cect|ncct)\b/i.test(inv) ||
            inv.toLowerCase().includes("mri") ||
            inv.toLowerCase().includes("ultra")

          const uPrice = isRad ? 120 : 50

          items.push({
            id: `OP-IT-${enc.id}-INV-${idx + 1}`,

            description: inv,

            category: isRad ? "Radiology / Imaging" : "Laboratory",

            cptCode: isRad ? "71046" : "85025",

            quantity: 1,

            unitPrice: uPrice,

            total: uPrice,

            insuranceCovered: Math.round(uPrice * 0.8),

            patientPayable: Math.round(uPrice * 0.2),

            orderedBy: enc.assignedDoctor || "OP Physician",
          })
        })

        const total = items.reduce((sum, i) => sum + i.total, 0)

        encounters.push({
          encounterId: enc.id,

          encounterType: "Outpatient",

          department: "Outpatient",

          date: enc.registrationTime.includes("-")
            ? enc.registrationTime.split(" ")[0]
            : new Date().toISOString().split("T")[0],

          doctor: enc.assignedDoctor || "Dr. Rajesh Sharma",

          status:
            enc.status === "OP Completed"
              ? "Finalized by Dept"
              : "Accumulating Charges",

          items,

          totalCharges: total,

          isFinalized: enc.status === "OP Completed",

          isInvoiced: false,
        })
      }
    })

    // Add ER Visits from erDb.ts if not yet recorded

    const erVisits = ErDatabase.getVisits("all").filter(
      (v) => v.patient_id === effectiveUmr,
    )

    erVisits.forEach((v) => {
      const vEncId = v.visit_no

      if (!seenEncIds.has(vEncId)) {
        seenEncIds.add(vEncId)

        const items: InvoiceItem[] = [
          {
            id: `ER-IT-${v.id}-1`,

            description: `Emergency Triage & Acute Care Evaluation (${v.triage_category || "B2"})`,

            category: "Consultation",

            cptCode: "99284",

            quantity: 1,

            unitPrice: 150,

            total: 150,

            insuranceCovered: 120,

            patientPayable: 30,

            orderedBy: v.assigned_doctor_name || "Emergency Physician",
          },
        ]
        ;(v.investigations || []).forEach((inv, idx) => {
          const invPrice = inv.category.toLowerCase().includes("radiology")
            ? 120
            : inv.category.toLowerCase().includes("cardiology")
              ? 80
              : 50

          items.push({
            id: `ER-IT-${v.id}-INV-${idx + 1}`,

            description: inv.test_name,

            category: inv.category.toLowerCase().includes("cardiology")
              ? "Consultation"
              : inv.category.toLowerCase().includes("radiology")
                ? "Radiology / Imaging"
                : "Laboratory",

            cptCode: "84484",

            quantity: 1,

            unitPrice: invPrice,

            total: invPrice,

            insuranceCovered: Math.round(invPrice * 0.8),

            patientPayable: Math.round(invPrice * 0.2),

            orderedBy: inv.ordered_by,
          })
        })

        const total = items.reduce((sum, i) => sum + i.total, 0)

        encounters.push({
          encounterId: vEncId,

          encounterType: "Emergency",

          department: "Emergency",

          date: v.arrival_at
            ? v.arrival_at.split("T")[0]
            : new Date().toISOString().split("T")[0],

          doctor: v.assigned_doctor_name || "Dr. Vikram Seth",

          status: v.closed_at ? "Finalized by Dept" : "Accumulating Charges",

          items,

          totalCharges: total,

          isFinalized: Boolean(v.closed_at),

          isInvoiced: false,
        })
      }
    })

    // 5. Aggregate Financials

    const totalHistoricalCharges = encounters.reduce(
      (sum, e) => sum + e.totalCharges,
      0,
    )

    const totalInvoiced = allClaims.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0,
    )

    const totalPaid = allClaims.reduce((sum, c) => sum + (c.amountPaid || 0), 0)

    const outstandingBalance = allClaims.reduce(
      (sum, c) => sum + (c.balanceDue || 0),
      0,
    )

    const insurancePending = allClaims

      .filter((c) => c.status !== "Paid")

      .reduce(
        (sum, c) =>
          sum + Math.max(0, (c.insurancePortion || 0) - (c.amountPaid || 0)),
        0,
      )

    const allPayments = allClaims.flatMap((c) => c.payments || [])

    return {
      umr: effectiveUmr,

      patientName: effectiveName,

      mrn,

      age,

      gender,

      phone,

      insuranceProvider:
        allClaims[0]?.insuranceProvider ||
        allDeptCharges[0]?.insuranceProvider ||
        "Star Health",

      policyNumber:
        allClaims[0]?.policyNumber ||
        allDeptCharges[0]?.policyNumber ||
        "SH-9921045",

      totalHistoricalCharges,

      totalInvoiced,

      totalPaid,

      outstandingBalance,

      insurancePending,

      encounters,

      invoices: allClaims,

      payments: allPayments,

      activeHospitalStayId: allDeptCharges.find((c) => c.hospitalStayId)
        ?.hospitalStayId,
    }
  }

  /**
   * Returns a list of all distinct UMR ledgers available in the hospital system
   */

  static getAllUmrLedgers(): UmrFinancialLedger[] {
    const umrSet = new Set<string>()

    // Collect all UMRs

    this.getClaims().forEach((c) => umrSet.add(c.patientId))

    this.getDepartmentCharges().forEach((c) => umrSet.add(c.patientId))

    db.getPatients().forEach((p) => umrSet.add(p.umr))

    ErDatabase.getPatients().forEach((p) => umrSet.add(p.patient_id))

    BedDatabase.getBeds().forEach((b) => {
      if (b.patient_id) umrSet.add(b.patient_id)
    })

    const ledgers: UmrFinancialLedger[] = []

    umrSet.forEach((umr) => {
      const ledger = this.getUmrLedger(umr)

      if (ledger) ledgers.push(ledger)
    })

    return ledgers.sort(
      (a, b) => b.totalHistoricalCharges - a.totalHistoricalCharges,
    )
  }

  // ── RESET TO CLEAN SEED DATA ────────────────────────────────────────────────

  static resetToActualData(): void {
    this.save(STORAGE_KEY_CLAIMS, [])

    this.save(STORAGE_KEY_DEPT_CHARGES, INITIAL_DEPARTMENT_CHARGES)
  }

  // ── FINANCIAL METRICS & KPI ENGINE ──────────────────────────────────────────

  static getFinancialMetrics(): FinancialMetrics {
    const claims = this.getClaims()

    const activeClaims = claims.filter((c) => c.status !== "Voided")

    const totalChargesMtd = activeClaims.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0,
    )

    const insurancePending = activeClaims

      .filter((c) => c.status !== "Paid")

      .reduce(
        (sum, c) =>
          sum + Math.max(0, (c.insurancePortion || 0) - (c.amountPaid || 0)),
        0,
      )

    const patientBalance = activeClaims.reduce(
      (sum, c) => sum + (c.balanceDue || 0),
      0,
    )

    const deniedClaims = activeClaims.filter(
      (c) =>
        c.status === "Denied" ||
        c.status === "Rejected" ||
        c.status === "Appeal",
    )

    const deniedCount = deniedClaims.length

    const deniedAmount = deniedClaims.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0,
    )

    const paidClaims = activeClaims.filter((c) => c.status === "Paid")

    const totalCollected = activeClaims.reduce(
      (sum, c) => sum + (c.amountPaid || 0),
      0,
    )

    const collectionsRate =
      totalChargesMtd > 0
        ? Number(((totalCollected / totalChargesMtd) * 100).toFixed(1))
        : 94.2

    const daysInAr = 28.6

    const firstPassRate = 89.4

    const avgClaimValue =
      activeClaims.length > 0
        ? Math.round(totalChargesMtd / activeClaims.length)
        : 28500

    return {
      totalChargesMtd,

      insurancePending,

      patientBalance,

      deniedCount,

      deniedAmount,

      collectionsRate,

      daysInAr,

      firstPassRate,

      avgClaimValue,

      paidCount: paidClaims.length,

      totalClaimsCount: activeClaims.length,
    }
  }

  static getPayerMixMetrics(): PayerMixItem[] {
    const claims = this.getClaims()

    const totalAmount = claims.reduce((sum, c) => sum + (c.totalAmount || 0), 0)

    const payerMap: {
      [payer: string]: { count: number ;amount: number ;color: string }
    } = {
      "Star Health": { count: 0, amount: 0, color: "#1B4FD8" },

      "HDFC ERGO": { count: 0, amount: 0, color: "#0284C7" },

      "ICICI Lombard": { count: 0, amount: 0, color: "#7C3AED" },

      "Care Health": { count: 0, amount: 0, color: "#16A34A" },

      "Bajaj Allianz": { count: 0, amount: 0, color: "#D97706" },

      "PM-JAY (Ayushman Bharat)": { count: 0, amount: 0, color: "#0EA5E9" },

      "Self-Pay": { count: 0, amount: 0, color: "#DC2626" },
    }

    claims.forEach((c) => {
      const payer = c.insuranceProvider || "Self-Pay"

      if (!payerMap[payer]) {
        payerMap[payer] = { count: 0, amount: 0, color: "#64748B" }
      }

      payerMap[payer].count += 1

      payerMap[payer].amount += c.totalAmount || 0
    })

    return Object.entries(payerMap).map(([payer, val]) => ({
      payer,

      claimCount: val.count,

      totalAmount: val.amount,

      pct: totalAmount > 0 ? Math.round((val.amount / totalAmount) * 100) : 0,

      color: val.color,
    }))
  }

  static getArAgingMetrics(): ArAgingItem[] {
    const claims = this.getClaims()

    const unpaidClaims = claims.filter(
      (c) => c.status !== "Paid" && c.totalAmount > 0,
    )

    const totalUnpaid = unpaidClaims.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0,
    )

    const buckets: ArAgingItem[] = [
      {
        bucket: "0–30 Days",
        amount: Math.round(totalUnpaid * 0.55),
        pct: 55,
        color: "#16A34A",
        count: Math.max(1, Math.round(unpaidClaims.length * 0.55)),
      },

      {
        bucket: "31–60 Days",
        amount: Math.round(totalUnpaid * 0.25),
        pct: 25,
        color: "#D97706",
        count: Math.max(1, Math.round(unpaidClaims.length * 0.25)),
      },

      {
        bucket: "61–90 Days",
        amount: Math.round(totalUnpaid * 0.12),
        pct: 12,
        color: "#DC2626",
        count: Math.max(1, Math.round(unpaidClaims.length * 0.12)),
      },

      {
        bucket: "91–120 Days",
        amount: Math.round(totalUnpaid * 0.06),
        pct: 6,
        color: "#B91C1C",
        count: 1,
      },

      {
        bucket: "> 120 Days",
        amount: Math.round(totalUnpaid * 0.02),
        pct: 2,
        color: "#7F1D1D",
        count: 1,
      },
    ]

    return buckets
  }

  static exportClaimsToCSV(): string {
    const claims = this.getClaims()

    const headers = [
      "Claim ID",

      "Invoice No",

      "Patient Name",

      "UMR / MRN",

      "Department",

      "Date of Service",

      "Insurance Provider",

      "Total Amount (INR)",

      "Insurance Portion (INR)",

      "Patient Portion (INR)",

      "Amount Paid (INR)",

      "Balance Due (INR)",

      "Status",
    ]

    const rows = claims.map((c) => [
      c.id,

      c.invoiceNo,

      `"${c.patientName}"`,

      c.patientId,

      c.department,

      c.dateOfService,

      `"${c.insuranceProvider}"`,

      c.totalAmount,

      c.insurancePortion,

      c.patientPortion,

      c.amountPaid,

      c.balanceDue,

      c.status,
    ])

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
  }
}

if (typeof window !== "undefined") {
  (window as any).BillingDatabase = BillingDatabase
}

export interface ErPricedItem {
  name: string

  category: InvoiceItem["category"]

  unitPrice: number

  cptCode: string
}

/**
 * Standardized ER Emergency Item Rate Card Resolution (INR ₹)
 * Maps clinical medicine/investigation/procedure names to standard hospital tariffs and CPT codes.
 */

export function resolveErItemPrice(
  itemName: string,

  itemType: "medication" | "investigation" | "intervention" | "procedure",
): ErPricedItem {
  const norm = (itemName || "").toLowerCase().trim()

  if (
    norm.includes("bill dispatched") ||
    norm.includes("central billing") ||
    norm.includes("billing desk") ||
    norm.includes("invoice") ||
    norm.includes("clearance pending") ||
    norm.includes("patient arrived") ||
    norm.includes("bed assigned") ||
    norm.includes("doctor assigned") ||
    norm.includes("triage")
  ) {
    return {
      name: itemName,
      category: "Administrative" as any,
      unitPrice: 0,
      cptCode: "99080",
    }
  }

  if (itemType === "medication") {
    if (
      norm.includes("aspirin") ||
      norm.includes("ecosprin") ||
      norm.includes("asa")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 150,
        cptCode: "J0120",
      }

    if (
      norm.includes("clopidogrel") ||
      norm.includes("plavix") ||
      norm.includes("ticagrelor") ||
      norm.includes("brilinta")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 250,
        cptCode: "J0121",
      }

    if (
      norm.includes("atorvastatin") ||
      norm.includes("statin") ||
      norm.includes("rosuvastatin")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 180,
        cptCode: "J0122",
      }

    if (
      norm.includes("paracetamol") ||
      norm.includes("pcm") ||
      norm.includes("dolo") ||
      norm.includes("calpol")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 200,
        cptCode: "J0123",
      }

    if (
      norm.includes("ceftriaxone") ||
      norm.includes("monocef") ||
      norm.includes("antibiotic") ||
      norm.includes("augmentin") ||
      norm.includes("pipzo")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 650,
        cptCode: "J0696",
      }

    if (
      norm.includes("pantoprazole") ||
      norm.includes("pantocid") ||
      norm.includes("pan 40") ||
      norm.includes("rabeprazole")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 220,
        cptCode: "J2440",
      }

    if (
      norm.includes("ondansetron") ||
      norm.includes("emset") ||
      norm.includes("zofran")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 180,
        cptCode: "J2405",
      }

    if (
      norm.includes("morphine") ||
      norm.includes("tramadol") ||
      norm.includes("fentanyl") ||
      norm.includes("pethidine")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 450,
        cptCode: "J2270",
      }

    if (norm.includes("furosemide") || norm.includes("lasix"))
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 150,
        cptCode: "J1940",
      }

    if (
      norm.includes("hydrocortisone") ||
      norm.includes("dexamethasone") ||
      norm.includes("steroid") ||
      norm.includes("prednisolone")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 220,
        cptCode: "J1720",
      }

    if (
      norm.includes("salbutamol") ||
      norm.includes("budecort") ||
      norm.includes("nebuliz") ||
      norm.includes("duolin")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 300,
        cptCode: "J7611",
      }

    if (
      norm.includes("nitroglycerin") ||
      norm.includes("ntg") ||
      norm.includes("sorbitrate") ||
      norm.includes("angispan")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 850,
        cptCode: "J3490",
      }

    if (
      norm.includes("heparin") ||
      norm.includes("enoxaparin") ||
      norm.includes("clexane") ||
      norm.includes("fondaparinux")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 950,
        cptCode: "J1644",
      }

    if (
      norm.includes("tenecteplase") ||
      norm.includes("streptokinase") ||
      norm.includes("thromboly") ||
      norm.includes("alteplase")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 24500,
        cptCode: "J3101",
      }

    if (
      norm.includes("saline") ||
      norm.includes("rl") ||
      norm.includes("dns") ||
      norm.includes("ringer") ||
      norm.includes("fluid")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 250,
        cptCode: "J7030",
      }

    if (
      norm.includes("adrenaline") ||
      norm.includes("epinephrine") ||
      norm.includes("atropine") ||
      norm.includes("noradren")
    )
      return {
        name: itemName,
        category: "Consumables",
        unitPrice: 350,
        cptCode: "J0171",
      }

    return {
      name: itemName,
      category: "Consumables",
      unitPrice: 250,
      cptCode: "99070",
    }
  }

  if (itemType === "investigation") {
    if (norm.includes("ecg") || norm.includes("electrocardiogram"))
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 450,
        cptCode: "93000",
      }

    if (norm.includes("troponin"))
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 1200,
        cptCode: "84484",
      }

    if (
      norm.includes("x-ray") ||
      norm.includes("xray") ||
      norm.includes("chest") ||
      norm.includes("radiograph")
    )
      return {
        name: itemName,
        category: "Radiology / Imaging",
        unitPrice: 600,
        cptCode: "71045",
      }

    if (
      norm.includes("ultrasound") ||
      norm.includes("fast") ||
      norm.includes("usg") ||
      norm.includes("sonograph")
    )
      return {
        name: itemName,
        category: "Radiology / Imaging",
        unitPrice: 1500,
        cptCode: "76705",
      }

    if (
      norm.includes("cbc") ||
      norm.includes("blood count") ||
      norm.includes("grbs") ||
      norm.includes("glucose") ||
      norm.includes("sugar")
    )
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 450,
        cptCode: "85025",
      }

    if (norm.includes("abg") || norm.includes("arterial blood gas"))
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 950,
        cptCode: "82803",
      }

    if (/\b(ct|ct scan|computed tomography|hrct|cect|ncct)\b/i.test(norm))
      return {
        name: itemName,
        category: "Radiology / Imaging",
        unitPrice: 3200,
        cptCode: "70450",
      }

    if (norm.includes("mri") || norm.includes("magnetic resonance"))
      return {
        name: itemName,
        category: "Radiology / Imaging",
        unitPrice: 6500,
        cptCode: "70551",
      }

    if (
      norm.includes("renal") ||
      norm.includes("kft") ||
      norm.includes("rft") ||
      norm.includes("electrolyte") ||
      norm.includes("creatinine") ||
      norm.includes("urea")
    )
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 850,
        cptCode: "80069",
      }

    if (
      norm.includes("culture") ||
      norm.includes("blood culture") ||
      norm.includes("urine culture")
    )
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 1200,
        cptCode: "87040",
      }

    if (norm.includes("d-dimer") || norm.includes("dimer"))
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 1400,
        cptCode: "85379",
      }

    if (
      norm.includes("lft") ||
      norm.includes("liver") ||
      norm.includes("bilirubin")
    )
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 850,
        cptCode: "80076",
      }

    if (
      norm.includes("pt/inr") ||
      norm.includes("inr") ||
      norm.includes("coagulation")
    )
      return {
        name: itemName,
        category: "Laboratory",
        unitPrice: 650,
        cptCode: "85610",
      }

    return {
      name: itemName,
      category: "Laboratory",
      unitPrice: 500,
      cptCode: "80050",
    }
  }

  // Interventions / Procedures

  if (
    norm.includes("cannula") ||
    norm.includes("iv line") ||
    norm.includes("peripheral") ||
    norm.includes("iv access")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 350,
      cptCode: "36000",
    }

  if (
    norm.includes("oxygen") ||
    norm.includes("o2") ||
    norm.includes("mask") ||
    norm.includes("prongs") ||
    norm.includes("nrbm")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 500,
      cptCode: "94640",
    }

  if (
    norm.includes("defibrillat") ||
    norm.includes("cardioversion") ||
    norm.includes("shock")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 2500,
      cptCode: "92960",
    }

  if (
    norm.includes("cpr") ||
    norm.includes("resuscitat") ||
    norm.includes("acls") ||
    norm.includes("cardiopulmonary")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 4500,
      cptCode: "92950",
    }

  if (
    norm.includes("intubat") ||
    norm.includes("ventilator") ||
    norm.includes("airway") ||
    norm.includes("ett")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 3500,
      cptCode: "31500",
    }

  if (
    norm.includes("wound") ||
    norm.includes("dress") ||
    norm.includes("suture") ||
    norm.includes("bandage") ||
    norm.includes("hemorrhage")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 850,
      cptCode: "12001",
    }

  if (
    norm.includes("catheter") ||
    norm.includes("foley") ||
    norm.includes("urinary")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 450,
      cptCode: "51702",
    }

  if (
    norm.includes("ryle") ||
    norm.includes("nasogastric") ||
    norm.includes("ng tube") ||
    norm.includes("lavage")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 450,
      cptCode: "43752",
    }

  if (norm.includes("nebuliz") || norm.includes("inhalation"))
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 300,
      cptCode: "94640",
    }

  if (
    norm.includes("pocus") ||
    norm.includes("bedside echo") ||
    norm.includes("echo")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 1800,
      cptCode: "93308",
    }

  if (
    norm.includes("lumbar puncture") ||
    norm.includes("lp") ||
    norm.includes("spinal tap")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 2200,
      cptCode: "62270",
    }

  if (
    norm.includes("chest tube") ||
    norm.includes("icd") ||
    norm.includes("drainage") ||
    norm.includes("thoracentesis")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 4500,
      cptCode: "32551",
    }

  if (
    norm.includes("blood transfusion") ||
    norm.includes("prbc") ||
    norm.includes("ffp")
  )
    return {
      name: itemName,
      category: "Procedure / Surgery",
      unitPrice: 1800,
      cptCode: "36430",
    }

  return {
    name: itemName,
    category: "Procedure / Surgery",
    unitPrice: 500,
    cptCode: "99285",
  }
}
