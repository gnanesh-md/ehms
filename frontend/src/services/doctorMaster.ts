/**
 * Imperial Hospitals doctor master -- the authoritative roster the whole app reads.
 * Provides central backend synchronization, deterministic ID allocation, and multi-tab broadcasts.
 */

import { apiFetch } from "../lib/api"

export type DoctorSection = "Main" | "Visiting"

export interface MasterDoctor {
  id: string
  name: string
  qualification: string
  specialty: string | null
  specialtyNote?: string
  section: DoctorSection
  verified: boolean
  username?: string
  room: string
  staffId: string
  selectedOnCard?: boolean
  consultationFee?: number
  gender?: "Male" | "Female"
  roleId?: string
  password?: string
}

export const DOCTOR_LOCAL_PASSWORD = "password123"
export const INITIAL_DOCTOR_MASTER: MasterDoctor[] = []

export function getDefaultFeeForSpecialty(specialty?: string | null): number {
  if (!specialty) return 500
  const s = specialty.toLowerCase()
  if (s.includes("neuro")) return 800
  if (s.includes("ortho")) return 700
  if (s.includes("cardio")) return 500
  if (s.includes("gastro")) return 600
  if (s.includes("gyne") || s.includes("obg")) return 400
  if (s.includes("pedia")) return 450
  if (s.includes("urology")) return 600
  if (s.includes("oncology")) return 900
  if (s.includes("vascular")) return 750
  if (s.includes("critical")) return 700
  if (s.includes("radiology")) return 350
  if (s.includes("ent")) return 400
  return 500
}

const DOCTOR_MASTER_KEY = "hospai_doctor_master_v3"
const DOCTOR_BROADCAST_CHANNEL = "hospai_doctor_master_channel"

let docBroadcast: BroadcastChannel | null = null
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    docBroadcast = new BroadcastChannel(DOCTOR_BROADCAST_CHANNEL)
    docBroadcast.onmessage = (e) => {
      if (e.data?.type === "doctor_master_updated") {
        window.dispatchEvent(new Event("doctor_master_updated"))
      }
    }
  } catch {
    docBroadcast = null
  }
}

export function getDoctorMaster(): MasterDoctor[] {
  if (typeof window === "undefined") return []

  try {
    const stored = window.localStorage.getItem(DOCTOR_MASTER_KEY)
    if (!stored) {
      return []
    }

    const parsed: MasterDoctor[] = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []

    // Filter out legacy demo doctors
    const filtered = parsed.filter(
      (d) =>
        d &&
        !String(d.id).startsWith("IMP-0") &&
        !String(d.id).startsWith("IMP-1") &&
        !String(d.id).startsWith("IMP-2") &&
        d.name !== "Dr. P. R. K. Varma" &&
        d.name !== "Dr. Rajesh Sharma",
    )

    if (filtered.length !== parsed.length) {
      window.localStorage.setItem(DOCTOR_MASTER_KEY, JSON.stringify(filtered))
    }

    return filtered
  } catch {
    return []
  }
}

export function saveDoctorMaster(doctors: MasterDoctor[]): void {
  if (typeof window === "undefined") {
    doctors.forEach((updatedDoc) => {
      const idx = INITIAL_DOCTOR_MASTER.findIndex((d) => d.id === updatedDoc.id)
      if (idx !== -1) {
        INITIAL_DOCTOR_MASTER[idx] = updatedDoc
      } else {
        INITIAL_DOCTOR_MASTER.push(updatedDoc)
      }
    })
    return
  }

  try {
    window.localStorage.setItem(DOCTOR_MASTER_KEY, JSON.stringify(doctors))
    window.dispatchEvent(new Event("doctor_master_updated"))
    try {
      docBroadcast?.postMessage({ type: "doctor_master_updated" })
    } catch {}
  } catch (e) {
    console.error("Failed to save doctor master", e)
  }
}

export function addDoctorMaster(doctor: MasterDoctor): MasterDoctor[] {
  const current = getDoctorMaster()

  // Generate deterministic ID DOC-xxxx -- never array length
  if (!doctor.id || doctor.id.startsWith("IMP-") || doctor.id.length < 5) {
    const nextNum = current.length > 0
      ? Math.max(...current.map(d => {
          const num = parseInt((d.id || "").replace(/\D/g, ""), 10)
          return isNaN(num) ? 0 : num
        })) + 1
      : 1001
    doctor.id = `DOC-${nextNum}`
    doctor.staffId = doctor.id
  }

  const updated = [...current.filter(d => d.id !== doctor.id && d.name.toLowerCase() !== doctor.name.toLowerCase()), doctor]
  saveDoctorMaster(updated)

  // Asynchronously sync to central backend
  try {
    apiFetch("/api/admin/doctors", {
      method: "POST",
      body: JSON.stringify({
        staff_id: doctor.staffId || doctor.id,
        name: doctor.name,
        department: doctor.specialty || "General Medicine",
        specialty: doctor.specialty,
        specialtyNote: doctor.specialtyNote,
        qualification: doctor.qualification,
        section: doctor.section,
        room: doctor.room,
        username: doctor.username,
        consultationFee: doctor.consultationFee,
        gender: doctor.gender || "Male",
      }),
    }).catch(e => console.warn("Background doctor creation sync failed:", e))
  } catch {}

  return updated
}

export function updateDoctorMaster(
  updatedDoctor: MasterDoctor,
): MasterDoctor[] {
  const current = getDoctorMaster()
  const updated = current.map((d) =>
    d.id === updatedDoctor.id ? updatedDoctor : d,
  )
  saveDoctorMaster(updated)

  try {
    apiFetch(`/api/admin/doctors/${updatedDoctor.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: updatedDoctor.name,
        department: updatedDoctor.specialty,
        specialty: updatedDoctor.specialty,
        specialtyNote: updatedDoctor.specialtyNote,
        qualification: updatedDoctor.qualification,
        section: updatedDoctor.section,
        room: updatedDoctor.room,
        consultationFee: updatedDoctor.consultationFee,
        gender: updatedDoctor.gender,
      }),
    }).catch(e => console.warn("Background doctor update sync failed:", e))
  } catch {}

  return updated
}

export function deleteDoctorMaster(id: string): MasterDoctor[] {
  const current = getDoctorMaster()
  const updated = current.filter((d) => d.id !== id)
  saveDoctorMaster(updated)

  try {
    apiFetch(`/api/admin/doctors/${id}`, {
      method: "DELETE",
    }).catch(e => console.warn("Background doctor delete sync failed:", e))
  } catch {}

  return updated
}

export async function syncDoctorMasterFromBackend(): Promise<MasterDoctor[]> {
  try {
    const res = await apiFetch<{ success: boolean; doctors: any[] }>("/api/admin/doctors")
    if (res && Array.isArray(res.doctors)) {
      const mapped: MasterDoctor[] = res.doctors.map((d) => ({
        id: String(d.staff_id || d.id),
        name: d.doctor_name || d.name,
        qualification: d.qualification || "MBBS, MD",
        specialty: d.specialty || d.department || "General Medicine",
        specialtyNote: d.specialty_note || "",
        section: (d.section as DoctorSection) || "Main",
        verified: true,
        username: d.username,
        room: d.room || "OPD-101",
        staffId: String(d.staff_id || d.id),
        consultationFee: d.consultation_fee ?? 500,
        gender: d.gender || "Male",
      }))
      saveDoctorMaster(mapped)
      return mapped
    }
  } catch (e) {
    console.warn("Could not sync doctors from backend:", e)
  }
  return getDoctorMaster()
}

export const getActiveDoctors = (): MasterDoctor[] => {
  return getDoctorMaster().filter((d) => d && d.verified && d.specialty)
}

/** Dynamic live proxy for DOCTOR_MASTER always querying current state */
export const DOCTOR_MASTER: MasterDoctor[] = new Proxy([] as MasterDoctor[], {
  get(target, prop, receiver) {
    const live = getDoctorMaster()
    const val = Reflect.get(live, prop, receiver)
    return typeof val === "function" ? val.bind(live) : val
  },
})

/** Dynamic live proxy for ACTIVE_DOCTORS */
export const ACTIVE_DOCTORS: MasterDoctor[] = new Proxy([] as MasterDoctor[], {
  get(target, prop, receiver) {
    const live = getActiveDoctors()
    const val = Reflect.get(live, prop, receiver)
    return typeof val === "function" ? val.bind(live) : val
  },
})

/** Rows the hospital still has to complete before they can be used. */
export const UNVERIFIED_DOCTORS: MasterDoctor[] = new Proxy([] as MasterDoctor[], {
  get(target, prop, receiver) {
    const live = getDoctorMaster().filter((d) => !d.verified)
    const val = Reflect.get(live, prop, receiver)
    return typeof val === "function" ? val.bind(live) : val
  },
})

export const DEFAULT_HOSPITAL_SPECIALTIES = [
  "General Medicine",
  "Cardiology",
  "Neurology",
  "Pediatrics",
  "Orthopedics",
  "General Surgery",
  "Obstetrics & Gynecology",
  "Dermatology",
  "Ophthalmology",
  "ENT",
  "Oncology",
  "Urology",
  "Gastroenterology",
  "Emergency Medicine",
  "Pulmonology",
]

/** Returns the dynamic, up-to-date list of all active specialties across doctors. */
export function getActiveSpecialties(): string[] {
  const specs = new Set<string>(DEFAULT_HOSPITAL_SPECIALTIES)
  try {
    const docs = getDoctorMaster()
    for (const d of docs) {
      if (d.specialty && d.specialty.trim()) specs.add(d.specialty.trim())
    }
  } catch {}
  return Array.from(specs).sort()
}

/** Dynamic live proxy for ACTIVE_SPECIALTIES */
export const ACTIVE_SPECIALTIES: string[] = new Proxy([] as string[], {
  get(target, prop, receiver) {
    const live = getActiveSpecialties()
    const val = Reflect.get(live, prop, receiver)
    return typeof val === "function" ? val.bind(live) : val
  },
})

export function getDoctorByName(name: string): MasterDoctor | undefined {
  if (!name) return undefined
  const norm = name.replace(/^Dr\.\s*/i, "").trim().toLowerCase()
  return getDoctorMaster().find(
    (d) =>
      d.name.toLowerCase() === name.toLowerCase() ||
      d.name.replace(/^Dr\.\s*/i, "").trim().toLowerCase() === norm,
  )
}

export function getDoctorConsultationFee(name: string): number {
  if (!name) return 500
  const doc = getDoctorByName(name)
  if (doc && typeof doc.consultationFee === "number" && doc.consultationFee >= 0) {
    return doc.consultationFee
  }
  return 500
}

export function doctorsForSpecialty(specialty: string): MasterDoctor[] {
  return getDoctorMaster().filter(
    (d) => d.verified && d.specialty === specialty,
  )
}

export function availabilityOf(
  doctor: MasterDoctor,
): {
  bookable: boolean
  label: string
  onRequest: boolean
} {
  if (!doctor.verified || !doctor.specialty) {
    return { bookable: false, label: "Needs verification", onRequest: false }
  }

  return doctor.section === "Main"
    ? { bookable: true, label: "Available today", onRequest: false }
    : { bookable: true, label: "On request", onRequest: true }
}

export function pickDoctorForSpecialty(
  specialty: string,
  load: (doctorName: string) => number,
): MasterDoctor | undefined {
  const candidates = doctorsForSpecialty(specialty)
  if (!candidates.length) return undefined

  const byPreference = [...candidates].sort((a, b) => {
    if (a.section !== b.section) return a.section === "Main" ? -1 : 1
    return load(a.name) - load(b.name)
  })

  return byPreference[0]
}
