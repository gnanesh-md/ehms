/**
 * Enterprise Hospital Management System - Emergency Room & Bed Management Persistent Store
 * Provides full offline/local storage fallback and data persistence for ER & Bed workflows.
 */

import { db } from "./db"
import { BedDatabase } from "./bedDb"
import { LLM_API_KEY, LLM_CHAT_URL, llmModel } from "../lib/llm"

export interface ErPatientMedicalProfile {
  chronic_conditions: string[]

  past_medical_history: string

  past_surgeries: string

  family_history: string

  current_medications: Array<{
    name: string

    dosage: string

    frequency: string

    indication: string
  }>
}

export interface ErPatient {
  patient_id: string

  name: string

  last_name: string

  gender: string

  age: number

  dob?: string

  phone: string

  emergency_contact: string

  emergency_contact_name?: string

  emergency_contact_relation?: string

  guardian_name?: string

  guardian_relation?: string

  address?: string

  allergies?: string

  blood_group?: string

  created_at: string

  medical_profile?: ErPatientMedicalProfile
}

export interface ErComplaintItem {
  id: number

  complaint: string

  severity: string | null

  case_category: string | null

  duration: string | null

  reported_by: string | null

  created_at: string
}

export interface ErVitalsItem {
  id: number

  recorded_at: string

  recorded_by: string | null

  heart_rate: number | null

  bp_systolic: number | null

  bp_diastolic: number | null

  respiratory_rate: number | null

  spo2: number | null

  temperature: number | null

  consciousness_level: string | null

  blood_glucose: number | null

  pain_score: number | null

  gcs: number | null

  notes: string | null
}

export interface ErTriageItem {
  category: string

  triage_bed_label: string | null

  reason: string | null

  triaged_at: string

  assigned_by: string | null
}

export interface ErTreatmentItem {
  id: number

  intervention_type: string

  description: string | null

  performed_at: string

  administered_by: string | null
}

export interface ErClinicalNoteItem {
  id: number

  note_type: string

  author: string | null

  content: string

  created_at: string
}

export interface ErDispositionItem {
  outcome: string

  required_specialty: string | null

  clinical_reason: string

  decided_by: string | null

  decided_at: string

  priority: string | null
}

export interface ErBedRequestItem {
  id: number

  status: string

  requested_level_of_care: string

  requested_specialty: string | null

  requested_at: string

  allocated_bed_id: number | null

  allocated_admission_id: number | null

  allocated_at: string | null
}

export interface ErConsentItem {
  id: number

  hospital_id?: number

  patient_id?: string

  patient_name: string

  consent_type: string

  signed_by: string

  relation_to_patient?: string

  status: string

  witness_doctor?: string

  signed_by_phone?: string

  refusal_reason?: string

  legal_waiver_acknowledged: boolean

  er_visit_id?: number

  notes?: string

  signed_at?: string

  document_filename?: string | null

  document_mime_type?: string | null
}

export interface ErInvestigationItem {
  id: number

  test_name: string

  category: string

  priority: string

  ordered_at: string

  ordered_by: string

  status: "Completed" | "In Progress" | "Ordered" | "Sample Collected"

  result: string | null

  result_summary?: string | null

  verified_at?: string | null
}

export type ErTimelineEventType = "patient_arrived" | "bed_assigned" | "initial_vitals" | "medication_given" | "intervention_given" | "investigation_ordered" | "followup_vitals" | "patient_stabilized" | "doctor_assigned" | "doctor_arrived" | "doctor_assessment_completed" | "destination_assigned" | "destination_bed_assigned" | "patient_transferred"

export interface ErTimelineEventItem {
  id: number

  event_type: ErTimelineEventType

  event_name: string

  timestamp: string // ISO string

  logged_by: string // e.g. "Staff Nurse Jessica Carter, RN"

  visit_id: number

  visit_no: string

  patient_id?: string | null

  location?: string | null

  bed?: string | null

  notes?: string | null

  vitals_data?: {
    bp_systolic?: number | null

    bp_diastolic?: number | null

    heart_rate?: number | null

    spo2?: number | null

    respiratory_rate?: number | null

    temperature?: number | null

    blood_glucose?: number | null

    pain_score?: number | null

    gcs?: number | null

    notes?: string | null
  }

  medication_data?: {
    drug_name: string

    dosage: string

    route: string

    response?: string

    notes?: string
  }

  intervention_data?: {
    intervention_type: string

    details?: string

    patient_response?: string

    notes?: string
  }

  investigation_data?: {
    test_name: string

    priority?: string

    category?: string

    notes?: string
  }

  stabilization_data?: {
    status: string

    clinical_notes?: string
  }

  doctor_data?: {
    doctor_name: string

    specialty: string

    assignment_method: "Manual by Nurse" | "AI Recommended & Nurse Confirmed"

    notes?: string
  }

  assessment_data?: {
    doctor_name: string

    clinical_impression?: string

    acute_condition?: string

    care_plan?: string
  }

  destination_data?: {
    destination: "Ward" | "ICU" | "HDU" | "Specialty Ward" | "Observation" | "Operating Theatre" | "Discharge"

    clinical_reason?: string

    doctor_name?: string

    ai_recommendation_notes?: string
  }

  destination_bed_data?: {
    department: string

    bed_id_or_label: string

    allocated_by?: string
  }

  transfer_data?: {
    source_location: string

    target_destination: string

    target_bed: string

    transfer_status: "Transfer Completed" | "In Transit"

    escorting_staff?: string

    handover_notes?: string
  }
}

export interface ErVisitRecord {
  id: number

  visit_no: string

  patient_id: string | null

  is_unknown_patient: boolean

  unknown_patient_label: string | null

  arrival_mode: string | null

  brought_by?: string | null

  attendant_name?: string | null

  attendant_relation?: string | null

  condition_at_arrival: string | null

  consciousness?: string | null

  info_provided_by?: string | null

  arrival_at: string | null

  status: string

  assigned_doctor_name: string | null

  assigned_specialty: string | null

  doctor_assigned_at: string | null

  doctor_accepted_at: string | null

  triage_category: string | null

  triage_bed_label: string | null

  closed_at: string | null

  police_involved?: boolean

  patient_name?: string | null

  patient_last_name?: string | null

  patient_gender?: string | null

  patient_age?: number | null

  patient_phone?: string | null

  patient_emergency_contact?: string | null

  patient?: ErPatient | null

  prior_visits_count?: number

  complaints: ErComplaintItem[]

  vitals: ErVitalsItem[]

  triage: ErTriageItem | null

  treatments: ErTreatmentItem[]

  clinical_notes: ErClinicalNoteItem[]

  investigations?: ErInvestigationItem[]

  disposition: ErDispositionItem | null

  bed_requests: ErBedRequestItem[]

  consents: ErConsentItem[]

  timeline_events?: ErTimelineEventItem[]
}

export interface TriageCategoryConfig {
  id: number

  category_code: string

  category_label: string

  description: string | null

  color: string | null

  sort_order: number
}

const DEFAULT_TRIAGE_CATEGORIES: TriageCategoryConfig[] = [
  {
    id: 1,
    category_code: "B1",
    category_label: "Immediate / Resuscitation",
    description:
      "Life-threatening condition requiring immediate medical intervention",
    color: "#DC2626",
    sort_order: 1,
  },

  {
    id: 2,
    category_code: "B2",
    category_label: "High / Emergent",
    description:
      "Potentially life-threatening condition; assessment within 10-15 minutes",
    color: "#EA580C",
    sort_order: 2,
  },

  {
    id: 3,
    category_code: "B3",
    category_label: "Moderate / Urgent",
    description:
      "Serious condition requiring medical evaluation within 30-60 minutes",
    color: "#D97706",
    sort_order: 3,
  },

  {
    id: 4,
    category_code: "B4",
    category_label: "Low / Less Urgent",
    description: "Stable condition, routine emergency evaluation",
    color: "#16A34A",
    sort_order: 4,
  },

  {
    id: 5,
    category_code: "B5",
    category_label: "Non-Urgent",
    description:
      "Minor presentation, can be managed electively or referred to OP",
    color: "#2563EB",
    sort_order: 5,
  },

  {
    id: 6,
    category_code: "Black",
    category_label: "Expectant / Comfort Care",
    description:
      "Catastrophic non-survivable presentation or deceased; comfort & palliative care",
    color: "#1E293B",
    sort_order: 6,
  },
]

const INITIAL_PATIENTS: ErPatient[] = []

const INITIAL_VISITS: ErVisitRecord[] = []

const ER_STORAGE_KEY_PATIENTS = "hospai_er_patients_v8"

const ER_STORAGE_KEY_VISITS = "hospai_er_visits_v8"

const ER_STORAGE_KEY_CATEGORIES = "hospai_er_categories_v8"

export class ErDatabase {
  private static load<T,>(key: string, fallback: T): T {
    try {
      if (typeof window === "undefined") return fallback

      const data = window.localStorage.getItem(key)

      if (!data) {
        // If v8 is missing, check if v7 or v6 has user-created visits

        if (key === ER_STORAGE_KEY_VISITS) {
          const oldV =
            window.localStorage.getItem("hospai_er_visits_v7") ||
            window.localStorage.getItem("hospai_er_visits_v6")

          if (oldV) {
            try {
              const oldVisits: ErVisitRecord[] = JSON.parse(oldV)

              const fallbackVisits = fallback as unknown as ErVisitRecord[]

              const fallbackIds = new Set(fallbackVisits.map((v) => v.id))

              const userVisits = oldVisits.filter((v) => !fallbackIds.has(v.id))

              const merged = [...fallbackVisits, ...userVisits]

              window.localStorage.setItem(key, JSON.stringify(merged))

              return merged as unknown as T
            } catch {}
          }
        }

        window.localStorage.setItem(key, JSON.stringify(fallback))

        return fallback
      }

      const parsed = JSON.parse(data)

      // Purge legacy mock seed records & duplicate visits
      if (key === ER_STORAGE_KEY_VISITS && Array.isArray(parsed)) {
        let filtered = parsed.filter(
          (v: any) => v && !String(v.id).startsWith("ER-2024") && !String(v.id).startsWith("ER-2025") && v.patient_name !== "John" && v.patient_name !== "Rahul" && v.patient_name !== "Robert"
        )

        // Deduplicate duplicate visits for the same patient (never allow duplicate active visits)
        const activeVisits = filtered.filter(
          (v: any) => v && v.status !== "closed" && v.status !== "discharged"
        )
        const toRemoveIds = new Set<string>()
        const seenActivePatients: any[] = []

        for (const v of activeVisits) {
          const vPid = (v.patient_id || v.patient?.patient_id || "").trim().toUpperCase()
          const vName = (v.patient_name || v.patient?.name || "").trim().toLowerCase()
          const vLast = (v.patient_last_name || v.patient?.last_name || "").trim().toLowerCase()
          const vPhone = (v.patient_phone || v.patient?.phone || "").replace(/\D/g, "")

          const duplicateOf = seenActivePatients.find((prev) => {
            const prevPid = (prev.patient_id || prev.patient?.patient_id || "").trim().toUpperCase()
            const prevName = (prev.patient_name || prev.patient?.name || "").trim().toLowerCase()
            const prevLast = (prev.patient_last_name || prev.patient?.last_name || "").trim().toLowerCase()
            const prevPhone = (prev.patient_phone || prev.patient?.phone || "").replace(/\D/g, "")

            // 1. Same UHID
            if (vPid && prevPid && vPid === prevPid) return true
            // 2. Same Phone (10 digits)
            if (vPhone && prevPhone && vPhone.length >= 10 && vPhone === prevPhone) return true
            // 3. Same full name
            if (vName && prevName && vName === prevName) {
              if (vLast && prevLast && vLast === prevLast) return true
              if (!vLast || !prevLast) return true
            }
            return false
          })

          if (duplicateOf) {
            // Rank them: decide which one to keep
            // Prefer triaged visits with specific bed over default/placeholder B1 Resuscitation
            const vIsBetter = (v.status === "triaged" && v.triage_category && !v.triage_category.includes("Resuscitation"))
            const prevIsBetter = (duplicateOf.status === "triaged" && duplicateOf.triage_category && !duplicateOf.triage_category.includes("Resuscitation"))

            if (vIsBetter && !prevIsBetter) {
              // Mark prev for removal, keep v
              toRemoveIds.add(String(duplicateOf.id))
              if (duplicateOf.visit_no) toRemoveIds.add(String(duplicateOf.visit_no))
              const idx = seenActivePatients.indexOf(duplicateOf)
              if (idx >= 0) seenActivePatients[idx] = v
            } else {
              // Keep prev, mark v for removal
              toRemoveIds.add(String(v.id))
              if (v.visit_no) toRemoveIds.add(String(v.visit_no))
            }
          } else {
            seenActivePatients.push(v)
          }
        }

        if (toRemoveIds.size > 0) {
          filtered = filtered.filter((v: any) => !toRemoveIds.has(String(v.id)) && (!v.visit_no || !toRemoveIds.has(String(v.visit_no))))
        }

        if (filtered.length !== parsed.length) {
          window.localStorage.setItem(key, JSON.stringify(filtered))
        }
        return filtered as unknown as T
      }

      if (key === ER_STORAGE_KEY_PATIENTS && Array.isArray(parsed)) {
        const filtered = parsed.filter(
          (p: any) => p && !String(p.patient_id).startsWith("P-1002") && !String(p.patient_id).startsWith("P-1003") && p.name !== "John" && p.name !== "Rahul" && p.name !== "Robert"
        )
        if (filtered.length !== parsed.length) {
          window.localStorage.setItem(key, JSON.stringify(filtered))
        }
        return filtered as unknown as T
      }

      return parsed
    } catch {
      return fallback
    }
  }

  private static save<T,>(key: string, data: T): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(data))
      }
    } catch (e) {
      console.error("ErDatabase save error:", e)
    }
  }

  // Patients

  static getPatients(): ErPatient[] {
    const list = this.load<ErPatient[]>(ER_STORAGE_KEY_PATIENTS, INITIAL_PATIENTS)
    return [...list].sort((a, b) => {
      const timeB = new Date(b.created_at || 0).getTime()
      const timeA = new Date(a.created_at || 0).getTime()
      return timeB - timeA
    })
  }

  static searchPatients(query: string): ErPatient[] {
    const q = (query || "").trim().toLowerCase()

    if (!q) return []

    return this.getPatients().filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.last_name || "").toLowerCase().includes(q) ||
        (p.patient_id || "").toLowerCase().includes(q) ||
        (p.phone || "").includes(q),
    )
  }

  static getPatient(patientId: string): ErPatient | null {
    const pId = (patientId || "").trim().toUpperCase()

    return (
      this.getPatients().find(
        (p) => (p.patient_id || "").trim().toUpperCase() === pId,
      ) || null
    )
  }

  static addPatient(patientData: Partial<ErPatient>): ErPatient {
    const patients = this.getPatients()

    const rawPhone = (patientData.phone || "").replace(/\D/g, "")
    const cleanPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone

    const cleanName = (patientData.name || "").trim().toLowerCase()

    const cleanLastName = (patientData.last_name || "").trim().toLowerCase()

    const existing = patientData.patient_id
      ? patients.find(
          (p) =>
            (p.patient_id || "").trim().toUpperCase() ===
            patientData.patient_id!.trim().toUpperCase(),
        )
      : cleanPhone && cleanPhone.length === 10 && cleanPhone !== "0000000000"
        ? patients.find((p) => {
            const pDigits = (p.phone || "").replace(/\D/g, "")
            const p10 = pDigits.length >= 10 ? pDigits.slice(-10) : pDigits
            return p10 === cleanPhone
          })
        : cleanName && cleanLastName
          ? patients.find(
              (p) =>
                (p.name || "").trim().toLowerCase() === cleanName &&
                (p.last_name || "").trim().toLowerCase() === cleanLastName,
            )
          : null

    if (existing) {
      Object.assign(existing, patientData)

      this.save(ER_STORAGE_KEY_PATIENTS, patients)

      return existing
    }

    const nextId =
      patients.length > 0
        ? Math.max(
            ...patients.map((p) => {
              const num = parseInt(p.patient_id.replace(/\D/g, ""), 10)

              return isNaN(num) ? 0 : num
            }),
          ) + 1
        : 100100

    const newPatient: ErPatient = {
      patient_id:
        patientData.patient_id || `P-${String(nextId).padStart(6, "0")}`,

      name: patientData.name || "Patient",

      last_name: patientData.last_name || "",

      gender: patientData.gender || "Unknown",

      age: patientData.age || 30,

      phone: patientData.phone || "",

      emergency_contact:
        patientData.emergency_contact || patientData.phone || "",

      guardian_name: patientData.guardian_name,

      address: patientData.address || "",

      allergies: patientData.allergies,

      blood_group: patientData.blood_group || "O+",

      created_at: new Date().toISOString(),
    }

    patients.push(newPatient)

    this.save(ER_STORAGE_KEY_PATIENTS, patients)

    try {
      const corePat = db.getPatientByUmr(newPatient.patient_id)
      if (!corePat) {
        db.addPatient({
          umr: newPatient.patient_id,
          name: `${newPatient.name} ${newPatient.last_name}`.trim(),
          age: newPatient.age,
          sex: (newPatient.gender?.toLowerCase() === "female" ? "Female" : "Male") as any,
          gender: newPatient.gender,
          phone: newPatient.phone,
          address: newPatient.address || "",
          bloodGroup: newPatient.blood_group || "O+",
          createdAt: newPatient.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
    } catch {}

    return newPatient
  }

  static updatePatient(
    patientId: string,
    updates: Partial<ErPatient>,
  ): ErPatient {
    const list = this.getPatients()

    const idx = list.findIndex((p) => p.patient_id === patientId)
    let updatedPat: ErPatient

    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates }
      this.save(ER_STORAGE_KEY_PATIENTS, list)
      updatedPat = list[idx]
    } else {
      updatedPat = this.addPatient({ patient_id: patientId, ...updates })
    }

    // Always sync existing visits for this patient (including full patient object)
    const visits = this.getVisits("all")
    let changed = false

    visits.forEach((v) => {
      if (
        v.patient_id === patientId ||
        (v.patient && v.patient.patient_id === patientId) ||
        (patientId.startsWith("P-") && String(v.id) === patientId.replace("P-", ""))
      ) {
        if (updates.name) v.patient_name = updates.name
        if (updates.last_name !== undefined)
          v.patient_last_name = updates.last_name
        if (updates.gender) v.patient_gender = updates.gender
        if (updates.age !== undefined) v.patient_age = updates.age
        if (updates.phone) v.patient_phone = updates.phone
        if (updates.emergency_contact)
          v.patient_emergency_contact = updates.emergency_contact

        v.patient = {
          ...(v.patient || {}),
          ...updates,
          patient_id: v.patient_id || patientId,
          name: updates.name || v.patient?.name || v.patient_name || "",
          last_name: updates.last_name !== undefined ? updates.last_name : (v.patient?.last_name || v.patient_last_name || ""),
          gender: updates.gender || v.patient?.gender || v.patient_gender || "Other",
          age: updates.age !== undefined ? updates.age : (v.patient?.age ?? v.patient_age ?? 30),
          phone: updates.phone !== undefined ? updates.phone : (v.patient?.phone || v.patient_phone || ""),
          emergency_contact: updates.emergency_contact !== undefined ? updates.emergency_contact : (v.patient?.emergency_contact || v.patient_emergency_contact || ""),
          address: updates.address !== undefined ? updates.address : (v.patient?.address || ""),
          allergies: updates.allergies !== undefined ? updates.allergies : (v.patient?.allergies || "No Known Allergies"),
          blood_group: updates.blood_group || v.patient?.blood_group || "O+",
          guardian_name: updates.guardian_name !== undefined ? updates.guardian_name : (v.patient?.guardian_name || ""),
          created_at: v.patient?.created_at || new Date().toISOString(),
        }
        changed = true
      }
    })

    if (changed) {
      this.save(ER_STORAGE_KEY_VISITS, visits)
    }

    // Also sync BedDatabase if patient is currently in a bed
    try {
      const beds = BedDatabase.load()
      let bedsChanged = false
      beds.forEach((b) => {
        if (b.patient_id === patientId) {
          if (updates.name) b.patient_name = updates.name
          if (updates.last_name !== undefined) b.patient_last_name = updates.last_name
          if (updates.phone) b.patient_phone = updates.phone
          if (updates.age !== undefined) b.patient_age = updates.age
          if (updates.gender) b.patient_gender = updates.gender
          bedsChanged = true
        }
      })
      if (bedsChanged) {
        BedDatabase.save(beds)
      }
    } catch {}

    return updatedPat
  }

  // Triage Categories

  static getCategories(): TriageCategoryConfig[] {
    return this.load<TriageCategoryConfig[]>(
      ER_STORAGE_KEY_CATEGORIES,
      DEFAULT_TRIAGE_CATEGORIES,
    )
  }

  static saveCategory(
    cat: Partial<TriageCategoryConfig>,
  ): TriageCategoryConfig {
    const list = this.getCategories()

    const idx = list.findIndex(
      (c) => c.category_code === cat.category_code || c.id === cat.id,
    )

    if (idx >= 0) {
      list[idx] = { ...list[idx], ...cat }

      this.save(ER_STORAGE_KEY_CATEGORIES, list)

      return list[idx]
    } else {
      const newCat: TriageCategoryConfig = {
        id: list.length + 1,

        category_code: cat.category_code || `B${list.length + 1}`,

        category_label: cat.category_label || "New Category",

        description: cat.description || null,

        color: cat.color || "#16A34A",

        sort_order: cat.sort_order || list.length + 1,
      }

      list.push(newCat)

      this.save(ER_STORAGE_KEY_CATEGORIES, list)

      return newCat
    }
  }

  // Visits

  private static ensureDynamicActiveVisits(visits: ErVisitRecord[]): boolean {
    if (!Array.isArray(visits)) return false
    let changed = false
    const now = Date.now()
    const seedOffsets: Record<number, number> = {
      1: 25 * 60000,
      2: 40 * 60000,
      3: 60 * 60000,
      4: 75 * 60000,
      5: 90 * 60000,
      6: 110 * 60000,
    }

    visits.forEach((v) => {
      if (seedOffsets[v.id] && v.status === "under_treatment") {
        const offset = seedOffsets[v.id]
        const expectedMs = now - offset
        const currentMs = v.arrival_at ? new Date(v.arrival_at).getTime() : 0
        const isStale = Math.abs(now - currentMs) > 2 * 3600 * 1000 || !v.arrival_at
        if (isStale) {
          v.arrival_at = new Date(expectedMs).toISOString()
          if (v.doctor_assigned_at) {
            v.doctor_assigned_at = new Date(expectedMs + 60000).toISOString()
          }
          if (v.doctor_accepted_at) {
            v.doctor_accepted_at = new Date(expectedMs + 120000).toISOString()
          }
          changed = true
        }
      }
    })

    if (changed) {
      try {
        this.save(ER_STORAGE_KEY_VISITS, visits)
      } catch {}
    }
    return changed
  }

  static getVisits(filter?: "all" | "active" | "closed"): ErVisitRecord[] {
    const visits = this.load<ErVisitRecord[]>(
      ER_STORAGE_KEY_VISITS,
      INITIAL_VISITS,
    )

    this.ensureDynamicActiveVisits(visits)

    // Deduplicate active visits so only one active encounter per patient is displayed
    const seenActiveKeys = new Set<string>()
    const deduplicated: ErVisitRecord[] = []
    let hasDupes = false

    for (const v of visits) {
      const isActive =
        v.status !== "closed" &&
        v.status !== "discharged" &&
        v.disposition !== "Discharged" &&
        v.disposition !== "Transferred"
      if (!isActive) {
        deduplicated.push(v)
        continue
      }

      const pId = (v.patient_id || v.patient?.patient_id || "").trim().toUpperCase()
      const pPhone = (v.patient_phone || v.patient?.phone || "").replace(/\D/g, "").slice(-10)
      const pName = `${v.patient_name || v.patient?.name || ""} ${v.patient_last_name || v.patient?.last_name || ""}`.trim().toLowerCase()

      const key = pId || (pPhone.length >= 10 ? `ph_${pPhone}` : (pName ? `nm_${pName}` : `id_${v.id}`))
      if (seenActiveKeys.has(key)) {
        hasDupes = true
        continue
      }
      seenActiveKeys.add(key)
      deduplicated.push(v)
    }

    if (hasDupes) {
      try {
        this.save(ER_STORAGE_KEY_VISITS, deduplicated)
      } catch {}
    }

    const sorted = [...deduplicated].sort((a, b) => {
      const timeB = new Date(b.arrival_at || (b as any).created_at || (b as any).arrivalDate || 0).getTime()
      const timeA = new Date(a.arrival_at || (a as any).created_at || (a as any).arrivalDate || 0).getTime()
      return timeB - timeA || b.id - a.id
    })

    if (filter === "active") return sorted.filter((v) => v.status !== "closed")

    if (filter === "closed") return sorted.filter((v) => v.status === "closed")

    return sorted
  }

  static getVisitsByPatient(
    patientId: string,
    patientName?: string,
    phone?: string,
  ): ErVisitRecord[] {
    if (!patientId && !patientName && !phone) return []

    const visits = this.getVisits("all")

    const targetPid = (patientId || "").trim().toUpperCase()

    const targetName = (patientName || "").trim().toLowerCase()

    const targetPhone = (phone || "").replace(/\D/g, "")

    const matched = visits.filter((v) => {
      const vPid = (v.patient_id || v.patient?.patient_id || "")
        .trim()
        .toUpperCase()

      if (
        targetPid &&
        vPid &&
        (vPid === targetPid ||
          vPid.replace(/[-_]/g, "") === targetPid.replace(/[-_]/g, ""))
      )
        return true

      const vName = (
        v.patient_name ||
        (v.patient?.name
          ? `${v.patient?.name} ${v.patient?.last_name || ""}`
          : "")
      )
        .trim()
        .toLowerCase()

      if (
        targetName &&
        vName &&
        (vName === targetName ||
          (targetName.length >= 4 && vName.includes(targetName)))
      )
        return true

      const vPhone = (v.patient_phone || v.patient?.phone || "").replace(
        /\D/g,
        "",
      )

      if (
        targetPhone &&
        vPhone &&
        targetPhone.length >= 7 &&
        (vPhone === targetPhone ||
          (targetPhone.length === 10 &&
            vPhone.length === 10 &&
            vPhone === targetPhone))
      )
        return true

      return false
    })

    return matched
  }

  static getPatientMedicalProfile(
    patientId: string,
    patientName?: string,
  ): ErPatientMedicalProfile | null {
    const pId = (patientId || "").trim().toUpperCase()

    const name = (patientName || "").trim().toLowerCase()

    // 1. Built-in profiles for hospital and ER patients

    const PROFILES: Record<string, ErPatientMedicalProfile> = {
      "P-100245": {
        chronic_conditions: [
          "Essential Hypertension (Grade II)",
          "Dyslipidemia (Elevated LDL)",
          "GERD / Acid Peptic Disease",
        ],

        past_medical_history:
          "Diagnosed with hypertension 8 years ago, managed with ACEi/ARB. History of recurrent epigastric burning & acid regurgitation.",

        past_surgeries:
          "Appendectomy (2018), Arthroscopic Meniscectomy Right Knee (2022)",

        family_history:
          "Paternal history of Myocardial Infarction at age 58; Mother has hypertension.",

        current_medications: [
          {
            name: "Tab Telmisartan",
            dosage: "40 mg",
            frequency: "OD (Morning)",
            indication: "Essential Hypertension",
          },

          {
            name: "Tab Atorvastatin",
            dosage: "20 mg",
            frequency: "HS (Bedtime)",
            indication: "Dyslipidemia",
          },

          {
            name: "Tab Pantoprazole",
            dosage: "40 mg",
            frequency: "OD (Before breakfast PRN)",
            indication: "Acid Peptic Disease",
          },
        ],
      },

      "P-100342": {
        chronic_conditions: [
          "Allergic Rhinitis / Dust Mite Allergy",
          "Mild Bronchial Hyperreactivity",
        ],

        past_medical_history:
          "Seasonal allergic rhinitis with occasional nocturnal wheezing during winter months.",

        past_surgeries: "None",

        family_history: "No early cardiovascular disease or diabetes.",

        current_medications: [
          {
            name: "Tab Levocetirizine",
            dosage: "5 mg",
            frequency: "OD PRN (Night)",
            indication: "Allergic Rhinitis",
          },
        ],
      },

      "P-100289": {
        chronic_conditions: [
          "COPD Stage II (Moderate, GOLD 2)",
          "Type 2 Diabetes Mellitus (HbA1c 7.6%)",
          "Essential Hypertension",
          "Bilateral Knee Osteoarthritis",
        ],

        past_medical_history:
          "30 pack-year smoking history, quit 4 years ago. Diagnosed with Type 2 Diabetes 12 years ago, on oral hypoglycemic agents.",

        past_surgeries: "Left Eye Cataract Phacoemulsification with IOL (2020)",

        family_history:
          "Type 2 Diabetes in both parents; sibling with hypertension.",

        current_medications: [
          {
            name: "Inhaler Foracort",
            dosage: "200 mcg",
            frequency: "2 puffs BD (Twice daily)",
            indication: "COPD Maintenance",
          },

          {
            name: "Tab Metformin",
            dosage: "500 mg",
            frequency: "1 tab BD with meals",
            indication: "Type 2 Diabetes",
          },

          {
            name: "Tab Glimepiride",
            dosage: "1 mg",
            frequency: "1 tab OD morning",
            indication: "Type 2 Diabetes",
          },

          {
            name: "Tab Amlodipine",
            dosage: "5 mg",
            frequency: "1 tab OD",
            indication: "Hypertension",
          },
        ],
      },

      "P-100512": {
        chronic_conditions: [
          "Migraine with Aura (Episodic)",
          "Primary Hypothyroidism (Controlled)",
        ],

        past_medical_history:
          "History of episodic throbbing hemicranial headaches with visual aura. Hypothyroidism detected on routine screening 2 years ago.",

        past_surgeries: "Lower Segment Cesarean Section (LSCS, 2023)",

        family_history: "Mother has history of chronic migraine.",

        current_medications: [
          {
            name: "Tab Levothyroxine",
            dosage: "50 mcg",
            frequency: "1 tab OD (Empty stomach morning)",
            indication: "Primary Hypothyroidism",
          },

          {
            name: "Tab Naproxen",
            dosage: "250 mg",
            frequency: "1 tab SOS with food",
            indication: "Acute Migraine",
          },
        ],
      },

      "P-100301": {
        chronic_conditions: [
          "Recurrent Urolithiasis / Renal Calculi",
          "Mild Hyperuricemia",
        ],

        past_medical_history:
          "Passed 2 calcium oxalate renal stones previously (2021, 2023).",

        past_surgeries: "Right Inguinal Hernioplasty (2019)",

        family_history: "Renal calculus in elder brother.",

        current_medications: [
          {
            name: "Tab Potassium Citrate",
            dosage: "1080 mg",
            frequency: "1 tab BD after meals",
            indication: "Nephrolithiasis prevention",
          },
        ],
      },

      "P-100711": {
        chronic_conditions: [
          "Childhood Febrile Seizure Predisposition",
          "Mild Reactive Airway Disease",
        ],

        past_medical_history:
          "Two prior simple febrile convulsion episodes triggered by viral upper respiratory infections.",

        past_surgeries: "None",

        family_history: "Paternal cousin had childhood febrile seizures.",

        current_medications: [
          {
            name: "Syrup Paracetamol",
            dosage: "250 mg / 5 mL",
            frequency: "SOS for temp > 100°F",
            indication: "Fever Management",
          },
        ],
      },

      UMR10001: {
        chronic_conditions: [
          "Essential Hypertension",
          "Dyslipidemia",
          "Mild Obstructive Sleep Apnea",
        ],

        past_medical_history:
          "Longstanding hypertension well controlled on dual therapy. Mild dyslipidemia on statin therapy.",

        past_surgeries: "Laparoscopic Cholecystectomy (2021)",

        family_history:
          "Father had coronary artery bypass graft (CABG) at age 62.",

        current_medications: [
          {
            name: "Tab Aspirin",
            dosage: "81 mg",
            frequency: "1 tab OD after breakfast",
            indication: "Cardiovascular prophylaxis",
          },

          {
            name: "Tab Atorvastatin",
            dosage: "40 mg",
            frequency: "1 tab HS (Bedtime)",
            indication: "Dyslipidemia",
          },

          {
            name: "Tab Telmisartan",
            dosage: "40 mg",
            frequency: "1 tab OD morning",
            indication: "Hypertension",
          },
        ],
      },

      UMR10067: {
        chronic_conditions: [
          "Dyslipidemia",
          "Occasional Stress-induced Palpitations",
        ],

        past_medical_history:
          "Treated for borderline high cholesterol and stress fatigue.",

        past_surgeries: "None",

        family_history: "Paternal hypertension.",

        current_medications: [
          {
            name: "Tab Atorvastatin",
            dosage: "10 mg",
            frequency: "1 tab HS",
            indication: "Hyperlipidemia",
          },

          {
            name: "Capsule Omega-3 Marine TG",
            dosage: "1000 mg",
            frequency: "1 cap OD",
            indication: "Cardiovascular health",
          },
        ],
      },

      UMR10002: {
        chronic_conditions: [
          "Postural Orthostatic Tachycardia / Vasovagal Tendency",
          "Mild Iron Deficiency Anemia",
        ],

        past_medical_history:
          "Episodes of lightheadedness upon sudden standing. Hemoglobin 10.8 g/dL on recent workup.",

        past_surgeries: "None",

        family_history: "Non-contributory.",

        current_medications: [
          {
            name: "Tab Ferrous Ascorbate + Folic Acid",
            dosage: "100 mg / 1.5 mg",
            frequency: "1 tab OD after lunch",
            indication: "Iron Deficiency Anemia",
          },
        ],
      },

      UMR10003: {
        chronic_conditions: [
          "Type 2 Diabetes Mellitus",
          "Essential Hypertension",
        ],

        past_medical_history:
          "Diagnosed with Type 2 Diabetes 9 years ago. Managed with oral hypoglycemics.",

        past_surgeries: "Bilateral Knee Arthroscopy (2019)",

        family_history: "Maternal diabetes and hypertension.",

        current_medications: [
          {
            name: "Tab Metformin",
            dosage: "500 mg",
            frequency: "1 tab BD with meals",
            indication: "Type 2 Diabetes",
          },

          {
            name: "Tab Glimepiride",
            dosage: "2 mg",
            frequency: "1 tab OD morning",
            indication: "Type 2 Diabetes",
          },

          {
            name: "Tab Enalapril",
            dosage: "5 mg",
            frequency: "1 tab OD",
            indication: "Hypertension",
          },
        ],
      },
    }

    if (PROFILES[pId]) return PROFILES[pId]

    return null
  }

  static getVisit(id: number | string): ErVisitRecord | null {
    const visits = this.getVisits("all")
    const idNum = Number(id)
    const idStr = String(id || "").trim()

    const v = visits.find((item) => {
      if (!isNaN(idNum) && item.id === idNum) return true
      if (item.visit_no) {
        if (item.visit_no === idStr) return true
        if (item.visit_no.endsWith(idStr)) return true
        if (!isNaN(idNum) && item.visit_no.endsWith(String(idNum).padStart(5, "0"))) return true
      }
      return false
    })

    if (!v) return null

    // Ensure visit_no and arrival_at are set
    if (!v.visit_no) {
      v.visit_no = `ER-${new Date().getFullYear()}-${String(v.id).padStart(5, "0")}`
    }
    if (!v.arrival_at) {
      v.arrival_at = new Date().toISOString()
    }

    // Attach patient details and prior visit count

    if (v.patient_id) {
      const normalizedPid = v.patient_id.trim().toUpperCase()

      const priorCount = visits.filter(
        (other) =>
          other.id !== v.id &&
          (other.patient_id || "").trim().toUpperCase() === normalizedPid,
      ).length

      v.prior_visits_count = priorCount

      if (!v.patient) {
        let p = this.getPatients().find(
          (item) =>
            (item.patient_id || "").trim().toUpperCase() === normalizedPid,
        )

        if (!p) {
          const core = db.getPatientByUmr(v.patient_id)

          if (core) {
            p = {
              patient_id: core.umr,

              name: core.name,

              last_name: "",

              gender: core.sex || "Male",

              age: core.age || 30,

              phone: core.phone || "",

              emergency_contact: core.phone || "",

              address: core.address || "",

              blood_group: "O+",

              created_at: new Date().toISOString(),
            }
          }
        }

        if (p) v.patient = p
      }
    } else {
      v.prior_visits_count = 0
    }

    // Fallback: If v.patient is still missing, synthesize from visit record fields
    if (!v.patient && (v.patient_name || v.patient_id)) {
      v.patient = {
        patient_id: v.patient_id || `P-${v.id}`,
        name: v.patient_name || "Emergency Patient",
        last_name: v.patient_last_name || "",
        gender: v.patient_gender || "Male",
        age: v.patient_age || 35,
        phone: v.patient_phone || "",
        emergency_contact: v.patient_emergency_contact || v.patient_phone || "",
        address: v.patient_address || "",
        blood_group: v.patient_blood_group || "O+",
        created_at: v.arrival_at || new Date().toISOString(),
      }
    }

    // Keep patient_name synchronized
    if (v.patient && !v.patient_name) {
      v.patient_name = [v.patient.name, v.patient.last_name].filter(Boolean).join(" ")
    }

    return v
  }

  static async createVisit(visitData: {
    [key: string]: any
    patientId?: string

    patientDetails?: Partial<ErPatient>

    isUnknown?: boolean

    unknownLabel?: string

    arrivalDate?: string

    arrivalTime?: string

    arrivalMode?: string

    broughtBy?: string

    attendantName?: string

    attendantRelation?: string

    conditionAtArrival?: string

    consciousness?: string

    infoProvidedBy?: string

    policeInvolved?: boolean

    complaintText?: string

    caseCategory?: string

    vitals?: Partial<ErVitalsItem>

    assignedDoctorName?: string

    assignedSpecialty?: string

    triageCategory?: string

    triageBedLabel?: string

    /** Rule-based triage only, no LLM call -- for generated demo visits. */
    skipAiTriage?: boolean
  }): Promise<{ visit: ErVisitRecord ;patient: ErPatient | null }> {
    let patient: ErPatient | null = null

    if (visitData.patientId) {
      patient =
        this.getPatients().find(
          (p) =>
            (p.patient_id || "").trim().toUpperCase() ===
            visitData.patientId!.trim().toUpperCase(),
        ) || null

      if (!patient) {
        // Fall back to hospital core database (db.ts)

        const corePatient = db.getPatientByUmr(visitData.patientId)

        if (corePatient) {
          patient = this.addPatient({
            patient_id: corePatient.umr,

            name: corePatient.name,

            last_name: "",

            gender: corePatient.sex || "Male",

            age: corePatient.age || 30,

            phone: corePatient.phone || "",

            emergency_contact: corePatient.phone || "",

            address: corePatient.address || "",

            blood_group: "O+",
          })
        } else if (visitData.patientDetails) {
          patient = this.addPatient({
            ...visitData.patientDetails,

            patient_id: visitData.patientId,
          })
        }
      } else if (visitData.patientDetails) {
        // Sync any incoming details

        patient = this.addPatient({
          ...patient,

          ...visitData.patientDetails,

          patient_id: patient.patient_id,
        })
      }
    } else if (
      visitData.patientDetails &&
      (visitData.patientDetails.name || visitData.patientDetails.phone)
    ) {
      patient = this.addPatient(visitData.patientDetails)
    }

    const visits = this.getVisits("all")

    // Guard against duplicate active visits for the same patient in ER
    if (patient) {
      const activeVisits = visits.filter((v) => {
        const isActive =
          v.status !== "closed" &&
          v.status !== "discharged" &&
          v.disposition !== "Discharged" &&
          v.disposition !== "Transferred"
        if (!isActive) return false
        const vPid = (v.patient_id || v.patient?.patient_id || "").trim().toUpperCase()
        const pPid = (patient!.patient_id || "").trim().toUpperCase()
        if (vPid && pPid && vPid === pPid) return true
        const vPhone = (v.patient_phone || v.patient?.phone || "").replace(/\D/g, "").slice(-10)
        const pPhone = (patient!.phone || "").replace(/\D/g, "").slice(-10)
        if (vPhone && pPhone && vPhone.length === 10 && vPhone === pPhone) return true
        return false
      })

      if (activeVisits.length > 0) {
        const existingVisit = activeVisits[0]
        if (visitData.triageCategory) {
          existingVisit.triage_category = visitData.triageCategory
          existingVisit.status = "triaged"
        }
        if (visitData.triageBedLabel) {
          existingVisit.triage_bed_label = visitData.triageBedLabel
        }
        if (visitData.assignedDoctorName) {
          existingVisit.doctor_name = visitData.assignedDoctorName
        }
        if (visitData.complaintText && visitData.complaintText.trim()) {
          existingVisit.chief_complaint = visitData.complaintText.trim()
        }
        this.save(ER_STORAGE_KEY_VISITS, visits)
        return { visit: existingVisit, patient }
      }
    }

    const nextId =
      visits.length > 0 ? Math.max(...visits.map((v) => v.id)) + 1 : 101

    const visitNo = `ER-${new Date().getFullYear()}-${String(nextId).padStart(5, "0")}`

    let arrivalTimestamp = new Date().toISOString()

    if (visitData.arrivalDate) {
      try {
        const timePart = (visitData.arrivalTime || "").trim() || "12:00"
        const parsed = new Date(`${visitData.arrivalDate} ${timePart}`)
        if (!isNaN(parsed.getTime())) {
          arrivalTimestamp = parsed.toISOString()
        } else {
          const parsedT = new Date(`${visitData.arrivalDate}T${timePart}`)
          if (!isNaN(parsedT.getTime())) {
            arrivalTimestamp = parsedT.toISOString()
          }
        }
      } catch (e) {
        arrivalTimestamp = new Date().toISOString()
      }
    } else if (visitData.arrivalTime) {
      try {
        const todayStr = new Date().toISOString().split("T")[0]
        const parsed = new Date(`${todayStr} ${visitData.arrivalTime.trim()}`)
        if (!isNaN(parsed.getTime())) {
          arrivalTimestamp = parsed.toISOString()
        }
      } catch {}
    }

    const now = new Date().toISOString()

    const complaintsList: ErComplaintItem[] = []

    if (visitData.complaintText && visitData.complaintText.trim()) {
      complaintsList.push({
        id: 1,

        complaint: visitData.complaintText.trim(),

        severity: "Moderate",

        case_category: visitData.caseCategory || "general_illness",

        duration: "Immediate",

        reported_by: visitData.infoProvidedBy || "Intake Nurse / EMS",

        created_at: now,
      })
    }

    const vitalsList: ErVitalsItem[] = []

    if (visitData.vitals && Object.keys(visitData.vitals).length > 0) {
      vitalsList.push({
        id: 1,

        recorded_at: now,

        recorded_by: "Triage Staff",

        heart_rate: visitData.vitals.heart_rate || null,

        bp_systolic: visitData.vitals.bp_systolic || null,

        bp_diastolic: visitData.vitals.bp_diastolic || null,

        respiratory_rate: visitData.vitals.respiratory_rate || null,

        spo2: visitData.vitals.spo2 || null,

        temperature: visitData.vitals.temperature || null,

        consciousness_level:
          visitData.consciousness ||
          visitData.vitals.consciousness_level ||
          "Alert (A)",

        blood_glucose: visitData.vitals.blood_glucose || null,

        pain_score: visitData.vitals.pain_score || null,

        gcs: visitData.vitals.gcs || 15,

        notes: visitData.vitals.notes || null,
      })
    }

    // Run smart clinical triage logic using Qwen / fallback to rules
    const triageCalc = await this.evaluateClinicalTriage(
      visitData.complaintText || "",
      visitData.vitals || {},
      { ruleBasedOnly: visitData.skipAiTriage || Boolean(visitData.triageCategory) },
    )

    const finalDoctorName =
      visitData.assignedDoctorName || triageCalc.suggestedDoctor || null

    const finalSpecialty =
      visitData.assignedSpecialty ||
      triageCalc.suggestedDepartment ||
      "Emergency"

    const effectivePid = patient?.patient_id || visitData.patientId

    // Strict Multi-Encounter Guard: An emergency patient cannot have multiple concurrent open/active visits!
    const effectivePidClean = (effectivePid || "").trim().toUpperCase()
    const pNameClean = (visitData.patientDetails?.name || patient?.name || "").trim().toLowerCase()
    const pLastClean = (visitData.patientDetails?.last_name || patient?.last_name || "").trim().toLowerCase()
    const pPhoneClean = (visitData.patientDetails?.phone || patient?.phone || "").replace(/\D/g, "")

    const existingActive = visits.find((v) => {
      if (!v || v.status === "closed" || v.status === "discharged") return false
      const vPid = (v.patient_id || v.patient?.patient_id || "").trim().toUpperCase()
      // 1. Match by UHID/patient_id (most reliable)
      if (effectivePidClean && vPid && vPid === effectivePidClean) return true
      const vName = (v.patient_name || v.patient?.name || "").trim().toLowerCase()
      const vLast = (v.patient_last_name || v.patient?.last_name || "").trim().toLowerCase()
      const vPhone = (v.patient_phone || v.patient?.phone || "").replace(/\D/g, "")
      // 2. Match by first name + last name (even if one side is missing last name, still try phone)
      if (pNameClean && vName === pNameClean) {
        // Both have last name and they match → definite duplicate
        if (pLastClean && vLast && pLastClean === vLast) return true
        // Last name matches for the one that has it, other doesn't → check phone too
        if (pLastClean && !vLast && pPhoneClean && vPhone && pPhoneClean === vPhone) return true
        if (!pLastClean && vLast && pPhoneClean && vPhone && pPhoneClean === vPhone) return true
        // Both have phone and match → strong signal even without last name
        if (pPhoneClean && pPhoneClean.length === 10 && vPhone && vPhone === pPhoneClean) return true
        // Both have no phone and no last name → same first name, treat as same patient
        if (!pPhoneClean && !vPhone && !pLastClean && !vLast) return true
      }
      // 3. Same phone + similar name (phone is unique per patient — catch renames)
      if (pPhoneClean && pPhoneClean.length === 10 && vPhone && vPhone === pPhoneClean) {
        // Phone matches — strong uniqueness signal
        return true
      }
      return false
    })

    if (existingActive) {
      console.warn(`[ErDatabase] Patient already has active ER visit ${existingActive.visit_no}. Updating existing encounter instead of creating duplicate.`)
      if (visitData.triageCategory) {
        existingActive.triage_category = visitData.triageCategory
        existingActive.status = "triaged"
      }
      if (visitData.triageBedLabel) {
        existingActive.triage_bed_label = visitData.triageBedLabel
      }
      if (visitData.complaintText && (!existingActive.complaints || existingActive.complaints.length === 0)) {
        existingActive.complaints = complaintsList
      }
      if (patient) existingActive.patient = patient
      this.save(ER_STORAGE_KEY_VISITS, visits)
      return { visit: existingActive, patient: patient || existingActive.patient || null }
    }

    const priorVisits = patient?.patient_id
      ? this.getVisitsByPatient(patient.patient_id, patient.name, patient.phone)
      : []

    const newRecord: ErVisitRecord = {
      id: nextId,

      visit_no: visitNo,

      patient_id:
        patient?.patient_id ||
        (visitData.isUnknown ? null : visitData.patientId || null),

      is_unknown_patient: !!visitData.isUnknown,

      unknown_patient_label: visitData.unknownLabel || null,

      arrival_mode: visitData.arrivalMode || "Relative",

      brought_by: visitData.broughtBy || "Family / Relatives",

      attendant_name: visitData.attendantName || null,

      attendant_relation: visitData.attendantRelation || null,

      condition_at_arrival: visitData.conditionAtArrival || "Critical",

      consciousness: visitData.consciousness || "Conscious",

      info_provided_by: visitData.infoProvidedBy || "Relative",

      arrival_at: arrivalTimestamp,

      status: visitData.triageCategory ? "triaged" : "registered",

      assigned_doctor_name: finalDoctorName,

      assigned_specialty: finalSpecialty,

      doctor_assigned_at: finalDoctorName ? now : null,

      doctor_accepted_at: null,

      triage_category: visitData.triageCategory || triageCalc.categoryCode,

      triage_bed_label: visitData.triageBedLabel || triageCalc.triageBedLabel,

      closed_at: null,

      police_involved: !!visitData.policeInvolved,

      patient_name:
        patient?.name ||
        visitData.patientDetails?.name ||
        (visitData.isUnknown ? "Unidentified Patient" : "Patient"),

      patient_last_name:
        patient?.last_name ?? visitData.patientDetails?.last_name ?? "",

      patient_gender:
        patient?.gender || visitData.patientDetails?.gender || "Unknown",

      patient_age: patient?.age ?? visitData.patientDetails?.age ?? null,

      patient_phone: patient?.phone || visitData.patientDetails?.phone || "",

      patient_emergency_contact:
        patient?.emergency_contact ||
        visitData.patientDetails?.emergency_contact ||
        "",

      patient: patient || undefined,

      prior_visits_count: priorVisits.length,

      complaints: complaintsList,

      vitals: vitalsList,

      triage: {
        category: visitData.triageCategory || triageCalc.categoryCode,

        triage_bed_label: visitData.triageBedLabel || triageCalc.triageBedLabel,

        reason: triageCalc.reasoning,

        triaged_at: now,

        assigned_by: visitData.triageCategory ? "Intake Staff" : "AI Triage Assistant",
      },

      treatments: [],

      clinical_notes: [],

      disposition: null,

      bed_requests: [],

      consents: [],
    }


    visits.unshift(newRecord)

    this.save(ER_STORAGE_KEY_VISITS, visits)

    return { visit: newRecord, patient }
  }

  static updateVisit(
    id: number,
    updates: Partial<ErVisitRecord>,
  ): ErVisitRecord {
    const visits = this.getVisits("all")

    const idx = visits.findIndex((v) => v.id === Number(id))

    if (idx >= 0) {
      visits[idx] = { ...visits[idx], ...updates }

      this.save(ER_STORAGE_KEY_VISITS, visits)

      return visits[idx]
    }

    throw new Error(`Visit ${id} not found`)
  }

  static addComplaint(
    visitId: number,
    complaint: { complaint: string ;case_category?: string },
  ): ErComplaintItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newItem: ErComplaintItem = {
      id: visit.complaints.length + 1,

      complaint: complaint.complaint,

      severity: "Moderate",

      case_category: complaint.case_category || null,

      duration: "Current",

      reported_by: "Clinical Staff",

      created_at: new Date().toISOString(),
    }

    visit.complaints.push(newItem)

    this.updateVisit(visitId, { complaints: visit.complaints })

    return newItem
  }

  static addVitals(
    visitId: number,
    vitals: Partial<ErVitalsItem>,
  ): ErVitalsItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newItem: ErVitalsItem = {
      id: visit.vitals.length + 1,

      recorded_at: new Date().toISOString(),

      recorded_by: "Triage Nurse",

      heart_rate: vitals.heart_rate ?? null,

      bp_systolic: vitals.bp_systolic ?? null,

      bp_diastolic: vitals.bp_diastolic ?? null,

      respiratory_rate: vitals.respiratory_rate ?? null,

      spo2: vitals.spo2 ?? null,

      temperature: vitals.temperature ?? null,

      consciousness_level: vitals.consciousness_level ?? "Alert (A)",

      blood_glucose: vitals.blood_glucose ?? null,

      pain_score: vitals.pain_score ?? null,

      gcs: vitals.gcs ?? 15,

      notes: vitals.notes ?? null,
    }

    visit.vitals.push(newItem)

    this.updateVisit(visitId, { vitals: visit.vitals })

    return newItem
  }

  static setTriage(
    visitId: number,
    triage: { category: string ;reason?: string ;bedLabel?: string },
  ): ErTriageItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newTriage: ErTriageItem = {
      category: triage.category,

      triage_bed_label:
        triage.bedLabel ||
        (triage.category === "B1"
          ? "ER Red Zone"
          : triage.category === "B2"
            ? "ER Yellow Zone"
            : triage.category === "Black"
              ? "ER Comfort / Palliative Bay"
              : "ER Green Zone"),

      reason: triage.reason || "Clinical Assessment",

      triaged_at: new Date().toISOString(),

      assigned_by: "ED Medical Officer",
    }

    this.updateVisit(visitId, {
      triage: newTriage,

      triage_category: triage.category,

      triage_bed_label: newTriage.triage_bed_label,

      status: visit.status === "registered" ? "triaged" : visit.status,
    })

    return newTriage
  }

  static assignDoctor(
    visitId: number,
    data: { doctor_name?: string ;specialty?: string },
  ): void {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    this.updateVisit(visitId, {
      assigned_doctor_name:
        data.doctor_name || visit.assigned_doctor_name || "Dr. Anita Roy",

      assigned_specialty:
        data.specialty || visit.assigned_specialty || "Emergency Medicine",

      doctor_assigned_at: new Date().toISOString(),

      status: "doctor_assigned",
    })
  }

  static acceptDoctor(visitId: number): void {
    this.updateVisit(visitId, {
      doctor_accepted_at: new Date().toISOString(),

      status: "under_treatment",
    })
  }

  static addTreatment(
    visitId: number,
    data: { intervention_type: string ;description?: string },
  ): ErTreatmentItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newItem: ErTreatmentItem = {
      id: visit.treatments.length + 1,

      intervention_type: data.intervention_type,

      description: data.description || null,

      performed_at: new Date().toISOString(),

      administered_by: "ER Attending Staff",
    }

    visit.treatments.push(newItem)

    this.updateVisit(visitId, {
      treatments: visit.treatments,

      status: "under_treatment",
    })

    return newItem
  }

  static addClinicalNote(
    visitId: number,
    data: { note_type?: string ;author?: string ;content: string },
  ): ErClinicalNoteItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newItem: ErClinicalNoteItem = {
      id: visit.clinical_notes.length + 1,

      note_type: data.note_type || "Clinical Note",

      author: data.author || "Attending Physician",

      content: data.content,

      created_at: new Date().toISOString(),
    }

    visit.clinical_notes.push(newItem)

    this.updateVisit(visitId, { clinical_notes: visit.clinical_notes })

    return newItem
  }

  static addInvestigation(
    visitId: number,
    data: { name: string ;priority?: string ;category?: string },
  ): ErInvestigationItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newItem: ErInvestigationItem = {
      id: (visit.investigations || []).length + 1,

      test_name: data.name,

      category: data.category || "Emergency Lab / Imaging",

      priority: data.priority || "STAT",

      ordered_at: new Date().toISOString(),

      ordered_by: visit.assigned_doctor_name || "Emergency Physician",

      status: "Ordered",

      result: "Sample Dispatched / In Progress",
    }

    visit.investigations = [...(visit.investigations || []), newItem]

    this.updateVisit(visitId, { investigations: visit.investigations })

    return newItem
  }

  static createBedRequest(
    visitId: number | string,
    data: { requested_level_of_care?: string ;requested_specialty?: string },
  ): ErBedRequestItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    if (!visit.bed_requests) visit.bed_requests = []

    const newItem: ErBedRequestItem = {
      id: visit.bed_requests.length + 1,

      status: "pending",

      requested_level_of_care:
        data.requested_level_of_care || "Inpatient General Ward",

      requested_specialty:
        data.requested_specialty ||
        visit.assigned_specialty ||
        "General Medicine",

      requested_at: new Date().toISOString(),

      allocated_bed_id: null,

      allocated_admission_id: null,

      allocated_at: null,
    }

    visit.bed_requests.push(newItem)

    this.updateVisit(visit.id, {
      bed_requests: visit.bed_requests,
      status: "bed_requested",
    })

    try {
      ErDatabase.dispatchBedTransferAlert({
        patient_id: visit.patient_id,
        patient_name:
          visit.patient_name ||
          (visit.patient as any)?.name ||
          (visit.is_unknown_patient
            ? visit.unknown_patient_label || "Unknown Patient"
            : "Patient"),
        patient_last_name: visit.patient_last_name || (visit.patient as any)?.last_name || "",
        patient_age: visit.patient_age,
        patient_gender: visit.patient_gender,
        patient_phone: visit.patient_phone,
        source_department: `Emergency Department (${visit.triage?.triage_bed_label || visit.triage_bed_label || "Triage Bay"})`,
        target_destination: newItem.requested_level_of_care,
        target_bed_type: newItem.requested_level_of_care.toLowerCase().includes("icu") ? "ICU" : "General",
        target_ward: newItem.requested_level_of_care.toLowerCase().includes("icu") ? "Intensive Care Unit (ICU)" : "3N Medical/Surgical",
        priority: "High Priority",
        clinical_reason: `Emergency admission bed request (${newItem.requested_level_of_care}).`,
        sent_by: visit.assigned_doctor_name || "Emergency Staff",
        er_visit_id: visit.id,
        er_bed_request_id: newItem.id,
      })
    } catch {}

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hospai_bed_request_updated"))
    }

    return newItem
  }

  static addConsent(visitId: number, data: any): ErConsentItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const newItem: ErConsentItem = {
      id: (visit.consents || []).length + 1,

      patient_name:
        data.patient_name || `${visit.patient_name} ${visit.patient_last_name}`,

      consent_type: data.consent_type || "General Emergency Treatment",

      signed_by: data.signed_by || "Self",

      relation_to_patient: data.relation_to_patient || "Self",

      status: "Signed",

      witness_doctor:
        data.witness_doctor || visit.assigned_doctor_name || "Dr. Anita Roy",

      signed_by_phone: data.signed_by_phone || visit.patient_phone || "",

      legal_waiver_acknowledged: true,

      signed_at: new Date().toISOString(),

      notes: data.notes,
    }

    const updated = [...(visit.consents || []), newItem]

    this.updateVisit(visitId, { consents: updated })

    return newItem
  }

  static recordLama(visitId: number, data: any): void {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    this.updateVisit(visitId, {
      disposition: {
        outcome: data.is_dama ? "dama" : "lama",

        required_specialty: null,

        clinical_reason:
          data.reason ||
          "Patient left against medical advice after signing liability waiver.",

        decided_by:
          data.witness_doctor || visit.assigned_doctor_name || "Dr. Anita Roy",

        decided_at: new Date().toISOString(),

        priority: "High",
      },

      closed_at: new Date().toISOString(),

      status: "closed",
    })
  }

  static dispatchBedTransferAlert(notifData: {
    patient_id?: string | null

    patient_name: string

    patient_last_name?: string

    patient_age?: number | null

    patient_gender?: string | null

    patient_phone?: string | null

    source_department: string

    target_destination: string

    target_bed_type: "ICU" | "General" | "Semi-Private" | "Private"

    target_ward?: string

    priority: "Stat / Emergency" | "High Priority" | "Urgent" | "Routine"

    clinical_reason: string

    sent_by?: string | null

    er_visit_id?: number

    er_bed_request_id?: number
  }) {
    if (typeof window === "undefined" || !window.localStorage) return

    try {
      const key = "hospai_bed_transfer_notifications_v3"

      const existing = JSON.parse(window.localStorage.getItem(key) || "[]")

      const isIcu =
        notifData.target_destination.toLowerCase().includes("icu") ||
        notifData.target_bed_type === "ICU"

      const newNotif = {
        id: `NOTIF-TR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,

        patient_id: notifData.patient_id,

        patient_name: notifData.patient_name,

        patient_last_name: notifData.patient_last_name || "",

        patient_age: notifData.patient_age ?? 45,

        patient_gender: notifData.patient_gender || "Male",

        patient_phone: notifData.patient_phone || null,

        source_department:
          notifData.source_department || "Emergency Department (ER Bay 1)",

        target_destination:
          notifData.target_destination ||
          (isIcu ? "ICU (Intensive Care Unit)" : "3N Medical/Surgical Ward"),

        target_bed_type:
          notifData.target_bed_type || (isIcu ? "ICU" : "General"),

        target_ward:
          notifData.target_ward ||
          (isIcu ? "Intensive Care Unit (ICU)" : "3N Medical/Surgical"),

        priority:
          notifData.priority || (isIcu ? "Stat / Emergency" : "High Priority"),

        clinical_reason: notifData.clinical_reason,

        sent_by: notifData.sent_by || "Attending Emergency Physician",

        sent_at: new Date().toISOString(),

        status: "pending",

        er_visit_id: notifData.er_visit_id,

        er_bed_request_id: notifData.er_bed_request_id,

        is_read: false,
      }

      existing.unshift(newNotif)

      window.localStorage.setItem(key, JSON.stringify(existing))

      window.dispatchEvent(
        new CustomEvent("bed:transfer_notification_updated", {
          detail: {
            count: existing.filter(
              (n: any) => !n.is_read && n.status !== "dismissed",
            ).length,
            notifications: existing,
          },
        }),
      )

      window.dispatchEvent(
        new CustomEvent("bed:new_transfer_alert", {
          detail: newNotif,
        }),
      )
    } catch (err) {
      console.error("Failed to dispatch bed transfer alert", err)
    }
  }

  static recordDisposition(visitId: number | string, data: any): ErDispositionItem {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const outcome = data.outcome || "discharge"

    const isAdmission =
      outcome.includes("admit") ||
      outcome.includes("icu") ||
      outcome.includes("ward") ||
      outcome === "admit_inpatient" ||
      outcome === "admit_icu" ||
      outcome === "transfer_ot" ||
      outcome === "transfer_facility"

    const isIcu =
      outcome.includes("icu") ||
      (data.required_specialty || "").toLowerCase().includes("icu")

    const reqLoc = isIcu ? "ICU" : data.required_specialty || "General Ward"

    const disp: ErDispositionItem = {
      outcome: outcome,

      required_specialty:
        data.required_specialty ||
        (isIcu ? "Intensive Care Unit (ICU)" : "General Medicine"),

      clinical_reason:
        data.clinical_reason ||
        (isIcu
          ? "Critical patient admitted to ICU for intensive telemetry & monitoring."
          : "Patient stabilized and admitted to inpatient care."),

      decided_by:
        data.decided_by || visit.assigned_doctor_name || "Attending Physician",

      decided_at: new Date().toISOString(),

      priority: data.priority || (isIcu ? "Stat / Emergency" : "Routine"),
    }

    let createdBedReqId: number | undefined

    // Auto-create or ensure bed request when disposition is admission or ICU

    if (isAdmission) {
      const existingPendingReq = (visit.bed_requests || []).find(
        (r) => r.status === "pending",
      )

      if (!existingPendingReq) {
        createdBedReqId = (visit.bed_requests || []).length + 1

        const newReq: ErBedRequestItem = {
          id: createdBedReqId,

          status: "pending",

          requested_level_of_care: reqLoc,

          requested_specialty:
            data.required_specialty ||
            (isIcu
              ? "ICU (Intensive Care Unit)"
              : visit.assigned_specialty || "General Medicine"),

          requested_at: new Date().toISOString(),

          allocated_bed_id: null,

          allocated_admission_id: null,

          allocated_at: null,
        }

        visit.bed_requests = [...(visit.bed_requests || []), newReq]
      } else {
        createdBedReqId = existingPendingReq.id
      }

      // Dispatch Transfer Notification to Bed Board

      ErDatabase.dispatchBedTransferAlert({
        patient_id: visit.patient_id,

        patient_name:
          visit.patient_name ||
          (visit.is_unknown_patient
            ? visit.unknown_patient_label || "Unknown Patient"
            : "Patient"),

        patient_last_name: visit.patient_last_name || "",

        patient_age: visit.patient_age,

        patient_gender: visit.patient_gender,

        patient_phone: visit.patient_phone,

        source_department: `Emergency Department (${visit.triage?.triage_bed_label || visit.triage_bed_label || "Triage Bay"})`,

        target_destination: isIcu
          ? "ICU (Intensive Care Unit)"
          : data.required_specialty
            ? `${data.required_specialty} Ward`
            : "3N Medical/Surgical Ward",

        target_bed_type: isIcu ? "ICU" : "General",

        target_ward: isIcu
          ? "Intensive Care Unit (ICU)"
          : "3N Medical/Surgical",

        priority: disp.priority as any,

        clinical_reason: disp.clinical_reason,

        sent_by: disp.decided_by,

        er_visit_id: visit.id,

        er_bed_request_id: createdBedReqId,
      })
    }

    const newStatus = isAdmission
      ? "bed_requested"
      : outcome === "discharge" || outcome === "death"
        ? "closed"
        : "awaiting_disposition"

    this.updateVisit(visit.id, {
      disposition: disp,

      bed_requests: visit.bed_requests,

      status: newStatus,

      closed_at:
        outcome === "discharge" || outcome === "death"
          ? new Date().toISOString()
          : null,
    })

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hospai_bed_request_updated"))
    }

    return disp
  }

  static getBedRequests(statusFilter?: string): any[] {
    const visits = this.getVisits("all")

    const results: any[] = []

    for (const v of visits) {
      if (!v.bed_requests || v.bed_requests.length === 0) continue

      for (const r of v.bed_requests) {
        if (statusFilter && r.status !== statusFilter) continue

        results.push({
          id: r.id,

          er_visit_id: v.id,

          visit_no: v.visit_no,

          patient_id: v.patient_id,

          patient_name:
            v.patient_name ||
            (v.patient as any)?.name ||
            (v.is_unknown_patient ? v.unknown_patient_label : "Patient"),

          patient_last_name: v.patient_last_name || (v.patient as any)?.last_name || "",

          is_unknown_patient: v.is_unknown_patient,

          unknown_patient_label: v.unknown_patient_label,

          requested_level_of_care: r.requested_level_of_care,

          requested_specialty: r.requested_specialty,

          requested_at: r.requested_at,

          status: r.status,
        })
      }
    }

    return results
  }

  static allocateBedRequest(
    bedRequestId: number,
    bedId: number,
    notes?: string,
  ): void {
    const visits = this.getVisits("all")

    for (const v of visits) {
      const req = (v.bed_requests || []).find((r) => r.id === bedRequestId)

      if (req) {
        req.status = "allocated"

        req.allocated_bed_id = bedId

        req.allocated_at = new Date().toISOString()

        this.updateVisit(v.id, {
          bed_requests: v.bed_requests,

          status: "closed",

          closed_at: new Date().toISOString(),
        })

        break
      }
    }
  }

  static cancelBedRequest(bedRequestId: number, reason?: string): void {
    const visits = this.getVisits("all")

    for (const v of visits) {
      const req = (v.bed_requests || []).find((r) => r.id === bedRequestId)

      if (req) {
        req.status = "cancelled"

        this.updateVisit(v.id, {
          bed_requests: v.bed_requests,
        })

        break
      }
    }
  }

  static getTimelineEvents(visitId: number): ErTimelineEventItem[] {
    const visit = this.getVisit(visitId)

    if (!visit) return []

    return (visit.timeline_events || [])
      .slice()
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
  }

  static addTimelineEvent(
    visitId: number | string,
    eventData: Partial<ErTimelineEventItem>,
  ): ErTimelineEventItem {
    const visit = this.getVisit(visitId)
    if (!visit) throw new Error("Visit not found")

    const visits = this.getVisits("all")
    const idx = visits.findIndex((v) => v.id === visit.id)
    if (idx < 0) throw new Error("Visit not found")

    const v = visits[idx]

    if (!v.timeline_events) v.timeline_events = []

    const newId =
      v.timeline_events.length > 0
        ? Math.max(...v.timeline_events.map((e) => e.id)) + 1
        : 1

    const now = new Date().toISOString()

    const fullEvent: ErTimelineEventItem = {
      id: newId,

      event_type: eventData.event_type || "initial_vitals",

      event_name: eventData.event_name || "Clinical Event",

      timestamp: eventData.timestamp || now,

      logged_by: eventData.logged_by || "Staff Nurse Jessica Carter, RN",

      visit_id: v.id,

      visit_no: v.visit_no,

      patient_id: v.patient_id,

      location: eventData.location || v.triage_bed_label || "ER Bay",

      bed: eventData.bed || v.triage_bed_label || null,

      notes: eventData.notes || null,

      vitals_data: eventData.vitals_data,

      medication_data: eventData.medication_data,

      intervention_data: eventData.intervention_data,

      stabilization_data: eventData.stabilization_data,

      doctor_data: eventData.doctor_data,

      assessment_data: eventData.assessment_data,

      destination_data: eventData.destination_data,

      destination_bed_data: eventData.destination_bed_data,

      transfer_data: eventData.transfer_data,
    }

    // Add to chronological timeline

    v.timeline_events.push(fullEvent)

    // Sync corresponding subsystems:

    if (
      fullEvent.event_type === "initial_vitals" ||
      fullEvent.event_type === "followup_vitals"
    ) {
      if (fullEvent.vitals_data) {
        if (!v.vitals) v.vitals = []

        v.vitals.push({
          id: v.vitals.length + 1,

          recorded_at: fullEvent.timestamp,

          recorded_by: fullEvent.logged_by,

          heart_rate: fullEvent.vitals_data.heart_rate ?? null,

          bp_systolic: fullEvent.vitals_data.bp_systolic ?? null,

          bp_diastolic: fullEvent.vitals_data.bp_diastolic ?? null,

          respiratory_rate: fullEvent.vitals_data.respiratory_rate ?? null,

          spo2: fullEvent.vitals_data.spo2 ?? null,

          temperature: fullEvent.vitals_data.temperature ?? null,

          blood_glucose: fullEvent.vitals_data.blood_glucose ?? null,

          pain_score: fullEvent.vitals_data.pain_score ?? null,

          gcs: fullEvent.vitals_data.gcs ?? null,

          consciousness_level:
            fullEvent.vitals_data.gcs && fullEvent.vitals_data.gcs < 15
              ? "Altered"
              : "Alert (A)",

          notes: fullEvent.vitals_data.notes || null,
        })
      }
    } else if (
      fullEvent.event_type === "medication_given" &&
      fullEvent.medication_data
    ) {
      if (!v.treatments) v.treatments = []

      v.treatments.push({
        id: v.treatments.length + 1,

        intervention_type: fullEvent.medication_data.drug_name,

        description: `Dose: ${fullEvent.medication_data.dosage || "STAT"} • Route: ${fullEvent.medication_data.route || "IV"} • Response: ${fullEvent.medication_data.response || "Tolerated"}`,

        performed_at: fullEvent.timestamp,

        administered_by: fullEvent.logged_by,
      })
    } else if (
      fullEvent.event_type === "intervention_given" &&
      fullEvent.intervention_data
    ) {
      if (!v.treatments) v.treatments = []

      v.treatments.push({
        id: v.treatments.length + 1,

        intervention_type: fullEvent.intervention_data.intervention_type,

        description: `${fullEvent.intervention_data.details || ""} ${
          fullEvent.intervention_data.patient_response
            ? `• Response: ${fullEvent.intervention_data.patient_response}`
            : ""
        }`,

        performed_at: fullEvent.timestamp,

        administered_by: fullEvent.logged_by,
      })
    } else if (
      fullEvent.event_type === "doctor_assigned" &&
      fullEvent.doctor_data
    ) {
      v.assigned_doctor_name = fullEvent.doctor_data.doctor_name

      v.assigned_specialty = fullEvent.doctor_data.specialty

      v.doctor_assigned_at = fullEvent.timestamp
    } else if (
      fullEvent.event_type === "doctor_arrived" &&
      fullEvent.assessment_data
    ) {
      v.doctor_accepted_at = fullEvent.timestamp
    } else if (
      fullEvent.event_type === "destination_assigned" &&
      fullEvent.destination_data
    ) {
      const outcomeMap: Record<string, string> = {
        ICU: "admit_icu",

        Ward: "admit_inpatient",

        HDU: "admit_icu",

        "Specialty Ward": "admit_inpatient",

        Observation: "admit_inpatient",

        "Operating Theatre": "transfer_ot",

        Discharge: "discharge",
      }

      v.disposition = {
        outcome:
          outcomeMap[fullEvent.destination_data.destination] ||
          "admit_inpatient",

        required_specialty: fullEvent.destination_data.destination,

        clinical_reason:
          fullEvent.destination_data.clinical_reason ||
          "Emergency evaluation completed",

        decided_by:
          fullEvent.destination_data.doctor_name ||
          v.assigned_doctor_name ||
          "Attending Physician",

        decided_at: fullEvent.timestamp,

        priority: "High Priority",
      }
    } else if (
      fullEvent.event_type === "destination_bed_assigned" &&
      fullEvent.destination_bed_data
    ) {
      v.triage_bed_label = `${fullEvent.destination_bed_data.department} (${fullEvent.destination_bed_data.bed_id_or_label})`
    } else if (
      fullEvent.event_type === "patient_transferred" &&
      fullEvent.transfer_data
    ) {
      v.status = "closed"

      v.closed_at = fullEvent.timestamp

      v.triage_bed_label = `${fullEvent.transfer_data.target_destination} (${fullEvent.transfer_data.target_bed})`

      // Dispatch Transfer Notification to Bed Board

      const isIcu = (fullEvent.transfer_data.target_destination || "")
        .toLowerCase()
        .includes("icu")

      ErDatabase.dispatchBedTransferAlert({
        patient_id: v.patient_id,

        patient_name:
          v.patient_name ||
          (v.is_unknown_patient
            ? v.unknown_patient_label || "Unknown Patient"
            : "Patient"),

        patient_last_name: v.patient_last_name || "",

        patient_age: v.patient_age,

        patient_gender: v.patient_gender,

        patient_phone: v.patient_phone,

        source_department: `Emergency Department (${fullEvent.transfer_data.source_location || "ER Bay"})`,

        target_destination:
          fullEvent.transfer_data.target_destination ||
          (isIcu ? "ICU (Intensive Care Unit)" : "Inpatient Ward"),

        target_bed_type: isIcu ? "ICU" : "General",

        priority: isIcu ? "Stat / Emergency" : "High Priority",

        clinical_reason:
          fullEvent.transfer_data.handover_notes ||
          `Transferred to ${fullEvent.transfer_data.target_destination} (${fullEvent.transfer_data.target_bed}). Escort: ${fullEvent.transfer_data.escorting_staff || "Staff RN"}`,

        sent_by: fullEvent.logged_by || "Staff Nurse",

        er_visit_id: v.id,
      })
    }

    this.save(ER_STORAGE_KEY_VISITS, visits)

    return fullEvent
  }

  static clearTimeline(visitId: number): void {
    const visits = this.getVisits("all")

    const idx = visits.findIndex((v) => v.id === Number(visitId))

    if (idx < 0) throw new Error("Visit not found")

    visits[idx].timeline_events = []

    this.save(ER_STORAGE_KEY_VISITS, visits)
  }

  static deleteTimelineEvent(visitId: number, eventId: number): void {
    const visits = this.getVisits("all")

    const idx = visits.findIndex((v) => v.id === Number(visitId))

    if (idx < 0) throw new Error("Visit not found")

    if (visits[idx].timeline_events) {
      visits[idx].timeline_events = visits[idx].timeline_events!.filter(
        (e) => e.id !== eventId,
      )

      this.save(ER_STORAGE_KEY_VISITS, visits)
    }
  }

  static closeVisit(visitId: number, consultationFee?: number): {
    invoice_id: number
    total: number
  } {
    const visit = this.getVisit(visitId)

    if (!visit) throw new Error("Visit not found")

    const baseFee = consultationFee || 100

    const treatFee = (visit.treatments || []).length * 40

    const total = baseFee + treatFee

    this.updateVisit(visitId, {
      status: "closed",

      closed_at: new Date().toISOString(),
    })

    return { invoice_id: 1000 + visitId, total }
  }

  // Clinical Rule-Based Smart AI Triage Engine with Qwen Integration

  static async evaluateClinicalTriage(
    complaints: string,

    vitals: Partial<ErVitalsItem>,

    options: { ruleBasedOnly?: boolean } = {},
  ): Promise<{
    categoryCode: string

    urgency: string

    reasoning: string

    suggestedDepartment: string

    suggestedDoctor: string

    triageBedLabel: string

    suggestedTreatments: { intervention_type: string ;description: string }[]
  }> {
    const c = (complaints || "").toLowerCase()

    // Fallback rule-based logic function

    const runRuleBasedFallback = () => {
      const hr = vitals.heart_rate || 0

      const sys = vitals.bp_systolic || 0

      const dia = vitals.bp_diastolic || 0

      const spo2 = vitals.spo2 || 100

      const rr = vitals.respiratory_rate || 16

      const temp = vitals.temperature || 98.6

      const gcs = vitals.gcs || 15

      const grbs = vitals.blood_glucose || 100

      const pain = vitals.pain_score || 0

      const cons = (vitals.consciousness_level || "").toLowerCase()

      // Critical Priority (B1 - Red)

      if (
        (spo2 > 0 && spo2 < 85) ||
        (sys > 0 && sys < 80) ||
        hr > 140 ||
        (hr > 0 && hr < 40) ||
        (gcs > 0 && gcs < 9) ||
        cons.includes("unresponsive") ||
        cons.includes("comatose") ||
        c.includes("cardiac arrest") ||
        c.includes("unconscious") ||
        c.includes("stemi") ||
        c.includes("crushing chest pain") ||
        c.includes("severe hemorrhage") ||
        c.includes("active bleeding") ||
        c.includes("anaphylaxis")
      ) {
        return {
          categoryCode: "B1",

          urgency: "Immediate / Resuscitation",

          reasoning:
            "Critical presentation detected (Severe hemodynamic instability / hypoxia / acute coronary syndrome / altered consciousness). Immediate resuscitation protocol activated.",

          suggestedDepartment: c.includes("trauma")
            ? "Trauma Surgery"
            : c.includes("chest") || c.includes("heart")
              ? "Cardiology"
              : "Emergency Medicine",

          suggestedDoctor: "Duty Cardiologist / Emergency Specialist",

          triageBedLabel: "ER Bed 01 (Red Zone - Resuscitation)",

          suggestedTreatments: [
            {
              intervention_type: "Immediate IV Resuscitation & High Flow O2",
              description:
                "Wide bore IV lines, O2 at 6-8 L/min, continuous ECG and SpO2 monitoring",
            },

            {
              intervention_type: "Emergency Cardiac / Airway Protocol",
              description: "Stat ECG, cardiac loading doses / airway standby",
            },
          ],
        }
      }

      // High Emergent Priority (B2 - Orange)

      if (
        spo2 < 92 ||
        sys > 190 ||
        dia > 115 ||
        hr > 115 ||
        rr > 26 ||
        pain >= 8 ||
        grbs > 350 ||
        grbs < 55 ||
        c.includes("chest pain") ||
        c.includes("stroke") ||
        c.includes("weakness") ||
        c.includes("rta") ||
        c.includes("accident") ||
        c.includes("seizure") ||
        c.includes("poisoning") ||
        c.includes("burn") ||
        c.includes("fracture") ||
        c.includes("dyspnea")
      ) {
        return {
          categoryCode: "B2",

          urgency: "High / Emergent",

          reasoning:
            "High emergent acuity (Significant vital abnormality, severe pain, or acute neurological/trauma presentation). Rapid physician assessment within 10 minutes required.",

          suggestedDepartment:
            c.includes("rta") || c.includes("trauma") || c.includes("fracture")
              ? "Orthopedics / Trauma"
              : c.includes("stroke")
                ? "Neurology"
                : c.includes("chest")
                  ? "Cardiology"
                  : "Emergency Medicine",

          suggestedDoctor: "Dr. Anita Roy (Emergency & Critical Care)",

          triageBedLabel: "ER Bed 03 (Yellow Zone - High Care)",

          suggestedTreatments: [
            {
              intervention_type: "Vital Stabilization & IV Access",
              description:
                "IV Line secured, 0.9% Normal Saline slow infusion, continuous multi-para monitoring",
            },

            {
              intervention_type: "Targeted Analgesia / Nebulization",
              description: "Immediate symptomatic relief per protocol",
            },
          ],
        }
      }

      // Moderate Urgent (B3 - Yellow)

      if (
        temp > 102 ||
        pain >= 5 ||
        hr > 100 ||
        sys > 150 ||
        c.includes("fever") ||
        c.includes("vomiting") ||
        c.includes("abdominal pain") ||
        c.includes("infection") ||
        c.includes("laceration") ||
        c.includes("asthma")
      ) {
        return {
          categoryCode: "B3",

          urgency: "Moderate / Urgent",

          reasoning:
            "Moderate acuity condition requiring structured evaluation and symptomatic emergency stabilization within 30 minutes.",

          suggestedDepartment:
            c.includes("abdominal") || c.includes("vomiting")
              ? "General Surgery / Gastroenterology"
              : "General Medicine",

          suggestedDoctor: "Duty General Physician",

          triageBedLabel: "ER Bed 06 (Yellow Zone - Observation)",

          suggestedTreatments: [
            {
              intervention_type: "Antipyretic / IV Antiemetic",
              description:
                "IV Paracetamol 1g / Ondansetron 4mg for acute symptom control",
            },
          ],
        }
      }

      return {
        categoryCode: "B4",

        urgency: "Low / Less Urgent",

        reasoning:
          "Hemodynamically stable presentation. Routine emergency care and outpatient/day-care management indicated.",

        suggestedDepartment: "General Medicine",

        suggestedDoctor: "Duty General Physician",

        triageBedLabel: "ER Bed 08 (Green Zone - Ambulatory)",

        suggestedTreatments: [
          {
            intervention_type: "Clinical Evaluation & Basic Vitals Review",
            description: "Standard clinical evaluation and vitals monitoring",
          },
        ],
      }
    }

    if (options.ruleBasedOnly) return runRuleBasedFallback()

    // Attempt to use Qwen LLM

    try {
      // Same-origin vLLM proxy (see src/lib/llm.ts); the old default was a
      // local Ollama port that only exists on the developer's machine.
      const apiUrl = LLM_CHAT_URL

      const apiKey = LLM_API_KEY

      const prompt = `You are an AI Triage Assistant in an Emergency Room.
Based on the patient's symptoms and vitals, evaluate the clinical triage.
Symptoms: ${complaints}
Vitals: ${JSON.stringify(vitals)}

Available Departments: Emergency Medicine, Cardiology, Pulmonology, General Medicine, General Surgery, Orthopedics / Trauma, Neurology, Pediatrics, Obstetrics & Gynecology
Available Doctors: Dr. Vikram Seth (Cardiology), Dr. Anita Roy (Emergency Medicine), Dr. Rajesh Sharma (General Medicine), Dr. Sanjay Gupta (Orthopedics / Trauma), Dr. Meenakshi Rao (Neurology), Dr. Priya Deshmukh (General Surgery)

Respond ONLY with a valid JSON object matching this schema:
{
  "categoryCode": "B1" | "B2" | "B3" | "B4" | "B5",
  "urgency": "Immediate / Resuscitation" | "High / Emergent" | "Moderate / Urgent" | "Low / Less Urgent" | "Non-Urgent",
  "reasoning": "string explaining reasoning",
  "suggestedDepartment": "string from available departments",
  "suggestedDoctor": "string from available doctors or empty if none",
  "triageBedLabel": "string describing bed assignment (e.g. ER Bed 01 (Red Zone))",
  "suggestedTreatments": [
    { "intervention_type": "string", "description": "string" }
  ]
}`

      const response = await fetch(apiUrl, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${apiKey}`,
        },

        body: JSON.stringify({
          model: await llmModel(),

          messages: [{ role: "user", content: prompt }],

          temperature: 0.1,

          response_format: { type: "json_object" },
        }),
      })

      if (!response.ok) {
        throw new Error("LLM API returned an error")
      }

      const data = await response.json()

      const content = data.choices[0].message.content

      const parsed = JSON.parse(content)

      // Basic validation

      if (!parsed.categoryCode || !parsed.suggestedDepartment) {
        throw new Error("Invalid schema returned by LLM")
      }

      // Fallback logic for hallucinations

      const validDepts = [
        "Emergency Medicine",
        "Cardiology",
        "Pulmonology",
        "General Medicine",
        "General Surgery",
        "Orthopedics / Trauma",
        "Neurology",
        "Pediatrics",
        "Obstetrics & Gynecology",
      ]

      if (!validDepts.includes(parsed.suggestedDepartment)) {
        parsed.suggestedDepartment = "General Medicine"
      }

      if (
        !parsed.suggestedDoctor ||
        !parsed.suggestedDoctor.includes(parsed.suggestedDepartment)
      ) {
        // Deterministic fallback to a doctor in the department

        const docMap: Record<string, string> = {
          Cardiology: "Duty Cardiologist",
          "Emergency Medicine": "Duty Emergency Physician",
          "General Medicine": "Duty General Physician",
          "Orthopedics / Trauma": "Duty Orthopedic Surgeon",
          Neurology: "Duty Neurologist",
          "General Surgery": "Duty General Surgeon",
        }

        parsed.suggestedDoctor =
          docMap[parsed.suggestedDepartment] ||
          "Duty Attending Physician"
      }

      return parsed
    } catch (err) {
      console.warn(
        "AI Triage via Qwen failed, falling back to rule-based engine:",
        err,
      )

      return runRuleBasedFallback()
    }
  }
}
