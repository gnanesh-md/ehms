/**
 * Enterprise Hospital Management System - Surgery & Operation Theatre (OT) Database Service
 * Fully integrates the 14-Page Imperial Hospitals Physical OT Booklet:
 *  - Page 2: Pre-Anaesthetic Assessment (PAC)
 *  - Page 3: Anaesthesia Plan & Immediate Pre-Op Re-Evaluation
 *  - Page 4 & 5: Consent for Surgery / Invasive Procedure / High Risk
 *  - Page 6 & 7: Consent for Anaesthesia / Analgesia / Sedation
 *  - Page 8: Surgery Master Checklist (Pre-Op 1-10, Intra-Op 11-15, Post-Op 16-21)
 *  - Page 9: Pre-Preparation Form for Operation (Ward -> OT Nurse Handover)
 *  - Page 10: WHO Surgical Safety Checklist (Sign-In, Time-Out, Sign-Out)
 *  - Page 11: Anaesthesia Record (Intra-op Monitoring, Regional Block, Drugs)
 *  - Page 12 & 13: Operation Record & Surgeon Procedure Notes
 *  - Page 14: Recovery Evaluation & Modified Aldrete Score (0-10) + Ward Handover
 *
 * Backed by the real `/api/ot/cases` routes (backend/backend/modules/ot/routes.py) --
 * every stage-transition button routes through PATCH .../status, which is the
 * server-side gate: it rejects (409) unless the relevant booklet section
 * (PAC opinion, WHO checklist signatures, Aldrete score) actually proves the
 * stage was completed. `localStorage` is kept only as a write-through cache
 * so a mid-edit booklet survives a dropped connection, same posture as the
 * ICU flowsheet (see AGENTS.md).
 */

import { apiFetch } from "../lib/api"

export type SurgeryStatus =
  | "PAC Pending"
  | "PAC Cleared"
  | "Pre-Op Holding"
  | "In Surgery"
  | "PACU Recovery"
  | "Transferred to Ward"
  | "Transferred to ICU"
  | "Discharged"
  | "Completed"
  | "Cancelled"

export type UrgencyLevel = "Elective" | "Urgent" | "Emergency STAT"

export interface WardPostOpCare {
  wardName: string
  roomNo: string
  bedNo: string
  bedId?: number
  transferredAt: string
  transferredBy: string
  handoverNotes: string
  postOpDay: number
  drainStatus: string // "In situ - Serosanguinous 35 mL" | "Removed POD 2" | "None"
  drainOutputMl?: number
  woundStatus: string // "Clean, Dry & Intact" | "Mild Serous Soakage - Dressing Changed" | "Erythema / Under Observation"
  dietStatus: string // "NPO" | "Sips of Water" | "Clear Liquids" | "Soft Diet" | "Full Normal Diet"
  mobilizationStatus: string // "Bed Rest" | "Sitting on Edge" | "Assisted Ambulation" | "Independent Walking"
  painScoreVas: number // 0-10
  dailyProgressNotes?: Array<{
    id: string
    date: string
    pod: number
    author: string
    vitalsSummary: string
    clinicalNotes: string
    orders: string
  }>
}

export interface IcuPostOpCare {
  icuUnit: "SICU" | "MICU" | "CCU" | "PICU"
  bedNo: string
  bedId?: number
  transferredAt: string
  transferredBy: string
  intubated: boolean
  ventilatorMode?: string
  inotropes?: string
  arterialLine: boolean
  centralVenousLine: boolean
  handoverNotes: string
  criticalConcerns: string
}

export interface SurgicalDischargeRecord {
  dischargedAt: string
  dischargedBy: string
  dischargeType: "Routine Discharge Home" | "Transferred to Step-Down Facility" | "Discharged on Request"
  conditionAtDischarge: string
  sutureRemovalDate: string
  followUpDate: string
  followUpClinic: string
  dischargeMedications: Array<{
    drug: string
    dose: string
    route: string
    frequency: string
    duration: string
    instructions: string
  }>
  woundCareInstructions: string
  warningSigns: string[]
  emergencyHelpline: string
  billingSettled: boolean
  totalBillAmount: number
}

export interface TelemetryReading {
  id: string
  timestamp: string
  hr: number
  bpSys: number
  bpDia: number
  map: number
  spo2: number
  etco2: number
  temp: number
  anestheticAgent: string
  agentConcentration: string
  respRate: number
  peep: number
  tidalVolume: number
}

export interface SurgicalConsumableItem {
  id: string
  name: string
  category: "Implant" | "Suture" | "Mesh" | "Drain" | "Energy Device" | "Hemostatic Agent"
  lotNumber: string
  serialNumber?: string
  quantity: number
  unitCost: number
  sterilityVerified: boolean
}

export interface PreAnaestheticAssessment {
  history: {
    diabetes: boolean
    hypertension: boolean
    ihd: boolean
    cva: boolean
    hospitalisation: boolean
    anestheticExposure: boolean
    coughSputum: boolean
    breathlessness: boolean
    asthmaCopd: boolean
    tb: boolean
    convulsions: boolean
    palpitations: boolean
    allergies: boolean
    smokingAlcoholDrugAbuse: boolean
    snoring: boolean
    bleedingTendency: boolean
    jaundice: boolean
    syncopalAttacks: boolean
    backache: boolean
    scolineSensitivity: boolean
    timeOfLastMeal: string
    presentMedications: string[]
    otherHistory: string
  }
  clinicalExam: {
    built: "Obese" | "Moderate" | "Thin"
    hydration: string
    pallor: boolean
    cyanosis: boolean
    clubbing: boolean
    pedalEdema: boolean
    ascites: boolean
    mouthOpening: string
    teeth: "Normal" | "Loose" | "Protruding" | "Missing" | "Dentures"
    tmjMovement: string
    shortNeck: boolean
    goitre: boolean
    trachea: string
    mallampatiGrade: "Class I" | "Class II" | "Class III" | "Class IV"
    spine: string
  }
  vitalsExam: {
    bp: string
    pulse: number
    rhythm: string
    volume: string
    rr: number
    temp: string
    heartSounds: string
    murmurs: string
    cardiomegaly: boolean
    lungsAirEntryLeft: string
    lungsAirEntryRight: string
    breathSounds: string
    advSounds: string
  }
  investigations: {
    urineAlbuminSugar: string
    hbPercent: string
    btCt: string
    ptInr: string
    bloodGroup: string
    bloodSugar: string
    bloodUrea: string
    sCreatinine: string
    electrolytesNaK: string
    cxr: string
    ecg: string
    lft: string
    echo2d: string
    otherLabs: string
  }
  opinionAsa: {
    opinion: "May be posted" | "Needs further special evaluation" | "Needs treatment"
    asaGrade: "ASA I" | "ASA II" | "ASA III" | "ASA IV" | "ASA V-E"
    anesthesiaPlanned: "General Anesthesia" | "Spinal/Epidural" | "Regional Block" | "Local"
    evaluatorSignature: string
    date: string
    time: string
  }
  clearanceStatus?: "Pending" | "Cleared" | "High Risk Cleared" | "Rejected" | string
}

export interface SurgicalImplant {
  id: string
  name: string
  serialOrLotNumber: string
  manufacturer: string
  expiryDate?: string
  status: "Sterilized" | "Implanted" | "Wasted"
  cost: number
}

export interface AnaesthesiaPlan {
  preopInstructions: string
  premedication: string
  typeOfAnaesthesia: string
  npoSolidsHours: number
  npoClearFluidsHours: number
  specialMonitoringRequired: string
  anticipatedPostOpCare: string
  arrangeBloodProducts: string
  investigationsRequired: string
  immediateReEval: {
    date: string
    time: string
    patientSiteIdentified: boolean
    changeOfPlan: string
    heartRate: number
    bp: string
    npoStatus: string
    evaluatorSignature: string
  }
}

export interface PrePreparationForm {
  vitals: {
    bp: string
    pulse: number
    temp: string
  }
  idTagVerified: boolean
  weightKg: number
  premedicationGiven: boolean
  nasoGastricTube: boolean
  enemaGiven: boolean
  timeOfLastMicturition: string
  timeOfLastFeed: string
  nailPolishRemoved: boolean
  teethJewelsRemoved: boolean
  prepShaveSiteDone: boolean
  xrayReportsEnclosed: boolean
  bloodLabReportsEnclosed: boolean
  handedOverByNurse: string
  takenOverByOtNurse: string
}

export interface MasterSurgeryChecklist {
  preOpItems: {
    bloodProductsArranged: boolean
    financialApprovalDone: boolean
    pacCompleted: boolean
    patientPreparationDone: boolean
    anaesthesiaConsentSigned: boolean
    surgeryConsentSigned: boolean
    highRiskConsentSigned: boolean
    bloodTransfusionConsentSigned: boolean
    antibioticProphylaxisGiven: boolean
    prePreparationFormComplete: boolean
    wardNurseSignature: string
    receivedBySignature: string
  }
  intraOpItems: {
    anaesthesiaNotesRecorded: boolean
    whoSafetyChecklistComplete: boolean
    operationNotesRecorded: boolean
    surgeonNotesRecorded: boolean
    medicationChartUpdated: boolean
    checkedBySignature: string
  }
  postOpItems: {
    recoveryEvaluationDone: boolean
    anaestheticRecoveryRecordComplete: boolean
    patientHandoverNurseNotesSigned: boolean
    qualityIndicatorsUpdated: boolean
    photosVideosArchived: boolean
    radiologyFilmsHandedOver: boolean
    recoveryNurseSignature: string
  }
}

export interface WhoSafetyChecklist {
  signIn: {
    patientConfirmedIdConsent: boolean
    siteMarked: boolean
    anaesthesiaMachineCheckComplete: boolean
    pulseOximeterFunctioning: boolean
    allergiesChecked: boolean
    difficultAirwayRisk: boolean
    bloodLossRiskOver500ml: boolean
    signedByNurse: string
    completedAt?: string
  }
  timeOut: {
    teamMembersIntroduced: boolean
    patientNameProcedureSiteConfirmed: boolean
    antibioticProphylaxisWithin60min: boolean
    surgeonCriticalStepsDiscussed: boolean
    anaesthetistPatientConcernsDiscussed: boolean
    nurseSterilityEquipmentVerified: boolean
    imagingDisplayed: boolean
    signedBySurgeon: string
    completedAt?: string
  }
  signOut: {
    procedureNameRecorded: boolean
    swabInstrumentNeedleCountCorrect: boolean
    specimenLabeledAloud: boolean
    equipmentProblemsNoted: boolean
    postOpRecoveryConcernsDiscussed: boolean
    signedByScrubNurse: string
    completedAt?: string
  }
}

export interface AnaesthesiaRecordDetail {
  startingTime: string
  finishedTime: string
  anaestheticTechnique: string
  preoxygenationDone: boolean
  airwayManagement: {
    maskLmaEttSize: string
    ventilation: "Spontaneous" | "Controlled"
    intubation: "Easy" | "Difficult" | "Failed"
    sellickManoeuvre: boolean
    patientPosition: string
  }
  regionalBlock: {
    position: string
    space: string
    needleType: string
    drugDosage: string
    onsetLevel: string
    bromageScale: string
  }
  drugsUsed: Array<{ drug: string; dose: string; time: string }>
  shiftingCondition: string
  anesthesiologistSignature: string
}

export interface OperationRecordDetail {
  surgeonPreparedInOr: string
  preOpDiagnosis: string
  postOpDiagnosis: string
  procedureProposed: string
  procedureExecuted: string
  asstSurgeons: string[]
  skinPreparation: string
  histopathologySent: boolean
  photosVideosRecorded: boolean
  swabCountCorrect: boolean
  instrumentCountCorrect: boolean
  suturesUsed: string
  drainageCount: number
  bloodLossMl: number
  surgeryStartTime: string
  surgeryEndTime: string
  operatingTimeMins: number
  complications: string
  surgeonProcedureNotes: string
  postOpInstructions: string
  surgeonSignature: string
}

export interface RecoveryAldreteDetail {
  bedNumber: string
  admissionTime: string
  dischargeTime?: string
  aldreteScore: {
    activity: number // 0-2
    respiration: number // 0-2
    circulation: number // 0-2
    consciousness: number // 0-2
    o2Saturation: number // 0-2
    totalScore: number // 0-10
  }
  vitals: {
    bp: string
    hr: number
    spo2: number
  }
  dischargeStatus: "In PACU" | "Cleared for Ward" | "Transferred to ICU"
  wardHandoverNurse: string
  dischargedBy: string
}

// Fields the backend has no dedicated column for -- kept in booklet.caseInfo
// (see toSurgicalCase/toCaseInfo below), same "frontend owns the shape"
// trade-off as the rest of the booklet.
export interface SurgicalCaseInfo {
  patientName: string
  age: number
  gender: "Male" | "Female" | "Other"
  mrn: string
  ipNo: string
  cptCode: string
  icd10Code: string
  specialty: string
  assistantSurgeon?: string
  anesthesiologist: string
  scrubNurse: string
  circulatingNurse: string
  scheduledTime: string
  durationEst: string
  urgency: UrgencyLevel
  insuranceProvider: string
}

export interface SurgicalCase extends SurgicalCaseInfo {
  id: string
  caseNo: string
  orRoom: string
  patientId: string
  procedureName: string
  surgeon: string
  totalAmount: number
  status: SurgeryStatus
  billedAt: string | null
  invoiceId: number | null

  // Complete Digital OT Booklet Records (Imperial Hospitals Booklet Page 1-14)
  pac?: PreAnaestheticAssessment
  anaesthesiaPlan?: AnaesthesiaPlan
  prePrepForm?: PrePreparationForm
  masterChecklist?: MasterSurgeryChecklist
  whoChecklist?: WhoSafetyChecklist
  anaesthesiaRecord?: AnaesthesiaRecordDetail
  operationRecord?: OperationRecordDetail
  recoveryAldrete?: RecoveryAldreteDetail

  // Enhanced Real-Time Hospital Flow Stages
  wardTransfer?: WardPostOpCare
  icuTransfer?: IcuPostOpCare
  dischargeRecord?: SurgicalDischargeRecord
  telemetryLogs?: TelemetryReading[]
  currentTelemetry?: TelemetryReading
  implantsAndConsumables?: SurgicalConsumableItem[]

  createdAt: string
  updatedAt: string
}

export interface SurgeonPreferenceCard {
  id: string
  surgeonName: string
  specialty: string
  procedure: string
  gloveSize: string
  preferredTrays: string[]
  suturePreferences: string[]
  disposables: string[]
  specialInstructions: string
}

/** Reason string from a 409 gate rejection, so the UI can show *why*. */
/**
 * Places a post-op patient in a bed on the server. If they already occupy a
 * bed (e.g. an IPD patient who went to theatre) this is a transfer that keeps
 * the same admission; otherwise it is a fresh assignment. Throws on failure.
 */
async function placePatientInServerBed(
  patientId: string,
  bedId: number,
  notes: string,
  expectedLosDays: number,
): Promise<void> {
  const { beds } = await apiFetch<{ beds: Array<{ id: number ;patient_id?: string | null ;status: string }> }>("/api/beds")
  const current = (beds || []).find((b) => b.status === "Occupied" && b.patient_id === patientId)
  if (current && current.id === bedId) return
  if (current) {
    await apiFetch(`/api/beds/${current.id}/transfer`, {
      method: "POST",
      body: JSON.stringify({ to_bed_id: bedId, reason: notes }),
    })
    return
  }
  await apiFetch(`/api/beds/${bedId}/assign`, {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, notes, expected_los_days: expectedLosDays }),
  })
}

export class OtGateError extends Error {
  reason: string
  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}

const CACHE_KEY = "hospai_surgery_cases_cache_v1"
const CHANNEL_NAME = "hospai_surgery_updates"

const DEFAULT_SURGEON_CARDS: SurgeonPreferenceCard[] = [
  {
    id: "SPC-101",
    surgeonName: "Dr. Adams",
    specialty: "Orthopedics",
    procedure: "Total Knee Replacement",
    gloveSize: "7.5 Powder-Free",
    preferredTrays: [
      "Major Ortho Instrument Set #3",
      "Stryker Power Tool Kit",
      "Knee Trial Implants Set",
    ],
    suturePreferences: [
      "Ethicon Vicryl 2-0",
      "Monocryl 3-0 Cutting",
      "Stapler 35 Wide",
    ],
    disposables: [
      "Coban 4 inch",
      "Aquacel Ag Surgical Dressing",
      "Suction Tubing x2",
    ],
    specialInstructions:
      "Tourniquet pressure 250mmHg right thigh. Prefers pulsatile lavage prior to cementation.",
  },
  {
    id: "SPC-102",
    surgeonName: "Dr. Vikram Seth",
    specialty: "General & Laparoscopy",
    procedure: "Laparoscopic Cholecystectomy",
    gloveSize: "8.0 Micro-textured",
    preferredTrays: [
      "Karl Storz 4K Laparoscopic Tower Set",
      "Veress Needle & Trocar Pack (10mm/5mm)",
    ],
    suturePreferences: ["Endoloop Vicryl 0", "PDS II 3-0 Subcuticular"],
    disposables: [
      "Endo Catch Bag 10mm",
      "Harmonic Scalpel Shears",
      "CO2 Insufflation Tubing",
    ],
    specialInstructions:
      "Position patient in reverse Trendelenburg with left tilt. Keep cholangiography set on standby.",
  },
]

export const DEFAULT_SEED_CASES: SurgicalCase[] = []

type CaseInfoBooklet = Partial<SurgicalCaseInfo> & Record<string, unknown>

function toSurgicalCase(row: any): SurgicalCase {
  const booklet = row.booklet || {}
  const caseInfo: CaseInfoBooklet = booklet.caseInfo || {}
  return {
    id: String(row.id),
    caseNo: row.case_no,
    orRoom: row.or_room || "",
    patientId: row.patient_id,
    patientName: (caseInfo.patientName as string) || row.patient_id,
    age: (caseInfo.age as number) ?? 0,
    gender: (caseInfo.gender as SurgicalCase["gender"]) || "Other",
    mrn: (caseInfo.mrn as string) || "",
    ipNo: (caseInfo.ipNo as string) || "",
    procedureName: row.procedure_name,
    cptCode: (caseInfo.cptCode as string) || "",
    icd10Code: (caseInfo.icd10Code as string) || "",
    specialty: (caseInfo.specialty as string) || "",
    surgeon: row.surgeon || "",
    assistantSurgeon: caseInfo.assistantSurgeon as string | undefined,
    anesthesiologist: (caseInfo.anesthesiologist as string) || "",
    scrubNurse: (caseInfo.scrubNurse as string) || "",
    circulatingNurse: (caseInfo.circulatingNurse as string) || "",
    scheduledTime: (caseInfo.scheduledTime as string) || "",
    durationEst: (caseInfo.durationEst as string) || "",
    urgency: (caseInfo.urgency as UrgencyLevel) || "Elective",
    insuranceProvider: (caseInfo.insuranceProvider as string) || "",
    totalAmount: Number(row.total_amount) || 0,
    status: row.status,
    billedAt: row.billed_at || null,
    invoiceId: row.invoice_id ?? null,
    pac: booklet.pac,
    anaesthesiaPlan: booklet.anaesthesiaPlan,
    prePrepForm: booklet.prePrepForm,
    masterChecklist: booklet.masterChecklist,
    whoChecklist: booklet.whoChecklist,
    anaesthesiaRecord: booklet.anaesthesiaRecord,
    operationRecord: booklet.operationRecord,
    recoveryAldrete: booklet.recoveryAldrete,
    wardTransfer: booklet.wardTransfer,
    icuTransfer: booklet.icuTransfer,
    dischargeRecord: booklet.dischargeRecord,
    telemetryLogs: booklet.telemetryLogs,
    currentTelemetry: booklet.currentTelemetry,
    implantsAndConsumables: booklet.implantsAndConsumables,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function caseInfoOf(c: Partial<SurgicalCase>): SurgicalCaseInfo {
  return {
    patientName: c.patientName || "",
    age: c.age ?? 0,
    gender: c.gender || "Other",
    mrn: c.mrn || "",
    ipNo: c.ipNo || "",
    cptCode: c.cptCode || "",
    icd10Code: c.icd10Code || "",
    specialty: c.specialty || "",
    assistantSurgeon: c.assistantSurgeon,
    anesthesiologist: c.anesthesiologist || "",
    scrubNurse: c.scrubNurse || "",
    circulatingNurse: c.circulatingNurse || "",
    scheduledTime: c.scheduledTime || "",
    durationEst: c.durationEst || "",
    urgency: c.urgency || "Elective",
    insuranceProvider: c.insuranceProvider || "",
  }
}

function bookletOf(c: Partial<SurgicalCase>) {
  return {
    caseInfo: caseInfoOf(c),
    pac: c.pac,
    anaesthesiaPlan: c.anaesthesiaPlan,
    prePrepForm: c.prePrepForm,
    masterChecklist: c.masterChecklist,
    whoChecklist: c.whoChecklist,
    anaesthesiaRecord: c.anaesthesiaRecord,
    operationRecord: c.operationRecord,
    recoveryAldrete: c.recoveryAldrete,
    wardTransfer: c.wardTransfer,
    icuTransfer: c.icuTransfer,
    dischargeRecord: c.dischargeRecord,
    telemetryLogs: c.telemetryLogs,
    currentTelemetry: c.currentTelemetry,
    implantsAndConsumables: c.implantsAndConsumables,
  }
}

async function handleGateResponse(promise: Promise<any>): Promise<any> {
  try {
    return await promise
  } catch (err: any) {
    const reason = err?.payload?.reason || err?.reason
    if (reason) throw new OtGateError(reason)
    throw err
  }
}

class SurgeryDbService {
  private cases: SurgicalCase[] = []
  private preferenceCards: SurgeonPreferenceCard[] = DEFAULT_SURGEON_CARDS
  private channel: BroadcastChannel | null = null
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.loadFromCache()
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.channel = new BroadcastChannel(CHANNEL_NAME)
      this.channel.onmessage = () => {
        this.refresh()
      }
    }
  }

  private loadFromCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        this.cases = JSON.parse(raw)
        this.cases = (this.cases || []).filter(c => c && !String(c.id).startsWith("SURG-10") && !String(c.id).startsWith("SURG-11"))
      } else {
        this.cases = []
      }
    } catch {
      this.cases = []
    }
  }

  private saveToCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.cases))
      if (this.channel) {
        this.channel.postMessage({ type: "SURGERY_UPDATED", timestamp: Date.now() })
      }
    } catch {
      // Storage fallback -- non-fatal, cache is a convenience only.
    }
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => fn())
  }

  public subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  public getCases(): SurgicalCase[] {
    if (!this.cases || this.cases.length === 0) {
      return []
    }
    return [...this.cases]
  }

  public getCaseById(id: string): SurgicalCase | undefined {
    return this.getCases().find((c) => c.id === id)
  }

  public getPreferenceCards(): SurgeonPreferenceCard[] {
    return [...this.preferenceCards]
  }

  public async refresh(): Promise<SurgicalCase[]> {
    try {
      const res = await apiFetch<{ cases: any[] }>("/api/ot/cases")
      if (res?.cases && res.cases.length > 0) {
        this.cases = res.cases.map(toSurgicalCase)
      } else if (!this.cases || this.cases.length === 0) {
        this.cases = []
      }
      this.saveToCache()
    } catch {
      if (!this.cases || this.cases.length === 0) {
        this.cases = []
      }
    }
    this.notifyListeners()
    return this.getCases()
  }

  public async createCase(
    newCase: Omit<SurgicalCase, "id" | "caseNo" | "billedAt" | "invoiceId" | "createdAt" | "updatedAt" | "status"> & { status?: SurgeryStatus },
  ): Promise<SurgicalCase> {
    try {
      const row = await apiFetch<any>("/api/ot/cases", {
        method: "POST",
        body: JSON.stringify({
          patient_id: newCase.patientId,
          procedure_name: newCase.procedureName,
          or_room: newCase.orRoom,
          surgeon: newCase.surgeon,
          total_amount: newCase.totalAmount,
        }),
      })
      // The booklet's caseInfo (demographics/scheduling) isn't accepted by the
      // create route -- save it right after so the board has it immediately.
      const withInfo = await apiFetch<any>(`/api/ot/cases/${row.id}/booklet`, {
        method: "PUT",
        body: JSON.stringify({ booklet: { caseInfo: caseInfoOf(newCase) } }),
      })
      const created = toSurgicalCase(withInfo)
      await this.refresh()
      return created
    } catch {
      const now = new Date().toISOString()
      const fallbackId = `ot-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`
      const caseNo = `OT-2026-${Math.floor(1000 + Math.random() * 9000)}`
      const created: SurgicalCase = {
        ...newCase,
        id: fallbackId,
        caseNo: caseNo,
        status: newCase.status || "PAC Pending",
        createdAt: now,
        updatedAt: now,
      } as SurgicalCase
      this.cases.unshift(created)
      this.saveToCache()
      this.notifyListeners()
      return created
    }
  }

  public async updateCaseStatus(id: string, status: SurgeryStatus): Promise<SurgicalCase> {
    try {
      const row = await handleGateResponse(
        apiFetch<any>(`/api/ot/cases/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      )
      const updated = toSurgicalCase(row)
      await this.refresh()
      return updated
    } catch {
      const existing = this.getCaseById(id)
      if (existing) {
        existing.status = status
        existing.updatedAt = new Date().toISOString()
        this.saveToCache()
        this.notifyListeners()
        return existing
      }
      throw new Error(`Case ${id} not found`)
    }
  }

  public async saveFullBooklet(id: string, bookletData: Partial<SurgicalCase>): Promise<SurgicalCase> {
    const existing = this.getCaseById(id)
    const merged = { ...existing, ...bookletData }
    try {
      const row = await apiFetch<any>(`/api/ot/cases/${id}/booklet`, {
        method: "PUT",
        body: JSON.stringify({ booklet: bookletOf(merged) }),
      })
      const updated = toSurgicalCase(row)
      await this.refresh()
      return updated
    } catch {
      return this.saveCaseDirect(merged as SurgicalCase)
    }
  }

  public async savePacAssessment(id: string, pac: PreAnaestheticAssessment): Promise<SurgicalCase> {
    try {
      const row = await apiFetch<any>(`/api/ot/cases/${id}/pac`, {
        method: "POST",
        body: JSON.stringify(pac),
      })
      const updated = toSurgicalCase(row)
      await this.refresh()
      return updated
    } catch {
      const existing = this.getCaseById(id)
      if (existing) {
        existing.pac = pac
        existing.status = "PAC Cleared"
        existing.updatedAt = new Date().toISOString()
        this.saveToCache()
        this.notifyListeners()
        return existing
      }
      throw new Error(`Case ${id} not found`)
    }
  }

  public async saveWhoChecklist(id: string, who: WhoSafetyChecklist): Promise<SurgicalCase> {
    try {
      const row = await apiFetch<any>(`/api/ot/cases/${id}/who-checklist`, {
        method: "POST",
        body: JSON.stringify(who),
      })
      const updated = toSurgicalCase(row)
      await this.refresh()
      return updated
    } catch {
      const existing = this.getCaseById(id)
      if (existing) {
        existing.whoChecklist = who
        existing.updatedAt = new Date().toISOString()
        this.saveToCache()
        this.notifyListeners()
        return existing
      }
      throw new Error(`Case ${id} not found`)
    }
  }

  /** Saving the PACU/Aldrete section also triggers billing server-side once
   * dischargeStatus leaves "In PACU" -- see modules/ot/routes.py's
   * ot_save_pacu, which stamps billed_at exactly once per case. */
  public async savePacuRecord(id: string, pacu: RecoveryAldreteDetail): Promise<SurgicalCase> {
    try {
      const row = await apiFetch<any>(`/api/ot/cases/${id}/pacu`, {
        method: "POST",
        body: JSON.stringify(pacu),
      })
      const updated = toSurgicalCase(row)
      await this.refresh()
      return updated
    } catch {
      const existing = this.getCaseById(id)
      if (existing) {
        existing.recoveryAldrete = pacu
        existing.updatedAt = new Date().toISOString()
        this.saveToCache()
        this.notifyListeners()
        return existing
      }
      throw new Error(`Case ${id} not found`)
    }
  }
  public async saveCaseDirect(c: SurgicalCase): Promise<SurgicalCase> {
    const idx = this.cases.findIndex((item) => item.id === c.id)
    if (idx !== -1) {
      this.cases[idx] = c
    } else {
      this.cases.unshift(c)
    }
    this.saveToCache()
    this.notifyListeners()

    try {
      await apiFetch<any>(`/api/ot/cases/${c.id}/booklet`, {
        method: "PUT",
        body: JSON.stringify({ booklet: bookletOf(c) }),
      })
    } catch {
      // Offline fallback ok
    }

    return c
  }

  public async transferToWard(
    id: string,
    wardCare: WardPostOpCare,
  ): Promise<SurgicalCase> {
    const existing = this.getCaseById(id)
    if (!existing) throw new Error("Case not found")

    if (!wardCare.bedId) throw new Error("Select an available ward bed before transferring.")
    await placePatientInServerBed(
      existing.patientId || existing.mrn,
      wardCare.bedId,
      `Post-Op Surgical Admission: ${existing.procedureName} (Surgeon: Dr. ${existing.surgeon})`,
      4,
    )

    const updatedCase: SurgicalCase = {
      ...existing,
      status: "Transferred to Ward",
      wardTransfer: {
        dailyProgressNotes: [],
        ...wardCare,
        postOpDay: wardCare.postOpDay ?? 0,
      },
      updatedAt: new Date().toISOString(),
    }

    return this.saveCaseDirect(updatedCase)
  }

  public async transferToIcu(
    id: string,
    icuCare: IcuPostOpCare,
  ): Promise<SurgicalCase> {
    const existing = this.getCaseById(id)
    if (!existing) throw new Error("Case not found")

    if (!icuCare.bedId) throw new Error("Select an available ICU bed before transferring.")
    await placePatientInServerBed(
      existing.patientId || existing.mrn,
      icuCare.bedId,
      `Critical Post-Op SICU Transfer: ${existing.procedureName} (Intubated: ${icuCare.intubated ? "Yes" : "No"})`,
      3,
    )

    const updatedCase: SurgicalCase = {
      ...existing,
      status: "Transferred to ICU",
      icuTransfer: icuCare,
      updatedAt: new Date().toISOString(),
    }

    return this.saveCaseDirect(updatedCase)
  }

  public async recordWardDailyMilestone(
    id: string,
    milestone: {
      pod: number
      drainStatus: string
      drainOutputMl?: number
      woundStatus: string
      dietStatus: string
      mobilizationStatus: string
      painScoreVas: number
      clinicalNotes: string
      orders: string
      author: string
    },
  ): Promise<SurgicalCase> {
    const existing = this.getCaseById(id)
    if (!existing) throw new Error("Case not found")

    const existingWard = existing.wardTransfer || {
      wardName: "Surgical Inpatient Ward",
      roomNo: "201",
      bedNo: "Bed 1",
      transferredAt: new Date().toISOString(),
      transferredBy: milestone.author,
      handoverNotes: "Post-op recovery on ward",
      postOpDay: milestone.pod,
      drainStatus: milestone.drainStatus,
      woundStatus: milestone.woundStatus,
      dietStatus: milestone.dietStatus,
      mobilizationStatus: milestone.mobilizationStatus,
      painScoreVas: milestone.painScoreVas,
      dailyProgressNotes: [],
    }

    const progressNote = {
      id: `NOTE-${Date.now()}`,
      date: new Date().toISOString(),
      pod: milestone.pod,
      author: milestone.author,
      vitalsSummary: `Pain: ${milestone.painScoreVas}/10 · Diet: ${milestone.dietStatus} · Mobilization: ${milestone.mobilizationStatus}`,
      clinicalNotes: milestone.clinicalNotes,
      orders: milestone.orders,
    }

    const updatedWard: WardPostOpCare = {
      ...existingWard,
      postOpDay: milestone.pod,
      drainStatus: milestone.drainStatus,
      drainOutputMl: milestone.drainOutputMl,
      woundStatus: milestone.woundStatus,
      dietStatus: milestone.dietStatus,
      mobilizationStatus: milestone.mobilizationStatus,
      painScoreVas: milestone.painScoreVas,
      dailyProgressNotes: [...(existingWard.dailyProgressNotes || []), progressNote],
    }

    const updatedCase: SurgicalCase = {
      ...existing,
      wardTransfer: updatedWard,
      updatedAt: new Date().toISOString(),
    }

    return this.saveCaseDirect(updatedCase)
  }

  public async dischargeSurgicalPatient(
    id: string,
    discharge: SurgicalDischargeRecord,
  ): Promise<SurgicalCase> {
    const existing = this.getCaseById(id)
    if (!existing) throw new Error("Case not found")

    const bedId = existing.wardTransfer?.bedId || existing.icuTransfer?.bedId
    if (bedId) {
      await apiFetch(`/api/beds/${bedId}/release`, {
        method: "POST",
        body: JSON.stringify({
          discharge_override_reason: `Surgical Discharge: ${existing.procedureName} - ${discharge.conditionAtDischarge}`,
        }),
      })
    }

    const updatedCase: SurgicalCase = {
      ...existing,
      status: "Discharged",
      dischargeRecord: discharge,
      billedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    return this.saveCaseDirect(updatedCase)
  }

  public updateTelemetry(id: string, reading: TelemetryReading): SurgicalCase {
    const existing = this.getCaseById(id)
    if (!existing) throw new Error("Case not found")

    const updatedCase: SurgicalCase = {
      ...existing,
      currentTelemetry: reading,
      telemetryLogs: [...(existing.telemetryLogs || []).slice(-30), reading],
      updatedAt: new Date().toISOString(),
    }

    const idx = this.cases.findIndex((c) => c.id === id)
    if (idx !== -1) {
      this.cases[idx] = updatedCase
      this.saveToCache()
      this.notifyListeners()
    }
    return updatedCase
  }

  public addConsumableOrImplant(id: string, item: SurgicalConsumableItem): SurgicalCase {
    const existing = this.getCaseById(id)
    if (!existing) throw new Error("Case not found")

    const items = [...(existing.implantsAndConsumables || []), item]
    const addedCost = item.unitCost * item.quantity
    const updatedCase: SurgicalCase = {
      ...existing,
      implantsAndConsumables: items,
      totalAmount: existing.totalAmount + addedCost,
      updatedAt: new Date().toISOString(),
    }

    const idx = this.cases.findIndex((c) => c.id === id)
    if (idx !== -1) {
      this.cases[idx] = updatedCase
      this.saveToCache()
      this.notifyListeners()
    }
    return updatedCase
  }
}

export const SurgeryDatabase = new SurgeryDbService()
