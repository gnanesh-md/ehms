/**
 * Enterprise Hospital Management System - Inpatient Nursing Workflow Database
 *
 * STRICT ARCHITECTURE:
 * 1. Begins ONLY AFTER patient is admitted and assigned an active Inpatient/ICU Bed in BedDatabase.
 * 2. Consumes existing Patient, MRN, Admission, Ward, Room, Bed, and Attending Doctor.
 * 3. Individual Nurse Authentication & Shift Identity.
 * 4. Nurse-Patient Shift Assignment with historical tracking.
 * 5. Patient-bound Doctor Instructions with Lifecycle: Pending -> Acknowledged -> In Progress -> Completed.
 * 6. Nursing Care Notes with immutable authorship.
 * 7. Patient-bound Doctor <-> Nurse Clinical Communication.
 * 8. Shift Handover & Unified Patient Clinical Timeline.
 */

import { BedDatabase, BedRecord } from "./bedDb"
import { db } from "./db"

export interface NurseStaff {
  id: string // e.g. "N001"
  name: string // "Jessica Carter, RN"
  username: string // "jcarter@generalhospital.org"
  role: "Nurse" | "Charge Nurse" | "Supervisor"
  title: string
  department: string
  unit: string
  defaultShift: "morning" | "evening" | "night"
}

export interface DoctorStaff {
  id: string // e.g. "DOC-101"
  name: string // "Dr. Arjun Rao"
  username: string
  department: string
  specialty: string
}

export interface NurseAssignmentRecord {
  id: string // e.g. "ASN-1001"
  patientId: string
  patientName: string
  mrn: string
  admissionId: string // e.g. "IP-2026-00125"
  ward: string
  roomNo: string
  bedNo: string
  bedId: number
  department: string
  attendingDoctor: string
  attendingDoctorId: string
  diagnosis: string
  nurseId: string
  nurseName: string
  shift: "morning" | "evening" | "night"
  shiftLabel: string // "Morning · 07:00–15:00"
  status: "active" | "completed" | "transferred"
  assignedAt: string
  assignedBy: string
  acuity: 1 | 2 | 3
  allergies?: string
  codeStatus?: string
}

export interface DoctorInstructionRecord {
  id: string // e.g. "INS-2001"
  patientId: string
  patientName: string
  admissionId: string
  bedNo: string
  ward: string
  doctorId: string
  doctorName: string
  doctorDept: string
  instructionText: string
  priority: "routine" | "urgent" | "stat"
  status: "pending" | "acknowledged" | "in_progress" | "completed"
  createdAt: string
  acknowledgedAt?: string
  acknowledgedByNurseId?: string
  acknowledgedByNurseName?: string
  completedAt?: string
  completedByNurseId?: string
  completedByNurseName?: string
  completionNote?: string
}

export interface NursingVitals {
  bp: string // e.g. "128/82"
  hr: number // e.g. 78
  spo2: number // e.g. 97
  temp: string // e.g. "98.4°F"
  rr: number // e.g. 18
  pain?: string // e.g. "2/10"
  recordedAt: string
}

export interface NursingNoteRecord {
  id: string // e.g. "NOT-3001"
  patientId: string
  patientName: string
  mrn: string
  admissionId: string
  ward: string
  bedNo: string
  assessment: string
  observation: string
  intervention: string
  patientResponse: string
  followUp: string
  remarks?: string
  vitals?: NursingVitals
  authorNurseId: string
  authorNurseName: string
  shiftLabel: string
  createdAt: string
}

export interface ClinicalMessageRecord {
  id: string // e.g. "MSG-4001"
  patientId: string
  patientName: string
  admissionId: string
  bedNo: string
  senderId: string
  senderName: string
  senderRole: "nurse" | "doctor"
  recipientId: string
  recipientName: string
  recipientRole: "nurse" | "doctor"
  messageText: string
  createdAt: string
  read: boolean
}

export interface ShiftHandoverRecord {
  id: string // e.g. "HND-5001"
  patientId: string
  patientName: string
  mrn: string
  bedNo: string
  ward: string
  outgoingNurseId: string
  outgoingNurseName: string
  outgoingShift: string
  incomingNurseId: string
  incomingNurseName: string
  incomingShift: string
  condition: "Stable" | "Guarded" | "Critical" | "Improving"
  latestBp: string
  pendingInstructionsCount: number
  medicationDue: string
  pendingTasks: string
  importantObservations: string
  handoverNote: string
  completedAt: string
}

export interface NursingTimelineEvent {
  id: string
  patientId: string
  timestamp: string
  timeDisplay: string
  authorName: string
  authorRole: string
  eventType: "shift_start" | "assessment" | "vitals" | "instruction" | "instruction_ack" | "instruction_done" | "note" | "message" | "handover"
  title: string
  description: string
  badge?: string
}

export const PREDEFINED_NURSES: NurseStaff[] = []

export const PREDEFINED_DOCTORS: DoctorStaff[] = []

// Storage keys
const KEY_AUTH_USER = "hms_nursing_active_user"
const KEY_ASSIGNMENTS = "hms_nursing_assignments"
const KEY_INSTRUCTIONS = "hms_nursing_doctor_instructions"
const KEY_NOTES = "hms_nursing_notes"
const KEY_MESSAGES = "hms_nursing_messages"
const KEY_HANDOVERS = "hms_nursing_handovers"

export class NursingWorkflowDb {
  // ── 1. ACTIVE AUTHENTICATED USER ──
  static getAuthenticatedUser(): {
    type: "nurse" | "doctor" | "admin"
    profile: any
  } {
    try {
      const saved = localStorage.getItem(KEY_AUTH_USER)
      if (saved) {
        return JSON.parse(saved)
      }
    } catch {}
    return { type: "admin", profile: { id: "ADM-001", name: "System Administrator", role: "admin", department: "Hospital Administration" } }
  }

  static setAuthenticatedUser(type: "nurse" | "doctor" | "admin", id: string) {
    let profile: any = null
    if (type === "nurse") {
      profile =
        PREDEFINED_NURSES.find((n) => n.id === id) || null
    } else if (type === "doctor") {
      profile =
        PREDEFINED_DOCTORS.find((d) => d.id === id) || null
    } else {
      profile = {
        id: "ADM-001",
        name: "System Administrator",
        role: "admin",
        department: "Hospital Administration",
      }
    }
    localStorage.setItem(KEY_AUTH_USER, JSON.stringify({ type, profile }))
  }

  // ── 2. NURSE-PATIENT ASSIGNMENTS (Auto-synced from occupied Inpatient Beds) ──
  static getAssignments(): NurseAssignmentRecord[] {
    let list: NurseAssignmentRecord[] = []
    try {
      const saved = localStorage.getItem(KEY_ASSIGNMENTS)
      if (saved) {
        list = JSON.parse(saved)
      }
    } catch {}

    // Synchronize with active BedDatabase occupied beds!
    const beds = BedDatabase.load()
    const occupiedBeds = beds.filter(
      (b) => b.status === "Occupied" && b.patient_id,
    )

    let updated = false

    occupiedBeds.forEach((bed, index) => {
      const existing = list.find(
        (a) => a.bedId === bed.id && a.status === "active",
      )
      if (!existing) {
        // Auto-assign to default nurse matching ward
        let targetNurse = PREDEFINED_NURSES[0] // Jessica
        let defaultShift: "morning" | "evening" | "night" = "morning"
        let shiftLabel = "Morning · 07:00–15:00"

        if (bed.ward.includes("ICU")) {
          targetNurse = PREDEFINED_NURSES[3] // Priya (ICU)
          defaultShift = "night"
          shiftLabel = "Night · 23:00–07:00"
        } else if (bed.ward.includes("4S")) {
          targetNurse = PREDEFINED_NURSES[4] // David (Surgical)
        } else if (bed.ward.includes("3N")) {
          targetNurse = PREDEFINED_NURSES[2] // Sarah (3N Med/Surg)
        } else {
          // Cardiology CCU: Alternate between Jessica and Michael
          targetNurse =
            index % 2 === 0 ? PREDEFINED_NURSES[0] : PREDEFINED_NURSES[1]
          if (targetNurse.id === "N002") {
            defaultShift = "evening"
            shiftLabel = "Evening · 15:00–23:00"
          }
        }

        const patientName =
          `${bed.patient_name || "John"} ${bed.patient_last_name || "Smith"}`.trim()
        const mrn =
          bed.patient_id?.replace(/\D/g, "") || String(100245 + bed.id)

        const newRec: NurseAssignmentRecord = {
          id: `ASN-${2000 + bed.id}`,
          patientId: bed.patient_id!,
          patientName,
          mrn,
          admissionId: `IP-2026-00${120 + bed.id}`,
          ward: bed.ward,
          roomNo: bed.room_no,
          bedNo: bed.bed_no,
          bedId: bed.id,
          department: bed.ward.includes("ICU")
            ? "Critical Care"
            : bed.ward.includes("Card")
              ? "Cardiology"
              : "Internal Medicine",
          attendingDoctor: bed.ward.includes("Card")
            ? "Dr. Arjun Rao"
            : "Dr. Vikram Seth",
          attendingDoctorId: bed.ward.includes("Card") ? "DOC-101" : "DOC-4401",
          diagnosis: bed.admission_notes || "Acute Inpatient Admission",
          nurseId: targetNurse.id,
          nurseName: targetNurse.name,
          shift: defaultShift,
          shiftLabel,
          status: "active",
          assignedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
          assignedBy: "Elena Rostova, RN (Supervisor)",
          acuity: bed.bed_type === "ICU" ? 1 : 2,
          allergies: "Penicillin (Moderate rash)",
          codeStatus: "Full Code",
        }
        list.unshift(newRec)
        updated = true
      }
    })

    if (updated || list.length === 0) {
      localStorage.setItem(KEY_ASSIGNMENTS, JSON.stringify(list))
    }
    return list
  }

  static saveAssignments(list: NurseAssignmentRecord[]) {
    localStorage.setItem(KEY_ASSIGNMENTS, JSON.stringify(list))
  }

  /**
   * Reassign patient to a new nurse or shift (e.g. on shift change)
   */
  static reassignPatient(
    patientId: string,
    newNurseId: string,
    newShift: "morning" | "evening" | "night",
    assignedBy: string,
  ): NurseAssignmentRecord {
    const list = this.getAssignments()
    const newNurse = PREDEFINED_NURSES.find((n) => n.id === newNurseId)
    if (!newNurse) throw new Error("Nurse not found")

    const shiftLabelMap: Record<string, string> = {
      morning: "Morning · 07:00–15:00",
      evening: "Evening · 15:00–23:00",
      night: "Night · 23:00–07:00",
    }

    // Mark previous active assignment as completed
    list.forEach((a) => {
      if (a.patientId === patientId && a.status === "active") {
        a.status = "completed"
      }
    })

    const activeBed = BedDatabase.load().find(
      (b) => b.patient_id === patientId && b.status === "Occupied",
    )
    const prev = list.find((a) => a.patientId === patientId)

    const newAssignment: NurseAssignmentRecord = {
      id: `ASN-${Math.floor(1000 + Math.random() * 9000)}`,
      patientId,
      patientName: prev?.patientName || activeBed?.patient_name || "Inpatient",
      mrn: prev?.mrn || "100245",
      admissionId: prev?.admissionId || "IP-2026-00125",
      ward: prev?.ward || activeBed?.ward || "Cardiac Care Unit",
      roomNo: prev?.roomNo || activeBed?.room_no || "204",
      bedNo: prev?.bedNo || activeBed?.bed_no || "204-A",
      bedId: prev?.bedId || activeBed?.id || 1,
      department: prev?.department || "Cardiology",
      attendingDoctor: prev?.attendingDoctor || "Dr. Arjun Rao",
      attendingDoctorId: prev?.attendingDoctorId || "DOC-101",
      diagnosis: prev?.diagnosis || "Inpatient Care",
      nurseId: newNurse.id,
      nurseName: newNurse.name,
      shift: newShift,
      shiftLabel: shiftLabelMap[newShift],
      status: "active",
      assignedAt: new Date().toISOString(),
      assignedBy,
      acuity: prev?.acuity || 2,
      allergies: prev?.allergies || "Penicillin",
      codeStatus: prev?.codeStatus || "Full Code",
    }

    list.unshift(newAssignment)
    this.saveAssignments(list)
    return newAssignment
  }

  // ── 3. DOCTOR INSTRUCTIONS ──
  static getDoctorInstructions(patientId?: string): DoctorInstructionRecord[] {
    let list: DoctorInstructionRecord[] = []
    try {
      const saved = localStorage.getItem(KEY_INSTRUCTIONS)
      if (saved) list = JSON.parse(saved)
    } catch {}

    if (patientId) {
      return list.filter((i) => i.patientId === patientId)
    }
    return list
  }

  static saveDoctorInstructions(list: DoctorInstructionRecord[]) {
    localStorage.setItem(KEY_INSTRUCTIONS, JSON.stringify(list))
  }

  static createDoctorInstruction(params: {
    patientId: string
    patientName: string
    admissionId: string
    bedNo: string
    ward: string
    doctorId: string
    doctorName: string
    doctorDept: string
    instructionText: string
    priority: "routine" | "urgent" | "stat"
  }): DoctorInstructionRecord {
    const list = this.getDoctorInstructions()
    const newInstruction: DoctorInstructionRecord = {
      id: `INS-${Math.floor(2000 + Math.random() * 8000)}`,
      ...params,
      status: "pending",
      createdAt: new Date().toISOString(),
    }
    list.unshift(newInstruction)
    this.saveDoctorInstructions(list)
    return newInstruction
  }

  static updateInstructionStatus(
    instructionId: string,
    status: "acknowledged" | "in_progress" | "completed",
    nurse: NurseStaff,
    completionNote?: string,
  ): DoctorInstructionRecord {
    const list = this.getDoctorInstructions()
    const index = list.findIndex((i) => i.id === instructionId)
    if (index === -1) throw new Error("Instruction not found")

    const item = list[index]
    item.status = status
    const now = new Date().toISOString()

    if (status === "acknowledged" && !item.acknowledgedAt) {
      item.acknowledgedAt = now
      item.acknowledgedByNurseId = nurse.id
      item.acknowledgedByNurseName = nurse.name
    } else if (status === "completed") {
      item.completedAt = now
      item.completedByNurseId = nurse.id
      item.completedByNurseName = nurse.name
      if (completionNote) item.completionNote = completionNote
    }

    list[index] = item
    this.saveDoctorInstructions(list)
    return item
  }

  // ── 4. NURSING CARE NOTES ──
  static getNotes(patientId?: string): NursingNoteRecord[] {
    let list: NursingNoteRecord[] = []
    try {
      const saved = localStorage.getItem(KEY_NOTES)
      if (saved) list = JSON.parse(saved)
    } catch {}

    if (patientId) {
      return list.filter((n) => n.patientId === patientId)
    }
    return list
  }

  static addNote(noteOrPatientId: any, data?: any): any {
    const list = this.getNotes()
    if (typeof noteOrPatientId === "string") {
      const patientId = noteOrPatientId
      const user = this.getAuthenticatedUser()
      const newNote = {
        id: `NOT-${Math.floor(3000 + Math.random() * 7000)}`,
        patientId,
        patientName: data?.patientName || "John Smith",
        mrn: data?.mrn || "100245",
        admissionId: data?.admissionId || "IP-2026-00125",
        ward: data?.ward || "Cardiac Care Unit",
        bedNo: data?.bedNo || "204-A",
        assessment: data?.clinicalObservations || data?.assessment || "",
        observation: data?.observations || data?.observation || "",
        intervention: data?.interventions || data?.intervention || "",
        patientResponse:
          data?.patientResponse || "Patient resting comfortably.",
        followUp:
          data?.followUpPlan || data?.followUp || "Continue monitoring.",
        remarks: data?.remarks || "",
        vitals: data?.vitals,
        noteType: data?.noteType || "Shift Assessment",
        patientCondition: data?.patientCondition || "Stable",
        isAddendum: data?.isAddendum || false,
        authorNurseId: user?.profile?.id || "N001",
        authorNurseName: user?.profile?.name || "Jessica Carter, RN",
        nurseName: user?.profile?.name || "Jessica Carter, RN",
        shift: user?.profile?.defaultShift || "morning",
        shiftLabel: user?.profile?.defaultShift || "Morning · 07:00–15:00",
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
      list.unshift(newNote as any)
      localStorage.setItem(KEY_NOTES, JSON.stringify(list))

      if (data?.vitals && patientId) {
        {
          void db.recordVitals(
            patientId,
            {
              bp: data.vitals.bloodPressure || data.vitals.bp || "--",
              pulse: data.vitals.heartRate ? String(data.vitals.heartRate) : (data.vitals.pulse || "--"),
              temp: data.vitals.temp ? String(data.vitals.temp) : data.vitals.temperature ? String(data.vitals.temperature) : "--",
              spo2: data.vitals.oxygenSaturation ? String(data.vitals.oxygenSaturation) : data.vitals.spo2 ? String(data.vitals.spo2) : "--",
              weight: data.vitals.weight ? String(data.vitals.weight) : "--",
              notes: `${data.remarks || data.assessment || ""}${data.vitals.respiratoryRate || data.vitals.rr ? ` [RR: ${data.vitals.respiratoryRate || data.vitals.rr}]` : ""}`,
            },
            user?.profile?.name || "Jessica Carter, RN"
          ).catch((error) => {
            console.error("Nursing note vitals were not saved to the server:", error)
            window.dispatchEvent(
              new CustomEvent("app:sync-error", {
                detail: { scope: "vitals", message: error instanceof Error ? error.message : String(error) },
              }),
            )
          })
        }
      }

      return newNote
    } else {
      const newNote: NursingNoteRecord = {
        ...noteOrPatientId,
        id: `NOT-${Math.floor(3000 + Math.random() * 7000)}`,
        createdAt: new Date().toISOString(),
      }
      list.unshift(newNote)
      localStorage.setItem(KEY_NOTES, JSON.stringify(list))
      return newNote
    }
  }

  // ── 5. CLINICAL MESSAGES (Patient-Specific Doctor <-> Nurse) ──
  static getMessages(patientId?: string): ClinicalMessageRecord[] {
    let list: ClinicalMessageRecord[] = []
    try {
      const saved = localStorage.getItem(KEY_MESSAGES)
      if (saved) list = JSON.parse(saved)
    } catch {}

    if (patientId) {
      return list.filter((m) => m.patientId === patientId)
    }
    return list
  }

  static sendMessage(
    msgOrPatientId: any,
    text?: string,
    category?: string,
    isUrgent?: boolean,
  ): ClinicalMessageRecord {
    const list = this.getMessages()
    if (typeof msgOrPatientId === "string") {
      const patientId = msgOrPatientId
      const user = this.getAuthenticatedUser()
      const newMsg: ClinicalMessageRecord = {
        id: `MSG-${Math.floor(4000 + Math.random() * 6000)}`,
        patientId,
        patientName: "John Smith",
        admissionId: "IP-2026-00125",
        bedNo: "204-A",
        senderId: user?.profile?.id || "N001",
        senderName: user?.profile?.name || "Staff",
        senderRole: user?.type === "doctor" ? "doctor" : "nurse",
        recipientId: "DOC-101",
        recipientName: "Dr. Arjun Rao",
        recipientRole: "doctor",
        messageText: text || "",
        createdAt: new Date().toISOString(),
        read: false,
      }
      list.push(newMsg)
      localStorage.setItem(KEY_MESSAGES, JSON.stringify(list))
      return newMsg
    } else {
      const newMsg: ClinicalMessageRecord = {
        ...msgOrPatientId,
        id: `MSG-${Math.floor(4000 + Math.random() * 6000)}`,
        createdAt: new Date().toISOString(),
        read: false,
      }
      list.push(newMsg)
      localStorage.setItem(KEY_MESSAGES, JSON.stringify(list))
      return newMsg
    }
  }

  // ── 6. SHIFT HANDOVERS ──
  static getHandovers(patientId?: string): ShiftHandoverRecord[] {
    let list: ShiftHandoverRecord[] = []
    try {
      const saved = localStorage.getItem(KEY_HANDOVERS)
      if (saved) list = JSON.parse(saved)
    } catch {}

    if (patientId) {
      return list.filter((h) => h.patientId === patientId)
    }
    return list
  }

  static createHandover(
    record: Omit<ShiftHandoverRecord, "id" | "completedAt">,
  ): ShiftHandoverRecord {
    let list: ShiftHandoverRecord[] = []
    try {
      const saved = localStorage.getItem(KEY_HANDOVERS)
      if (saved) list = JSON.parse(saved)
    } catch {}

    const newHandover: ShiftHandoverRecord = {
      ...record,
      id: `HND-${Math.floor(5000 + Math.random() * 5000)}`,
      completedAt: new Date().toISOString(),
    }
    list.unshift(newHandover)
    localStorage.setItem(KEY_HANDOVERS, JSON.stringify(list))

    // Also auto-reassign patient to incoming nurse!
    const incomingNurse = PREDEFINED_NURSES.find(
      (n) => n.id === record.incomingNurseId,
    )
    if (incomingNurse) {
      this.reassignPatient(
        record.patientId,
        incomingNurse.id,
        incomingNurse.defaultShift,
        record.outgoingNurseName,
      )
    }

    return newHandover
  }

  // ── 7. UNIFIED PATIENT NURSING TIMELINE ──
  static getPatientTimeline(patientId: string): NursingTimelineEvent[] {
    const events: NursingTimelineEvent[] = []

    // 1. Assignments
    const assignments = this.getAssignments().filter(
      (a) => a.patientId === patientId,
    )
    assignments.forEach((a) => {
      events.push({
        id: `TL-ASN-${a.id}`,
        patientId,
        timestamp: a.assignedAt,
        timeDisplay: new Date(a.assignedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        authorName: a.nurseName,
        authorRole: "Assigned Nurse",
        eventType: "shift_start",
        title: `${a.shiftLabel} Started`,
        description: `Patient assigned to ${a.nurseName} by ${a.assignedBy}. Room ${a.roomNo} · Bed ${a.bedNo}.`,
        badge: a.shift.toUpperCase(),
      })
    })

    // 2. Doctor Instructions
    const instructions = this.getDoctorInstructions(patientId)
    instructions.forEach((ins) => {
      events.push({
        id: `TL-INS-${ins.id}`,
        patientId,
        timestamp: ins.createdAt,
        timeDisplay: new Date(ins.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        authorName: ins.doctorName,
        authorRole: "Attending Doctor",
        eventType: "instruction",
        title: `Doctor Instruction (${ins.priority.toUpperCase()})`,
        description: ins.instructionText,
        badge: ins.status.toUpperCase(),
      })

      if (ins.acknowledgedAt && ins.acknowledgedByNurseName) {
        events.push({
          id: `TL-ACK-${ins.id}`,
          patientId,
          timestamp: ins.acknowledgedAt,
          timeDisplay: new Date(ins.acknowledgedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          authorName: ins.acknowledgedByNurseName,
          authorRole: "Staff Nurse",
          eventType: "instruction_ack",
          title: "Instruction Acknowledged",
          description: `Acknowledged by ${ins.acknowledgedByNurseName} for execution.`,
        })
      }

      if (ins.completedAt && ins.completedByNurseName) {
        events.push({
          id: `TL-DON-${ins.id}`,
          patientId,
          timestamp: ins.completedAt,
          timeDisplay: new Date(ins.completedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          authorName: ins.completedByNurseName,
          authorRole: "Staff Nurse",
          eventType: "instruction_done",
          title: "Instruction Completed",
          description:
            ins.completionNote ||
            `Completed order by ${ins.completedByNurseName}.`,
        })
      }
    })

    // 3. Nursing Notes
    const notes = this.getNotes(patientId)
    notes.forEach((n) => {
      events.push({
        id: `TL-NOT-${n.id}`,
        patientId,
        timestamp: n.createdAt,
        timeDisplay: new Date(n.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        authorName: n.authorNurseName,
        authorRole: "Staff Nurse",
        eventType: "note",
        title: "Nursing Assessment & Care Note",
        description: `${n.assessment} ${n.observation} ${n.intervention}`,
        badge: n.vitals ? `BP ${n.vitals.bp} · HR ${n.vitals.hr}` : undefined,
      })
    })

    // 4. Messages
    const messages = this.getMessages(patientId)
    messages.forEach((m) => {
      events.push({
        id: `TL-MSG-${m.id}`,
        patientId,
        timestamp: m.createdAt,
        timeDisplay: new Date(m.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        authorName: m.senderName,
        authorRole:
          m.senderRole === "doctor" ? "Attending Physician" : "Staff Nurse",
        eventType: "message",
        title: `Message: ${m.senderName} ➔ ${m.recipientName}`,
        description: `"${m.messageText}"`,
      })
    })

    // 5. Handovers
    const handovers = this.getHandovers(patientId)
    handovers.forEach((h) => {
      events.push({
        id: `TL-HND-${h.id}`,
        patientId,
        timestamp: h.completedAt,
        timeDisplay: new Date(h.completedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        authorName: h.outgoingNurseName,
        authorRole: "Outgoing Nurse",
        eventType: "handover",
        title: `Shift Handover (${h.outgoingShift} ➔ ${h.incomingShift})`,
        description: `Handed over to ${h.incomingNurseName}. Condition: ${h.condition}. Note: ${h.handoverNote}`,
        badge: "HANDOVER COMPLETE",
      })
    })

    // Sort in reverse chronological order (newest first)
    events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    return events
  }

  static getAuthenticatedStaff(): any {
    return this.getAuthenticatedUser().profile
  }
}

export const NursingDatabase = NursingWorkflowDb
