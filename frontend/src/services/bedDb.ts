/**
 * Enterprise Hospital Management System - Inpatient Bed Management Database
 * Real-time persistent state management for Wards, ICU Beds, Bed Allocations,
 * Transfers, and Discharge Clearance.
 */

import { ErDatabase } from "./erDb"

export type BedStatus = "Available" | "Occupied" | "Maintenance"

export interface BedRecord {
  id: number

  ward: string

  room_no: string

  bed_no: string

  bed_type: "General" | "Semi-Private" | "Private" | "ICU"

  status: BedStatus

  daily_rate: number

  allocation_id: number | null

  admission_id: number | null

  allocated_at: string | null

  admission_date: string | null

  expected_discharge_date: string | null

  patient_id: string | null

  patient_name: string | null

  patient_last_name: string | null

  patient_phone: string | null

  patient_age: number | null

  patient_gender: string | null

  admission_notes: string | null

  room_charges_so_far: number | null
}

export interface DischargedPatientRecord {
  id: string // "DISC-1001"

  patientId: string

  patientName: string

  mrn: string

  ward: string

  roomNo: string

  bedNo: string

  admissionDate: string

  dischargeDate: string

  lengthOfStayDays: number

  dischargeReason: string

  roomChargesTotal: number

  attendingDoctor: string
}

export interface BedSummary {
  total: number

  available: number

  occupied: number

  maintenance: number
}

export interface BedTransferNotification {
  id: string // e.g. "NOTIF-TR-101"

  patient_id: string

  patient_name: string

  patient_last_name?: string

  patient_age?: number | null

  patient_gender?: string | null

  patient_phone?: string | null

  source_department: string // e.g. "Emergency Department (ER Bay 2)"

  target_destination: string // e.g. "ICU (Intensive Care Unit)" or "3N Medical/Surgical Ward"

  target_bed_type: "ICU" | "General" | "Semi-Private" | "Private"

  target_ward?: string

  priority: "Stat / Emergency" | "High Priority" | "Urgent" | "Routine"

  clinical_reason: string

  sent_by: string // e.g. "Dr. Vikram Seth"

  sent_at: string // ISO string

  status: "pending" | "in_transit" | "allocated" | "completed" | "dismissed"

  er_visit_id?: number

  er_bed_request_id?: number

  assigned_bed_id?: number | null

  assigned_bed_label?: string | null

  is_read: boolean
}

export interface PendingBedAllocation {
  patient_id: string
  name: string
  last_name?: string
  phone?: string
  age?: number | null
  gender?: string | null
  source?: "ER" | "Transfer" | "OT" | "OP"
  visit_no?: string
  er_bed_request_id?: number
  er_visit_id?: number
  notification_id?: string
  requested_level_of_care?: string
  requested_specialty?: string
  clinical_notes?: string
  priority?: string
  timestamp: string
}

const STORAGE_KEY = "hospai_inpatient_beds_v9"

const DISCHARGED_STORAGE_KEY = "hospai_discharged_patients_v3"

const NOTIFICATIONS_STORAGE_KEY = "hospai_bed_transfer_notifications_v3"

const PENDING_ALLOCATION_KEY = "hospai_pending_bed_allocation_v2"

const INITIAL_TRANSFER_NOTIFICATIONS: BedTransferNotification[] = []

const INITIAL_BEDS: BedRecord[] = []

const INITIAL_DISCHARGED: DischargedPatientRecord[] = []

export class BedDatabase {
  static load(): BedRecord[] {
    if (typeof window === "undefined" || !window.localStorage)
      return []

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)

      if (!stored) {
        return []
      }

      const parsed: BedRecord[] = JSON.parse(stored)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  public static save(beds: BedRecord[]): void {
    if (typeof window === "undefined" || !window.localStorage) return

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(beds))
      window.dispatchEvent(new CustomEvent("hospai_beds_updated", { detail: beds }))
    } catch (e) {
      console.error("Failed to save beds to localStorage", e)
    }
  }

  static async syncWithBackend(): Promise<BedRecord[]> {
    if (typeof window === "undefined") return []
    try {
      const res = await fetch("/api/beds", {
        headers: { "Content-Type": "application/json" },
      })
      if (res.ok) {
        const data = await res.json()
        if (data && Array.isArray(data.beds)) {
          this.save(data.beds)
          return data.beds
        }
      }
    } catch {}
    return this.load()
  }

  static getDischargedPatients(): DischargedPatientRecord[] {
    if (typeof window === "undefined" || !window.localStorage)
      return INITIAL_DISCHARGED

    try {
      const stored = window.localStorage.getItem(DISCHARGED_STORAGE_KEY)

      if (!stored) {
        this.saveDischarged(INITIAL_DISCHARGED)

        return INITIAL_DISCHARGED
      }

      const parsed: DischargedPatientRecord[] = JSON.parse(stored)
      const currentIds = new Set(parsed.map((p) => p.id))
      const missing = INITIAL_DISCHARGED.filter((p) => !currentIds.has(p.id))
      const merged = missing.length > 0 ? [...parsed, ...missing] : parsed
      if (missing.length > 0) {
        this.saveDischarged(merged)
      }
      return merged.sort((a, b) => {
        const timeB = new Date(b.dischargeDate || 0).getTime()
        const timeA = new Date(a.dischargeDate || 0).getTime()
        return timeB - timeA || (b.id || "").localeCompare(a.id || "")
      })
    } catch {
      return INITIAL_DISCHARGED
    }
  }

  static saveDischarged(list: DischargedPatientRecord[]): void {
    if (typeof window === "undefined" || !window.localStorage) return

    try {
      window.localStorage.setItem(DISCHARGED_STORAGE_KEY, JSON.stringify(list))
    } catch (e) {
      console.error("Failed to save discharged patients to localStorage", e)
    }
  }

  static getBeds(): BedRecord[] {
    return this.load()
  }

  static getBed(id: number): BedRecord | undefined {
    return this.load().find((b) => b.id === id)
  }

  static getSummary(): BedSummary {
    const beds = this.load()

    return {
      total: beds.length,

      available: beds.filter((b) => b.status === "Available").length,

      occupied: beds.filter((b) => b.status === "Occupied").length,

      maintenance: beds.filter((b) => b.status === "Maintenance").length,
    }
  }

  /**
   * Allocate Bed from an ER Request (ICU or Inpatient Ward)
   */

  static allocateBedFromEr(
    bedId: number,
    erBedRequestId: number,
    notes?: string,
  ): BedRecord {
    const beds = this.load()
    const bedIndex = beds.findIndex((b) => b.id === bedId)
    if (bedIndex === -1) throw new Error("Bed not found")

    const erRequests = ErDatabase.getBedRequests()
    const req = erRequests.find((r) => r.id === erBedRequestId)
    
    // Also check transfer notifications and pending allocation
    const notifs = this.getTransferNotifications()
    const matchNotif = notifs.find(
      (n) => n.er_bed_request_id === erBedRequestId || n.id === String(erBedRequestId),
    )
    const pending = this.getPendingAllocation()

    const now = new Date().toISOString()
    const targetBed = beds[bedIndex]

    targetBed.status = "Occupied"
    targetBed.allocation_id = 1000 + bedId
    targetBed.admission_id = 5000 + bedId
    targetBed.allocated_at = now
    targetBed.admission_date = now
    targetBed.expected_discharge_date = new Date(
      Date.now() + 7 * 86400000,
    ).toISOString()

    const patientId = req?.patient_id || matchNotif?.patient_id || pending?.patient_id || `P-ER-${erBedRequestId}`
    const patientName = req?.patient_name || matchNotif?.patient_name || pending?.name || "Emergency Patient"
    const patientLastName = req?.patient_last_name || matchNotif?.patient_last_name || pending?.last_name || ""
    const patientAge = matchNotif?.patient_age ?? pending?.age ?? (req as any)?.patient_age ?? null
    const patientGender = matchNotif?.patient_gender || pending?.gender || (req as any)?.patient_gender || null
    const patientPhone = matchNotif?.patient_phone || pending?.phone || (req as any)?.patient_phone || null

    // Prevent duplicate bed assignments: release any previously occupied bed for this patient
    beds.forEach((b) => {
      if (b.id !== bedId && b.status === "Occupied" && b.patient_id === patientId) {
        b.status = "Available"
        b.patient_id = null
        b.patient_name = null
        b.patient_last_name = null
        b.patient_age = null
        b.patient_gender = null
        b.patient_phone = null
        b.allocated_at = null
        b.admission_date = null
        b.expected_discharge_date = null
      }
    })

    targetBed.patient_id = patientId
    targetBed.patient_name = patientName
    targetBed.patient_last_name = patientLastName
    targetBed.patient_age = patientAge
    targetBed.patient_gender = patientGender
    targetBed.patient_phone = patientPhone

    targetBed.admission_notes =
      notes ||
      matchNotif?.clinical_reason ||
      pending?.clinical_notes ||
      `Admitted from ER (${req?.visit_no || erBedRequestId}) for ${req?.requested_level_of_care || targetBed.bed_type}`

    targetBed.room_charges_so_far = targetBed.daily_rate
    beds[bedIndex] = targetBed
    this.save(beds)

    // Synchronize transfer notification
    if (matchNotif) {
      this.updateNotificationStatus(
        matchNotif.id,
        "allocated",
        bedId,
        `${targetBed.ward} (Room ${targetBed.room_no} / Bed ${targetBed.bed_no})`,
      )
    } else {
      const byPat = notifs.find((n) => n.patient_id === patientId && n.status !== "allocated")
      if (byPat) {
        this.updateNotificationStatus(
          byPat.id,
          "allocated",
          bedId,
          `${targetBed.ward} (Room ${targetBed.room_no} / Bed ${targetBed.bed_no})`,
        )
      }
    }

    this.clearPendingAllocation()
    return targetBed
  }

  /**
   * Direct Bed Assignment
   */

  static assignBed(
    bedId: number,
    patient: {
      patient_id: string
      name: string
      last_name?: string
      phone?: string
      age?: number | null
      gender?: string | null
    },
    notes?: string,
    expectedDays?: number,
  ): BedRecord {
    const beds = this.load()
    const bedIndex = beds.findIndex((b) => b.id === bedId)
    if (bedIndex === -1) throw new Error("Bed not found")

    const now = new Date().toISOString()
    const target = beds[bedIndex]
    const days = expectedDays || 5

    target.status = "Occupied"
    target.allocation_id = 2000 + bedId
    target.admission_id = 6000 + bedId
    target.allocated_at = now
    target.admission_date = now
    target.expected_discharge_date = new Date(
      Date.now() + days * 86400000,
    ).toISOString()

    // Prevent duplicate bed assignments: release any previously occupied bed for this patient
    if (patient.patient_id) {
      beds.forEach((b) => {
        if (b.id !== bedId && b.status === "Occupied" && b.patient_id === patient.patient_id) {
          b.status = "Available"
          b.patient_id = null
          b.patient_name = null
          b.patient_last_name = null
          b.patient_age = null
          b.patient_gender = null
          b.patient_phone = null
          b.allocated_at = null
          b.admission_date = null
          b.expected_discharge_date = null
        }
      })
    }

    target.patient_id = patient.patient_id
    target.patient_name = patient.name
    target.patient_last_name = patient.last_name || ""
    target.patient_phone = patient.phone || null
    target.patient_age = patient.age ?? null
    target.patient_gender = patient.gender || null
    target.admission_notes = notes || "Direct Inpatient Admission"
    target.room_charges_so_far = target.daily_rate

    beds[bedIndex] = target
    this.save(beds)

    // Synchronize any matching pending transfer notification
    try {
      const notifs = this.getTransferNotifications()
      const matchNotif = notifs.find(
        (n) => n.patient_id === patient.patient_id && n.status !== "allocated",
      )
      if (matchNotif) {
        this.updateNotificationStatus(
          matchNotif.id,
          "allocated",
          bedId,
          `${target.ward} (Room ${target.room_no} / Bed ${target.bed_no})`,
        )
      }
    } catch {
      // best-effort
    }

    this.clearPendingAllocation()
    return target
  }

  /**
   * Bed Transfer (e.g. Ward to ICU or Ward to Ward)
   */

  static transferBed(
    fromBedId: number,
    toBedId: number,
    reason?: string,
  ): BedRecord {
    const beds = this.load()

    const fromIndex = beds.findIndex((b) => b.id === fromBedId)

    const toIndex = beds.findIndex((b) => b.id === toBedId)

    if (fromIndex === -1 || toIndex === -1)
      throw new Error("Target or source bed not found")

    const fromBed = beds[fromIndex]

    const toBed = beds[toIndex]

    if (toBed.status !== "Available")
      throw new Error("Target bed is not available")

    // Copy patient data to new bed

    toBed.status = "Occupied"

    toBed.allocation_id = fromBed.allocation_id

    toBed.admission_id = fromBed.admission_id

    toBed.allocated_at = new Date().toISOString()

    toBed.admission_date = fromBed.admission_date

    toBed.expected_discharge_date = fromBed.expected_discharge_date

    toBed.patient_id = fromBed.patient_id

    toBed.patient_name = fromBed.patient_name

    toBed.patient_last_name = fromBed.patient_last_name

    toBed.patient_phone = fromBed.patient_phone

    toBed.patient_age = fromBed.patient_age

    toBed.patient_gender = fromBed.patient_gender

    toBed.admission_notes = `${fromBed.admission_notes || ""} | Transferred: ${reason || "Clinical unit change"}`

    toBed.room_charges_so_far =
      (fromBed.room_charges_so_far || 0) + toBed.daily_rate

    // Free original bed

    fromBed.status = "Available"

    fromBed.allocation_id = null

    fromBed.admission_id = null

    fromBed.allocated_at = null

    fromBed.admission_date = null

    fromBed.expected_discharge_date = null

    fromBed.patient_id = null

    fromBed.patient_name = null

    fromBed.patient_last_name = null

    fromBed.patient_phone = null

    fromBed.patient_age = null

    fromBed.patient_gender = null

    fromBed.admission_notes = null

    fromBed.room_charges_so_far = null

    beds[fromIndex] = fromBed

    beds[toIndex] = toBed

    this.save(beds)

    return toBed
  }

  /**
   * Release Bed (Discharge) with Discharged Directory Archival
   */

  static releaseBed(
    bedId: number,
    reason?: string,
    roomChargesTotal?: number,
  ): BedRecord {
    const beds = this.load()

    const bedIndex = beds.findIndex((b) => b.id === bedId)

    if (bedIndex === -1) throw new Error("Bed not found")

    const bed = beds[bedIndex]

    if (bed.patient_id && bed.patient_name) {
      const admDate = bed.admission_date
        ? new Date(bed.admission_date)
        : new Date()

      const discDate = new Date()

      const diffDays = Math.max(
        1,
        Math.round((discDate.getTime() - admDate.getTime()) / 86400000),
      )

      const dischargedRec: DischargedPatientRecord = {
        id: `DISC-${Math.floor(1000 + Math.random() * 9000)}`,

        patientId: bed.patient_id,

        patientName:
          `${bed.patient_name} ${bed.patient_last_name || ""}`.trim(),

        mrn: bed.patient_id.replace(/\D/g, "") || String(100000 + bedId),

        ward: bed.ward,

        roomNo: bed.room_no,

        bedNo: bed.bed_no,

        admissionDate: bed.admission_date || new Date().toISOString(),

        dischargeDate: new Date().toISOString(),

        lengthOfStayDays: diffDays,

        dischargeReason:
          reason ||
          "Clinically stable. Cleared for discharge by Attending Physician.",

        roomChargesTotal:
          roomChargesTotal ||
          bed.room_charges_so_far ||
          bed.daily_rate * diffDays,

        attendingDoctor: "Dr. M. Anderson",
      }

      const dischargedList = this.getDischargedPatients()

      dischargedList.unshift(dischargedRec)

      this.saveDischarged(dischargedList)
    }

    bed.status = "Available"

    bed.allocation_id = null

    bed.admission_id = null

    bed.allocated_at = null

    bed.admission_date = null

    bed.expected_discharge_date = null

    bed.patient_id = null

    bed.patient_name = null

    bed.patient_last_name = null

    bed.patient_phone = null

    bed.patient_age = null

    bed.patient_gender = null

    bed.admission_notes = null

    bed.room_charges_so_far = null

    beds[bedIndex] = bed

    this.save(beds)

    return bed
  }

  /**
   * Update Bed Details / Maintenance
   */

  static updateBed(bedId: number, data: Partial<BedRecord>): BedRecord {
    const beds = this.load()

    const bedIndex = beds.findIndex((b) => b.id === bedId)

    if (bedIndex === -1) throw new Error("Bed not found")

    beds[bedIndex] = { ...beds[bedIndex], ...data }

    this.save(beds)

    return beds[bedIndex]
  }

  /**
   * Bulk Create Beds
   */

  static createBedsBulk(data: {
    ward: string

    room_no: string

    from_bed: string

    to_bed: string

    bed_type: "General" | "Semi-Private" | "Private" | "ICU"

    daily_rate: number
  }): BedRecord[] {
    const beds = this.load()

    const created: BedRecord[] = []

    const fromNum = parseInt(String(data.from_bed || "").replace(/\D/g, ""), 10) || 1

    const toNum = parseInt(String(data.to_bed || "").replace(/\D/g, ""), 10) || fromNum

    const maxId = beds.length > 0 ? Math.max(...beds.map((b) => b.id)) : 0

    for (let i = fromNum; i <= toNum; i++) {
      const bedNoStr = String(i)
      const alreadyExists = beds.some(
        (b) =>
          b.ward === data.ward &&
          b.room_no === data.room_no &&
          (String(b.bed_no) === bedNoStr || String(b.bed_no) === `B${i}`)
      )
      if (alreadyExists) continue

      const newBed: BedRecord = {
        id: maxId + created.length + 1,

        ward: data.ward,

        room_no: data.room_no,

        bed_no: bedNoStr,

        bed_type: data.bed_type,

        status: "Available",

        daily_rate: data.daily_rate,

        allocation_id: null,

        admission_id: null,

        allocated_at: null,

        admission_date: null,

        expected_discharge_date: null,

        patient_id: null,

        patient_name: null,

        patient_last_name: null,

        patient_phone: null,

        patient_age: null,

        patient_gender: null,

        admission_notes: null,

        room_charges_so_far: null,
      }

      created.push(newBed)
    }

    const updated = [...beds, ...created]

    this.save(updated)

    return created
  }

  // ── Transfer Notifications System ──────────────────────────────────

  static getTransferNotifications(): BedTransferNotification[] {
    if (typeof window === "undefined") return INITIAL_TRANSFER_NOTIFICATIONS

    try {
      const stored = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)

      if (!stored) {
        this.saveTransferNotifications(INITIAL_TRANSFER_NOTIFICATIONS)

        return INITIAL_TRANSFER_NOTIFICATIONS
      }

      return JSON.parse(stored)
    } catch {
      return INITIAL_TRANSFER_NOTIFICATIONS
    }
  }

  static saveTransferNotifications(list: BedTransferNotification[]): void {
    if (typeof window === "undefined") return

    try {
      window.localStorage.setItem(
        NOTIFICATIONS_STORAGE_KEY,
        JSON.stringify(list),
      )

      window.dispatchEvent(
        new CustomEvent("bed:transfer_notification_updated", {
          detail: {
            count: list.filter((n) => !n.is_read && n.status !== "dismissed")
              .length,
            notifications: list,
          },
        }),
      )
    } catch (e) {
      console.error("Failed to save transfer notifications", e)
    }
  }

  static addTransferNotification(
    data: Partial<BedTransferNotification> & {
      patient_name: string

      target_destination: string

      clinical_reason: string
    },
  ): BedTransferNotification {
    const list = this.getTransferNotifications()

    const isIcu =
      data.target_destination.toLowerCase().includes("icu") ||
      (data.target_bed_type || "").toLowerCase().includes("icu")

    const newNotif: BedTransferNotification = {
      id: `NOTIF-TR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,

      patient_id:
        data.patient_id || `P-${Math.floor(100000 + Math.random() * 900000)}`,

      patient_name: (data as any).patient_name || "Patient",

      source_department:
        data.source_department || "Emergency Department (ER Bay 1)",

      target_destination:
        data.target_destination ||
        (isIcu ? "ICU (Intensive Care Unit)" : "3N Medical/Surgical Ward"),

      target_bed_type:
        data.target_bed_type as any || (isIcu ? "ICU" : "General"),

      target_ward:
        data.target_ward ||
        (isIcu ? "Intensive Care Unit (ICU)" : "3N Medical/Surgical"),

      priority: data.priority || (isIcu ? "Stat / Emergency" : "High Priority"),

      clinical_reason:
        data.clinical_reason ||
        "Transferred for continuous monitoring and inpatient care.",

      sent_by: data.sent_by || "Attending Emergency Physician",

      sent_at: new Date().toISOString(),

      status: data.status || "pending",

      er_visit_id: data.er_visit_id,

      er_bed_request_id: data.er_bed_request_id,

      assigned_bed_id: data.assigned_bed_id || null,

      assigned_bed_label: data.assigned_bed_label || null,

      is_read: false,
    }

    // Prepend to list

    list.unshift(newNotif)

    this.saveTransferNotifications(list)

    // Broadcast toast event

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("bed:new_transfer_alert", {
          detail: newNotif,
        }),
      )
    }

    return newNotif
  }

  static markNotificationRead(id: string): void {
    const list = this.getTransferNotifications()

    const idx = list.findIndex((n) => n.id === id)

    if (idx !== -1) {
      list[idx].is_read = true

      this.saveTransferNotifications(list)
    }
  }

  static markAllNotificationsRead(): void {
    const list = this.getTransferNotifications()

    list.forEach((n) => {
      n.is_read = true
    })

    this.saveTransferNotifications(list)
  }

  static updateNotificationStatus(
    id: string,

    status: BedTransferNotification["status"],

    bedId?: number,

    bedLabel?: string,
  ): void {
    const list = this.getTransferNotifications()

    const idx = list.findIndex((n) => n.id === id)

    if (idx !== -1) {
      list[idx].status = status

      if (bedId !== undefined) list[idx].assigned_bed_id = bedId

      if (bedLabel !== undefined) list[idx].assigned_bed_label = bedLabel

      this.saveTransferNotifications(list)
    }
  }

  static dismissNotification(id: string): void {
    const list = this.getTransferNotifications()

    const filtered = list.filter((n) => n.id !== id)

    this.saveTransferNotifications(filtered)
  }

  static clearAllNotifications(): void {
    this.saveTransferNotifications([])
  }

  // ── Pending Bed Allocation (Inter-department handover) ───────────────

  static getPendingAllocation(): PendingBedAllocation | null {
    if (typeof window === "undefined") return null
    try {
      const raw = window.sessionStorage.getItem(PENDING_ALLOCATION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  static setPendingAllocation(alloc: PendingBedAllocation | null): void {
    if (typeof window === "undefined") return
    try {
      if (alloc) {
        window.sessionStorage.setItem(
          PENDING_ALLOCATION_KEY,
          JSON.stringify(alloc),
        )
        window.dispatchEvent(
          new CustomEvent("bed:initiate_allocation", { detail: alloc }),
        )
      } else {
        window.sessionStorage.removeItem(PENDING_ALLOCATION_KEY)
        window.dispatchEvent(new CustomEvent("bed:clear_allocation"))
      }
    } catch (e) {
      console.error("Failed to set pending allocation", e)
    }
  }

  static clearPendingAllocation(): void {
    this.setPendingAllocation(null)
  }
}
