/**
 * Enterprise Hospital Management System - Outpatient Persistent Database
 * Uses HTML5 IndexedDB with LocalStorage fallback for high performance,
 * atomic transactions, and permanent data persistence.
 */

import { getDoctorConsultationFee, getDoctorMaster } from "./doctorMaster"
import { apiFetch } from "../lib/api"
import { dropLegacySeeds, SEED_OP_ENCOUNTERS, SEED_OP_PATIENTS } from "./legacySeedPurge"

export interface DBPatient {
  umr: string // Primary Key: e.g. UMR10001

  name: string

  dob?: string

  age: number

  sex: "Male" | "Female" | "Other"

  gender?: string

  mrn?: string

  phone: string

  address: string

  bloodGroup: string

  createdAt: string

  updatedAt: string
}

export interface DBOPEncounter {
  id: string // Primary Key: e.g. ENC-101

  umr: string // Foreign Key to DBPatient

  date?: string // Immutable calendar date of visit: YYYY-MM-DD

  createdAt?: string // Immutable ISO timestamp of encounter creation

  opNumber: string // e.g. OP001, OP025

  patientName: string

  age: number

  sex: "Male" | "Female" | "Other"

  phone: string

  address: string

  bloodGroup: string

  dept: string

  isNew: boolean

  registrationTime: string

  chiefComplaint: string

  symptoms: string[]

  aiSpecialty: string

  aiDoctor: string

  aiConfidence: number

  aiReasoning?: string

  aiDoctorRationale?: string

  doctorGenderPref: "Any" | "Male" | "Female"

  assignedDoctor: string

  doctorStatus: "Available" | "Busy" | "Inactive" | "Absent"

  queueToken: string

  queuePosition: number

  room: string

  assessment?: string

  diagnosis: string

  icd10: string

  prescription: {
    medicine: string
    dosage: string
    frequency: string
    duration: string
    instructions?: string
  }[]

  investigations: string[]

  services?: {
    id?: string
    name: string
    category?: string
    cptCode?: string
    price: number
    quantity?: number
  }[]

  advice: string
  vitals: {
    bp: string
    pulse: string
    temp: string
    spo2: string
    weight: string
    notes: string
  }

  billing: {
    registrationFee?: number
    consultationFee: number
    labFee: number
    total: number
    status: "Paid" | "Pending"
    mode: string
  }

  furtherAction: "None" | "Laboratory" | "Pharmacy" | "Radiology" | "Admission" | "Referral"

  priorityTag?: "Urgent" | "Senior" | "Wheelchair" | "Pediatric" | "Standard"
  visitType?: "New Visit" | "Follow-up" | "Review"
  news2Score?: number
  news2Risk?: "Low" | "Medium" | "High"
  opdProcedures?: {
    name: string
    status: "Ordered" | "In Progress" | "Completed"
    timestamp: string
  }[]
  status: "Registered" | "Symptoms Captured" | "AI Recommended" | "Awaiting Doctor" | "Doctor Assigned" | "In Queue" | "Vitals Recorded" | "Awaiting Consultation" | "Under Consultation" | "Consultation Completed" | "Post-Consultation" | "Awaiting Billing" | "Billing Completed" | "Awaiting Investigation" | "OP Completed"
  pharmacyStatus?: "In Queue" | "Processing" | "Ready" | "Partially Dispensed" | "Dispensed" | "Rejected" | string

  timestamps: {
    arrival: string

    registration?: string

    symptoms?: string

    doctorAssigned?: string
    /** When the OP desk called the patient through to the nurse station. */
    calledToNurse?: string
    calledToNurseBy?: string
    /** When the OP desk called the patient through to the doctor chamber. */
    calledToDoctor?: string
    calledToDoctorBy?: string
    /** When the OP nurse took baseline observations, and who took them. */

    vitalsRecorded?: string

    vitalsBy?: string

    consultationStart?: string

    consultationEnd?: string

    billingCompleted?: string

    visitCompleted?: string
  }
}


const CROSS_TAB_CHANNEL = "hospai_db_v1"

/** Raised (detail: the DBOPEncounter) when an OP registration is complete. */
export const OP_REGISTERED_EVENT = "hms:op-registered"

/** The fake phone earlier queue syncs stored when the real one was missed. */
export const PLACEHOLDER_PHONE = "+91 98765 43210"

/**
 * True only when the nurse station has actually recorded observations. Every
 * encounter carries a vitals object (blank until the nurse saves one), so its
 * mere presence must never be read as "vitals done".
 */
export function hasRecordedVitals(
  vitals?: Partial<DBOPEncounter["vitals"]> | null,
  timestamps?: { vitalsRecorded?: string } | null,
): boolean {
  if (timestamps?.vitalsRecorded) return true
  if (!vitals) return false
  const hasVal = (v: any) => v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "--"
  return Boolean(hasVal(vitals.bp) || hasVal(vitals.pulse) || hasVal(vitals.temp) || hasVal(vitals.spo2) || hasVal(vitals.weight))
}

/** A queue row's patient details, from the fields /api/queue actually sends. */
function queueDemographics(item: any): {
  patientName: string
  phone: string
  age: number | null
  sex: "Male" | "Female" | "Other" | ""
  bloodGroup: string
} {
  const g = String(item.patient_gender ?? item.gender ?? "").toLowerCase()
  const ageRaw = item.patient_age ?? item.age
  const age = ageRaw === null || ageRaw === undefined || ageRaw === "" ? null : Number(ageRaw)
  return {
    patientName: String(item.patient_name || item.patient_first_name || "").trim(),
    phone: String(item.patient_phone ?? item.phone ?? "").trim(),
    age: age != null && Number.isFinite(age) ? age : null,
    sex: g.startsWith("f") ? "Female" : g.startsWith("m") ? "Male" : g ? "Other" : "",
    bloodGroup: String(item.patient_blood_group ?? item.blood_group ?? "").trim(),
  }
}

const STORAGE_KEYS = {
  PATIENTS: "hospai_db_patients_v1",

  ENCOUNTERS: "hospai_db_encounters_v1",

  UMR_COUNTER: "hospai_db_umr_counter_v1",

  OP_COUNTER: "hospai_db_op_counter_v1",
  CALL_HISTORY: "hospai_db_call_history_v1",
}

export interface DBCallEvent {
  id: string
  encounterId: string
  umr: string
  patientName: string
  token: string
  dept: string
  room: string
  eventType: "Call Doctor" | "Call Nurse"
  timestamp: string
}

// ─── Emergency Storage Eviction & Quota Recovery ──────────────────────────────
const dbMemoryFallback: Record<string, string> = {}

export function emergencyDbStorageEviction(): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const todayStr = new Date().toISOString().split("T")[0]
    const keysToRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k) continue
      // 1. Purge all multi-day ICU flowsheets (except today's active note)
      if (k.startsWith("icu.flowsheet.") && !k.endsWith(todayStr)) {
        keysToRemove.push(k)
      }
      // 2. Remove OCR & preview temporary caches
      if (
        k.startsWith("hospai_ocr_") ||
        k.startsWith("receipt_preview_") ||
        k.startsWith("temp_") ||
        k.includes("_scratch")
      ) {
        keysToRemove.push(k)
      }
    }
    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k)
      } catch {}
    })

    // 3. Trim audit logs down to 20
    try {
      const auditRaw = window.localStorage.getItem("hospai_audit_logs_v1")
      if (auditRaw) {
        const logs = JSON.parse(auditRaw)
        if (Array.isArray(logs) && logs.length > 20) {
          window.localStorage.setItem("hospai_audit_logs_v1", JSON.stringify(logs.slice(0, 20)))
        }
      }
    } catch {
      try { window.localStorage.removeItem("hospai_audit_logs_v1") } catch {}
    }
  } catch (e) {
    console.warn("[HospitalDatabase] Storage eviction warning:", e)
  }
}

export function aggressiveDbStorageEviction(): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k) continue
      if (
        k.startsWith("icu.flowsheet.") ||
        k === "hospai_audit_logs_v1" ||
        k.startsWith("hospai_notif") ||
        k.includes("notifications")
      ) {
        keysToRemove.push(k)
      }
    }
    keysToRemove.forEach((k) => {
      try { window.localStorage.removeItem(k) } catch {}
    })
  } catch {}
}

export function safeDbSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return
  // Always update memory fallback so in-session patient/encounter state is 100% preserved
  dbMemoryFallback[key] = value

  // Fast path: try saving directly to localStorage
  try {
    localStorage.setItem(key, value)
    return
  } catch (err: any) {
    console.warn(`[HospitalDatabase] Quota exceeded on "${key}". Performing emergency eviction...`)
  }

  // Pass 1: Prune bloated ICU flowsheets & trim audit logs
  try {
    emergencyDbStorageEviction()
    localStorage.setItem(key, value)
    return
  } catch (secondErr: any) {
    console.warn(`[HospitalDatabase] Second setItem attempt on "${key}" failed. Aggressive eviction...`)
  }

  // Pass 2: Aggressive eviction
  try {
    aggressiveDbStorageEviction()
    localStorage.setItem(key, value)
    return
  } catch (finalErr: any) {
    console.warn(`[HospitalDatabase] Critical: localStorage full for "${key}". Falling back to in-memory store.`)
  }
}

export function safeDbGetItem(key: string): string | null {
  if (typeof window === "undefined") return dbMemoryFallback[key] || null
  try {
    const val = localStorage.getItem(key)
    if (val !== null) return val
  } catch {}
  return dbMemoryFallback[key] || null
}

class HospitalDatabase {
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.init()
  }

  private init() {
    if (typeof window === "undefined") return

    // A new install starts empty: every patient and visit is a real one.
    if (!safeDbGetItem(STORAGE_KEYS.PATIENTS)) {
      safeDbSetItem(STORAGE_KEYS.PATIENTS, "[]")
    }

    if (!safeDbGetItem(STORAGE_KEYS.ENCOUNTERS)) {
      safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, "[]")
    }

    if (!safeDbGetItem(STORAGE_KEYS.UMR_COUNTER)) {
      safeDbSetItem(STORAGE_KEYS.UMR_COUNTER, "10001")
    }

    if (!safeDbGetItem(STORAGE_KEYS.OP_COUNTER)) {
      safeDbSetItem(STORAGE_KEYS.OP_COUNTER, "1")
    }

    // Drop sample records older builds seeded, and deduplicate

    try {
      const pData = localStorage.getItem(STORAGE_KEYS.PATIENTS)

      if (pData) {
        const parsed: DBPatient[] = JSON.parse(pData)

        const filtered = dropLegacySeeds(parsed, SEED_OP_PATIENTS, (p) => p.umr, (p) => p.name)

        const seenUmrs = new Set()
        const dedupedPatients = filtered.filter((p) => {
          const u = (p.umr || "").trim().toUpperCase()
          if (!u || seenUmrs.has(u)) return false
          seenUmrs.add(u)
          return true
        })
        if (dedupedPatients.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(dedupedPatients))
        }
      }

      // Clean up duplicate encounters

      const eData = localStorage.getItem(STORAGE_KEYS.ENCOUNTERS)

      if (eData) {
        const parsedE: DBOPEncounter[] = JSON.parse(eData)

        const combined = dropLegacySeeds(parsedE, SEED_OP_ENCOUNTERS, (e) => e.id, (e) => e.patientName)

        const seen = new Set<string>()

        const filteredE = combined.filter((e) => {
          const key = `${e.umr}_${e.opNumber}`

          if (seen.has(key)) return false

          seen.add(key)

          return true
        })

        let encMigrated = false;
        for (const e of filteredE) {
          const defaultRegFee = e.isNew === false ? 0 : 20;
          if (!e.billing) {
            const fee = getDoctorConsultationFee(e.assignedDoctor);
            e.billing = {
              registrationFee: defaultRegFee,
              consultationFee: fee,
              labFee: 0,
              total: defaultRegFee + fee,
              status: "Pending",
              mode: "Card",
            };
            encMigrated = true;
          } else {
            if (e.billing.registrationFee === undefined) {
              e.billing.registrationFee = defaultRegFee;
              e.billing.total = defaultRegFee + (e.billing.consultationFee || 500) + (e.billing.labFee || 0);
              encMigrated = true;
            }
          }
        }

        if (filteredE.length !== parsedE.length || encMigrated) {
          localStorage.setItem(
            STORAGE_KEYS.ENCOUNTERS,
            JSON.stringify(filteredE),
          )
        }
      }
    } catch {
      // ignore
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener)

    this.ensureCrossTab()

    return () => this.listeners.delete(listener)
  }

  /**
   * Fan a local write out to the other tabs.
   *
   * Reception, the OP nurse station and the doctor's workspace are different
   * people at different desks, so they are different tabs -- and often different
   * machines pointed at the same browser profile. Without this, booking an
   * appointment notified only the tab that made the write: the nurse's open
   * station and the doctor's board went on showing stale queues until someone
   * happened to reload. The rest of this frontend already fans out this way.
   */

  private crossTabReady = false

  private channel: BroadcastChannel | null = null

  private ensureCrossTab() {
    if (this.crossTabReady || typeof window === "undefined") return

    this.crossTabReady = true

    try {
      this.channel = new BroadcastChannel(CROSS_TAB_CHANNEL)

      this.channel.onmessage = () => this.listeners.forEach((fn) => fn())
    } catch {
      // BroadcastChannel unavailable -- the storage event below still covers it.
    }

    // Fires in *other* tabs when localStorage changes, which covers browsers

    // without BroadcastChannel and writes made outside this class.

    window.addEventListener("storage", (e) => {
      if (!e.key) return

      if (
        e.key === STORAGE_KEYS.ENCOUNTERS ||
        e.key === STORAGE_KEYS.PATIENTS
      ) {
        this.listeners.forEach((fn) => fn())
      }
    })
  }

  /**
   * The front desk issues UMRs from a per-browser counter, so two desks can
   * hand the same UMR to two different people. The backend detects that
   * (`umr_conflict`) and files the newcomer under a server-issued id. Adopt
   * that id here -- patient, encounters and the OP card all follow -- so every
   * patient's card and barcode stay unique and resolve to their own record.
   */
  public adoptServerPatientId(localUmr: string, res: unknown): void {
    const r = (res ?? {}) as { patient_id?: unknown ;umr_conflict?: unknown }
    const serverId = typeof r.patient_id === "string" ? r.patient_id.trim() : ""
    if (!r.umr_conflict || !serverId || serverId === localUmr) return
    const patients = this.getPatients()
    if (patients.some((p) => p.umr === serverId)) return
    safeDbSetItem(
      STORAGE_KEYS.PATIENTS,
      JSON.stringify(patients.map((p) => (p.umr === localUmr ? { ...p, umr: serverId, updatedAt: new Date().toISOString() } : p))),
    )
    safeDbSetItem(
      STORAGE_KEYS.ENCOUNTERS,
      JSON.stringify(this.getEncounters().map((e) => (e.umr === localUmr ? { ...e, umr: serverId } : e))),
    )
    try {
      window.dispatchEvent(new CustomEvent("hms:umr-reassigned", { detail: { from: localUmr, to: serverId } }))
    } catch {}
    this.notify()
  }

  /**
   * Tells the rest of the app (patient messaging) that an OP registration is
   * complete. Raised only after the server write-through has settled, so the
   * UMR is final (a desk-UMR clash may have re-keyed it) and the patient
   * exists on the server for anything that needs them there.
   */
  private announceRegistered(encounterId: string) {
    try {
      const encounter = this.getEncounterById(encounterId)
      if (encounter) window.dispatchEvent(new CustomEvent(OP_REGISTERED_EVENT, { detail: encounter }))
    } catch {}
  }

  private notify() {
    this.listeners.forEach((fn) => fn())

    this.ensureCrossTab()

    try {
      this.channel?.postMessage(Date.now())
    } catch {
      /* a closed channel must never break the write that triggered it */
    }
  }

  // ── Patients CRUD ────────────────────────────────────────────────────────

  public getPatients(): DBPatient[] {
    try {
      const data = safeDbGetItem(STORAGE_KEYS.PATIENTS)
      if (!data) return []
      const parsed: DBPatient[] = JSON.parse(data)
      const list = dropLegacySeeds(parsed, SEED_OP_PATIENTS, (p) => p.umr, (p) => p.name)
      const merged = list.length !== parsed.length
      const seenUmrs = new Set<string>()
      const uniqueList: DBPatient[] = []
      for (const p of list) {
        const u = (p.umr || "").trim().toUpperCase()
        if (u && !seenUmrs.has(u)) {
          seenUmrs.add(u)
          uniqueList.push(p)
        }
      }
      if (uniqueList.length !== list.length || merged) {
        safeDbSetItem(STORAGE_KEYS.PATIENTS, JSON.stringify(uniqueList))
      }
      uniqueList.sort((a, b) => {
        const timeB = new Date(b.createdAt || 0).getTime()
        const timeA = new Date(a.createdAt || 0).getTime()
        return timeB - timeA
      })
      return uniqueList
    } catch {
      return []
    }
  }

  public getPatientByUmr(umr: string): DBPatient | undefined {
    return this.getPatients().find(
      (p) => p.umr.toUpperCase() === umr.toUpperCase(),
    )
  }

  public addPatient(p: DBPatient): void {
    try {
      const list = this.getPatients()
      const u = (p.umr || "").trim().toUpperCase()
      if (u && !list.some((existing) => (existing.umr || "").trim().toUpperCase() === u)) {
        localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify([p, ...list]))
        this.notify()
      }
    } catch {}
  }

  public searchPatients(query: string): DBPatient[] {
    const q = query.trim().toLowerCase()

    if (!q) return this.getPatients()

    return this.getPatients().filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.umr.toLowerCase().includes(q) ||
        p.phone.includes(q),
    )
  }

  // ── Encounters CRUD ──────────────────────────────────────────────────────

  public getEncounters(): DBOPEncounter[] {
    try {
      const data = safeDbGetItem(STORAGE_KEYS.ENCOUNTERS)
      if (!data) return []
      const parsed: DBOPEncounter[] = JSON.parse(data)
      const list = dropLegacySeeds(parsed, SEED_OP_ENCOUNTERS, (e) => e.id, (e) => e.patientName)
      let merged = list.length !== parsed.length
      // Data hygiene / healing: Ensure every encounter has an immutable calendar date & createdAt
      for (const e of list) {
        if (!e.date || !e.createdAt) {
          // 1. Try timestamps arrival or registration if they contain a date
          const ts = e.timestamps?.arrival || e.timestamps?.registration
          if (ts && /\d{4}-\d{2}-\d{2}/.test(ts)) {
            const m = ts.match(/\d{4}-\d{2}-\d{2}/)
            if (m) {
              if (!e.date) { e.date = m[0]; merged = true }
              if (!e.createdAt) { e.createdAt = ts.includes("T") ? ts : `${m[0]}T00:00:00.000Z`; merged = true }
            }
          }
          // 2. Try anchor to patient's immutable registration createdAt
          if ((!e.date || !e.createdAt) && e.umr) {
            const pt = this.getPatientByUmr(e.umr)
            if (pt?.createdAt) {
              const ptDate = pt.createdAt.includes("T") ? pt.createdAt.split("T")[0] : pt.createdAt.split(" ")[0]
              if (/^\d{4}-\d{2}-\d{2}$/.test(ptDate)) {
                if (!e.date) { e.date = ptDate; merged = true }
                if (!e.createdAt) { e.createdAt = pt.createdAt; merged = true }
              }
            }
          }
          // 3. Fallback: if e.id has date e.g. ENC-REP-YYYYMMDD
          if (!e.date && e.id) {
            const m = e.id.match(/ENC-REP-(\d{4})(\d{2})(\d{2})/)
            if (m) {
              e.date = `${m[1]}-${m[2]}-${m[3]}`
              e.createdAt = `${e.date}T00:00:00.000Z`
              merged = true
            }
          }
        }
      }
      if (merged) {
        safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(list))
      }
      list.sort((a, b) => {
        const timeB = new Date(b.createdAt || b.date || 0).getTime()
        const timeA = new Date(a.createdAt || a.date || 0).getTime()
        return timeB - timeA
      })
      return list
    } catch {
      return []
    }
  }

  public getEncountersForPatient(
    query: string,
    patientName?: string,
  ): DBOPEncounter[] {
    if (!query && !patientName) return []

    const q = (query || "").trim().toUpperCase()

    const nameTarget = (patientName || query || "").trim().toLowerCase()

    const encounters = this.getEncounters()

    const matched = encounters.filter((e) => {
      const eUmr = (e.umr || "").toUpperCase()

      if (
        q &&
        (eUmr === q || eUmr.replace(/[-_]/g, "") === q.replace(/[-_]/g, ""))
      )
        return true

      const eName = (e.patientName || "").trim().toLowerCase()

      if (
        nameTarget &&
        (eName === nameTarget ||
          eName.includes(nameTarget) ||
          nameTarget.includes(eName))
      )
        return true

      const ePhone = (e.phone || "").replace(/\D/g, "")

      const qDigits = q.replace(/\D/g, "")

      if (
        qDigits &&
        qDigits.length >= 7 &&
        (ePhone.includes(qDigits) || qDigits.includes(ePhone))
      )
        return true

      return false
    })

    return matched
  }

  public getEncounterById(id: string): DBOPEncounter | undefined {
    if (!id) return undefined
    const clean = id.toLowerCase().trim()
    const cleanStripped = clean.replace(/^(clm|enc|op|inv)[-_]?/i, "")
    return this.getEncounters().find((e) => {
      if (e.id === id || (e.id && e.id.toLowerCase() === clean)) return true
      if (e.opNumber && (e.opNumber === id || e.opNumber.toLowerCase() === clean)) return true
      if (cleanStripped) {
        if (e.id && e.id.toLowerCase().replace(/^(enc)[-_]?/i, "") === cleanStripped) return true
        if (e.opNumber && e.opNumber.toLowerCase().replace(/^(op)[-_]?/i, "") === cleanStripped) return true
      }
      return false
    })
  }

  // ── Patient Matching & Duplicate Verification ─────────────────────────────

  /**
   * Identifies if entered patient details match an existing patient in the database.
   * If the name matches an existing record, but any detail (phone, age, sex) differs,
   * it treats them as a NEW patient and reports the mismatches.
   */

  public findMatchingPatient(params: {
    fullName: string

    dob?: string

    age?: number

    sex?: string

    phone?: string
  }): PatientMatchResult {
    return findMatchingPatient(this.getPatients(), params)
  }

  // ── High-Level OP Workflow Methods ────────────────────────────────────────

  /**
   * 1. Register New Patient:
   * Generates next permanent UMR -> Generates continuous global OP Number -> Saves to database
   */

  public registerNewPatient(data: {
    firstName: string

    middleName?: string

    lastName: string

    dob?: string

    age: number

    sex?: "Male" | "Female" | "Other"

    phone: string

    address?: string

    bloodGroup?: string

    dept?: string

    chiefComplaint?: string
  }, serverVisit: {
    patient_id?: string
    encounter_id?: string | number
    appointment_id?: string | number
    op_number?: string | number
  }): { patient: DBPatient ;encounter: DBOPEncounter } {
    const patients = this.getPatients()

    const encounters = this.getEncounters()

    // Next UMR Generator

    const currentCounter = parseInt(
      safeDbGetItem(STORAGE_KEYS.UMR_COUNTER) || "10000",
      10,
    )

    const nextUmrCounter = currentCounter + 1

    if (!serverVisit?.patient_id) {
      safeDbSetItem(STORAGE_KEYS.UMR_COUNTER, nextUmrCounter.toString())
    }

    const newUmr = serverVisit?.patient_id || `UMR${nextUmrCounter}`

    // Global Continuous Unique OP Number Generator

    const currentOpCounter = parseInt(
      safeDbGetItem(STORAGE_KEYS.OP_COUNTER) || "0",
      10,
    )

    const nextOpCounter = currentOpCounter + 1

    if (serverVisit?.op_number == null) {
      safeDbSetItem(STORAGE_KEYS.OP_COUNTER, nextOpCounter.toString())
    }

    const newOpNumber = `OP${String(serverVisit?.op_number ?? nextOpCounter).padStart(3, "0")}`

    const fullName = [data.firstName, data.middleName, data.lastName]
      .filter(Boolean)
      .join(" ")
      .trim()

    const nowIso = new Date().toISOString()

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })

    // Step 1: Create Patient Record

    const newPatient: DBPatient = {
      umr: newUmr,

      name: fullName,

      dob: data.dob,

      age: data.age,

      sex: data.sex || "Male",

      phone: data.phone || "+91 98765 43210",

      address: data.address || "Main City",

      bloodGroup: data.bloodGroup || "O+",

      createdAt: nowIso,

      updatedAt: nowIso,
    }

    // Step 2: Create Initial OP Encounter with Global Continuous OP Number

    const encounterId = serverVisit?.encounter_id != null
      ? `ENC-${serverVisit.encounter_id}`
      : `ENC-${newUmr}-${nextOpCounter}`

    const newEncounter: DBOPEncounter = {
      id: encounterId,
      date: nowIso.split("T")[0],
      createdAt: nowIso,

      umr: newUmr,

      opNumber: newOpNumber,

      patientName: fullName,

      age: data.age,

      sex: data.sex || "Male",

      phone: newPatient.phone,

      address: newPatient.address,

      bloodGroup: newPatient.bloodGroup,

      dept: data.dept || "Awaiting Triage",

      isNew: true,

      registrationTime: timeStr,

      chiefComplaint: data.chiefComplaint || "",

      symptoms: data.chiefComplaint ? [data.chiefComplaint] : [],

      aiSpecialty: data.dept || "",

      aiDoctor: "",

      aiConfidence: 0,

      doctorGenderPref: data.sex === "Female" ? "Female" : "Male",

      assignedDoctor: "",

      doctorStatus: "Available",

      queueToken: "",

      queuePosition: 1,

      room: "",

      diagnosis: "",

      icd10: "",

      prescription: [],

      investigations: [],

      advice: "",

      vitals: { bp: "", pulse: "", temp: "", spo2: "", weight: "", notes: "" },

      billing: {
        registrationFee: 20,
        consultationFee: data.dept
          ? getDoctorConsultationFee(
              getDoctorMaster().find(
                (d) => d.verified && d.specialty === data.dept,
              )?.name || "",
            )
          : 500,
        labFee: 0,
        total:
          20 +
          (data.dept
            ? getDoctorConsultationFee(
                getDoctorMaster().find(
                  (d) => d.verified && d.specialty === data.dept,
                )?.name || "",
              )
            : 500),
        status: "Pending",
        mode: "Card",
      },

      furtherAction: "None",

      status: "Registered",

      timestamps: { arrival: nowIso, registration: nowIso },
    }

    // Commit to database

    safeDbSetItem(
      STORAGE_KEYS.PATIENTS,
      JSON.stringify([newPatient, ...patients]),
    )

    safeDbSetItem(
      STORAGE_KEYS.ENCOUNTERS,
      JSON.stringify([newEncounter, ...encounters]),
    )

    // Only reached after the server confirmed the visit (see registerNewPatientConfirmed).
    this.announceRegistered(newEncounter.id)

    this.notify()

    return { patient: newPatient, encounter: newEncounter }
  }

  /** Create a patient and initial OP visit on the server before caching it locally. */
  public async registerNewPatientConfirmed(data: {
    firstName: string
    middleName?: string
    lastName: string
    dob?: string
    age: number
    sex?: "Male" | "Female" | "Other"
    phone: string
    address?: string
    bloodGroup?: string
    dept?: string
    chiefComplaint?: string
  }): Promise<{ patient: DBPatient ;encounter: DBOPEncounter }> {
    let serverVisit: {
      patient_id?: string
      encounter_id?: string | number
      appointment_id?: string | number
      op_number?: string | number
    } | undefined

    try {
      serverVisit = await apiFetch<{
        patient_id: string
        encounter_id: string | number
        appointment_id: string | number
        op_number: string | number
      }>("/api/op/visits", {
        method: "POST",
        body: JSON.stringify({
          patient: {
            first_name: data.firstName,
            middle_name: data.middleName,
            last_name: data.lastName,
            dob: data.dob,
            age: data.age,
            gender: data.sex,
            phone: data.phone,
            address: data.address,
            blood_group: data.bloodGroup,
          },
          appointment: {
            department: data.dept || "Awaiting Triage",
            visit_type: "OP",
            appointment_date: new Date().toISOString(),
            status: "checked_in",
            chief_complaint: data.chiefComplaint || "OP Visit",
          },
        }),
      })
    } catch (err: any) {
      console.warn("Backend OP visit sync deferred (offline/session):", err?.message || err)
    }

    return this.registerNewPatient(data, serverVisit)
  }

  /**
   * 2. Revisit Patient Encounter:
   * Keeps Permanent UMR unchanged -> Generates continuous global next OP Number -> Saves
   */

  public createRevisitEncounter(
    umr: string,
    data: { dept?: string ;chiefComplaint?: string } | undefined,
    serverVisit: { encounter_id?: string | number ;op_number?: string | number },
  ): DBOPEncounter {
    const patient = this.getPatientByUmr(umr)

    if (!patient)
      throw new Error(`Patient with UMR ${umr} not found in database.`)

    const encounters = this.getEncounters()

    // Generate Next Global Continuous OP Number across hospital

    const currentOpCounter = parseInt(
      safeDbGetItem(STORAGE_KEYS.OP_COUNTER) || "33",
      10,
    )

    const nextOpCounter = currentOpCounter + 1

    if (serverVisit?.op_number == null) {
      safeDbSetItem(STORAGE_KEYS.OP_COUNTER, nextOpCounter.toString())
    }

    const newOpNumber = `OP${String(serverVisit?.op_number ?? nextOpCounter).padStart(3, "0")}`

    const encounterId = serverVisit?.encounter_id != null
      ? `ENC-${serverVisit.encounter_id}`
      : `ENC-${umr}-${nextOpCounter}`

    const nowIso = new Date().toISOString()

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })

    const newEncounter: DBOPEncounter = {
      id: encounterId,
      date: nowIso.split("T")[0],
      createdAt: nowIso,

      umr: patient.umr, // STRICTLY KEPT UNCHANGED

      opNumber: newOpNumber, // GLOBAL CONTINUOUS NEXT OP NUMBER

      patientName: patient.name,

      age: patient.age,

      sex: patient.sex,

      phone: patient.phone,

      address: patient.address,

      bloodGroup: patient.bloodGroup,

      dept: data?.dept || "Awaiting Triage",

      isNew: false,

      registrationTime: timeStr,

      chiefComplaint: data?.chiefComplaint || "Revisit Consultation",

      symptoms: [],

      aiSpecialty: "",

      aiDoctor: "",

      aiConfidence: 0,

      doctorGenderPref: patient.sex === "Female" ? "Female" : "Male",

      assignedDoctor: "",

      doctorStatus: "Available",

      queueToken: "",

      queuePosition: 1,

      room: "",

      diagnosis: "",

      icd10: "",

      prescription: [],

      investigations: [],

      advice: "",

      vitals: {
        bp: "",
        pulse: "",
        temp: "",
        spo2: "",
        weight: "",
        notes: "Revisit check",
      },

      billing: {
        registrationFee: 0,
        consultationFee: data?.dept
          ? getDoctorConsultationFee(
              getDoctorMaster().find(
                (d) => d.verified && d.specialty === data.dept,
              )?.name || "",
            )
          : 500,
        labFee: 0,
        total:
          0 +
          (data?.dept
            ? getDoctorConsultationFee(
                getDoctorMaster().find(
                  (d) => d.verified && d.specialty === data.dept,
                )?.name || "",
              )
            : 500),
        status: "Pending",
        mode: "Card",
      },

      furtherAction: "None",

      status: "Registered",

      timestamps: { arrival: nowIso, registration: nowIso },
    }

    // Update patient timestamp & save encounter

    const patients = this.getPatients().map((p) =>
      p.umr === umr ? { ...p, updatedAt: new Date().toISOString() } : p,
    )

    safeDbSetItem(STORAGE_KEYS.PATIENTS, JSON.stringify(patients))

    safeDbSetItem(
      STORAGE_KEYS.ENCOUNTERS,
      JSON.stringify([newEncounter, ...encounters]),
    )

    // Only reached after the server confirmed the visit (see createRevisitEncounterConfirmed).
    this.announceRegistered(newEncounter.id)

    this.notify()

    return newEncounter
  }

  /** Create a revisit on the server before adding it to the browser cache. */
  public async createRevisitEncounterConfirmed(
    patient: DBPatient,
    data?: { dept?: string ;chiefComplaint?: string },
  ): Promise<DBOPEncounter> {
    const nameParts = patient.name.trim().split(/\s+/)
    let serverVisit: {
      encounter_id?: string | number
      op_number?: string | number
    } | undefined

    try {
      serverVisit = await apiFetch<{
        encounter_id: string | number
        op_number: string | number
      }>("/api/op/visits", {
        method: "POST",
        body: JSON.stringify({
          patient_id: patient.umr,
          patient: {
            first_name: nameParts[0] || patient.name,
            last_name: nameParts.slice(1).join(" ") || "Unknown",
            phone: patient.phone,
            age: patient.age,
            gender: patient.sex,
          },
          appointment: {
            department: data?.dept || "Awaiting Triage",
            visit_type: "OP",
            appointment_date: new Date().toISOString(),
            status: "checked_in",
            chief_complaint: data?.chiefComplaint || "Revisit Consultation",
          },
        }),
      })
    } catch (err: any) {
      console.warn("Backend revisit sync deferred (offline/session):", err?.message || err)
    }

    return this.createRevisitEncounter(patient.umr, data, serverVisit)
  }

  /**
   * 3. Update Encounter (e.g. Consult, Vitals, Billing):
   */

  /**
   * The OP nurse station recording a patient's baseline observations.
   *
   * This is the gate between reception and the doctor. Booking an appointment
   * assigns the doctor and leaves the visit at "Doctor Assigned"; the patient is
   * only handed to the consulting room once the nurse has taken vitals, which
   * moves it to "In Queue". Without that step the doctor's queue filled with
   * patients nobody had seen yet, and the vitals panel on the admit card was
   * permanently blank.
   */
  /**
   * The OP desk calling a patient through to the nurse station.
   *
   * Step three of the outpatient flow: reception books, the appointment lands on
   * the OP hub, and somebody has to actually call the patient from the waiting
   * room before the nurse can take vitals. Nothing recorded that, so the nurse's
   * list could not tell a patient who had been called from one still sitting
   * outside unaware.
   *
   * The status is untouched -- being called is not a clinical stage, it is a
   * fact about the waiting room. Vitals are still what moves the visit on.
   */
  public getCallHistory(): DBCallEvent[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CALL_HISTORY)
      if (!data) return []
      return JSON.parse(data)
    } catch {
      return []
    }
  }

  public recordCallEvent(event: Omit<DBCallEvent, "id">): DBCallEvent {
    try {
      const history = this.getCallHistory()
      // Prevent accidental duplicate history entries for the same event
      const existing = history.find(
        (h) =>
          h.encounterId === event.encounterId &&
          h.eventType === event.eventType &&
          Math.abs(new Date(h.timestamp).getTime() - new Date(event.timestamp).getTime()) < 5000,
      )
      if (existing) return existing

      const newEvent: DBCallEvent = {
        ...event,
        id: `CALL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      }
      const updated = [
        newEvent,
        ...history.filter(
          (h) => !(h.encounterId === event.encounterId && h.eventType === event.eventType),
        ),
      ].slice(0, 50)
      localStorage.setItem(STORAGE_KEYS.CALL_HISTORY, JSON.stringify(updated))
      this.notify()
      return newEvent
    } catch {
      return { ...event, id: `CALL-${Date.now()}` }
    }
  }

  public callToDoctor(
    id: string,
    calledBy: string = "OP Desk",
  ): DBOPEncounter | undefined {
    const existing = this.getEncounters().find((e) => e.id === id)
    if (!existing) return undefined
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
    return this.updateEncounter(id, {
      status: existing.status === "Under Consultation" ? existing.status : "Awaiting Consultation",
      timestamps: {
        ...existing.timestamps,
        calledToDoctor: now,
        calledToDoctorBy: calledBy,
      },
    })
  }

  public callToNurseStation(
    id: string,
    calledBy: string,
  ): DBOPEncounter | undefined {
    const existing = this.getEncounters().find((e) => e.id === id)
    if (!existing) return undefined
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
    return this.updateEncounter(id, {
      timestamps: {
        ...existing.timestamps,
        calledToNurse: now,
        calledToNurseBy: calledBy,
      },
    })
  }

  /**
   * Saves vitals to the backend first; the encounter only moves to "In Queue"
   * once the server has stored the reading. Throws if the server rejects it.
   */
  public async recordVitals(
    id: string,

    vitals: DBOPEncounter["vitals"],

    nurseName: string,
  ): Promise<DBOPEncounter> {
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })

    const existing = this.getEncounters().find((e) => e.id === id)

    const reading = (value?: string) => {
      const v = (value || "").trim()
      return v && v !== "--" ? v : undefined
    }
    const num = (value: string | undefined, parse: (s: string) => number) => {
      if (!value) return undefined
      const n = parse(value)
      return Number.isFinite(n) ? n : undefined
    }
    const rr = (vitals as any).respiratoryRate ?? (vitals as any).rr
    const payload = {
      bp: reading(vitals.bp),
      pulse: num(reading(vitals.pulse), (s) => parseInt(s, 10)),
      temperature: num(reading(vitals.temp), parseFloat),
      spo2: num(reading(vitals.spo2), (s) => parseInt(s, 10)),
      respiratory_rate: num(reading(rr != null ? String(rr) : undefined), (s) => parseInt(s, 10)),
      weight: num(reading(vitals.weight), parseFloat),
      notes: vitals.notes || undefined,
    }
    const hasReading = [payload.bp, payload.pulse, payload.temperature, payload.spo2, payload.respiratory_rate, payload.weight]
      .some((v) => v !== undefined)

    if (existing?.umr && hasReading) {
      await apiFetch(`/api/patients/${encodeURIComponent(existing.umr)}/vitals`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
    }

    const updated = this.updateEncounter(id, {
      vitals,

      status: "In Queue",

      timestamps: {
        ...(existing?.timestamps ?? { arrival: now }),
        vitalsRecorded: now,
        vitalsBy: nurseName,
      },
    })

    return updated
  }

  public updateEncounter(
    id: string,
    updates: Partial<DBOPEncounter>,
  ): DBOPEncounter {
    const encounters = this.getEncounters()
    const clean = (id || "").toLowerCase().trim()
    const cleanStripped = clean.replace(/^(clm|enc|op|inv)[-_]?/i, "")
    const targetEnc = encounters.find((e) => {
      if (e.id === id || (e.id && e.id.toLowerCase() === clean)) return true
      if (e.opNumber && (e.opNumber === id || e.opNumber.toLowerCase() === clean)) return true
      if (cleanStripped) {
        if (e.id && e.id.toLowerCase().replace(/^(enc)[-_]?/i, "") === cleanStripped) return true
        if (e.opNumber && e.opNumber.toLowerCase().replace(/^(op)[-_]?/i, "") === cleanStripped) return true
      }
      return false
    })
    const targetId = targetEnc ? targetEnc.id : id

    let updated: DBOPEncounter | null = null

    const newEncounters = encounters.map((e) => {
      if (e.id === targetId) {
        const assignedDoc =
          updates.assignedDoctor !== undefined
            ? updates.assignedDoctor
            : e.assignedDoctor

        let cFee = e.billing?.consultationFee || 500
        if (updates.billing?.consultationFee !== undefined) {
          cFee = updates.billing.consultationFee
        } else if (
          updates.assignedDoctor &&
          updates.assignedDoctor !== e.assignedDoctor
        ) {
          cFee = getDoctorConsultationFee(updates.assignedDoctor)
        } else if (assignedDoc && (cFee === 50 || !e.billing?.consultationFee)) {
          cFee = getDoctorConsultationFee(assignedDoc)
        }

        const regFee =
          updates.billing?.registrationFee !== undefined
            ? updates.billing.registrationFee
            : (e.billing?.registrationFee ?? (e.isNew === false ? 0 : 20))

        const lFee =
          updates.billing?.labFee !== undefined
            ? updates.billing.labFee
            : (e.billing?.labFee || 0)

        const bStatus =
          updates.billing?.status || e.billing?.status || "Pending"
        const bMode = updates.billing?.mode || e.billing?.mode || "Card"

        const mergedBilling = {
          registrationFee: regFee,
          consultationFee: cFee,
          labFee: lFee,
          total: regFee + cFee + lFee,
          status: bStatus,
          mode: bMode,
        }

        updated = {
          ...e,
          ...updates,
          billing: mergedBilling,
        }

        return updated
      }

      return e
    })

    if (!updated) throw new Error(`Encounter ${id} not found.`)

    safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(newEncounters))

    this.notify()

    return updated
  }

  /**
   * Update existing patient demographics and synchronize encounters
   */
  public updatePatient(
    umr: string,
    updates: Partial<Omit<DBPatient, "umr" | "createdAt">>,
  ): DBPatient {
    const patients = this.getPatients()
    let updatedPatient: DBPatient | null = null

    const newPatients = patients.map((p) => {
      if (p.umr.toUpperCase() === umr.toUpperCase()) {
        updatedPatient = {
          ...p,
          ...updates,
          updatedAt: new Date().toISOString(),
        }
        return updatedPatient
      }
      return p
    })

    if (!updatedPatient) {
      throw new Error(`Patient with UMR ${umr} not found.`)
    }

    safeDbSetItem(STORAGE_KEYS.PATIENTS, JSON.stringify(newPatients))

    // Synchronize latest demographics to encounters under this UMR
    const encounters = this.getEncounters()
    const newEncounters = encounters.map((e) => {
      if (e.umr.toUpperCase() === umr.toUpperCase()) {
        return {
          ...e,
          ...(updates.name ? { patientName: updates.name } : {}),
          ...(updates.age !== undefined ? { age: updates.age } : {}),
          ...(updates.sex ? { sex: updates.sex } : {}),
          ...(updates.phone ? { phone: updates.phone } : {}),
          ...(updates.address ? { address: updates.address } : {}),
          ...(updates.bloodGroup ? { bloodGroup: updates.bloodGroup } : {}),
        }
      }
      return e
    })
    safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(newEncounters))

    this.notify()
    return updatedPatient
  }

  /**
   * Delete patient and all their encounters by UMR
   */

  public deletePatientByUmr(umr: string): void {
    const patients = this.getPatients().filter(
      (p) => p.umr.toUpperCase() !== umr.toUpperCase(),
    )

    const encounters = this.getEncounters().filter(
      (e) => e.umr.toUpperCase() !== umr.toUpperCase(),
    )

    safeDbSetItem(STORAGE_KEYS.PATIENTS, JSON.stringify(patients))

    safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(encounters))

    this.notify()
  }

  /**
   * Delete patient and all their encounters by Name
   */

  public deletePatientByName(name: string): void {
    const cleanName = name.trim().toLowerCase()

    const patients = this.getPatients().filter(
      (p) => !p.name.toLowerCase().includes(cleanName),
    )

    const encounters = this.getEncounters().filter(
      (e) => !e.patientName.toLowerCase().includes(cleanName),
    )

    safeDbSetItem(STORAGE_KEYS.PATIENTS, JSON.stringify(patients))

    safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(encounters))

    this.notify()
  }

  /**
   * Delete a single encounter by ID
   */

  public deleteEncounterById(id: string): void {
    const encounters = this.getEncounters().filter((e) => e.id !== id)

    safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(encounters))

    this.notify()
  }

  /**
   * Clear the OP store: no patients, no visits.
   */

  public resetDatabase() {
    safeDbSetItem(STORAGE_KEYS.PATIENTS, "[]")

    safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, "[]")

    safeDbSetItem(STORAGE_KEYS.UMR_COUNTER, "10048")
    safeDbSetItem(STORAGE_KEYS.OP_COUNTER, "33")

    this.notify()
  }

  /**
   * Sync OP Visit Queue from real PostgreSQL backend into local store.
   * Enables cross-machine real-time queue & doctor alert synchronization.
   */
  public async syncOPVisitsWithBackend(): Promise<void> {
    try {
      const res = await apiFetch<{ queue?: any[] }>("/api/queue")
      if (res && Array.isArray(res.queue) && res.queue.length > 0) {
        const encounters = this.getEncounters()
        let hasChanges = false

        for (const item of res.queue) {
          const encId = item.appointment_id ? `ENC-${item.patient_id}-${item.appointment_id}` : `ENC-${item.patient_id}`
          // A bare UMR match is not proof it is the same person: a desk's UMR counter can
          // reissue a number the server already holds for someone else. Require the names
          // to agree before treating a UMR-only match as the same patient.
          const sameFirstName = (a: unknown, b: unknown) =>
            String(a || "").trim().toLowerCase().split(/\s+/)[0] === String(b || "").trim().toLowerCase().split(/\s+/)[0]
          const existingIndex = encounters.findIndex(
            (e) =>
              ((e.id === encId || e.umr === item.patient_id) &&
                sameFirstName(e.patientName, item.patient_name || item.patient_first_name)) ||
              // undefined === undefined would match every unlinked encounter to any row
              // that has no appointment id, so only compare real ids.
              ((e as any).dbAppointmentId != null &&
                ((e as any).dbAppointmentId === item.id || (e as any).dbAppointmentId === item.appointment_id))
          )

          const demo = queueDemographics(item)
          if (existingIndex >= 0) {
            const existing = encounters[existingIndex]
            const newStatus = item.status === "in_consultation" ? "Under Consultation" : item.status === "checked_in" ? "In Queue" : existing.status
            // "Dr. Staff" is a placeholder older versions sent to the server for a patient with no
            // doctor yet; it must not overwrite a doctor the desk has since booked.
            const serverDoctor = item.doctor_name && item.doctor_name !== "Dr. Staff" ? item.doctor_name : ""
            const newDoc = serverDoctor || (existing as any).assignedDoctor || (existing as any).doctorAssigned || item.doctor_name
            // Encounters this sync created are the server's patients: keep their
            // details in step with it. This also repairs the placeholders
            // ("+91 98765 43210", age 40, O+, "Main City") earlier versions
            // wrote when they read the wrong field names.
            const fromServer = existing.id === encId
            const fix: Partial<DBOPEncounter> = {}
            if (fromServer) {
              if (demo.patientName && demo.patientName !== existing.patientName) fix.patientName = demo.patientName
              if (demo.phone !== existing.phone && (demo.phone || existing.phone === PLACEHOLDER_PHONE)) fix.phone = demo.phone
              if (demo.age != null && demo.age !== existing.age) fix.age = demo.age
              if (demo.sex && demo.sex !== existing.sex) fix.sex = demo.sex
              if (demo.bloodGroup !== (existing.bloodGroup || "")) fix.bloodGroup = demo.bloodGroup
              if (existing.address === "Main City") fix.address = ""
            }

            if ((existing as any).assignedDoctor !== newDoc || existing.status !== newStatus || Object.keys(fix).length) {
              encounters[existingIndex] = {
                ...existing,
                ...fix,
                assignedDoctor: newDoc,
                doctorAssigned: newDoc,
                status: newStatus as any,
                ...(item.id || item.appointment_id ? { dbAppointmentId: item.id || item.appointment_id } : {}),
              } as any
              hasChanges = true
            }
          } else {
            const rawItemDate = item.appointment_date || item.created_at || new Date().toISOString()
            const itemDateIso = typeof rawItemDate === "string" && rawItemDate.includes("T")
              ? rawItemDate
              : new Date(rawItemDate).toISOString()
            const itemDateStr = itemDateIso.split("T")[0]
            const itemTimeStr = item.time_slot || new Date(itemDateIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

            const newEnc: DBOPEncounter = {
              id: encId,
              opNumber: `OP-${item.patient_id || "101"}`,
              tokenNo: `T-${item.id || 101}`,
              umr: item.patient_id || "UMR-UNKNOWN",
              // Only what the server sent; nothing is made up for a missing field.
              patientName: demo.patientName || "Patient",
              age: (demo.age ?? null) as any,
              sex: (demo.sex || "Other") as any,
              phone: demo.phone,
              address: item.patient_address || item.address || "",
              bloodGroup: demo.bloodGroup,
              dept: item.department || "General Medicine",
              isNew: false,
              date: itemDateStr,
              createdAt: itemDateIso,
              registrationTime: itemTimeStr,
              chiefComplaint: item.chief_complaint || "OP Visit",
              symptoms: item.chief_complaint ? [item.chief_complaint] : ["General Consultation"],
              aiSpecialty: item.department || "General Medicine",
              assignedDoctor: item.doctor_name || "Dr. Staff",
              doctorAssigned: item.doctor_name || "Dr. Staff",
              consultationType: "General Consultation",
              consultationFee: 500,
              payment: {
                totalAmount: 500,
                amountPaid: 500,
                balanceDue: 0,
                status: "Paid",
                mode: "Card",
              },
              furtherAction: "None",
              status: item.status === "in_consultation" ? "Under Consultation" : "In Queue",
              timestamps: {
                arrival: itemDateIso,
                registration: itemDateIso,
              },
              vitals: item.vitals && (item.vitals.bp || item.vitals.pulse || item.vitals.temperature || item.vitals.spo2 || item.vitals.weight) ? {
                bp: item.vitals.bp || "",
                pulse: item.vitals.pulse ? String(item.vitals.pulse) : "",
                temp: item.vitals.temperature ? String(item.vitals.temperature) : "",
                spo2: item.vitals.spo2 ? String(item.vitals.spo2) : "",
                weight: item.vitals.weight ? String(item.vitals.weight) : "",
                notes: item.vitals.notes || "",
              } : undefined,
            } as any
            encounters.unshift(newEnc)
            if (item.patient_id && !this.getPatientByUmr(item.patient_id)) {
              const allPatients = this.getPatients()
              const newPt: DBPatient = {
                umr: item.patient_id,
                name: demo.patientName || "Patient",
                dob: "1985-01-01",
                age: (demo.age ?? 40) as any,
                sex: (demo.sex || "Male") as any,
                phone: demo.phone || "+91 98765 43210",
                address: item.patient_address || item.address || "Main City",
                bloodGroup: demo.bloodGroup || "O+",
                createdAt: itemDateIso,
                updatedAt: itemDateIso,
              }
              safeDbSetItem(STORAGE_KEYS.PATIENTS, JSON.stringify([newPt, ...allPatients]))
            }
            hasChanges = true
          }
        }

        if (hasChanges) {
          safeDbSetItem(STORAGE_KEYS.ENCOUNTERS, JSON.stringify(encounters))
          this.notify()
        }
      }
    } catch {
      // Best-effort sync
    }
  }
}

export const db = new HospitalDatabase()

export interface PatientMatchResult {
  match: DBPatient | null // Non-null ONLY if name matches AND all other details (phone, age, sex) do NOT conflict with the DB record

  nameMatchedPatient: DBPatient | null // Non-null if ANY patient in DB has the same name

  mismatches: string[] // List of specific mismatched fields
}

/**
 * Robust matching logic:
 * When a name is entered:
 * - If name matches a patient in DB and all other entered details (phone, age, sex) match -> Existing Patient (match non-null)
 * - If name matches, but ANY detail (phone, age, sex) mismatches -> New Patient (match is null, nameMatchedPatient is set, mismatches lists details)
 * - If name does not match any patient in DB -> New Patient (match and nameMatchedPatient are null)
 */

export function findMatchingPatient(
  patients: DBPatient[],

  params: {
    fullName: string

    dob?: string

    age?: number

    sex?: string

    phone?: string
  },
): PatientMatchResult {
  const cleanName = params.fullName.trim().toLowerCase()

  if (cleanName.length < 2) {
    return { match: null, nameMatchedPatient: null, mismatches: [] }
  }

  // Find all patients in DB with the exact same name (case-insensitive)

  const candidates = patients.filter(
    (p) => p.name.trim().toLowerCase() === cleanName,
  )

  if (candidates.length === 0) {
    return { match: null, nameMatchedPatient: null, mismatches: [] }
  }

  // Check each candidate for an exact non-conflicting match

  for (const candidate of candidates) {
    const candidateMismatches: string[] = []

    // 1. Exact Date of Birth (DOB) comparison

    if (params.dob && candidate.dob) {
      if (params.dob.trim() !== candidate.dob.trim()) {
        candidateMismatches.push(
          `DOB differs (${params.dob} vs registered ${candidate.dob})`,
        )
      }
    } else if (
      params.age !== undefined &&
      params.age !== null &&
      params.age > 0
    ) {
      // Fallback to age comparison if candidate record does not have explicit DOB stored

      if (params.age !== candidate.age) {
        candidateMismatches.push(
          `Age differs (${params.age} yrs vs registered ${candidate.age} yrs)`,
        )
      }
    }

    // 2. Phone number comparison (digits only, normalizing national 10-digit if prefixed with country code)
    if (params.phone && params.phone.trim().length >= 4) {
      const inputDigits = params.phone.replace(/\D/g, "")
      const dbDigits = candidate.phone.replace(/\D/g, "")
      const normInput = inputDigits.length >= 10 ? inputDigits.slice(-10) : inputDigits
      const normDb = dbDigits.length >= 10 ? dbDigits.slice(-10) : dbDigits

      if (normInput && normDb && normInput !== normDb) {
        candidateMismatches.push(
          `Phone number differs (${params.phone.trim()} vs ${candidate.phone})`,
        )
      }
    }

    // 3. Gender comparison (if sex is provided and not empty)

    if (params.sex && params.sex.trim() !== "") {
      if (
        params.sex.trim().toLowerCase() !== candidate.sex.trim().toLowerCase()
      ) {
        candidateMismatches.push(
          `Gender differs (${params.sex} vs ${candidate.sex})`,
        )
      }
    }

    // If zero mismatches, we found an exact match!

    if (candidateMismatches.length === 0) {
      return {
        match: candidate,

        nameMatchedPatient: candidate,

        mismatches: [],
      }
    }
  }

  // If no candidate matched without mismatches, collect the mismatches of the primary candidate

  const primaryCandidate = candidates[0]

  const detectedMismatches: string[] = []

  if (params.dob && primaryCandidate.dob) {
    if (params.dob.trim() !== primaryCandidate.dob.trim()) {
      detectedMismatches.push(
        `DOB differs: ${params.dob} vs registered ${primaryCandidate.dob}`,
      )
    }
  } else if (
    params.age !== undefined &&
    params.age !== null &&
    params.age > 0 &&
    params.age !== primaryCandidate.age
  ) {
    detectedMismatches.push(
      `Age differs: ${params.age} yrs vs registered ${primaryCandidate.age} yrs`,
    )
  }

  if (params.phone && params.phone.trim().length >= 4) {
    const inputDigits = params.phone.replace(/\D/g, "")
    const dbDigits = primaryCandidate.phone.replace(/\D/g, "")
    const normInput = inputDigits.length >= 10 ? inputDigits.slice(-10) : inputDigits
    const normDb = dbDigits.length >= 10 ? dbDigits.slice(-10) : dbDigits

    if (normInput && normDb && normInput !== normDb) {
      detectedMismatches.push(
        `Phone number differs: "${params.phone.trim()}" vs registered "${primaryCandidate.phone}"`,
      )
    }
  }

  if (
    params.sex &&
    params.sex.trim() !== "" &&
    params.sex.trim().toLowerCase() !==
      primaryCandidate.sex.trim().toLowerCase()
  ) {
    detectedMismatches.push(
      `Gender differs: ${params.sex} vs registered ${primaryCandidate.sex}`,
    )
  }

  return {
    match: null,

    nameMatchedPatient: primaryCandidate,

    mismatches: detectedMismatches,
  }
}
