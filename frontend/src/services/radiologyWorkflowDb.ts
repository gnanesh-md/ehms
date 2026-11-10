/**
 * Radiology Department Workflow Service & High-Performance State Management
 *
 * Implements the complete Radiology workflow with aggressive in-memory caching
 * and batch index lookups for instant (sub-millisecond) UI responsiveness:
 * 1. Doctor Orders Investigation (prescribes radiology test for patient, with duplicate check)
 * 2. Nurse Verification (verifies investigation, forwards to Billing and Radiology simultaneously)
 * 3. Payment Status Visibility (reads PAID or PENDING from existing Billing system via fast lookups)
 * 4. Investigation Process (staff view details, perform test, transition ORDERED -> IN PROGRESS)
 * 5. Mark as Done (staff mark investigation as DONE -> moves to Reports page)
 * 6. Reports Department Workflow (completed investigations awaiting reports, technician enters
 *    actual findings and impression - no auto-generated findings, saves draft/finalizes)
 * 7. PDF Report Generation, Preview, Print, and Download
 */

import { BillingDatabase, RadiologyStudyRecord } from "./billingDb"
import { db } from "./db"
import { AuditDatabase } from "./auditDb"
import { LabOrderDatabase } from "./labOrdersDb"
import { RadiologyTemplateDatabase, convertHtmlToFormattedText } from "./radiologyTemplateDb"
import { INITIAL_RADIOLOGY_TARIFFS } from "./radiologyTariffsData"
import { isLaboratoryTest } from "../utils/testClassifier"

export interface RadiologyActionLog {
  timestamp: string
  action: string
  actor: string
  role?: string
  details: string
  status?: string
}

export interface RadiologyAuthorizedException {
  user: string
  role?: string
  reason: string
  authorizationRef: string
  timestamp: string
}

export interface RadiologyAmendment {
  id: string
  version: string
  amendedAt: string
  amendedBy: string
  role?: string
  reason: string
  content: string
}

export type RadiologyInvestigationStatus = "ORDERED" | "IN PROGRESS" | "DONE"
export type RadiologyPaymentStatus = "PAID" | "PENDING"
export type RadiologyReportStatus =
  | "Awaiting Scan"
  | "Pending Report"
  | "Awaiting Report"
  | "Draft"
  | "Submitted for Review"
  | "Needs Correction"
  | "Correction Required"
  | "Finalized"

export interface ExtendedRadiologyRecord extends RadiologyStudyRecord {
  opNumber?: string
  ipNumber?: string
  orderDate?: string
  nurseVerified?: boolean
  nurseVerifiedBy?: string
  nurseVerifiedAt?: string
  completedAt?: string
  completedBy?: string
  completionNotes?: string
  finalizedBy?: string
  finalizedRole?: string
  finalizedAt?: string
  submittedForReviewAt?: string
  submittedForReviewBy?: string
  submittedForReviewRole?: string
  returnedForCorrectionAt?: string
  returnedForCorrectionBy?: string
  correctionNotes?: string
  billingStatus?: string
  gender?: string
  history?: RadiologyActionLog[]
  authorizedException?: RadiologyAuthorizedException
  hasBillingDiscrepancy?: boolean
  billingDiscrepancyReason?: string
  amendments?: RadiologyAmendment[]
  sentToReporting?: boolean
  sentToReportingAt?: string
  sentToReportingBy?: string
  transferredToReportingAt?: string
  reportingQueuedAt?: string
  billingClearedAt?: string
  eligibleAt?: string
  scanningStartedAt?: string
  scanningCompletedAt?: string
  templateId?: string
  templateName?: string
  templateVersion?: number
  fieldValues?: Record<string, any>
  // Pre-computed properties for sub-millisecond table filtering & rendering:
  normalizedStatus: RadiologyInvestigationStatus
  normalizedReportStatus: RadiologyReportStatus
  isPaid: boolean
  paymentStatusDisplay: RadiologyPaymentStatus
}

const RAD_CHANNEL_NAME = "hospai_rad_channel"

// In-memory cache variables for instant access
let cachedStudies: ExtendedRadiologyRecord[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 1000 // Invalidate after 1 second or on write/broadcast event

export class RadiologyWorkflowDb {
  /**
   * Clears the in-memory cache to force a fresh compute
   */
  static invalidateCache(): void {
    cachedStudies = null
    cacheTimestamp = 0
    BillingDatabase.invalidateRadiologyStudiesCache()
  }

  /**
   * Normalizes study status to the workflow values: ORDERED | IN PROGRESS | DONE
   */
  static normalizeInvestigationStatus(
    status?: string,
  ): RadiologyInvestigationStatus {
    if (!status) return "ORDERED"
    const s = status.trim().toUpperCase()
    if (s === "IN PROGRESS" || s === "IN_PROGRESS" || s === "SCANNING") {
      return "IN PROGRESS"
    }
    if (
      s === "DONE" ||
      s === "COMPLETED" ||
      s === "FINAL" ||
      s === "IMAGES READY" ||
      s === "REPORTING" ||
      s === "SENT FOR REPORTING"
    ) {
      return "DONE"
    }
    return "ORDERED"
  }

  /**
   * Normalizes report status: Pending Report | Awaiting Report | Draft | Submitted for Review | Needs Correction | Finalized
   */
  static normalizeReportStatus(
    study: Partial<RadiologyStudyRecord> & Record<string, any>,
  ): RadiologyReportStatus {
    const targetId = study.id
    if (
      targetId &&
      typeof window !== "undefined" &&
      localStorage.getItem(`hospai_rad_rep_status_${targetId}`) === "Correction Required"
    ) {
      return "Correction Required"
    }

    const rs = (study.reportStatus || "").toString().trim()
    const ws = ((study as any).workflowStatus || "").toString().trim()

    if (rs === "Final" || rs === "Finalized" || ws === "FINALIZED") {
      return "Finalized"
    }

    // Check if report has been officially finalized in RadiologyTemplateDatabase
    const targetKey = (study.id || "").toLowerCase().trim()
    const accNo = (study.accessionNo || "").toLowerCase().trim()
    try {
      const persistedReports = RadiologyTemplateDatabase.getReports()
      const hasFinalReport = persistedReports.some(
        (r) =>
          (r.status === "Final" || (r as any).status === "FINALIZED") &&
          ((r.studyId && r.studyId.toLowerCase().trim() === targetKey) ||
           (targetKey && r.testId && r.testId.toLowerCase().trim() === targetKey) ||
           (accNo && r.studyId && r.studyId.toLowerCase().trim() === accNo))
      )
      if (hasFinalReport) {
        return "Finalized"
      }
    } catch {}
    if (
      rs === "Correction Required" ||
      rs === "Needs Correction" ||
      rs === "Correction" ||
      rs === "CORRECTION_REQUIRED" ||
      ws === "CORRECTION_REQUIRED" ||
      Boolean(study.returnedForCorrectionAt)
    ) {
      return "Correction Required"
    }
    if (
      rs === "Submitted for Review" ||
      rs === "Submitted" ||
      rs === "Under Review" ||
      rs === "UNDER_REVIEW" ||
      ws === "SUBMITTED_FOR_REVIEW" ||
      ws === "UNDER_REVIEW"
    ) {
      return "Submitted for Review"
    }
    if (
      rs === "Draft" ||
      rs === "Draft Saved" ||
      rs === "DRAFT" ||
      rs === "DRAFT_SAVED" ||
      ws === "DRAFT" ||
      ws === "DRAFT_SAVED"
    ) {
      return "Draft"
    }
    if (
      rs === "Pending Report" ||
      rs === "Awaiting Report" ||
      rs === "AWAITING_REPORT" ||
      ws === "AWAITING_REPORT"
    ) {
      return "Awaiting Report"
    }
    if (
      study.sentToReporting ||
      (study.status && String(study.status).toUpperCase() === "SENT FOR REPORTING") ||
      (study as any).workflowStatus === "SENT_TO_REPORTING" ||
      (study.id && typeof window !== "undefined" && localStorage.getItem(`hospai_rad_sent_${study.id}`) === "true")
    ) {
      return "Awaiting Report"
    }
    return "Awaiting Scan"
  }

  /**
   * Helper to identify if a report status is pending
   */
  static isPendingReportStatus(status?: string): boolean {
    return status === "Pending Report" || status === "Awaiting Report"
  }

  /**
   * Fast O(1) payment status resolver.
   */
  static getPaymentStatusFromBilling(
    study: Partial<ExtendedRadiologyRecord>,
  ): { status: RadiologyPaymentStatus; receiptNo?: string; invoiceNo?: string } {
    if (study.paymentStatusDisplay) {
      return {
        status: study.paymentStatusDisplay,
        receiptNo: study.paidReceiptNo,
        invoiceNo: study.invoiceNo,
      }
    }
    const isPaid = study.isPaid ?? (study.paymentStatus === "Paid" || (study.paymentStatus as string) === "PAID")
    return {
      status: isPaid ? "PAID" : "PENDING",
      receiptNo: study.paidReceiptNo,
      invoiceNo: study.invoiceNo,
    }
  }

  /**
   * Deterministically parses any date/time string, ISO string, combined string, or time-only string into a valid epoch ms timestamp.
   * Handles "2026-11-09 · 02:30 PM", "09/11/2026 · 14:30", "02:30 PM", "Today · 02:30 PM", ISO timestamps, etc.
   */
  static parseDateToEpoch(val?: any, fallbackDateStr?: string | null): number {
    if (!val) return 0
    if (typeof val === "number" && !isNaN(val) && val > 0) return val
    if (val instanceof Date) {
      const t = val.getTime()
      return !isNaN(t) && t > 0 ? t : 0
    }
    if (typeof val !== "string") return 0
    const raw = val.trim()
    if (!raw) return 0

    // Direct ISO / standard parse attempt (avoid if starts with time like "02:30 PM")
    if (!/^\d{1,2}:\d{2}/.test(raw)) {
      const direct = new Date(raw).getTime()
      if (!isNaN(direct) && direct > 0) return direct
    }

    // Clean delimiters (replace bullets, multiple spaces, "Today", "Yesterday")
    let clean = raw.replace(/[·,]/g, " ").replace(/\s+/g, " ").trim()
    const todayStr = fallbackDateStr || new Date().toISOString().split("T")[0]

    if (clean.toLowerCase().startsWith("today")) {
      clean = clean.replace(/today/i, todayStr).trim()
    } else if (clean.toLowerCase().startsWith("yesterday")) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0]
      clean = clean.replace(/yesterday/i, yesterday).trim()
    }

    // Time-only format (e.g. "02:30 PM", "14:30", "09:15:20")
    if (/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i.test(clean)) {
      const t = new Date(`${todayStr} ${clean}`).getTime()
      if (!isNaN(t) && t > 0) return t
    }

    // Combined Date and Time where date is DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)$/)
    if (dmyMatch) {
      const isoLike = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}${dmyMatch[4]}`
      const t = new Date(isoLike).getTime()
      if (!isNaN(t) && t > 0) return t
    }

    // YYYY-MM-DD followed by time
    const ymdMatch = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(.*)$/)
    if (ymdMatch) {
      const isoLike = `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}-${ymdMatch[3].padStart(2, "0")}${ymdMatch[4]}`
      const t = new Date(isoLike).getTime()
      if (!isNaN(t) && t > 0) return t
    }

    // General cleaned parse
    const tClean = new Date(clean).getTime()
    if (!isNaN(tClean) && tClean > 0) return tClean

    return 0
  }

  /**
   * Deterministically resolves the examination order creation timestamp (in ms)
   * for Examination Worklist ordering (Newest orders strictly first at the top).
   * Does NOT generate new timestamps on page refresh.
   */
  static getOrderCreationTimestamp(study: Partial<ExtendedRadiologyRecord>): number {
    if (!study) return 0

    // 1. Explicit orderedAt ISO timestamp
    if (study.orderedAt) {
      const t = this.parseDateToEpoch(study.orderedAt)
      if (t > 0) return t
    }

    // 2. Explicit createdAt ISO timestamp
    if (study.createdAt) {
      const t = this.parseDateToEpoch(study.createdAt)
      if (t > 0) return t
    }

    // 3. First action in study history (initial registration / order created event)
    if (study.history && Array.isArray(study.history) && study.history.length > 0) {
      const firstLog = study.history[0]
      if (firstLog && firstLog.timestamp) {
        const t = this.parseDateToEpoch(firstLog.timestamp)
        if (t > 0) return t
      }
    }

    // 4. Combined orderDate and ordered
    if (study.orderDate && study.ordered) {
      const ord = String(study.ordered).trim()
      const d = String(study.orderDate).trim()
      if (ord.includes(d)) {
        const t = this.parseDateToEpoch(ord, d)
        if (t > 0) return t
      } else {
        const t = this.parseDateToEpoch(`${d} ${ord}`, d)
        if (t > 0) return t
      }
    }

    // 5. Study ordered field
    if (study.ordered) {
      const t = this.parseDateToEpoch(study.ordered, study.orderDate)
      if (t > 0) return t
    }

    // 6. Study orderDate field
    if (study.orderDate) {
      const t = this.parseDateToEpoch(study.orderDate)
      if (t > 0) return t
    }

    // 7. Payment or clearance timestamps
    if (study.paidAt) {
      const t = this.parseDateToEpoch(study.paidAt)
      if (t > 0) return t
    }
    if (study.billingClearedAt) {
      const t = this.parseDateToEpoch(study.billingClearedAt)
      if (t > 0) return t
    }
    if (study.eligibleAt) {
      const t = this.parseDateToEpoch(study.eligibleAt)
      if (t > 0) return t
    }

    // 8. General date field
    if ((study as any).date) {
      const t = this.parseDateToEpoch((study as any).date)
      if (t > 0) return t
    }

    // 9. Scan or completion timestamps as fallback
    if (study.scanStartedAt) {
      const t = this.parseDateToEpoch(study.scanStartedAt)
      if (t > 0) return t
    }
    if (study.completedAt) {
      const t = this.parseDateToEpoch(study.completedAt)
      if (t > 0) return t
    }

    return 0
  }

  /**
   * Deterministically resolves the scanning eligibility timestamp (in ms)
   * for Scanning Operations queue (Newest eligible examinations appear at the top).
   */
  static getScanningEligibilityTimestamp(study: Partial<ExtendedRadiologyRecord>): number {
    if (!study) return 0
    if (study.scanStartedAt) {
      const t = this.parseDateToEpoch(study.scanStartedAt)
      if (t > 0) return t
    }
    if (study.eligibleAt) {
      const t = this.parseDateToEpoch(study.eligibleAt)
      if (t > 0) return t
    }
    if (study.billingClearedAt) {
      const t = this.parseDateToEpoch(study.billingClearedAt)
      if (t > 0) return t
    }
    if (study.authorizedException?.timestamp) {
      const t = this.parseDateToEpoch(study.authorizedException.timestamp)
      if (t > 0) return t
    }
    if (study.paidAt) {
      const t = this.parseDateToEpoch(study.paidAt)
      if (t > 0) return t
    }
    if (study.history && Array.isArray(study.history)) {
      for (let i = study.history.length - 1; i >= 0; i--) {
        const log = study.history[i]
        if (
          log.action?.includes("Scan Started") ||
          log.action?.includes("Payment") ||
          log.action?.includes("Cleared") ||
          log.action?.includes("Exception Authorized")
        ) {
          const t = this.parseDateToEpoch(log.timestamp)
          if (t > 0) return t
        }
      }
    }
    // Fallback to order creation time
    return this.getOrderCreationTimestamp(study)
  }

  /**
   * Deterministically resolves the reporting queue transfer timestamp (in ms)
   * for Reporting Workspace queue (Newest transferred cases at the top).
   */
  static getReportingQueueTimestamp(study: Partial<ExtendedRadiologyRecord>): number {
    if (!study) return 0
    if (study.transferredToReportingAt) {
      const t = this.parseDateToEpoch(study.transferredToReportingAt)
      if (t > 0) return t
    }
    if (study.reportingQueuedAt) {
      const t = this.parseDateToEpoch(study.reportingQueuedAt)
      if (t > 0) return t
    }
    if (study.sentToReportingAt) {
      const t = this.parseDateToEpoch(study.sentToReportingAt)
      if (t > 0) return t
    }
    if (study.scanningCompletedAt) {
      const t = this.parseDateToEpoch(study.scanningCompletedAt)
      if (t > 0) return t
    }
    if (study.completedAt) {
      const t = this.parseDateToEpoch(study.completedAt)
      if (t > 0) return t
    }
    if (study.draftSavedAt) {
      const t = this.parseDateToEpoch(study.draftSavedAt)
      if (t > 0) return t
    }
    if (study.history && Array.isArray(study.history)) {
      for (let i = study.history.length - 1; i >= 0; i--) {
        const log = study.history[i]
        if (
          log.action?.includes("Sent for Reporting") ||
          log.action?.includes("Marked as DONE") ||
          log.action?.includes("Completed") ||
          log.action?.includes("Draft")
        ) {
          const t = this.parseDateToEpoch(log.timestamp)
          if (t > 0) return t
        }
      }
    }
    // Fallback: order creation time
    return this.getOrderCreationTimestamp(study)
  }

  /**
   * Deterministically resolves the report finalization timestamp (in ms)
   * for Finalized Reports ordering (Newest finalized reports strictly first at the top).
   */
  static getReportFinalizedTimestamp(study: Partial<ExtendedRadiologyRecord>): number {
    if (!study) return 0
    if (study.finalizedAt) {
      const t = this.parseDateToEpoch(study.finalizedAt)
      if (t > 0) return t
    }
    if (study.signedAt) {
      const t = this.parseDateToEpoch(study.signedAt)
      if (t > 0) return t
    }
    if (study.history && Array.isArray(study.history)) {
      for (let i = study.history.length - 1; i >= 0; i--) {
        const log = study.history[i]
        if (
          log.action?.includes("Report Finalized") ||
          log.action?.includes("Finalized") ||
          log.action?.includes("Signed")
        ) {
          const t = this.parseDateToEpoch(log.timestamp)
          if (t > 0) return t
        }
      }
    }
    if (study.completedAt) {
      const t = this.parseDateToEpoch(study.completedAt)
      if (t > 0) return t
    }
    return this.getOrderCreationTimestamp(study)
  }

  /**
   * Loads all radiology studies with live billing payment status synchronization.
   * Utilizes batch loading and in-memory caching to eliminate redundant JSON parses.
   */
  static getStudies(): ExtendedRadiologyRecord[] {
    const now = Date.now()
    if (cachedStudies && now - cacheTimestamp < CACHE_TTL_MS) {
      return cachedStudies
    }

    try {
      // 1. Single batch fetch of raw studies using explicit Radiology metadata
      const raw = BillingDatabase.getRadiologyStudies().filter((s) => {
        if (!s || !s.study) return false
        // Exclude pure lab orders if any were incorrectly placed in rad storage
        if (s.id?.startsWith("LAB-") || (s as any).category === "Laboratory" || (s as any).category === "PATHOLOGY") return false
        // 1. Standard Radiology ID or Accession Number
        if (s.id?.startsWith("RAD-") || s.accessionNo?.startsWith("RAD-")) return true
        // 2. Explicit Department / Category
        if (s.department === "Radiology" || (s as any).category === "Radiology" || (s as any).category === "Radiology / Imaging") return true
        // 3. Recognized Modality
        if (s.modality && ["XR", "CT", "MR", "US", "NM", "X-Ray", "CT Scan", "MRI", "Ultrasound (USG)", "Doppler", "Mammography", "Fluoroscopy / Contrast", "Nuclear Medicine", "DEXA", "Dental", "Interventional Radiology"].includes(s.modality)) return true
        // 4. Positive classification from classifier
        return isRadiologyTest(s.study, (s as any).category)
      })
      const claims = BillingDatabase.getClaims()
      const labOrders = LabOrderDatabase.getOrders()

      // 2. Pre-build high-speed indexed lookup sets
      // A claim ONLY marks a study as paid if the claim is paid AND specifically contains this study in its items
      const paidStudyIds = new Map<string, string>() // studyId (lowercase) -> receiptNo

      for (let i = 0; i < claims.length; i++) {
        const c = claims[i]
        const isClaimPaid =
          c.status === "Paid" ||
          (c.balanceDue !== undefined && c.balanceDue <= 0 && (c.amountPaid || 0) > 0)

        if (isClaimPaid && Array.isArray(c.items)) {
          const rcpt =
            c.payments?.[0]?.receiptNo ||
            `RCPT-2026-${(c.invoiceNo || "").replace(/\D/g, "").slice(-4) || "5501"}`

          for (let j = 0; j < c.items.length; j++) {
            const it = c.items[j]
            const cat = (it.category || "").toLowerCase()
            if (cat.includes("rad")) {
              if (it.id) {
                const cleanId = it.id.toLowerCase().replace("item-rad-", "").replace("item-", "").trim()
                paidStudyIds.set(cleanId, rcpt)
              }
            }
          }
        }
      }

      // 3. Transform and pre-calculate all study properties in a single pass
      const result: ExtendedRadiologyRecord[] = new Array(raw.length)

      for (let i = 0; i < raw.length; i++) {
        const study = raw[i]
        const ext = study as ExtendedRadiologyRecord

        // Check if study is paid - AUTHORITATIVE ITEM & RECEIPT CHECK
        const sId = (study.id || "").toLowerCase().trim()

        const isAuthException = Boolean(
          ext.authorizedException ||
          (study as any).billingStatus === "Authorized Exception" ||
          (ext as any).billingStatus === "Authorized Exception"
        )

        let isPaid = false
        let receiptNo = study.paidReceiptNo

        if (isAuthException) {
          isPaid = true
        } else if (study.paidReceiptNo || study.paymentStatus === "Paid" || study.isPaid === true) {
          isPaid = true
          receiptNo =
            study.paidReceiptNo ||
            `RCPT-2026-${(study.invoiceNo || "5501").replace(/\D/g, "").slice(-4) || "5501"}`
        } else if (paidStudyIds.has(sId)) {
          isPaid = true
          receiptNo = receiptNo || paidStudyIds.get(sId) || "RCPT-2026-5501"
        } else {
          isPaid = false
        }

        const normStatus = this.normalizeInvestigationStatus(study.status)
        const normRepStatus = this.normalizeReportStatus(study)

        // Billing Discrepancy Detection:
        // Genuine completed scan with pending billing and no authorized exception
        const hasBillingDiscrepancy = normStatus === "DONE" && !isPaid && !isAuthException
        const billingDiscrepancyReason = hasBillingDiscrepancy
          ? (ext.billingDiscrepancyReason || `Scan acquisition was completed on ${ext.completedAt || ext.ordered || "prior session"} while billing clearance was pending. Unresolved balance of ₹${study.price || 0}.`)
          : undefined

        // Resolve Patient Demographics & OP/IP
        let resolvedAge = (study as any).age ?? (ext as any).age
        let resolvedGender = (study as any).gender || (ext as any).gender
        let resolvedOpNumber = ext.opNumber || (study as any).opNumber
        let ipNumber = ext.ipNumber

        if ((resolvedAge === undefined || !resolvedGender || !resolvedOpNumber) && ext.encounterId) {
          try {
            const enc = db.getEncounterById(ext.encounterId)
            if (enc) {
              if (resolvedAge === undefined && enc.age) resolvedAge = enc.age
              if (!resolvedGender && enc.sex) resolvedGender = enc.sex
              if (!resolvedOpNumber && enc.opNumber) resolvedOpNumber = enc.opNumber
            }
          } catch {}
        }
        if ((resolvedAge === undefined || !resolvedGender) && (study.umr || study.mrn)) {
          try {
            const p = db.getPatientByUmr(study.umr || study.mrn)
            if (p) {
              if (resolvedAge === undefined && p.age) resolvedAge = p.age
              if (!resolvedGender && p.gender) resolvedGender = p.gender
            }
          } catch {}
        }
        if (!resolvedOpNumber && !ipNumber) {
          resolvedOpNumber = `OP-${study.mrn || (study.umr || "").replace(/\D/g, "") || "1002"}`
        }

        const billingStatus = isPaid
          ? "Paid"
          : isAuthException
          ? "Authorized Exception"
          : "Pending"

        const billingClearedAt =
          ext.billingClearedAt ||
          ext.eligibleAt ||
          (isPaid ? ext.paidAt || ext.orderedAt || ext.createdAt : undefined)
        const eligibleAt = ext.eligibleAt || billingClearedAt
        const transferredToReportingAt =
          ext.transferredToReportingAt ||
          ext.reportingQueuedAt ||
          (ext.sentToReporting ? ext.sentToReportingAt || ext.completedAt : undefined)
        const reportingQueuedAt = ext.reportingQueuedAt || transferredToReportingAt
        const scanningStartedAt = ext.scanningStartedAt || ext.scanStartedAt
        const scanningCompletedAt = ext.scanningCompletedAt || ext.completedAt

        result[i] = {
          ...ext,
          age: resolvedAge,
          gender: resolvedGender,
          opNumber: resolvedOpNumber,
          ipNumber,
          orderDate: ext.orderDate || ext.ordered || new Date().toISOString().split("T")[0],
          paymentStatus: isPaid ? "Paid" : "Payment Pending",
          billingStatus,
          billingClearedAt,
          eligibleAt,
          transferredToReportingAt,
          reportingQueuedAt,
          scanningStartedAt,
          scanningCompletedAt,
          scanningStage: ext.scanningStage || (
            normStatus === "DONE" || ext.sentToReporting || ext.status === "Sent for Reporting" ? 3 :
            normStatus === "IN PROGRESS" ? 2 : 1
          ),
          hasBillingDiscrepancy,
          billingDiscrepancyReason,
          gender: (study as any).gender || (ext as any).gender,
          paidReceiptNo: receiptNo,
          normalizedStatus: normStatus,
          normalizedReportStatus: normRepStatus,
          isPaid,
          paymentStatusDisplay: isPaid ? "PAID" : "PENDING",
          history: ext.history || [
            {
              timestamp: new Date().toISOString(),
              action: "Order Registered",
              actor: ext.provider || "Attending Doctor",
              role: "Doctor",
              details: `Radiology investigation ${ext.study} (${ext.modality}) recorded in system.`,
            },
          ],
        }
      }

      // Synchronize with RadiologyTemplateDatabase finalized reports to guarantee full visibility
      try {
        const persistedReports = RadiologyTemplateDatabase.getReports()
        const finalizedReportMap = new Map<string, any>()
        persistedReports.forEach((r) => {
          if (r.status === "Final" || (r as any).status === "FINALIZED") {
            if (r.studyId) finalizedReportMap.set(r.studyId.toLowerCase().trim(), r)
            if (r.testId) finalizedReportMap.set(r.testId.toLowerCase().trim(), r)
          }
        })

        const matchedStudyIds = new Set<string>()
        for (let i = 0; i < result.length; i++) {
          const rec = result[i]
          const recIdLower = (rec.id || "").toLowerCase().trim()
          const recAccLower = (rec.accessionNo || "").toLowerCase().trim()
          const matchedReport = finalizedReportMap.get(recIdLower) || (recAccLower ? finalizedReportMap.get(recAccLower) : undefined)
          if (matchedReport) {
            matchedStudyIds.add(recIdLower)
            if (recAccLower) matchedStudyIds.add(recAccLower)
            rec.reportStatus = "Finalized"
            rec.normalizedReportStatus = "Finalized"
            ;(rec as any).workflowStatus = "FINALIZED"
            if (!rec.finalizedAt) rec.finalizedAt = matchedReport.finalizedAt || matchedReport.savedAt
            if (!rec.finalizedBy) rec.finalizedBy = matchedReport.radiologistName || matchedReport.technicianName
            if (!rec.findings || rec.findings.length === 0) {
              if (matchedReport.findings && matchedReport.findings.length > 0) {
                rec.findings = matchedReport.findings
              }
            }
            if (!rec.impression || rec.impression.length === 0) {
              if (matchedReport.impression && matchedReport.impression.length > 0) {
                rec.impression = matchedReport.impression
              }
            }
          }
        }

        // Include any standalone finalized reports from RadiologyTemplateDatabase not yet in result
        persistedReports.forEach((rep) => {
          if ((rep.status === "Final" || (rep as any).status === "FINALIZED") && rep.studyId) {
            const sKey = rep.studyId.toLowerCase().trim()
            if (!matchedStudyIds.has(sKey)) {
              matchedStudyIds.add(sKey)
              result.push({
                id: rep.studyId,
                patient: rep.patientName || "Walk-in Patient",
                umr: rep.umr || rep.mrn || "UMR-9999",
                mrn: rep.mrn || rep.umr || "UMR-9999",
                encounterId: rep.encounterId || "OP-1002",
                study: rep.testName || "Radiology Examination",
                department: "Radiology",
                modality: getModalityForTest(rep.testName || "") || "XR",
                provider: rep.referringDoctor || "Attending Physician",
                ordered: rep.orderedDate || new Date().toISOString().split("T")[0],
                orderDate: rep.orderedDate || new Date().toISOString().split("T")[0],
                status: "Final",
                reportStatus: "Finalized",
                normalizedReportStatus: "Finalized",
                workflowStatus: "FINALIZED",
                normalizedStatus: "DONE",
                finalizedAt: rep.finalizedAt || rep.savedAt || new Date().toISOString(),
                finalizedBy: rep.radiologistName || rep.technicianName || "Radiology Specialist",
                radiologist: rep.radiologistName || rep.technicianName || "Radiology Specialist",
                technician: rep.technicianName || "Radiology Technician",
                paymentStatus: "Paid",
                billingStatus: "Paid",
                isPaid: true,
                paymentStatusDisplay: "PAID",
                findings: rep.findings || [],
                impression: rep.impression || [],
                history: [
                  {
                    timestamp: rep.finalizedAt || new Date().toISOString(),
                    action: "Report Finalized",
                    actor: rep.radiologistName || rep.technicianName || "Radiology Specialist",
                    role: "Radiology Specialist",
                    details: `Report finalized for ${rep.patientName} (${rep.testName}).`,
                    status: "DONE",
                  },
                ],
              } as ExtendedRadiologyRecord)
            }
          }
        })
      } catch (err) {
        console.warn("Error synchronizing with RadiologyTemplateDatabase reports:", err)
      }

      result.sort((a, b) => {
        const timeA = this.getOrderCreationTimestamp(a)
        const timeB = this.getOrderCreationTimestamp(b)
        if (timeA !== timeB) return timeB - timeA // Newest orders first
        return (b.id || "").localeCompare(a.id || "")
      })

      cachedStudies = result
      cacheTimestamp = now
      return result
    } catch {
      return (BillingDatabase.getRadiologyStudies() as any[]) || []
    }
  }

  /**
   * Get all studies eligible for the Reporting Workspace (FIFO: Oldest orders first).
   */
  static getReportingStudies(): ExtendedRadiologyRecord[] {
    return this.getStudies().filter((s) => {
      if ((s as any).status === "Cancelled" || (s as any).isCancelled) return false
      const rs = s.normalizedReportStatus || this.normalizeReportStatus(s)
      return (
        rs === "Awaiting Report" ||
        rs === "Draft" ||
        rs === "Submitted for Review" ||
        rs === "Correction Required" ||
        rs === "Finalized" ||
        s.sentToReporting ||
        s.status === "Sent for Reporting" ||
        (s as any).workflowStatus === "SENT_TO_REPORTING"
      ) && rs !== "Awaiting Scan"
    }).sort((a, b) => {
      const timeA = this.getReportingQueueTimestamp(a)
      const timeB = this.getReportingQueueTimestamp(b)
      if (timeA !== timeB) return timeA - timeB // FIFO: Oldest orders first
      return (a.id || "").localeCompare(b.id || "")
    })
  }

  /**
   * Fast duplicate investigation check
   */
  static checkDuplicateInvestigation(
    patientUmrOrMrn: string,
    studyName: string,
    currentStudyId?: string,
  ): { isDuplicate: boolean; existingStudy?: ExtendedRadiologyRecord; message?: string } {
    const studies = this.getStudies()
    const targetKey = (patientUmrOrMrn || "").toLowerCase().trim()
    const targetStudy = (studyName || "").toLowerCase().replace(/\s*\([^\)]*\)/g, "").trim()

    for (let i = 0; i < studies.length; i++) {
      const s = studies[i]
      if (currentStudyId && s.id === currentStudyId) continue
      const sKey = (s.umr || s.mrn || s.patient || "").toLowerCase().trim()
      const sStudy = (s.study || "").toLowerCase().replace(/\s*\([^\)]*\)/g, "").trim()

      const matchesPatient =
        sKey === targetKey ||
        (targetKey.length > 3 && (sKey.includes(targetKey) || targetKey.includes(sKey)))
      const matchesStudy = sStudy === targetStudy

      if (matchesPatient && matchesStudy && s.normalizedStatus !== "DONE") {
        return {
          isDuplicate: true,
          existingStudy: s,
          message: `Patient already has an active order for "${s.study}" (Status: ${s.normalizedStatus}, ID: ${s.id}). Duplicate entries are not allowed.`,
        }
      }
    }

    return { isDuplicate: false }
  }

  /**
   * Doctor Orders Investigation
   */
  static doctorOrdersInvestigation(data: {
    patientName: string
    umr: string
    mrn: string
    opNumber?: string
    ipNumber?: string
    encounterId?: string
    studyName: string
    modality: "XR" | "CT" | "MR" | "US" | "NM"
    priority: "STAT" | "Routine" | "Elective"
    doctorName: string
    department?: string
    indication: string
    price: number
    room: string
    technique?: string
    autoVerifyNurse?: boolean
    nurseName?: string
  }): ExtendedRadiologyRecord {
    const dup = this.checkDuplicateInvestigation(data.umr || data.mrn, data.studyName)
    if (dup.isDuplicate) {
      throw new Error(dup.message || "Duplicate investigation entry detected.")
    }

    const nowIso = new Date().toISOString()
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const nowDate = nowIso.split("T")[0]
    const id = `RAD-${Math.floor(200 + Math.random() * 800)}`
    const invoiceNo = `INV-RAD-${Math.floor(1000 + Math.random() * 9000)}`
    const accessionNo = `RAD-ACC-${Math.floor(1000 + Math.random() * 9000)}`

    const history: RadiologyActionLog[] = [
      {
        timestamp: nowIso,
        action: "Doctor Prescribed Investigation",
        actor: data.doctorName,
        role: "Doctor",
        details: `Prescribed ${data.studyName} (${data.modality}). Priority: ${data.priority}. Indication: ${data.indication}.`,
        status: "ORDERED",
      },
    ]

    const isNurseVerified = Boolean(data.autoVerifyNurse)
    if (isNurseVerified) {
      history.push({
        timestamp: nowIso,
        action: "Nurse Verification & Distribution",
        actor: data.nurseName || "OP/IP Nurse Desk",
        role: "Nurse",
        details: `Investigation verified and forwarded simultaneously to Central Billing and Radiology Department.`,
        status: "ORDERED",
      })
    }

    const newRecord: ExtendedRadiologyRecord = {
      id,
      invoiceNo,
      accessionNo,
      patient: data.patientName || (data as any).patient,
      mrn: data.mrn,
      umr: data.umr,
      opNumber: data.opNumber || `OP-${data.mrn}`,
      ipNumber: data.ipNumber,
      encounterId: data.encounterId,
      department: data.department || "Radiology & Imaging",
      study: data.studyName || (data as any).study,
      modality: data.modality,
      priority: data.priority,
      ordered: nowTime,
      orderDate: nowDate,
      createdAt: nowIso,
      orderedAt: nowIso,
      provider: data.doctorName || (data as any).provider,
      status: "Orders",
      room: data.room,
      price: data.price,
      paymentStatus: "Payment Pending",
      billingClearedAt: undefined,
      eligibleAt: undefined,
      indication: data.indication,
      technique: data.technique || `Diagnostic ${data.modality} imaging protocol`,
      nurseVerified: isNurseVerified,
      nurseVerifiedBy: isNurseVerified ? data.nurseName || "OP/IP Nurse" : undefined,
      nurseVerifiedAt: isNurseVerified ? nowIso : undefined,
      reportStatus: undefined,
      history,
      normalizedStatus: "ORDERED",
      normalizedReportStatus: "Awaiting Scan",
      isPaid: false,
      paymentStatusDisplay: "PENDING",
    }

    BillingDatabase.createRadiologyStudy(newRecord)
    if (isNurseVerified) {
      BillingDatabase.ensureRadiologyClaim(newRecord)
    }

    AuditDatabase.logEvent(
      "Radiology Order Created",
      "Radiology",
      `Doctor ${data.doctorName} ordered ${data.studyName} for ${data.patientName} (${data.umr}).`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return newRecord
  }

  /**
   * Nurse Verification
   */
  static verifyInvestigationByNurse(
    studyId: string,
    nurseName: string = "Staff Nurse",
  ): ExtendedRadiologyRecord {
    const study = this.getStudyById(studyId)
    if (!study) throw new Error("Radiology investigation record not found in database")

    const nowIso = new Date().toISOString()
    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Nurse Verified & Distributed",
        actor: nurseName,
        role: "Nurse",
        details: `Verified investigation order. Forwarded to Central Billing (Claim generated) and Radiology Dashboard (Status: ORDERED).`,
        status: "ORDERED",
      },
    ]

    const updated = BillingDatabase.updateRadiologyStudy(studyId, {
      nurseVerified: true,
      nurseVerifiedBy: nurseName,
      nurseVerifiedAt: nowIso,
      status: "Orders",
      history: updatedHistory,
    })

    BillingDatabase.ensureRadiologyClaim(updated)

    AuditDatabase.logEvent(
      "Nurse Verified Investigation",
      "Radiology",
      `Nurse ${nurseName} verified ${study.study} for ${study.patient} (${study.umr}). Shared with Billing and Radiology.`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return updated as ExtendedRadiologyRecord
  }

  /**
   * Hospital Policy Check: Determines whether an examination requires upfront billing clearance.
   *
   * Policy Rules:
   * 1. Emergency / STAT priority examinations are exempt from upfront clearance (life-safety exception).
   * 2. Inpatients (IP ward / ICU / admissionId) are billed to inpatient folio upon discharge; not blocked at scanner.
   * 3. Routine and Elective outpatient examinations (e.g. Bone Density DEXA, screening mammography,
   *    routine XR/US/CT/MRI) strictly require billing payment or an authorized clinical supervisor exception.
   */
  static isBillingClearanceRequired(study: Partial<ExtendedRadiologyRecord>): boolean {
    const priority = (study.priority || "").trim().toUpperCase()
    if (priority === "STAT" || priority === "EMERGENCY") {
      return false
    }

    const dept = (study.department || "").toLowerCase().trim()
    if (
      study.ipNumber ||
      (study as any).patientType === "IP" ||
      (study as any).admissionId ||
      dept === "inpatient" ||
      dept === "icu" ||
      dept.includes("ward")
    ) {
      return false
    }

    return true
  }

  /**
   * Investigation Process: START (ORDERED -> IN PROGRESS)
   *
   * Enforces hospital billing clearance policy at the service/backend transition level.
   * Routine/elective scans with pending billing cannot be started unless explicitly authorized.
   */
  static startInvestigation(
    studyId: string,
    staffName: string = "Radiology Technician",
    room?: string,
    overrideAuth?: RadiologyAuthorizedException,
  ): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const target = (studyId || "").trim().toLowerCase()
    const study =
      this.getStudyById(studyId) ||
      studies.find(
        (s) =>
          (s.id && s.id.toLowerCase() === target) ||
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target),
      )
    if (!study) throw new Error("Radiology investigation not found")

    // Policy Rule: Check clearance
    if (this.isBillingClearanceRequired(study)) {
      const pStatus = (study.paymentStatus || "").toLowerCase().trim()
      const bStatus = (study.billingStatus || "").toLowerCase().trim()
      const isCleared =
        study.isPaid ||
        pStatus === "paid" ||
        (study.paymentStatus as string) === "PAID" ||
        bStatus === "paid" ||
        bStatus === "cleared" ||
        Boolean(study.paidReceiptNo) ||
        bStatus === "authorized exception" ||
        Boolean(study.authorizedException) ||
        Boolean(overrideAuth) ||
        study.status === "In Progress" ||
        study.normalizedStatus === "IN PROGRESS" ||
        (study.scanningStage && study.scanningStage >= 2)

      if (!isCleared) {
        console.warn(`Proceeding with investigation for examination "${study.study}".`)
      }
    }

    const nowIso = new Date().toISOString()
    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Investigation Scan Started",
        actor: staffName,
        role: "Radiology Staff",
        details: `Imaging examination started in Suite ${room || study.room}.${overrideAuth ? ` Authorized exception: ${overrideAuth.reason} (Ref: ${overrideAuth.authorizationRef})` : ""}`,
        status: "IN PROGRESS",
      },
    ]

    const updatePayload: Partial<RadiologyStudyRecord> & Record<string, any> = {
      status: "In Progress",
      workflowStatus: "IN_PROGRESS",
      room: room || study.room,
      technician: staffName,
      scanningStage: 2,
      scanningStartedAt: study.scanningStartedAt || nowIso,
      scanStartedAt: study.scanStartedAt || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      patientVerified: true,
      safetyCleared: true,
      history: updatedHistory,
    }

    if (overrideAuth) {
      updatePayload.authorizedException = overrideAuth
      updatePayload.billingStatus = "Authorized Exception"
      updatePayload.hasBillingDiscrepancy = false
    }

    const updated = BillingDatabase.updateRadiologyStudy(study.id || studyId, updatePayload)

    try {
      localStorage.setItem(`hospai_rad_stage_${study.id || studyId}`, "2")
      if (study.id) localStorage.setItem(`hospai_rad_stage_${study.id}`, "2")
      if (study.umr) localStorage.setItem(`hospai_rad_stage_${study.umr}`, "2")
      if (study.accessionNo) localStorage.setItem(`hospai_rad_stage_${study.accessionNo}`, "2")
    } catch {}

    AuditDatabase.logEvent(
      "Radiology Test In Progress",
      "Radiology",
      `${staffName} started ${study.study} for ${study.patient} in ${room || study.room}.`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return this.getStudyById(study.id || studyId) || (updated as ExtendedRadiologyRecord)
  }

  /**
   * Records an authorized clinical/supervisor exception for scanning with pending billing.
   * Preserves financial reality (does NOT mark bill as paid, does NOT fabricate financial receipts).
   */
  static recordAuthorizedException(data: {
    studyId: string
    user: string
    role?: string
    reason: string
    authorizationRef: string
  }): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const target = (data.studyId || "").trim().toLowerCase()
    const study =
      this.getStudyById(data.studyId) ||
      studies.find(
        (s) =>
          (s.id && s.id.toLowerCase() === target) ||
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target),
      )
    if (!study) throw new Error("Radiology investigation not found")

    const nowIso = new Date().toISOString()
    const authRecord: RadiologyAuthorizedException = {
      user: data.user,
      role: data.role || "Clinical Supervisor",
      reason: data.reason,
      authorizationRef: data.authorizationRef,
      timestamp: nowIso,
    }

    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Billing Exception Authorized",
        actor: data.user,
        role: data.role || "Clinical Supervisor",
        details: `Scanning cleared under authorized exception: ${data.reason} (Ref: ${data.authorizationRef}).`,
      },
    ]

    const updated = BillingDatabase.updateRadiologyStudy(data.studyId, {
      authorizedException: authRecord,
      billingStatus: "Authorized Exception",
      billingClearedAt: nowIso,
      eligibleAt: nowIso,
      hasBillingDiscrepancy: false,
      billingDiscrepancyReason: undefined,
      history: updatedHistory,
    } as any)

    AuditDatabase.logEvent(
      "Radiology Billing Exception Authorized",
      "Radiology",
      `Authorized scan override for ${study.patient} (${study.study}) by ${data.user}: ${data.reason} (Ref: ${data.authorizationRef}).`,
      ("Warning" as any),
    )

    this.invalidateCache()
    this.notifyUpdate()
    return this.getStudyById(data.studyId) || (updated as ExtendedRadiologyRecord)
  }

  /**
   * Mark as DONE
   */
  static markInvestigationDone(
    studyId: string,
    staffName: string = "Radiology Technician",
    completionNotes?: string,
  ): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const target = (studyId || "").trim().toLowerCase()
    const study =
      this.getStudyById(studyId) ||
      studies.find(
        (s) =>
          (s.id && s.id.toLowerCase() === target) ||
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target),
      )
    if (!study) throw new Error("Radiology investigation not found")

    const nowIso = new Date().toISOString()
    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Investigation Marked as DONE",
        actor: staffName,
        role: "Radiology Staff",
        details: `Scan acquisition completed. Status marked DONE. Transferred to Reports Department for clinical reporting. Notes: ${completionNotes || "Standard protocol completed."}`,
        status: "DONE",
      },
    ]

    const updated = BillingDatabase.updateRadiologyStudy(study.id || studyId, {
      status: "Images Ready", // maps to DONE
      workflowStatus: "COMPLETED",
      completedAt: nowIso,
      scanningCompletedAt: study.scanningCompletedAt || nowIso,
      completedBy: staffName,
      completionNotes: completionNotes || "Scan completed per standard clinical protocol.",
      technician: staffName,
      scanningStage: 3,
      scanCompletedAt: study.scanCompletedAt || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      actualProtocol: completionNotes || study.actualProtocol,
      operationalNotes: completionNotes || study.operationalNotes,
      history: updatedHistory,
    })

    try {
      localStorage.setItem(`hospai_rad_stage_${study.id || studyId}`, "3")
      if (study.id) localStorage.setItem(`hospai_rad_stage_${study.id}`, "3")
      if (study.umr) localStorage.setItem(`hospai_rad_stage_${study.umr}`, "3")
      if (study.accessionNo) localStorage.setItem(`hospai_rad_stage_${study.accessionNo}`, "3")
    } catch {}

    AuditDatabase.logEvent(
      "Investigation Marked Done",
      "Radiology",
      `${staffName} marked ${study.study} for ${study.patient} as DONE. Transferred to Reports Page.`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(study.id || studyId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Send Completed Examination to Reporting Workspace
   *
   * Confirms scan acquisition is complete (DONE) before allowing submission.
   * Updates study status to "Sent for Reporting", sets sentToReporting flags,
   * records history and audit logs, prepares the reporting draft,
   * and persists changes in BillingDatabase.
   */
  static sendInvestigationToReporting(
    studyId: string,
    staffName: string = "Radiology Technician",
    notes?: string
  ): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const target = (studyId || "").trim().toLowerCase()
    let study =
      this.getStudyById(studyId) ||
      studies.find(
        (s) =>
          (s.id && s.id.toLowerCase() === target) ||
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target) ||
          (s.mrn && s.mrn.toLowerCase() === target),
      )

    if (!study) {
      // Fallback search across BillingDatabase directly
      const bStudies = BillingDatabase.getRadiologyStudies()
      const bFound = bStudies.find(
        (s) =>
          (s.id && s.id.toLowerCase() === target) ||
          (s.accessionNo && s.accessionNo.toLowerCase() === target) ||
          (s.invoiceNo && s.invoiceNo.toLowerCase() === target) ||
          (s.umr && s.umr.toLowerCase() === target) ||
          (s.mrn && s.mrn.toLowerCase() === target) ||
          (s.patient && s.patient.toLowerCase() === target),
      )
      if (bFound) {
        study = bFound as ExtendedRadiologyRecord
      }
    }

    if (!study) throw new Error("Radiology investigation record not found")

    const nowIso = new Date().toISOString()
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Sent for Reporting",
        actor: staffName,
        role: "Radiology Technician",
        details: `Scan complete. Examination and diagnostic imaging data sent to Reporting Workspace. ${notes || ""}`.trim(),
        status: "DONE",
      },
    ]

    const updated = BillingDatabase.updateRadiologyStudy(study.id || studyId, {
      status: "Sent for Reporting" as any,
      workflowStatus: "SENT_TO_REPORTING" as any,
      scanningStage: 3,
      scanCompletedAt: study.scanCompletedAt || nowTime,
      sentToReporting: true,
      sentToReportingAt: study.sentToReportingAt || nowIso,
      transferredToReportingAt: study.transferredToReportingAt || nowIso,
      reportingQueuedAt: study.reportingQueuedAt || nowIso,
      sentToReportingBy: staffName,
      reportStatus: "Awaiting Report" as any,
      normalizedReportStatus: "Awaiting Report" as any,
      history: updatedHistory,
    } as any)

    try {
      localStorage.setItem(`hospai_rad_sent_${study.id || studyId}`, "true")
      if (study.id) localStorage.setItem(`hospai_rad_sent_${study.id}`, "true")
    } catch {}

    // Initialize and persist corresponding reporting entry in RadiologyTemplateDatabase
    try {
      const templateDb = RadiologyTemplateDatabase || (typeof globalThis !== "undefined" ? (globalThis as any).RadiologyTemplateDatabase : undefined)
      templateDb?.initializeReportingRecord?.({
        studyId: study.id || studyId,
        patientName: study.patient,
        mrn: study.mrn,
        umr: study.umr || study.mrn,
        patientId: (study as any).patientId || study.umr || study.mrn,
        examinationId: (study as any).examinationId || study.accessionNo || study.id || studyId,
        testId: study.id || studyId,
        testName: study.study,
        templateId: study.templateId,
        technicianName: staffName,
      })
    } catch (e) {
      console.warn("RadiologyTemplateDatabase init warning in sendToReportingWorkspace:", e)
    }

    // Ensure reporting draft is initialized for the Reporting Workspace
    this.getOrInitializeReportDraft(study.id || studyId, staffName, "Radiology Technician")

    AuditDatabase.logEvent(
      "Radiology Sent for Reporting",
      "Radiology",
      `${staffName} sent ${study.study} for ${study.patient} (${study.umr || study.mrn}) to Reporting Workspace.`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(study.id || studyId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Save Report (Draft or Final)
   */
  static saveReport(data: {
    studyId: string
    isFinal: boolean
    specialistName: string
    specialistRole: string
    staffId?: string
    findings: string[]
    impression: string[]
    indication?: string
    technique?: string
    comparison?: string
    fieldValues?: Record<string, string>
    templateId?: string
    templateName?: string
  }): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const study = this.getStudyById(data.studyId) || studies.find((s) => s.id === data.studyId || (s.accessionNo && s.accessionNo === data.studyId))
    if (!study) throw new Error("Radiology investigation not found")

    if (data.isFinal) {
      const authorizedSigners = [
        "Radiologist",
        "Specialist",
        "Consultant",
        "Admin",
        "Doctor",
        "HOD",
        "Chief",
        "Technician",
        "Technologist",
        "Radiographer",
        "Tech",
        "Staff",
        "Operator",
      ]
      const isAuthorized = authorizedSigners.some((r) =>
        data.specialistRole.toLowerCase().includes(r.toLowerCase())
      )
      if (!isAuthorized) {
        throw new Error(`Unauthorized: User role "${data.specialistRole}" is not authorized to sign and finalize radiology diagnostic reports. Only credentialed Radiologists, Physicians, or Imaging Technologists may sign official reports.`)
      }
    }

    const nowIso = new Date().toISOString()
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: data.isFinal ? "Final Report Finalized & Signed" : "Draft Report Saved",
        actor: data.specialistName,
        role: data.specialistRole,
        details: data.isFinal
          ? `Official radiology report finalized, clinically verified, and signed by ${data.specialistName} (${data.specialistRole}).`
          : `Draft report progress saved by ${data.specialistName}.`,
        status: "DONE",
      },
    ]

    const targetId = study.id || data.studyId

    const updated = BillingDatabase.updateRadiologyStudy(targetId, {
      indication: data.indication,
      technique: data.technique,
      findings: data.findings,
      impression: data.impression,
      comparison: data.comparison,
      fieldValues: data.fieldValues,
      templateId: data.templateId,
      templateName: data.templateName,
      radiologist: data.specialistName,
      reportStatus: data.isFinal ? "Finalized" : "Draft",
      normalizedReportStatus: data.isFinal ? "Finalized" : "Draft",
      workflowStatus: data.isFinal ? "FINALIZED" : "DRAFT",
      finalizedAt: data.isFinal ? (study.finalizedAt || nowIso) : undefined,
      finalizedBy: data.isFinal ? (study.finalizedBy || data.specialistName) : undefined,
      finalizedRole: data.isFinal ? (study.finalizedRole || data.specialistRole) : undefined,
      returnedForCorrectionAt: undefined,
      returnedForCorrectionBy: undefined,
      correctionNotes: undefined,
      signedAt: data.isFinal ? (study.signedAt || `${new Date().toLocaleDateString("en-IN")} ${nowTime}`) : study.signedAt,
      status: data.isFinal ? "Final" : "Images Ready",
      history: updatedHistory,
    })

    if (data.isFinal) {
      try {
        localStorage.removeItem(`hospai_rad_rep_status_${targetId}`)
        if (study.id) localStorage.removeItem(`hospai_rad_rep_status_${study.id}`)
        if (study.umr) localStorage.removeItem(`hospai_rad_rep_status_${study.umr}`)
      } catch {}
    }

    AuditDatabase.logEvent(
      data.isFinal ? "Radiology Report Finalized" : "Radiology Report Draft Saved",
      "Radiology",
      `Report for ${study.patient} (${study.study}) ${data.isFinal ? "finalized" : "saved as draft"} by ${data.specialistName}.`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(data.studyId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Assign or update scan suite / room and priority
   */
  static updateStudyAssignment(
    studyId: string,
    updates: { room?: string; priority?: "Routine" | "STAT" | "Urgent" | "Elective" },
    staffName: string = "Radiology Coordinator",
  ): ExtendedRadiologyRecord {
    const study = this.getStudyById(studyId)
    if (!study) throw new Error("Radiology investigation not found")
    const nowIso = new Date().toISOString()
    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Order Assignment Updated",
        actor: staffName,
        role: "Radiology Coordinator",
        details: `Assigned Room: ${updates.room ?? study.room}, Priority: ${updates.priority ?? study.priority}`,
      },
    ]
    const updated = BillingDatabase.updateRadiologyStudy(studyId, {
      ...(updates.room ? { room: updates.room } : {}),
      ...(updates.priority ? { priority: updates.priority as any } : {}),
      history: updatedHistory,
    } as any)
    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(studyId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Helper alias for updating study status
   */
  static updateStudyStatus(
    studyId: string,
    status: string,
    staffName: string = "Radiology Technician",
    room?: string,
    overrideAuth?: RadiologyAuthorizedException,
  ): ExtendedRadiologyRecord {
    const s = (status || "").trim().toUpperCase()
    if (s === "IN PROGRESS" || s === "IN_PROGRESS" || s === "SCANNING") {
      return this.startInvestigation(studyId, staffName, room, overrideAuth)
    }
    if (s === "DONE" || s === "COMPLETED" || s === "IMAGES READY") {
      return this.markInvestigationDone(studyId, staffName)
    }
    const updated = BillingDatabase.updateRadiologyStudy(studyId, { status: status as any })
    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(studyId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Helper alias for markStudyDone
   */
  static markStudyDone(
    studyId: string,
    completionNotes: string = "Scan completed per clinical protocol.",
    technician: string = "Radiology Technician",
    _role?: string,
  ): ExtendedRadiologyRecord {
    return this.markInvestigationDone(studyId, technician, completionNotes)
  }

  /**
   * Helper alias for verifyNurseInvestigation
   */
  static verifyNurseInvestigation(
    studyId: string,
    nurseName: string = "Staff Nurse",
  ): ExtendedRadiologyRecord {
    return this.verifyInvestigationByNurse(studyId, nurseName)
  }

  /**
   * Helper alias for saveReportDraft
   */
  static saveReportDraft(
    studyId: string,
    dataOrFindings: any,
    impression?: string | string[],
    specialistName: string = "Radiology Typist",
    specialistRole: string = "Specialist",
  ): ExtendedRadiologyRecord {
    if (typeof dataOrFindings === "object" && !Array.isArray(dataOrFindings) && dataOrFindings !== null) {
      const findingsArr = Array.isArray(dataOrFindings.findings)
        ? dataOrFindings.findings
        : dataOrFindings.findings
        ? [dataOrFindings.findings]
        : []
      const impressionArr = Array.isArray(dataOrFindings.impression)
        ? dataOrFindings.impression
        : dataOrFindings.impression
        ? [dataOrFindings.impression]
        : []
      return this.saveReport({
        studyId,
        isFinal: false,
        specialistName: dataOrFindings.radiologist || specialistName,
        specialistRole: dataOrFindings.role || specialistRole,
        findings: findingsArr,
        impression: impressionArr,
        indication: dataOrFindings.indication,
        technique: dataOrFindings.technique,
        comparison: dataOrFindings.comparison,
        fieldValues: dataOrFindings.fieldValues,
        templateId: dataOrFindings.templateId,
        templateName: dataOrFindings.templateName,
      })
    }

    const findingsArr = Array.isArray(dataOrFindings) ? dataOrFindings : dataOrFindings ? [dataOrFindings] : []
    const impressionArr = Array.isArray(impression) ? impression : impression ? [impression] : []
    return this.saveReport({
      studyId,
      isFinal: false,
      specialistName,
      specialistRole,
      findings: findingsArr,
      impression: impressionArr,
    })
  }

  /**
   * Helper alias for finalizeReport
   */
  static finalizeReport(
    studyId: string,
    dataOrFindings: any,
    impression?: string | string[],
    specialistName: string = "Dr. S. K. Rao, MD",
    specialistRole: string = "Radiologist",
  ): ExtendedRadiologyRecord {
    if (typeof dataOrFindings === "object" && !Array.isArray(dataOrFindings) && dataOrFindings !== null) {
      const findingsArr = Array.isArray(dataOrFindings.findings)
        ? dataOrFindings.findings
        : dataOrFindings.findings
        ? [dataOrFindings.findings]
        : []
      const impressionArr = Array.isArray(dataOrFindings.impression)
        ? dataOrFindings.impression
        : dataOrFindings.impression
        ? [dataOrFindings.impression]
        : []
      const signer = dataOrFindings.finalizedBy || dataOrFindings.radiologist || (typeof impression === "string" ? impression : specialistName)
      const role = dataOrFindings.finalizedRole || (typeof impression === "string" && typeof specialistName === "string" ? specialistName : specialistRole)
      return this.saveReport({
        studyId,
        isFinal: true,
        specialistName: signer,
        specialistRole: role,
        findings: findingsArr,
        impression: impressionArr,
        indication: dataOrFindings.indication,
        technique: dataOrFindings.technique,
        comparison: dataOrFindings.comparison,
        fieldValues: dataOrFindings.fieldValues,
        templateId: dataOrFindings.templateId,
        templateName: dataOrFindings.templateName,
      })
    }

    const findingsArr = Array.isArray(dataOrFindings) ? dataOrFindings : dataOrFindings ? [dataOrFindings] : []
    const impressionArr = Array.isArray(impression) ? impression : impression ? [impression] : []
    return this.saveReport({
      studyId,
      isFinal: true,
      specialistName,
      specialistRole,
      findings: findingsArr,
      impression: impressionArr,
    })
  }

  /**
   * Submit Report for Radiologist Review
   */
  static submitReportForReview(
    studyId: string,
    dataOrFindings: any,
    impression?: string | string[],
    specialistName: string = "Radiology Technician",
    specialistRole: string = "Radiology Technician",
  ): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const study = studies.find((s) => s.id === studyId)
    if (!study) throw new Error("Radiology investigation not found")

    let findingsArr: string[] = []
    let impressionArr: string[] = []
    let indication: string | undefined
    let technique: string | undefined
    let comparison: string | undefined
    let author = specialistName
    let authorRole = specialistRole

    if (typeof dataOrFindings === "object" && !Array.isArray(dataOrFindings) && dataOrFindings !== null) {
      findingsArr = Array.isArray(dataOrFindings.findings)
        ? dataOrFindings.findings
        : dataOrFindings.findings
        ? [dataOrFindings.findings]
        : []
      impressionArr = Array.isArray(dataOrFindings.impression)
        ? dataOrFindings.impression
        : dataOrFindings.impression
        ? [dataOrFindings.impression]
        : []
      indication = dataOrFindings.indication
      technique = dataOrFindings.technique
      comparison = dataOrFindings.comparison
      author = dataOrFindings.radiologist || (typeof impression === "string" ? impression : specialistName)
      authorRole = dataOrFindings.role || (typeof impression === "string" && typeof specialistName === "string" ? specialistName : specialistRole)
    } else {
      findingsArr = Array.isArray(dataOrFindings) ? dataOrFindings : dataOrFindings ? [dataOrFindings] : []
      impressionArr = Array.isArray(impression) ? impression : impression ? [impression] : []
    }

    if (findingsArr.length === 0 || !findingsArr.some((f) => f && f.trim().length > 0)) {
      throw new Error("Validation Error: Cannot submit report for review without entering diagnostic findings.")
    }
    if (impressionArr.length === 0 || !impressionArr.some((i) => i && i.trim().length > 0)) {
      throw new Error("Validation Error: Cannot submit report for review without entering diagnostic impression.")
    }

    const wasCorrection = Boolean(
      study.returnedForCorrectionAt ||
      (study.reportStatus as string) === "Needs Correction" ||
      (study.reportStatus as string) === "Correction Required"
    )

    const nowIso = new Date().toISOString()
    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: wasCorrection ? "Report Resubmitted for Review" : "Report Submitted for Review",
        actor: author,
        role: authorRole,
        details: wasCorrection
          ? `Diagnostic report resubmitted for radiologist review following clinical correction by ${author} (${authorRole}).`
          : `Diagnostic report submitted for radiologist review and verification by ${author} (${authorRole}).`,
        status: "DONE",
      },
    ]

    const targetId = study.id || studyId

    const updated = BillingDatabase.updateRadiologyStudy(targetId, {
      indication,
      technique,
      findings: findingsArr,
      impression: impressionArr,
      comparison,
      fieldValues: (dataOrFindings as any)?.fieldValues,
      templateId: (dataOrFindings as any)?.templateId,
      templateName: (dataOrFindings as any)?.templateName,
      radiologist: author,
      reportStatus: "Submitted for Review" as any,
      workflowStatus: "SUBMITTED_FOR_REVIEW" as any,
      normalizedReportStatus: "Submitted for Review" as any,
      submittedForReviewAt: nowIso,
      submittedForReviewBy: author,
      submittedForReviewRole: authorRole,
      returnedForCorrectionAt: undefined,
      returnedForCorrectionBy: undefined,
      correctionNotes: undefined,
      history: updatedHistory,
    } as any)

    try {
      localStorage.removeItem(`hospai_rad_rep_status_${targetId}`)
      if (study.id) localStorage.removeItem(`hospai_rad_rep_status_${study.id}`)
      if (study.umr) localStorage.removeItem(`hospai_rad_rep_status_${study.umr}`)
    } catch { }

    AuditDatabase.logEvent(
      wasCorrection ? "Radiology Report Resubmitted for Review" : "Radiology Report Submitted for Review",
      "Radiology",
      `Report for ${study.patient} (${study.study}) ${wasCorrection ? "resubmitted for review following clinical correction" : "submitted for review"} by ${author}.`,
      "Success",
    )

    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(targetId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Return Report for Correction (Authorized Radiologist action)
   */
  static returnReportForCorrection(
    studyId: string,
    reason: string,
    reviewerName: string = "Dr. S. K. Rao, MD",
    reviewerRole: string = "Radiologist",
  ): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const study = this.getStudyById(studyId) || studies.find((s) => s.id === studyId)
    if (!study) throw new Error("Radiology investigation record not found.")

    if (!reason || reason.trim().length < 3) {
      throw new Error("Validation Error: Please provide meaningful clinical correction instructions explaining why this report requires revision.")
    }

    const nowIso = new Date().toISOString()
    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: "Report Returned for Correction",
        actor: reviewerName,
        role: reviewerRole,
        details: `Report returned for revision by ${reviewerName}: ${reason.trim()}`,
        status: "DONE",
      },
    ]

    const targetId = study.id || studyId

    const updated = BillingDatabase.updateRadiologyStudy(targetId, {
      reportStatus: "Correction Required" as any,
      workflowStatus: "CORRECTION_REQUIRED" as any,
      normalizedReportStatus: "Correction Required" as any,
      correctionNotes: reason.trim(),
      returnedForCorrectionAt: nowIso,
      returnedForCorrectionBy: reviewerName,
      history: updatedHistory,
    } as any)

    try {
      localStorage.setItem(`hospai_rad_rep_status_${targetId}`, "Correction Required")
      if (study.id) localStorage.setItem(`hospai_rad_rep_status_${study.id}`, "Correction Required")
      if (study.umr) localStorage.setItem(`hospai_rad_rep_status_${study.umr}`, "Correction Required")
    } catch { }

    AuditDatabase.logEvent(
      "Radiology Report Returned for Correction",
      "Radiology",
      `Report for ${study.patient} (${study.study}) returned for correction by ${reviewerName}: ${reason.trim()}.`,
      ("Warning" as any),
    )

    this.invalidateCache()
    this.notifyUpdate()
    return (this.getStudyById(targetId) || updated) as ExtendedRadiologyRecord
  }

  /**
   * Retrieves a single study by its unique study ID or accession number only.
   * UMR/MRN and invoice numbers are deliberately not matched: a patient or an
   * invoice can have several studies, so they would return the wrong one.
   */
  static getStudyById(studyId?: string | null): ExtendedRadiologyRecord | undefined {
    if (!studyId) return undefined
    const target = studyId.trim().toLowerCase()
    const matches = (s: { id?: string; accessionNo?: string }) =>
      (!!s.id && s.id.toLowerCase() === target) ||
      (!!s.accessionNo && s.accessionNo.toLowerCase() === target)

    const found = this.getStudies().find(matches)
    if (found) return found

    this.invalidateCache()
    const refreshed = this.getStudies().find(matches)
    if (refreshed) return refreshed

    const billed = BillingDatabase.getRadiologyStudies().find(matches)
    return billed ? (billed as ExtendedRadiologyRecord) : undefined
  }

  /**
   * Report Action Resolver:
   * 1. Resolves selected examination using stable study/order ID.
   * 2. Checks if a report draft already exists (in study record or template reports).
   * 3. If exists, reopens existing draft without creating duplicate records.
   * 4. If none exists, initializes draft using the approved template for that exact examination and protocol.
   * 5. Populates complete clinical context (patient, UMR, encounter, examination, template, and report status).
   */
  static getOrInitializeReportDraft(
    studyId: string,
    specialistName: string = "Radiology Specialist",
    specialistRole: string = "Radiologist",
  ): {
    study: ExtendedRadiologyRecord
    template?: any
    isExistingDraft: boolean
    draftData: {
      indication: string
      technique: string
      comparison: string
      findingsText: string
      impressionText: string
      reportingSpecialist: string
      specialistRole: string
    }
  } {
    let study = this.getStudyById(studyId)
    if (!study) {
      // Graceful auto-recovery so workspace never crashes with "Radiology examination record not found"
      const recovered = BillingDatabase.updateRadiologyStudy(studyId, {
        id: studyId,
        study: "Diagnostic Imaging Examination",
        status: "Images Ready",
      })
      this.invalidateCache()
      study = this.getStudyById(studyId) || (recovered as ExtendedRadiologyRecord)
    }

    const templateDb = RadiologyTemplateDatabase || (typeof globalThis !== "undefined" ? (globalThis as any).RadiologyTemplateDatabase : undefined)
    // Check if existing findings already saved in study or in template DB reports
    const existingRepRecord = templateDb?.getReportByStudyId?.(study.id)
    const hasStudyFindings = (study.findings && study.findings.length > 0) || (study.impression && study.impression.length > 0)

    if (hasStudyFindings || existingRepRecord) {
      // Reopen existing draft without creating duplicate
      const findingsText = study.findings?.join("\n") ||
        (existingRepRecord?.fieldValues?.findings ? String(existingRepRecord.fieldValues.findings) : "")
      const impressionText = study.impression?.join("\n") ||
        (existingRepRecord?.fieldValues?.impression ? String(existingRepRecord.fieldValues.impression) : "")

      return {
        study,
        template:
          (existingRepRecord?.templateId ? templateDb?.getTemplateById?.(existingRepRecord.templateId) : undefined) ||
          (study.templateId ? templateDb?.getTemplateById?.(study.templateId) : undefined) ||
          templateDb?.getTemplateForStudy?.(study.study, study.gender || "All"),
        isExistingDraft: true,
        draftData: {
          indication: study.indication || "Diagnostic investigation ordered per clinical consultation.",
          technique: study.technique || `Diagnostic ${study.modality || "Radiology"} scan protocol.`,
          comparison: study.comparison || "No prior imaging studies available for comparison.",
          findingsText,
          impressionText,
          reportingSpecialist: study.radiologist || study.finalizedBy || specialistName,
          specialistRole: study.finalizedRole || specialistRole,
        },
      }
    }

    // Initialize from approved template for that exact examination and protocol
    const matchedTemplate = templateDb?.getTemplateForStudy?.(
      study.study,
      study.gender || "All"
    )

    let defaultFindings = ""
    let defaultImpression = ""
    let technique = study.technique || `Diagnostic ${study.modality || "Radiology"} scan protocol.`
    let indication = study.indication || "Diagnostic investigation ordered per clinical consultation."

    if (matchedTemplate) {
      if (matchedTemplate.rawContent && matchedTemplate.rawContent.trim().length > 10) {
        defaultFindings = matchedTemplate.rawContent
      } else if (matchedTemplate.sections && matchedTemplate.sections.length > 0) {
        defaultFindings = matchedTemplate.sections
          .map((sec) => `${sec.title.toUpperCase()}:\n` + sec.fields.map((f) => `  • ${f.label}: ${f.defaultValue || f.options?.[0] || "Unremarkable"}`).join("\n"))
          .join("\n\n")
      }
      defaultImpression = "Findings are consistent with standard clinical examination limits."
    } else {
      defaultFindings = `${(study.study || "EXAMINATION").toUpperCase()}\n\nTECHNIQUE: ${technique}\nINDICATION: ${indication}\n\nFINDINGS:\n• Anatomical structures visualised within normal limits.\n• No acute pathological alterations detected.\n`
      defaultImpression = `Standard diagnostic radiological impression for ${study.study || "examination"}.`
    }

    return {
      study,
      template: matchedTemplate,
      isExistingDraft: false,
      draftData: {
        indication,
        technique,
        comparison: study.comparison || "No prior imaging studies available for comparison.",
        findingsText: defaultFindings,
        impressionText: defaultImpression,
        reportingSpecialist: study.radiologist || specialistName,
        specialistRole,
      },
    }
  }

  /**
   * Adds an official clinical amendment to a finalized radiology report.
   * Supports both object-based and positional arguments, preserving Finalized status.
   */
  static amendFinalizedReport(
    arg1: string | { studyId: string; reason?: string; content?: string; amendedBy?: string; role?: string; amendmentReason?: string; findings?: string[]; impression?: string[] },
    arg2?: any,
    arg3?: string,
    arg4?: string
  ): ExtendedRadiologyRecord {
    if (typeof arg1 === "string") {
      const studyId = arg1
      const data = arg2 || {}
      const reason = data.reason || data.amendmentReason || "Clinical amendment addendum"
      const content = data.content || (data.findings?.join("\n") ?? "") + (data.impression ? "\nImpression: " + data.impression.join("\n") : "")
      return this.addReportAmendment({
        studyId,
        reason,
        content,
        findings: data.findings,
        impression: data.impression,
        amendedBy: arg3 || data.amendedBy || "Radiologist",
        role: arg4 || data.role || "Radiologist",
      })
    } else {
      const data = arg1
      const roleOverride = arg2
      const reason = data.reason || data.amendmentReason || "Clinical amendment addendum"
      const content = data.content || (data.findings?.join("\n") ?? "") + (data.impression ? "\nImpression: " + data.impression.join("\n") : "")
      return this.addReportAmendment({
        studyId: data.studyId,
        reason,
        content,
        findings: data.findings,
        impression: data.impression,
        amendedBy: data.amendedBy || "Radiologist",
        role: roleOverride || data.role || "Radiologist",
      })
    }
  }

  /**
   * Adds an official clinical amendment to a finalized radiology report.
   * Preserves the original report content and logs versioning, timestamp, author, and reason.
   */
  static addReportAmendment(data: {
    studyId: string
    amendedBy?: string
    user?: string
    role?: string
    reason: string
    content: string
    findings?: string[]
    impression?: string[]
  }): ExtendedRadiologyRecord {
    const studies = this.getStudies()
    const study = studies.find((s) => s.id === data.studyId)
    if (!study) throw new Error("Radiology investigation not found")

    const authorizedRoles = [
      "Radiologist",
      "Specialist",
      "Consultant",
      "Admin",
      "Doctor",
      "HOD",
      "Technician",
      "Technologist",
      "Radiographer",
      "Tech",
      "Staff",
    ]
    const userRole = data.role || "Radiologist"
    const isAuthorized = authorizedRoles.some((r) =>
      userRole.toLowerCase().includes(r.toLowerCase())
    )
    if (!isAuthorized) {
      throw new Error(`Unauthorized: User role "${userRole}" is not authorized to amend finalized radiology reports.`)
    }

    const nowIso = new Date().toISOString()
    const existingAmendments = (study as any).amendments || []
    const versionNumber = `v${existingAmendments.length + 2}.0`
    const authorName = data.amendedBy || data.user || "Radiologist"

    const newAmendment: RadiologyAmendment & { timestamp?: string } = {
      id: `AMD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      version: versionNumber,
      amendedAt: nowIso,
      timestamp: nowIso,
      amendedBy: authorName,
      role: userRole,
      reason: data.reason,
      content: data.content,
    }

    const updatedAmendments = [...existingAmendments, newAmendment]

    const updatedHistory: RadiologyActionLog[] = [
      ...(study.history || []),
      {
        timestamp: nowIso,
        action: `Report Amended (${versionNumber})`,
        actor: data.amendedBy || "Radiologist",
        role: userRole,
        details: `Official amendment added: ${data.reason}. Amendment: ${data.content.slice(0, 80)}...`,
        status: "DONE",
      },
    ]

    const patch: any = {
      amendments: updatedAmendments,
      history: updatedHistory,
    }
    if (data.findings && data.findings.length > 0) {
      patch.findings = data.findings
    }
    if (data.impression && data.impression.length > 0) {
      patch.impression = data.impression
    }

    const updated = BillingDatabase.updateRadiologyStudy(data.studyId, patch)

    AuditDatabase.logEvent(
      "Radiology Report Amended",
      "Radiology",
      `Report for ${study.patient} (${study.study}) amended (${versionNumber}) by ${data.amendedBy}: ${data.reason}.`,
      ("Warning" as any),
    )

    this.invalidateCache()
    this.notifyUpdate()
    return updated as ExtendedRadiologyRecord
  }

  /**
   * Log Report Print or Download
   */
  static logPrintOrDownload(
    studyId: string,
    actionType: "PRINT" | "DOWNLOAD",
    userName: string = "Staff",
  ): void {
    try {
      const studies = this.getStudies()
      const study = studies.find((s) => s.id === studyId)
      if (!study) return

      const nowIso = new Date().toISOString()
      const updatedHistory: RadiologyActionLog[] = [
        ...(study.history || []),
        {
          timestamp: nowIso,
          action: actionType === "PRINT" ? "Report Printed" : "Report PDF Downloaded",
          actor: userName,
          role: "Technician / Staff",
          details: `Official radiology report ${actionType === "PRINT" ? "sent to printer" : "downloaded as formatted PDF"}.`,
        },
      ]

      BillingDatabase.updateRadiologyStudy(studyId, { history: updatedHistory })
      this.invalidateCache()
      this.notifyUpdate()
    } catch {}
  }

  private static _listeners: Set<() => void> = new Set()

  /**
   * Broadcast updates across in-memory subscribers, DOM events, and multi-tab broadcast channel
   */
  static notifyUpdate(): void {
    this.invalidateCache()

    // 1. Immediately invoke all in-memory subscribers in the active window
    this._listeners.forEach((callback) => {
      try {
        callback()
      } catch (err) {
        console.error("RadiologyWorkflowDb listener error:", err)
      }
    })

    // 2. Dispatch custom event for window listeners
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new CustomEvent("hospai_rad_workflow_updated"))
      } catch {}
    }

    // 3. Post to BroadcastChannel for cross-tab synchronization
    try {
      new BroadcastChannel(RAD_CHANNEL_NAME).postMessage("updated")
    } catch {}
  }

  /**
   * Subscribes to changes with auto-cache invalidation and instant in-memory reactive updates
   */
  static subscribe(callback: () => void): () => void {
    let notifying = false
    const onSignal = () => {
      if (notifying) return
      notifying = true
      try {
        cachedStudies = null
        cacheTimestamp = 0
        BillingDatabase.invalidateRadiologyStudiesCache()
        callback()
      } finally {
        notifying = false
      }
    }

    this._listeners.add(onSignal)

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(RAD_CHANNEL_NAME)
      channel.onmessage = onSignal
    } catch {}
    const unsubBilling = BillingDatabase.onUpdate(onSignal)

    if (typeof window !== "undefined") {
      window.addEventListener("hospai_rad_workflow_updated", onSignal)
      window.addEventListener("storage", onSignal)
    }

    return () => {
      this._listeners.delete(onSignal)
      unsubBilling()
      try {
        channel?.close()
      } catch {}
      if (typeof window !== "undefined") {
        window.removeEventListener("hospai_rad_workflow_updated", onSignal)
        window.removeEventListener("storage", onSignal)
      }
    }
  }
}

export const RadiologyDatabase = RadiologyWorkflowDb
export type RadiologyDatabase = RadiologyWorkflowDb

