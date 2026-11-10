import { API_BASE } from "./constants"

import type { Notice } from "../types"

import { ErDatabase } from "../services/erDb"

import { BedDatabase } from "../services/bedDb"

import { db } from "../services/db"

import { BillingDatabase } from "../services/billingDb"

import { getDoctorMaster } from "../services/doctorMaster"
import { DepartmentDatabase } from "../services/departmentDb"
import { RoleDatabase, ALL_SYSTEM_MODULES, type AppRole, type AppUser } from "../services/roleDb"

import {
  GeneralReportsService,
  DateRangePreset,
} from "../services/generalReportsDb"

const HOSPITAL_CODE_KEY = "hospai_hospital_code"

const DEFAULT_HOSPITAL_CODE = "hosp-default"

// Browser-resident stores are useful only for isolated development demos. They
// must never silently replace a failed API call in a deployed HMS, where that
// would make a clinical or financial screen claim a successful local write.
export const LOCAL_MOCKS_ENABLED =
  Boolean((import.meta as any)?.env?.DEV) &&
  (import.meta as any)?.env?.VITE_ENABLE_LOCAL_MOCKS !== "false"

export function getHospitalCode(): string {
  if (typeof window === "undefined") return DEFAULT_HOSPITAL_CODE

  const stored = (window.localStorage.getItem(HOSPITAL_CODE_KEY) || "")
    .trim()
    .toLowerCase()

  return stored || DEFAULT_HOSPITAL_CODE
}

export function setHospitalCode(hospitalCode: string): void {
  if (typeof window === "undefined") return

  const normalized =
    (hospitalCode || "").trim().toLowerCase() || DEFAULT_HOSPITAL_CODE

  window.localStorage.setItem(HOSPITAL_CODE_KEY, normalized)
}

export function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined

  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)

  return match ? decodeURIComponent(match[1]) : undefined
}

/**
 * Robust mock handler for ER & Hospital data when backend is in standalone mode
 */

async function handleLocalErMock<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T | null> {
  const method = (options.method || "GET").toUpperCase()

  const url = new URL(path, "http://localhost")

  const pathname = url.pathname

  const body = options.body
    ? typeof options.body === "string"
      ? JSON.parse(options.body)
      : options.body
    : {}

  // GET /api/reports/:reportType

  if (pathname.startsWith("/api/reports") && method === "GET") {
    const reportType = pathname.replace(/^\/api\/reports\/?/, "") || "overview"

    const preset = (url.searchParams.get("preset") ||
      url.searchParams.get("dateRangePreset") ||
      "last30") as DateRangePreset

    const customStart =
      url.searchParams.get("from") ||
      url.searchParams.get("customStartDate") ||
      undefined

    const customEnd =
      url.searchParams.get("to") ||
      url.searchParams.get("customEndDate") ||
      undefined

    const department = url.searchParams.get("department") || undefined

    const doctor = url.searchParams.get("doctor") || undefined

    const status = url.searchParams.get("status") || undefined

    const visitType = url.searchParams.get("visitType") || undefined

    const search = url.searchParams.get("search") || undefined

    const page = parseInt(url.searchParams.get("page") || "1", 10)

    const limit = parseInt(url.searchParams.get("limit") || "10", 10)

    const revenueSource = url.searchParams.get("revenueSource") || undefined

    const paymentMethod = url.searchParams.get("paymentMethod") || undefined

    const paymentStatus = url.searchParams.get("paymentStatus") || undefined

    const supplier = url.searchParams.get("supplier") || undefined

    const medicine = url.searchParams.get("medicine") || undefined

    const category = url.searchParams.get("category") || undefined

    const reason = url.searchParams.get("reason") || undefined

    const payload = GeneralReportsService.getReportPayload(reportType, {
      preset,

      customStart,

      customEnd,

      department,

      doctor,

      status,

      visitType,

      search,

      page,

      limit,

      revenueSource,

      paymentMethod,

      paymentStatus,

      supplier,

      medicine,

      category,

      reason,
    })

    return payload as T
  }

  // GET /api/er/triage-config

  if (pathname === "/api/er/triage-config" && method === "GET") {
    return { categories: ErDatabase.getCategories() } as T
  }

  // POST /api/er/triage-config

  if (pathname === "/api/er/triage-config" && method === "POST") {
    const cat = ErDatabase.saveCategory(body)

    return { category: cat } as T
  }

  // GET /api/er/visits

  if (pathname === "/api/er/visits" && method === "GET") {
    const activeOnly = url.searchParams.get("active_only") === "true"

    const status = url.searchParams.get("status")

    const filter = activeOnly
      ? "active"
      : status === "closed"
        ? "closed"
        : "all"

    return { visits: ErDatabase.getVisits(filter) } as T
  }

  // GET /api/er/visits/:id

  const visitDetailMatch = pathname.match(/^\/api\/er\/visits\/([^/]+)$/)

  if (visitDetailMatch && method === "GET") {
    const rawId = visitDetailMatch[1]
    const visitId = parseInt(rawId, 10)

    let visit = ErDatabase.getVisit(!isNaN(visitId) ? visitId : rawId)

    if (!visit) {
      const allVisits = ErDatabase.getVisits("all")
      const matched = allVisits.find(
        (v) =>
          v.id === visitId ||
          v.visit_no === rawId ||
          (v.visit_no && v.visit_no.endsWith(rawId)) ||
          (!isNaN(visitId) && v.visit_no && v.visit_no.endsWith(String(visitId).padStart(5, "0")))
      )
      if (matched) {
        visit = ErDatabase.getVisit(matched.id)
      }
    }

    return (visit || null) as T
  }

  // POST /api/er/register-patient (Direct ER Patient Registration)

  if (pathname === "/api/er/register-patient" && method === "POST") {
    const {
      patient: pData,
      visit: vData,
      complaint: cData,
      vitals: vtData,
    } = body

    const res = await ErDatabase.createVisit({
      patientDetails: pData,

      arrivalDate: vData?.arrival_date,

      arrivalTime: vData?.arrival_time,

      arrivalMode: vData?.arrival_mode,

      broughtBy: vData?.brought_by,

      attendantName: vData?.attendant_name,

      attendantRelation: vData?.attendant_relation,

      conditionAtArrival: vData?.condition_at_arrival,

      consciousness: vData?.consciousness,

      infoProvidedBy: vData?.info_provided_by,

      policeInvolved: vData?.police_involved,

      triageCategory: vData?.triage_category,

      triageBedLabel: vData?.triage_bed_label,

      complaintText: cData?.[0]?.complaint,

      caseCategory: cData?.[0]?.case_category,

      vitals: vtData,
    })

    return {
      patient_id: res.patient?.patient_id || `P-${res.visit.id}`,

      patient: res.patient,

      visit: { id: res.visit.id, visit_no: res.visit.visit_no },
    } as T
  }

  // POST /api/er/visits (Existing or Unknown Patient)

  if (pathname === "/api/er/visits" && method === "POST") {
    const res = await ErDatabase.createVisit({
      patientId: body.patient_id,

      patientDetails: body.patient_details,

      isUnknown: body.is_unknown_patient,

      unknownLabel: body.unknown_patient_label,

      arrivalDate: body.arrival_date,

      arrivalTime: body.arrival_time,

      arrivalMode: body.arrival_mode,

      broughtBy: body.brought_by,

      attendantName: body.attendant_name,

      attendantRelation: body.attendant_relation,

      conditionAtArrival: body.condition_at_arrival,

      consciousness: body.consciousness,

      infoProvidedBy: body.info_provided_by,

      policeInvolved: body.police_involved,

      assignedDoctorName: body.assigned_doctor_name,

      assignedSpecialty: body.assigned_specialty,
    })

    return { id: res.visit.id, visit_no: res.visit.visit_no } as T
  }

  // GET /api/er/patients/:patientId/history

  const patientHistoryMatch = pathname.match(
    /^\/api\/er\/patients\/([^/]+)\/history$/,
  )

  if (patientHistoryMatch && method === "GET") {
    const patientId = decodeURIComponent(patientHistoryMatch[1])

    const erVisits = ErDatabase.getVisitsByPatient(patientId)

    const opEncounters = db.getEncountersForPatient(patientId)

    const erPatient = ErDatabase.getPatients().find(
      (p) =>
        (p.patient_id || "").trim().toUpperCase() ===
        patientId.trim().toUpperCase(),
    )

    const corePatient = db.getPatientByUmr(patientId)

    return {
      er_visits: erVisits,

      op_encounters: opEncounters,

      patient:
        erPatient ||
        (corePatient
          ? {
              patient_id: corePatient.umr,

              name: corePatient.name,

              last_name: "",

              gender: corePatient.sex || "Male",

              age: corePatient.age || 30,

              phone: corePatient.phone || "",

              emergency_contact: corePatient.phone || "",

              address: corePatient.address || "",

              blood_group: "O+",

              created_at: new Date().toISOString(),
            }
          : null),
    } as T
  }

  // POST /api/er/visits/:id/complaints

  const complaintsMatch = pathname.match(
    /^\/api\/er\/visits\/(\d+)\/complaints$/,
  )

  if (complaintsMatch && method === "POST") {
    const visitId = parseInt(complaintsMatch[1])

    const c = ErDatabase.addComplaint(visitId, body)

    return { complaint_id: c.id } as T
  }

  // POST /api/er/visits/:id/vitals

  const vitalsMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/vitals$/)

  if (vitalsMatch && method === "POST") {
    const visitId = parseInt(vitalsMatch[1])

    const v = ErDatabase.addVitals(visitId, body)

    return { vitals_id: v.id } as T
  }

  // POST /api/er/visits/:id/triage

  const triageMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/triage$/)

  if (triageMatch && method === "POST") {
    const visitId = parseInt(triageMatch[1])

    ErDatabase.setTriage(visitId, {
      category: body.category,

      reason: body.reason,

      bedLabel: body.triage_bed_label || body.bedLabel,
    })

    return { success: true } as T
  }

  // POST /api/er/visits/:id/assign-doctor

  const assignDocMatch = pathname.match(
    /^\/api\/er\/visits\/(\d+)\/assign-doctor$/,
  )

  if (assignDocMatch && method === "POST") {
    const visitId = parseInt(assignDocMatch[1])

    ErDatabase.assignDoctor(visitId, body)

    return { success: true } as T
  }

  // POST /api/er/visits/:id/accept

  const acceptDocMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/accept$/)

  if (acceptDocMatch && method === "POST") {
    const visitId = parseInt(acceptDocMatch[1])

    ErDatabase.acceptDoctor(visitId)

    return { success: true } as T
  }

  // POST /api/er/visits/:id/treatments

  const treatMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/treatments$/)

  if (treatMatch && method === "POST") {
    const visitId = parseInt(treatMatch[1])

    const t = ErDatabase.addTreatment(visitId, body)

    return { treatment_id: t.id } as T
  }

  // POST /api/er/visits/:id/notes

  const notesMatch = pathname.match(
    /^\/api\/er\/visits\/(\d+)\/(notes|clinical-notes)$/,
  )

  if (notesMatch && method === "POST") {
    const visitId = parseInt(notesMatch[1])

    const n = ErDatabase.addClinicalNote(visitId, body)

    return { note_id: n.id } as T
  }

  // POST /api/er/visits/:id/investigations

  const invMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/investigations$/)

  if (invMatch && method === "POST") {
    const visitId = parseInt(invMatch[1])

    const inv = ErDatabase.addInvestigation(visitId, body)

    return { investigation_id: inv.id } as T
  }

  // POST /api/er/visits/:id/bed-requests

  const bedReqMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/bed-requests$/)

  if (bedReqMatch && method === "POST") {
    const visitId = parseInt(bedReqMatch[1])

    const b = ErDatabase.createBedRequest(visitId, body)

    return { bed_request_id: b.id } as T
  }

  // GET /api/er/visits/:id/consents

  const consentsGetMatch = pathname.match(
    /^\/api\/er\/visits\/(\d+)\/consents$/,
  )

  if (consentsGetMatch && method === "GET") {
    const visitId = parseInt(consentsGetMatch[1])

    const visit = ErDatabase.getVisit(visitId)

    return { consents: visit?.consents || [] } as T
  }

  // POST /api/er/visits/:id/consents

  if (consentsGetMatch && method === "POST") {
    const visitId = parseInt(consentsGetMatch[1])

    const c = ErDatabase.addConsent(visitId, body)

    return { consent_id: c.id } as T
  }

  // POST /api/er/visits/:id/lama

  const lamaMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/lama$/)

  if (lamaMatch && method === "POST") {
    const visitId = parseInt(lamaMatch[1])

    ErDatabase.recordLama(visitId, body)

    return { success: true } as T
  }

  // POST /api/er/visits/:id/disposition

  const dispMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/disposition$/)

  if (dispMatch && method === "POST") {
    const visitId = parseInt(dispMatch[1])

    const d = ErDatabase.recordDisposition(visitId, body)

    return { disposition: d, bed_request_id: (d as any).er_bed_request_id || 1 } as T
  }

  // POST /api/er/patients/:id or PUT /api/patients/:id (Update patient info & allergies)

  const patientUpdateMatch = pathname.match(/^\/api\/(?:er\/)?patients\/([^/]+)$/)

  if (patientUpdateMatch && (method === "POST" || method === "PUT")) {
    const pId = decodeURIComponent(patientUpdateMatch[1])

    const updated = ErDatabase.updatePatient(pId, body)

    try {
      const existingDbPat = db.getPatientByUmr(pId)
      if (existingDbPat) {
        const all = db.getPatients().map((p) =>
          p.umr.toUpperCase() === pId.toUpperCase()
            ? {
                ...p,
                name: body.name || p.name,
                phone: body.phone || p.phone,
                gender: body.gender || p.gender,
                age: body.age ? Number(body.age) : p.age,
                address: body.address || p.address,
                bloodGroup: body.blood_group || p.bloodGroup,
                emergency_contact: body.emergency_contact || (p as any).emergency_contact,
              }
            : p
        )
        if (typeof window !== "undefined") {
          window.localStorage.setItem("hospai_db_patients_v1", JSON.stringify(all))
        }
      }
    } catch {}

    return { patient: updated, success: true } as T
  }

  // POST or GET /api/patients/:id/notes (Clinical Evaluations & Treatment Notes)
  const patientNotesMatch = pathname.match(/^\/api\/patients\/([^/]+)\/notes$/)
  if (patientNotesMatch) {
    const pId = decodeURIComponent(patientNotesMatch[1])
    const key = `hospai_patient_evaluations_${pId}`

    if (method === "POST") {
      let existing: any[] = []
      try {
        existing = JSON.parse(window.localStorage.getItem(key) || "[]")
      } catch {
        existing = []
      }

      const newNote = {
        id: existing.length + 1,
        doctor_name: body.doctor_name || "Attending Physician",
        note: body.note || "",
        treatment_plan: body.treatment_plan || "",
        role: body.role || "doctor",
        created_at: new Date().toISOString(),
      }
      existing.unshift(newNote)
      try {
        window.localStorage.setItem(key, JSON.stringify(existing))
      } catch {}

      if (body.vitals && (body.vitals.bp || body.vitals.pulse || body.vitals.temperature || body.vitals.spo2 || body.vitals.respiratory_rate)) {
        const vitKey = `hospai_patient_vitals_${pId}`
        try {
          const vits = JSON.parse(window.localStorage.getItem(vitKey) || "[]")
          vits.unshift({
            id: vits.length + 1,
            bp: body.vitals.bp || "",
            pulse: body.vitals.pulse || "",
            temperature: body.vitals.temperature || "",
            spo2: body.vitals.spo2 || "",
            respiratory_rate: body.vitals.respiratory_rate || "",
            created_at: new Date().toISOString(),
          })
          window.localStorage.setItem(vitKey, JSON.stringify(vits))
        } catch {}
      }

      if (body.diagnosis && body.diagnosis.trim()) {
        const diagKey = `hospai_patient_diagnoses_${pId}`
        try {
          const diags = JSON.parse(window.localStorage.getItem(diagKey) || "[]")
          diags.unshift({
            id: diags.length + 1,
            diagnosis_name: body.diagnosis.trim(),
            created_at: new Date().toISOString(),
          })
          window.localStorage.setItem(diagKey, JSON.stringify(diags))
        } catch {}
      }

      return { note_id: newNote.id, success: true } as T
    }

    if (method === "GET") {
      try {
        const notes = JSON.parse(window.localStorage.getItem(key) || "[]")
        return { notes } as T
      } catch {
        return { notes: [] } as T
      }
    }
  }

  // GET /api/er/bed-requests

  if (pathname === "/api/er/bed-requests" && method === "GET") {
    const status = url.searchParams.get("status") || undefined

    const reqs = ErDatabase.getBedRequests(status)

    return { bed_requests: reqs } as T
  }

  // POST /api/er/bed-requests/:id/allocate

  const allocReqMatch = pathname.match(
    /^\/api\/er\/bed-requests\/(\d+)\/allocate$/,
  )

  if (allocReqMatch && method === "POST") {
    const reqId = parseInt(allocReqMatch[1])

    const { bed_id, notes } = body

    BedDatabase.allocateBedFromEr(bed_id, reqId, notes)

    ErDatabase.allocateBedRequest(reqId, bed_id, notes)

    return { success: true } as T
  }

  // POST /api/er/bed-requests/:id/lama

  const lamaReqMatch = pathname.match(/^\/api\/er\/bed-requests\/(\d+)\/lama$/)

  if (lamaReqMatch && method === "POST") {
    const reqId = parseInt(lamaReqMatch[1])

    ErDatabase.cancelBedRequest(reqId, body.reason)

    return { success: true } as T
  }

  // GET /api/beds

  if (pathname === "/api/beds" && method === "GET") {
    const beds = BedDatabase.getBeds()

    const summary = BedDatabase.getSummary()

    return { beds, summary } as T
  }

  // POST /api/beds/bulk

  if (pathname === "/api/beds/bulk" && method === "POST") {
    const created = BedDatabase.createBedsBulk(body)

    return { created_count: created.length, skipped_count: 0, beds: created } as T
  }

  // POST /api/beds/:id/assign

  const assignBedMatch = pathname.match(/^\/api\/beds\/(\d+)\/assign$/)

  if (assignBedMatch && method === "POST") {
    const bedId = parseInt(assignBedMatch[1])

    const bed = BedDatabase.assignBed(
      bedId,
      body.patient || body,
      body.notes,
      body.expected_los_days,
    )

    return { bed } as T
  }

  // POST /api/beds/:id/transfer

  const transferBedMatch = pathname.match(/^\/api\/beds\/(\d+)\/transfer$/)

  if (transferBedMatch && method === "POST") {
    const fromBedId = parseInt(transferBedMatch[1])

    const targetBedId = body.to_bed_id || body.target_bed_id || body.toBedId

    const bed = BedDatabase.transferBed(fromBedId, targetBedId, body.reason)

    return { bed } as T
  }

  // POST /api/beds/:id/release

  const releaseBedMatch = pathname.match(/^\/api\/beds\/(\d+)\/release$/)

  if (releaseBedMatch && method === "POST") {
    const bedId = parseInt(releaseBedMatch[1])
    const bedBeforeRelease = BedDatabase.getBed(bedId)

    if (bedBeforeRelease) {
      const occupantName = `${bedBeforeRelease.patient_name || ""} ${bedBeforeRelease.patient_last_name || ""}`.trim()
      const patientName = occupantName || "Inpatient Patient"
      const patientId =
        bedBeforeRelease.patient_id ||
        (bedBeforeRelease.admission_id ? `UMR-ADM-${bedBeforeRelease.admission_id}` : `UMR-${100000 + bedId}`)

      let roomChargeTotal = body.room_charge_total || 0
      if (roomChargeTotal <= 0) {
        roomChargeTotal = (bedBeforeRelease.daily_rate || 1500) * (body.room_charge_segments?.[0]?.days || 1)
      }
      const segments = body.room_charge_segments || []

      const existingClaims = BillingDatabase.getClaims()
      const encId = bedBeforeRelease.admission_id ? `ADM-${bedBeforeRelease.admission_id}` : `BED-${bedBeforeRelease.id}`
      const alreadyInvoiced = existingClaims.some((c) => c.encounterId === encId && (c.balanceDue || 0) > 0)

      if (!alreadyInvoiced && roomChargeTotal > 0 && (bedBeforeRelease.patient_id || occupantName)) {
        const dept: DepartmentType =
          bedBeforeRelease.bed_type === "ICU" || bedBeforeRelease.ward.toUpperCase().includes("ICU")
            ? "ICU"
            : "Inpatient"

        const items =
          segments.length > 0
            ? segments.map((seg: any, idx: number) => ({
                id: `ITEM-BED-${bedBeforeRelease.id}-${Date.now()}-${idx}`,
                description: `Room & Bed Charges: ${seg.ward} (Room ${seg.room_no} / Bed ${seg.bed_no}) [${seg.days} Day${seg.days > 1 ? "s" : ""} @ ₹${seg.daily_rate}/day]`,
                category: "Room / Bed Charges" as const,
                cptCode: "99231",
                quantity: seg.days || 1,
                unitPrice: seg.daily_rate || roomChargeTotal,
                total: (seg.days || 1) * (seg.daily_rate || roomChargeTotal),
                insuranceCovered: 0,
                patientPayable: (seg.days || 1) * (seg.daily_rate || roomChargeTotal),
              }))
            : [
                {
                  id: `ITEM-BED-${bedBeforeRelease.id}-${Date.now()}-0`,
                  description: `Inpatient Room Charges: ${bedBeforeRelease.ward} (Bed ${bedBeforeRelease.bed_no})`,
                  category: "Room / Bed Charges" as const,
                  cptCode: "99231",
                  quantity: 1,
                  unitPrice: roomChargeTotal,
                  total: roomChargeTotal,
                  insuranceCovered: 0,
                  patientPayable: roomChargeTotal,
                },
              ]

        const claim = BillingDatabase.createClaim({
          patientId,
          patientName,
          mrn: patientId.replace(/\D/g, "") || String(100000 + bedId),
          age: bedBeforeRelease.patient_age || 45,
          gender: (bedBeforeRelease.patient_gender as any) || "Other",
          phone: bedBeforeRelease.patient_phone || "+91 98765 43210",
          department: dept,
          carePathway: `Inpatient Stay & Discharge (${bedBeforeRelease.ward} - Room ${bedBeforeRelease.room_no} / Bed ${bedBeforeRelease.bed_no})`,
          encounterId: encId,
          hospitalStayId: `STAY-${bedBeforeRelease.id}-${Date.now().toString().slice(-4)}`,
          dateOfService: new Date().toISOString().split("T")[0],
          insuranceProvider: "Self-Pay",
          status: "Accepted",
          items,
          amountPaid: 0,
          balanceDue: roomChargeTotal,
          totalAmount: roomChargeTotal,
          patientPortion: roomChargeTotal,
        })

        try {
          BillingDatabase.createDepartmentCharge({
            patientId,
            patientName,
            mrn: patientId.replace(/\D/g, "") || String(100000 + bedId),
            department: dept,
            encounterId: encId,
            items,
            status: "Invoiced in Central Billing",
            invoiceId: claim.invoiceNo || claim.id,
            totalAmount: roomChargeTotal,
          })
        } catch {
          // best-effort
        }

        BillingDatabase.setPreselectedClaimForBilling(claim.id || claim.invoiceNo)
        BillingDatabase.emitUpdate()
      }
    }

    const bed = BedDatabase.releaseBed(
      bedId,
      body.discharge_override_reason || body.reason,
      body.room_charge_total,
    )

    return { bed } as T
  }

  // GET /api/beds/discharged

  if (pathname === "/api/beds/discharged" && method === "GET") {
    const list = BedDatabase.getDischargedPatients()

    return { discharged_patients: list } as T
  }

  // GET /api/beds/transfer-notifications

  if (pathname === "/api/beds/transfer-notifications" && method === "GET") {
    const list = BedDatabase.getTransferNotifications()

    return {
      notifications: list,
      unread_count: list.filter((n) => !n.is_read && n.status !== "dismissed")
        .length,
    } as T
  }

  // POST /api/beds/transfer-notifications

  if (pathname === "/api/beds/transfer-notifications" && method === "POST") {
    const notif = BedDatabase.addTransferNotification(body)

    return { notification: notif } as T
  }

  // POST /api/beds/transfer-notifications/read-all

  if (
    LOCAL_MOCKS_ENABLED &&
    pathname === "/api/beds/transfer-notifications/read-all" &&
    method === "POST"
  ) {
    BedDatabase.markAllNotificationsRead()

    return { success: true } as T
  }

  // POST /api/beds/transfer-notifications/:id/read

  const readNotifMatch = pathname.match(
    /^\/api\/beds\/transfer-notifications\/(.+)\/read$/,
  )

  if (readNotifMatch && method === "POST") {
    const notifId = readNotifMatch[1]

    BedDatabase.markNotificationRead(notifId)

    return { success: true } as T
  }

  // POST /api/beds/transfer-notifications/:id/status

  const statusNotifMatch = pathname.match(
    /^\/api\/beds\/transfer-notifications\/(.+)\/status$/,
  )

  if (statusNotifMatch && method === "POST") {
    const notifId = statusNotifMatch[1]

    BedDatabase.updateNotificationStatus(
      notifId,
      body.status,
      body.bed_id,
      body.bed_label,
    )

    return { success: true } as T
  }

  // DELETE /api/beds/transfer-notifications/:id

  const deleteNotifMatch = pathname.match(
    /^\/api\/beds\/transfer-notifications\/(.+)$/,
  )

  if (deleteNotifMatch && method === "DELETE") {
    const notifId = deleteNotifMatch[1]

    BedDatabase.dismissNotification(notifId)

    return { success: true } as T
  }

  // GET /api/beds/:id/discharge-checklist

  const checklistMatch = pathname.match(
    /^\/api\/beds\/(\d+)\/discharge-checklist$/,
  )

  if (checklistMatch && method === "GET") {
    const bedId = parseInt(checklistMatch[1])

    const bed = BedDatabase.getBed(bedId)

    const clearance = BillingDatabase.getInpatientFinancialClearance(
      bed?.patient_id || bedId,

      bed?.patient_name || undefined,
    )

    const billingOk = clearance.isCleared

    const pendingInvoices = (clearance.pendingInvoices || []).map((p) => ({
      invoice_no: p.invoiceNo,

      due_amount: p.dueAmount,
    }))

    const admTime = bed?.admission_date || bed?.allocated_at
    let calculatedDays = 1
    if (admTime) {
      const start = new Date(admTime)
      const now = new Date()
      const diffMs = Math.max(0, now.getTime() - start.getTime())
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      calculatedDays = Math.max(1, diffDays)
    }

    const dailyRate = bed?.daily_rate || 1500
    const totalRoomCharge = dailyRate * calculatedDays

    return {
      billing: { ok: billingOk, pending_invoices: pendingInvoices },

      prescriptions: { ok: true, pending_count: 0 },

      documents: { count: 2 },

      room_charges: {
        segments: [
          {
            ward: bed?.ward || "General Ward",

            room_no: bed?.room_no || "201",

            bed_no: bed?.bed_no || "201-1",

            days: calculatedDays,

            daily_rate: dailyRate,

            amount: totalRoomCharge,
          },
        ],

        total: totalRoomCharge,
      },

      clear: billingOk,
    } as T
  }

  // POST /api/beds/:id (Edit/Update) & DELETE

  const updateBedMatch = pathname.match(/^\/api\/beds\/(\d+)$/)

  if (updateBedMatch && (method === "POST" || method === "PUT")) {
    const bedId = parseInt(updateBedMatch[1])

    const bed = BedDatabase.updateBed(bedId, body)

    return { bed } as T
  }

  if (updateBedMatch && method === "DELETE") {
    return { success: true } as T
  }

  // GET /api/patients/readmissions
  if (pathname === "/api/patients/readmissions" && method === "GET") {
    const windowDays = parseInt(url.searchParams.get("window_days") || "30", 10)
    const discharged = BedDatabase.getDischargedPatients()
    const activeBeds = BedDatabase.getBeds().filter((b) => b.status === "Occupied")

    // Dynamically calculate readmissions based on actual patient discharge & admission records
    const readmissionEvents: any[] = []
    const patientAdmissionsCount = new Map<string, { name: string; count: number }>()

    for (const d of discharged) {
      const pid = d.patientId || (d as any).umr || String(d.id)
      const current = patientAdmissionsCount.get(pid) || { name: d.patientName || "Patient", count: 0 }
      current.count += 1
      patientAdmissionsCount.set(pid, current)

      const readmittedBed = activeBeds.find(
        (b) => (b.patient_id && b.patient_id === d.patientId) || (b.patient_name && b.patient_name === d.patientName)
      )
      if (readmittedBed && d.dischargeDate) {
        const dDate = new Date(d.dischargeDate).getTime()
        const admitDate = (readmittedBed as any).admitted_at || readmittedBed.admission_date || readmittedBed.allocated_at ? new Date(((readmittedBed as any).admitted_at || readmittedBed.admission_date || readmittedBed.allocated_at)!).getTime() : Date.now()
        const gapDays = Math.max(0, Math.round((admitDate - dDate) / 86400000))
        if (gapDays <= windowDays) {
          readmissionEvents.push({
            patient_id: d.patientId || String(d.id),
            patient_name: d.patientName,
            index_discharge_date: d.dischargeDate,
            readmission_date: (readmittedBed as any).admitted_at || readmittedBed.admission_date || readmittedBed.allocated_at || new Date().toISOString(),
            gap_days: gapDays,
            readmission_admission_id: readmittedBed.allocation_id || 1001,
          })
        }
      }
    }

    const highFrequency = Array.from(patientAdmissionsCount.entries())
      .filter(([_, data]) => data.count >= 2)
      .map(([id, data]) => ({
        patient_id: id,
        patient_name: data.name,
        admissions_in_last_12_months: data.count,
      }))

    const totalDischarges = discharged.length
    const totalReadmissions = readmissionEvents.length
    const ratePct = totalDischarges > 0 ? Number(((totalReadmissions / totalDischarges) * 100).toFixed(1)) : 0

    return {
      window_days: windowDays,
      total_discharges: totalDischarges,
      total_readmissions: totalReadmissions,
      readmission_rate_pct: ratePct,
      readmission_events: readmissionEvents,
      high_frequency_patients: highFrequency,
    } as T
  }

  // POST /api/er/consents/:id/document (Document upload simulation)

  const consentDocMatch = pathname.match(
    /^\/api\/er\/consents\/(\d+)\/document$/,
  )

  if (consentDocMatch && method === "POST") {
    return { success: true, message: "Document uploaded successfully" } as T
  }

  // GET /api/doctors & /api/doctors/directory & /api/op/doctors

  if (
    (pathname === "/api/doctors" ||
      pathname === "/api/doctors/directory" ||
      pathname === "/api/op/doctors" ||
      pathname === "/api/admin/doctors") &&
    method === "GET"
  ) {
    const liveDocs = getDoctorMaster()
    const deptParam = url.searchParams.get("department")
    const searchParam = (url.searchParams.get("search") || "").trim().toLowerCase()
    const filtered = liveDocs.filter((d) => {
      if (deptParam && deptParam !== "all" && d.specialty !== deptParam && (d as any).department !== deptParam) return false
      if (searchParam) {
        const match = d.name.toLowerCase().includes(searchParam) ||
          (d.specialty || "").toLowerCase().includes(searchParam) ||
          (d.staffId || "").toLowerCase().includes(searchParam)
        if (!match) return false
      }
      return true
    })
    return {
      success: true,
      doctors: filtered.map((d) => ({
        id: d.staffId || d.id,
        doctor_name: d.name,
        name: d.name,
        department: d.specialty || (d as any).department || "General Medicine",
        specialty: d.specialty || (d as any).department || "General Medicine",
        qualification: d.qualification,
        room: d.room,
        section: d.section,
        consultation_fee: d.consultationFee ?? 500,
        review_fee: (d.consultationFee ?? 500) * 0.5,
        available: true,
      })),
    } as T
  }

  // POST /api/er/visits/:id/close or preview

  const closeMatch = pathname.match(/^\/api\/er\/visits\/(\d+)\/close$/)

  if (closeMatch && method === "POST") {
    const visitId = parseInt(closeMatch[1])

    const res = ErDatabase.closeVisit(
      visitId,
      body.total || body.consultation_fee,
    )

    return res as T
  }

  // POST /api/patients (Register new patient offline-resilient handler)
  if (pathname === "/api/patients" && method === "POST") {
    const erPatient = ErDatabase.addPatient({
      name: body.name || "Emergency Patient",
      last_name: body.last_name || "",
      age: body.age ? parseInt(String(body.age), 10) : 35,
      gender: body.gender || "Male",
      phone: body.phone || "(617) 555-0199",
      address: body.address || "Boston, MA",
    })
    return {
      id: Date.now(),
      patient_id: erPatient.patient_id,
      patient: erPatient,
      name: erPatient.name,
      last_name: erPatient.last_name,
    } as T
  }

  // GET /api/patients/:id
  const patientDetailMatch = pathname.match(/^\/api\/patients\/([^/]+)$/)
  if (patientDetailMatch && method === "GET") {
    const pId = decodeURIComponent(patientDetailMatch[1])
    const ep = ErDatabase.getPatient(pId)
    if (ep) return ep as T
    const cp = db.getPatientByUmr(pId)
    if (cp) return cp as T
  }

  // GET /api/patients

  if (pathname === "/api/patients" && method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim()

    const careType = (url.searchParams.get("care_type") || "all").toLowerCase()

    // 1. OP Patients from db

    const opPatients = db.getPatients()

    const opEncounters = db.getEncounters()

    // 2. ER Patients & Visits from ErDatabase

    const erPatients = ErDatabase.getPatients()

    const erVisits = ErDatabase.getVisits("all")

    // 3. Inpatient & ICU Beds from BedDatabase

    const beds = BedDatabase.getBeds()

    // Build unified PatientRow list

    const patientRows: any[] = []

    const seenIds = new Set<string>()

    // Add Inpatient / ICU patients

    for (const bed of beds) {
      if (bed.status === "Occupied" && (bed.patient_name || bed.patient_id)) {
        const pId = bed.patient_id || `IP-${bed.id}`

        if (!seenIds.has(pId)) {
          seenIds.add(pId)

          patientRows.push({
            patient_id: pId,

            name: bed.patient_name || "Patient",

            last_name: bed.patient_last_name || "",

            age: bed.patient_age || 45,

            gender: bed.patient_gender || "Male",

            phone: bed.patient_phone || "(617) 555-0100",

            care_stream: "IP",

            active_bed: `${bed.ward} · ${bed.bed_no}`,

            appointment_dept: bed.ward,

            appointment_doctor: bed.doctor || "Unassigned",
          })
        }
      }
    }

    // Add ER Active Visits

    for (const visit of erVisits) {
      const p = erPatients.find((ep) => ep.patient_id === visit.patient_id)

      const pId = visit.patient_id || `ER-${visit.id}`

      if (!seenIds.has(pId)) {
        seenIds.add(pId)

        patientRows.push({
          patient_id: pId,

          name: p?.name || visit.patient_name || "Emergency Patient",

          last_name: p?.last_name || "",

          age: p?.age || 35,

          gender: p?.gender || "Male",

          phone: p?.phone || p?.emergency_contact || "(617) 555-0199",

          care_stream: "ER",

          active_er_visit_id: visit.id,

          active_er_visit_no: visit.visit_no,

          active_er_status: visit.status,

          er_triage_category: visit.triage?.category || "Yellow",

          appointment_doctor: visit.assigned_doctor_name || "Unassigned",

          appointment_dept: "Emergency Medicine",
        })
      }
    }

    // Add OP Patients

    for (const p of opPatients) {
      const pEnc = opEncounters.filter((e) => e.umr === p.umr)

      const latestEnc = pEnc[0]

      const pId = p.umr

      if (!seenIds.has(pId)) {
        seenIds.add(pId)

        patientRows.push({
          patient_id: pId,

          name: p.name,

          last_name: "",

          age: p.age,

          gender: p.sex,

          phone: p.phone,

          care_stream: "OP",

          appointment_status: latestEnc?.status || "Registered",

          appointment_doctor: latestEnc?.assignedDoctor || "Unassigned",

          appointment_dept: latestEnc?.dept || "General Medicine",
        })
      }
    }

    // Also include any other ER patients in records

    for (const ep of erPatients) {
      if (!seenIds.has(ep.patient_id)) {
        seenIds.add(ep.patient_id)

        patientRows.push({
          patient_id: ep.patient_id,

          name: ep.name,

          last_name: ep.last_name || "",

          age: ep.age,

          gender: ep.gender,

          phone: ep.phone,

          care_stream: "ER",

          appointment_dept: "Emergency",

          appointment_doctor: (ep as any).assigned_doctor_name || "Unassigned",
        })
      }
    }

    // Filter by search query if present

    let filtered = patientRows

    if (q) {
      filtered = filtered.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.last_name || "").toLowerCase().includes(q) ||
          (p.patient_id || "").toLowerCase().includes(q) ||
          (p.phone || "").toLowerCase().includes(q) ||
          (p.appointment_doctor || "").toLowerCase().includes(q) ||
          (p.appointment_dept || "").toLowerCase().includes(q) ||
          (p.active_bed || "").toLowerCase().includes(q) ||
          (p.active_er_visit_no || "").toLowerCase().includes(q),
      )
    }

    // Filter by care stream

    if (careType === "op") {
      filtered = filtered.filter((p) => p.care_stream === "OP")
    } else if (careType === "ip") {
      filtered = filtered.filter((p) => p.care_stream === "IP")
    } else if (careType === "er") {
      filtered = filtered.filter((p) => p.care_stream === "ER")
    }

    const counts = {
      all: patientRows.length,

      op: patientRows.filter((p) => p.care_stream === "OP").length,

      ip: patientRows.filter((p) => p.care_stream === "IP").length,

      er: patientRows.filter((p) => p.care_stream === "ER").length,
    }

    return { patients: filtered, counts } as T
  }

  // GET /api/emr/:id

  const emrMatch = pathname.match(/^\/api\/emr\/(.+)$/)

  if (emrMatch && method === "GET") {
    const pId = decodeURIComponent(emrMatch[1])

    const opP = db.getPatientByUmr(pId)

    const opEnc = db.getEncounters().filter((e) => e.umr === pId)

    const erP = ErDatabase.getPatients().find((p) => p.patient_id === pId)

    const erVisits = ErDatabase.getVisits("all").filter(
      (v) => v.patient_id === pId,
    )

    const bed = BedDatabase.getBeds().find((b) => b.patient_id === pId)

    const claims = BillingDatabase.getClaims().filter(
      (c) =>
        c.mrn === pId ||
        c.patientName === opP?.name ||
        c.patientName === erP?.name,
    )

    const name = opP?.name || erP?.name || bed?.patient_name || "Patient Record"

    const age = opP?.age || erP?.age || bed?.patient_age || 42

    const gender = opP?.sex || erP?.gender || bed?.patient_gender || "Male"

    const phone =
      opP?.phone || erP?.phone || bed?.patient_phone || "(617) 555-0100"

    const address = opP?.address || erP?.address || "Main Street, Boston, MA"

    const bloodGroup = opP?.bloodGroup || erP?.blood_group || "O+"

    const patientObj = {
      id: 1,

      patient_id: pId,

      name,

      last_name: erP?.last_name || bed?.patient_last_name || "",

      age,

      gender,

      phone,

      address,

      blood_group: bloodGroup,

      allergies: erP?.allergies || "No Known Drug Allergies (NKDA)",

      emergency_contact: erP?.emergency_contact || "(617) 555-0199",

      guardian_name: erP?.guardian_name || "",

      created_at: opP?.createdAt || erP?.created_at || new Date().toISOString(),

      status: "Active",
    }

    const notes = opEnc.map((e, idx) => ({
      id: idx + 1,

      chief_complaint: e.chiefComplaint,

      notes: `${e.diagnosis}. ${e.advice || ""}`,

      follow_up: "In 7 days if symptoms persist",

      created_at: new Date(Date.now() - (idx + 1) * 86400000).toISOString(),
    }))

    const vitals = opEnc.map((e, idx) => ({
      id: idx + 1,

      bp: e.vitals?.bp || "120/80 mmHg",

      pulse: e.vitals?.pulse || "74 bpm",

      temperature: e.vitals?.temp || "98.6 °F",

      created_at: new Date(Date.now() - (idx + 1) * 86400000).toISOString(),
    }))

    const diagnoses = opEnc
      .filter((e) => !!e.diagnosis)
      .map((e, idx) => ({
        id: idx + 1,
        diagnosis: e.diagnosis,
        created_at: new Date(Date.now() - (idx + 1) * 86400000).toISOString(),
      }))

    let localEvals: any[] = []
    let localVits: any[] = []
    let localDiags: any[] = []
    try {
      localEvals = JSON.parse(window.localStorage.getItem(`hospai_patient_evaluations_${pId}`) || "[]")
      localVits = JSON.parse(window.localStorage.getItem(`hospai_patient_vitals_${pId}`) || "[]")
      localDiags = JSON.parse(window.localStorage.getItem(`hospai_patient_diagnoses_${pId}`) || "[]")
    } catch {}

    const allVitals = [
      ...localVits,
      ...vitals,
    ]

    const allDiagnoses = [
      ...localDiags,
      ...diagnoses,
    ]

    const observation_notes = [
      ...localEvals,
    ]

    const prescriptions = (opEnc[0]?.prescription || []).map((rx, idx) => ({
      prescription_id: idx + 1,

      medicine_name: rx.medicine,

      dosage: `${rx.dosage} · ${rx.frequency} · ${rx.duration}`,

      quantity: 30,

      unit_price: 15,

      status: "Fulfilled",

      created_at: new Date().toISOString(),

      fulfilled_at: new Date().toISOString(),
    }))

    const medication_schedules = prescriptions.map((p, idx) => ({
      id: idx + 1,

      medicine_name: p.medicine_name,

      dosage: p.dosage,

      schedule_time: "08:00 AM, 08:00 PM",

      administered: true,

      notes: "Given with food",
    }))

    const labs = (
      opEnc[0]?.investigations || ["Complete Blood Count (CBC)", "Lipid Panel"]
    ).map((test, idx) => ({
      id: idx + 1,

      test_name: test,

      amount: 450,

      status: "Completed",

      doctor_name: opEnc[0]?.assignedDoctor || "",

      created_at: new Date().toISOString(),
    }))

    const invoices = claims.map((c, idx) => ({
      id: idx + 1,

      invoice_no: c.invoiceNo,

      module: c.department,

      total_amount: c.totalAmount,

      paid_amount: c.amountPaid,

      due_amount: c.balanceDue,

      payment_status: c.status === "Paid" ? "Paid" : "Pending",

      created_at: c.dateOfService || new Date().toISOString(),
    }))

    const invoice_payments = claims.flatMap((c) =>
      c.payments.map((p, pIdx) => ({
        id: pIdx + 1,

        invoice_id: 1,

        amount: p.amount,

        payment_mode: p.paymentMethod,

        created_at: p.paymentDate,
      })),
    )

    const insurance_claims = claims.map((c, idx) => ({
      id: idx + 1,

      invoice_id: idx + 1,

      insurer_name: c.insuranceProvider,

      claim_amount: c.totalAmount,

      approved_amount: c.insurancePortion || c.totalAmount,

      claim_status: c.status,

      submitted_at: c.dateOfService || new Date().toISOString(),
    }))

    const documents = [
      {
        id: 1,

        doc_type: "Prescription Scan",

        file_name: `Rx_${pId}.pdf`,

        mime_type: "application/pdf",

        created_at: new Date().toISOString(),

        ocr_text: `PATIENT: ${name}\nDIAGNOSIS: ${opEnc[0]?.diagnosis || "Clinical Management"}\nMEDICATIONS: ${prescriptions.map((p) => p.medicine_name).join(", ")}`,

        has_ocr_text: true,
      },
    ]

    const certificates = [
      {
        id: 1,

        certificate_type: "Medical Fitness",

        title: "Clinical Fitness Certificate",

        body: `This is to certify that ${name} (Age: ${age}, ${gender}) has been examined and is clinically fit for regular duties.`,

        issued_by: opEnc[0]?.assignedDoctor || "",

        created_at: new Date().toISOString(),
      },
    ]

    const admissions = bed
      ? [
          {
            id: 1,

            admission_date:
              bed.admission_date ||
              new Date(Date.now() - 86400000 * 3).toISOString(),

            discharge_date: bed.expected_discharge_date || null,

            notes:
              bed.admission_notes ||
              `Admitted to ${bed.ward} Bed ${bed.bed_no}`,
          },
        ]
      : []

    return {
      patient: patientObj,

      admissions,

      notes,

      vitals: allVitals,

      diagnoses: allDiagnoses,

      observation_notes,

      medication_schedules,

      prescriptions,

      labs,

      documents,

      invoices,

      invoice_payments,

      insurance_claims,

      certificates,

      timeline: [],

      icu_ventilator_settings: [],

      icu_infusions: [],

      icu_io_records: [],

      icu_rass_scores: [],

      icu_lab_results: [],

      icu_consults: [],
      clinical_orders: [],
      care_plan: null,
    } as T
  }

  // GET /api/registration/departments & /api/admin/departments
  if (
    (pathname === "/api/registration/departments" || pathname === "/api/admin/departments") &&
    method === "GET"
  ) {
    const liveDepts = DepartmentDatabase.getDepartments()
    return {
      success: true,
      departments: liveDepts.length > 0 ? liveDepts : [
        { id: 101, department_name: "Emergency Medicine", name: "Emergency Medicine", code: "EMER", status: "active", capacity: 50 },
        { id: 102, department_name: "Cardiology", name: "Cardiology", code: "CARD", status: "active", capacity: 40 },
        { id: 103, department_name: "Pulmonology", name: "Pulmonology", code: "PULM", status: "active", capacity: 30 },
        { id: 104, department_name: "General Medicine", name: "General Medicine", code: "GENM", status: "active", capacity: 60 },
        { id: 105, department_name: "General Surgery", name: "General Surgery", code: "GENS", status: "active", capacity: 35 },
        { id: 106, department_name: "Orthopedics / Trauma", name: "Orthopedics / Trauma", code: "ORTH", status: "active", capacity: 40 },
        { id: 107, department_name: "Neurology", name: "Neurology", code: "NEUR", status: "active", capacity: 25 },
        { id: 108, department_name: "Pediatrics", name: "Pediatrics", code: "PEDI", status: "active", capacity: 30 },
        { id: 109, department_name: "Obstetrics & Gynecology", name: "Obstetrics & Gynecology", code: "OBGY", status: "active", capacity: 35 },
      ],
    } as T
  }

  // POST /api/symptom-ai/triage

  if (pathname === "/api/symptom-ai/triage" && method === "POST") {
    const symptoms = body.symptoms || ""

    const evalRes = await ErDatabase.evaluateClinicalTriage(symptoms, {})

    return {
      department: evalRes.suggestedDepartment,

      urgency: evalRes.urgency,

      reasoning: evalRes.reasoning,

      doctor: evalRes.suggestedDoctor,

      suggested_treatment: evalRes.suggestedTreatments[0] || null,

      suggested_treatments: evalRes.suggestedTreatments,
    } as T
  }

  // ==================== RBAC: Roles Management ====================

  // GET /api/admin/roles
  if (pathname === "/api/admin/roles" && method === "GET") {
    const allRoles = RoleDatabase.getRoles()
    return {
      success: true,
      roles: allRoles.map((r) => ({
        id: r.id,
        role_key: r.id,
        name: r.name,
        role_name: r.name,
        allowedModules: r.allowedModules || [],
        allowed_modules: r.allowedModules || [],
        status: r.status || "Active",
      })),
    } as T
  }

  // POST /api/admin/roles
  if (pathname === "/api/admin/roles" && method === "POST") {
    const roleId =
      body.id ||
      "ROLE_" +
        (body.name || "Custom Role")
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "_")
    const newRole: AppRole = {
      id: roleId,
      name: (body.name || roleId).trim(),
      allowedModules: Array.isArray(body.allowedModules)
        ? body.allowedModules
        : Array.isArray(body.allowed_modules)
          ? body.allowed_modules
          : [],
      status: body.status || "Active",
      isSystem: false,
    }
    RoleDatabase.upsertRole(newRole)
    return {
      success: true,
      role: {
        id: newRole.id,
        role_key: newRole.id,
        name: newRole.name,
        role_name: newRole.name,
        allowedModules: newRole.allowedModules,
        allowed_modules: newRole.allowedModules,
        status: newRole.status,
      },
      message: `Role ${newRole.name} saved successfully`,
    } as T
  }

  // PUT /api/admin/roles/:id
  const adminRolePutMatch = pathname.match(/^\/api\/admin\/roles\/([^/]+)$/)
  if (adminRolePutMatch && method === "PUT") {
    const roleId = decodeURIComponent(adminRolePutMatch[1])
    const allRoles = RoleDatabase.getRoles()
    const existing = allRoles.find((r) => r.id === roleId)

    const allowed = Array.isArray(body.allowedModules)
      ? body.allowedModules
      : Array.isArray(body.allowed_modules)
        ? body.allowed_modules
        : (existing?.allowedModules || [])

    const updatedRole: AppRole = {
      id: roleId,
      name: body.name || existing?.name || roleId,
      status: body.status
        ? String(body.status).toLowerCase() === "active"
          ? "Active"
          : "Inactive"
        : (existing?.status || "Active"),
      allowedModules: allowed,
      isSystem: existing?.isSystem ?? roleId.includes("ADMIN"),
    }

    RoleDatabase.upsertRole(updatedRole)

    // Synchronize active session permissions if currently logged in with this role
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const raw = window.localStorage.getItem("hospai_current_user")
        if (raw) {
          const u = JSON.parse(raw)
          if (u && (u.role === roleId || u.role_key === roleId)) {
            u.module_access = updatedRole.allowedModules
            u.permissions = updatedRole.allowedModules
            window.localStorage.setItem("hospai_current_user", JSON.stringify(u))
          }
        }
      } catch {}
    }

    return {
      success: true,
      role: {
        id: updatedRole.id,
        role_key: updatedRole.id,
        name: updatedRole.name,
        role_name: updatedRole.name,
        allowedModules: updatedRole.allowedModules,
        allowed_modules: updatedRole.allowedModules,
        status: updatedRole.status,
      },
      message: `Role ${roleId} updated successfully`,
    } as T
  }

  // DELETE /api/admin/roles/:id
  if (adminRolePutMatch && method === "DELETE") {
    const roleId = decodeURIComponent(adminRolePutMatch[1])
    if (roleId === "ROLE_ADMIN" || roleId === "ROLE_SUPERADMIN") {
      throw new Error("System Administrator is a protected platform role.")
    }
    RoleDatabase.deleteRole(roleId)
    return { success: true, message: `Role ${roleId} deleted successfully` } as T
  }

  // ==================== RBAC: User Management ====================

  // GET /api/admin/users/all
  if (pathname === "/api/admin/users/all" && method === "GET") {
    const allUsers = RoleDatabase.getUsers()
    return {
      success: true,
      users: allUsers.map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        full_name: u.name,
        roleId: u.roleId,
        role_key: u.roleId,
        staffId: u.staffId,
        employee_id: u.staffId,
        status: u.status || "Active",
        department: u.department,
        allowedModules: u.allowedModules || u.customModules,
        customModules: u.customModules || u.allowedModules,
      })),
    } as T
  }

  // POST /api/admin/users/create
  if (pathname === "/api/admin/users/create" && method === "POST") {
    const allUsers = RoleDatabase.getUsers()
    const userCount = allUsers.length + 1
    const newUser: AppUser = {
      id: `U_${Date.now()}`,
      username: (body.username || "").trim().toLowerCase(),
      password: body.password || "password123",
      roleId: body.roleId || body.role_key || "ROLE_STAFF",
      name: body.name || body.full_name || body.username || "Staff Member",
      staffId: body.staffId || body.employee_id || `STF-${String(userCount).padStart(3, "0")}`,
      status: body.status || "Active",
      department: body.department,
      allowedModules: body.allowedModules || body.customModules,
      customModules: body.customModules || body.allowedModules,
    }
    RoleDatabase.upsertUser(newUser)
    return { success: true, user: newUser, message: "User account created successfully" } as T
  }

  // PUT /api/admin/users/:id
  const adminUserPutMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (adminUserPutMatch && (method === "PUT" || method === "POST")) {
    const userId = decodeURIComponent(adminUserPutMatch[1])
    const allUsers = RoleDatabase.getUsers()
    const idx = allUsers.findIndex(
      (u) => u.id === userId || (u.username && u.username.toLowerCase() === userId.toLowerCase()),
    )
    if (idx >= 0) {
      if (body.roleId || body.role_key) allUsers[idx].roleId = body.roleId || body.role_key
      if (body.name || body.full_name) allUsers[idx].name = body.name || body.full_name
      if (body.status) allUsers[idx].status = body.status
      if (body.staffId || body.employee_id) allUsers[idx].staffId = body.staffId || body.employee_id
      if (body.password) allUsers[idx].password = body.password
      if (body.department !== undefined) allUsers[idx].department = body.department
      if (body.allowedModules !== undefined) allUsers[idx].allowedModules = body.allowedModules
      if (body.customModules !== undefined) allUsers[idx].customModules = body.customModules
      RoleDatabase.saveUsers(allUsers)
      return { success: true, message: `User ${userId} updated successfully` } as T
    }
    const created: AppUser = {
      id: userId.startsWith("U_") ? userId : `U_${Date.now()}`,
      username: (body.username || userId).trim().toLowerCase(),
      name: body.name || body.full_name || userId,
      password: body.password || "password123",
      roleId: body.roleId || body.role_key || "ROLE_STAFF",
      staffId: body.staffId || body.employee_id || `STF-${Date.now().toString().slice(-4)}`,
      status: body.status || "Active",
      department: body.department,
      allowedModules: body.allowedModules || body.customModules,
      customModules: body.customModules || body.allowedModules,
    }
    RoleDatabase.upsertUser(created)
    return { success: true, user: created, message: `User ${userId} saved successfully` } as T
  }

  // DELETE /api/admin/users/:id
  if (adminUserPutMatch && method === "DELETE") {
    const userId = decodeURIComponent(adminUserPutMatch[1])
    RoleDatabase.deleteUser(userId)
    return { success: true, message: `User ${userId} deleted successfully` } as T
  }

  // POST /api/admin/users/:id/reset-password
  const resetPassMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/)
  if (resetPassMatch && method === "POST") {
    const userId = decodeURIComponent(resetPassMatch[1])
    const allUsers = RoleDatabase.getUsers()
    const u = allUsers.find((x) => x.id === userId || x.username === userId)
    if (u && body.password) {
      u.password = body.password
      RoleDatabase.saveUsers(allUsers)
    }
    return { success: true, message: "Password updated successfully" } as T
  }

  // POST /api/auth/login
  if (pathname === "/api/auth/login" && method === "POST") {
    const auth = RoleDatabase.authenticate(body.username, body.password, body.selected_role_id)
    if (!auth) throw new Error("Invalid username or password.")

    const effectivePerms = auth.user.customModules || auth.user.allowedModules || auth.role.allowedModules || []
    const isSysAdmin =
      auth.user.roleId === "ROLE_ADMIN" ||
      auth.role.id === "ROLE_ADMIN" ||
      auth.user.username.toLowerCase() === "admin"

    const userRoleUpper = (auth.role.id || auth.user.roleId || "").toUpperCase()
    const isDoctor =
      userRoleUpper === "ROLE_DOCTOR" ||
      userRoleUpper.includes("DOCTOR") ||
      userRoleUpper.includes("SURGEON") ||
      userRoleUpper.includes("PHYSICIAN") ||
      userRoleUpper.includes("CLINICIAN") ||
      (auth.user.name || "").toLowerCase().startsWith("dr.") ||
      Boolean(
        auth.user.department &&
          [
            "cardiology",
            "neurology",
            "pediatrics",
            "orthopedics",
            "general surgery",
            "general medicine",
            "oncology",
            "gastroenterology",
            "ent",
            "ophthalmology",
            "dermatology",
            "urology",
            "pulmonology",
            "emergency medicine",
          ].includes(auth.user.department.toLowerCase()),
      )

    const userPayload = {
      id: auth.user.id,
      employee_id: auth.user.staffId || auth.user.id,
      username: auth.user.username,
      role: auth.role.id,
      role_key: auth.role.id,
      access_role: isSysAdmin ? "owner" : isDoctor ? "clinician" : "staff",
      user_type: isSysAdmin ? "admin" : "normal",
      name: auth.user.name,
      full_name: auth.user.name,
      department: auth.user.department || (isDoctor ? "General Medicine" : undefined),
      permissions: isSysAdmin ? [...ALL_SYSTEM_MODULES, "*", "admin"] : effectivePerms,
      module_access: isSysAdmin ? [...ALL_SYSTEM_MODULES, "*", "admin"] : effectivePerms,
      doctorId: isDoctor ? (auth.user.staffId || auth.user.id || auth.user.username) : undefined,
    }

    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(
        "hospai_current_user",
        JSON.stringify({
          user: auth.user.username,
          role: auth.role.id,
          name: auth.user.name,
          profile: userPayload,
        }),
      )
    }

    return { success: true, user: userPayload } as T
  }

  // GET /api/auth/session
  if (pathname === "/api/auth/session" && method === "GET") {
    let sessionUser: any = null
    try {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem("hospai_current_user") : null
      if (stored) {
        const parsed = JSON.parse(stored)
        sessionUser = parsed?.profile || parsed
      }
    } catch {}
    if (sessionUser && sessionUser.username) {
      return { success: true, authenticated: true, user: sessionUser } as T
    }
    return { success: false, authenticated: false } as T
  }

  // GET /api/auth/login-roles
  if (pathname === "/api/auth/login-roles" && method === "GET") {
    const roles = RoleDatabase.getRoles()
    return {
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description || "Assigned access is applied after sign-in",
        is_system: Boolean(r.isSystem),
      })),
    } as T
  }

  // GET /api/auth/login-summary
  if (pathname === "/api/auth/login-summary" && method === "GET") {
    const roles = RoleDatabase.getRoles()
    const users = RoleDatabase.getUsers()
    return {
      active_roles: roles.filter((r) => (r.status || "Active") === "Active").length,
      active_staff: users.filter((u) => (u.status || "Active") === "Active").length,
      available_modules: ALL_SYSTEM_MODULES.length,
      security: "Role-Based Access Control",
    } as T
  }

  // GET /api/auth/login-roles/:role_id/users
  const loginRoleUsersMatch = pathname.match(/^\/api\/auth\/login-roles\/([^/]+)\/users$/)
  if (loginRoleUsersMatch && method === "GET") {
    const roleId = decodeURIComponent(loginRoleUsersMatch[1]).trim().toUpperCase()
    const allUsers = RoleDatabase.getUsers()
    let matchingUsers: any[] = []

    if (roleId === "ROLE_DOCTOR" || roleId === "DOCTOR" || roleId === "ROLE_CLINICIAN") {
      const docs = getDoctorMaster().filter((d) => d.verified)
      const userMap = new Map<string, any>()
      allUsers
        .filter((u) => (u.roleId === "ROLE_DOCTOR" || u.roleId?.toLowerCase().includes("doctor")) && (u.status || "Active") === "Active")
        .forEach((u) => {
          userMap.set(u.username.toLowerCase(), {
            id: u.id,
            employee_id: u.staffId || u.id,
            full_name: u.name,
            department: u.department || "General Medicine",
          })
        })
      docs.forEach((d) => {
        const key = (d.username || `doc_${d.id}`).toLowerCase()
        if (!userMap.has(key)) {
          userMap.set(key, {
            id: d.id,
            employee_id: d.staffId || d.id,
            full_name: d.name,
            department: d.specialty || "General Medicine",
          })
        }
      })
      matchingUsers = Array.from(userMap.values())
    } else {
      matchingUsers = allUsers
        .filter((u) => u.roleId?.toUpperCase() === roleId && (u.status || "Active") === "Active")
        .map((u) => ({
          id: u.id,
          employee_id: u.staffId || u.id,
          full_name: u.name,
          department: u.department,
        }))
    }
    return { users: matchingUsers } as T
  }

  // POST /api/auth/logout
  if (pathname === "/api/auth/logout" && method === "POST") {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem("hospai_current_user")
    }
    return { success: true, message: "Logged out" } as T
  }

  return null
}

/** Default per-request budget. Overridable via options.timeoutMs. */

export const DEFAULT_TIMEOUT_MS = 3500
export const AUTH_TIMEOUT_MS = 12000

let isBackendOnline = true

let lastBackendProbeTime = 0

const PROBE_INTERVAL_MS = 30000

export async function apiFetch<T = any>(
  path: string,

  options: RequestInit & { cache?: RequestCache ;timeoutMs?: number } = {},
): Promise<T> {
  const method = (options.method || "GET").toUpperCase()
  // Authentication is never mockable: even a development-only local data
  // fallback must not create or restore a session without the backend.
  const isAuthRequest = path.startsWith("/api/auth/")
  // Endpoints that grant or restore a session. A browser-store answer for these
  // would let any credential (or a hand-edited localStorage) sign in, so they
  // are only ever answered locally in dev mode when the backend is unreachable.
  const isCredentialRequest = path === "/api/auth/login" || path === "/api/auth/session"

  // Serve ER, bed management, reports, EMR, and patient notes directly from live persistent store.
  // Authentication is excluded here deliberately -- see isAuthRequest below.
  if (
    !isAuthRequest &&
    LOCAL_MOCKS_ENABLED && (
    path.startsWith("/api/admin") ||
    path.startsWith("/api/er") ||
    path.startsWith("/api/reports") ||
    path.startsWith("/api/beds") ||
    path.startsWith("/api/emr") ||
    path.startsWith("/api/icu") ||
    path.includes("/notes") ||
    path.startsWith("/api/patients")
    )
  ) {
    const localResult = await handleLocalErMock<T>(path, options)

    if (localResult !== null) {
      return localResult as T
    }
  }

  // If backend was already found unreachable within probe interval, serve via local mock handler directly

  const now = Date.now()

  if (!isAuthRequest && LOCAL_MOCKS_ENABLED && !isBackendOnline && now - lastBackendProbeTime < PROBE_INTERVAL_MS) {
    const cachedLocalResult = await handleLocalErMock<T>(path, options)

    if (cachedLocalResult !== null) {
      return cachedLocalResult as T
    }
  }

  const csrfToken = getCsrfToken()

  const headers: HeadersInit = {
    "Content-Type": "application/json",

    "X-Hospital-Code": getHospitalCode(),

    ...(csrfToken && method !== "GET" && method !== "HEAD"
      ? { "X-CSRF-Token": csrfToken }
      : {}),

    ...(options.headers || {}),
  }

  // Pulled out of the spread below: `...options` used to land after `headers`

  // and `signal`, so any caller passing its own headers silently dropped the

  // hospital-code/CSRF headers computed above.

  const {
    headers: _ignoredHeaders,
    signal: callerSignal,
    timeoutMs,
    cache,
    ...rest
  } = options

  try {
    const controller = new AbortController()

    // A fetch() that loses the race for one of the browser's ~6 connections per

    // origin sits in a queue with this timer already running, so a budget that

    // is too tight aborts requests that never reached the server at all. Hence

    // seconds, not milliseconds -- the server itself answers in ~10ms.

    const timeoutId = setTimeout(
      () => controller.abort(),
      timeoutMs ?? (isAuthRequest ? AUTH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    )

    if (callerSignal) {
      if (callerSignal.aborted) controller.abort()
      else
        callerSignal.addEventListener("abort", () => controller.abort(), {
          once: true,
        })
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...rest,

      headers,

      credentials: "include",

      cache: cache || (method === "GET" ? "no-store" : "default"),

      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      isBackendOnline = true
    } else {
      if (response.status >= 500) {
        isBackendOnline = false
        lastBackendProbeTime = Date.now()
      }
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))

      if (
        response.status === 401 &&
        path !== "/api/auth/login" &&
        path !== "/api/auth/session"
      ) {
        window.dispatchEvent(new Event("app:unauthorized"))
      }

      // Browser mocks may answer a failed request in dev or offline fallback
      // A server's answer to a login/session request is final -- never replaced locally.
      if (!isCredentialRequest && (response.status >= 500 || response.status === 404 || response.status === 401 || LOCAL_MOCKS_ENABLED)) {
        const localResult = await handleLocalErMock<T>(path, options)
        if (localResult !== null) return localResult as T
      }

      const message = payload.error || payload.message || "Request failed"

      const error = new Error(message) as Error & {
        payload?: any
        status?: number
      }

      error.payload = payload

      error.status = response.status

      throw error
    }

    return response.json()
  } catch (err: any) {
    // Mark backend offline so subsequent calls don't spam failed HTTP requests

    isBackendOnline = false

    lastBackendProbeTime = Date.now()

    // Offline fallback to browser stores. Login/session only fall back when the
    // backend gave no answer at all, and only in local dev mode.
    const serverAnswered = typeof err?.status === "number"
    if (!isCredentialRequest || (LOCAL_MOCKS_ENABLED && !serverAnswered)) {
      const localResult = await handleLocalErMock<T>(path, options)
      if (localResult !== null) {
        return localResult as T
      }
    }

    if (err?.name === "AbortError" && !callerSignal?.aborted) {
      throw new Error(
        isAuthRequest
          ? "Authentication service did not respond. Start the HMS backend and try again."
          : "The request timed out. Please try again.",
      )
    }

    throw err
  }
}

export function withAuthHeaders(
  headers: Record<string, string> = {},
  method = "GET",
): HeadersInit {
  const csrfToken = getCsrfToken()

  return {
    "X-Hospital-Code": getHospitalCode(),

    ...(csrfToken && method !== "GET" && method !== "HEAD"
      ? { "X-CSRF-Token": csrfToken }
      : {}),

    ...headers,
  }
}

export function reportError(
  setNotice?: (notice: Notice | null) => void,

  error?: { status?: number ;message?: string },

  fallbackMessage = "Request failed.",
): void {
  if (error?.status === 401) return

  setNotice?.({ type: "error", message: error?.message || fallbackMessage })
}
