import React, { useState, useEffect } from "react"
import { Icon } from "./icons"
import { StatusBadge, Btn, Input } from "./shared"
import { db, DBPatient, DBOPEncounter, hasRecordedVitals } from "../services/db"
import { getDoctorMaster, getDoctorConsultationFee, availabilityOf, type MasterDoctor } from "../services/doctorMaster"
import { HospAILogo } from "./HospAILogo"
import { useBranding } from "./branding/DocumentBranding"
import { OpCardPreview, cardBarcodeValue, opCardDataFor, printOpCard } from "./opcard/OpCard"
import { openJourneyForCode } from "./opcard/JourneyScan"
import {
  notifyAppointmentBooked,
  notifyPatientCalledToNurse,
  sendPatientMessage,
  whatsAppHandoffUrl,
  emailHandoffUrl,
} from "../services/patientMessaging"
import toast from "react-hot-toast"
import { SendToPatientButton } from "./messaging/SendToPatientDialog"
import HospitalReceiptModal from "./HospitalReceiptModal"
import PatientJourneyModal from "./PatientJourneyModal"
import JourneyReportPrintModal from "./opcard/JourneyReportPrintModal"

export interface OPPatient {
  id?: string
  umr: string
  opNumber: string
  date?: string
  createdAt?: string
  name: string
  age: number
  sex: "Male" | "Female" | "Other"
  phone: string
  address: string
  isNew: boolean
  previousVisits?: {
    opNumber: string
    date: string
    doctor: string
    diagnosis: string
  }[]
  symptoms: string[]
  chiefComplaint: string
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
  }[]
  investigations: string[]
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
    consultationFee: number
    labFee: number
    total: number
    status: "Paid" | "Pending"
    mode: string
  }
  furtherAction: "None" | "Laboratory" | "Pharmacy" | "Radiology" | "Admission" | "Referral"
  status: "Registered" | "Symptoms Captured" | "AI Recommended" | "Awaiting Doctor" | "Doctor Assigned" | "In Queue" | "Under Consultation" | "Consultation Completed" | "Post-Consultation" | "Awaiting Billing" | "Billing Completed" | "Awaiting Investigation" | "OP Completed"
  timestamps: {
    arrival: string
    registration?: string
    symptoms?: string
    doctorAssigned?: string
    consultationStart?: string
    consultationEnd?: string
    /** Set by the OP nurse station when baseline observations are saved. */
    vitalsRecorded?: string
    vitalsBy?: string
    billingCompleted?: string
    visitCompleted?: string
  }
}

export interface DoctorProfileInfo {
  id: string
  name: string
  specialty: string
  /** From the doctor master; unset when the master does not record it. */
  gender?: "Male" | "Female"
  status: "Available" | "In Consultation" | "Busy" | "On Rounds"
  room: string
  workload: number
  qualifications: string
  timing: string
  nextSlot: string
}

// Encounter states in which a patient is still waiting for, or with, their doctor.
const OPEN_OP_STATUSES = new Set<string>([
  "Registered",
  "Symptoms Captured",
  "AI Recommended",
  "Awaiting Doctor",
  "Doctor Assigned",
  "In Queue",
  "Vitals Recorded",
  "Awaiting Consultation",
  "Under Consultation",
])

function encounterDay(e: DBOPEncounter): string {
  return e.date || (e.createdAt || "").slice(0, 10)
}

function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today's open OP encounters for a doctor, in arrival order. */
function openQueueFor(doctorName: string, encounters: DBOPEncounter[]): DBOPEncounter[] {
  if (!doctorName) return []
  const today = todayIso()
  return encounters
    .filter(
      (e) =>
        e.assignedDoctor === doctorName &&
        OPEN_OP_STATUSES.has(e.status) &&
        encounterDay(e) === today,
    )
    .sort(
      (a, b) =>
        (a.queuePosition || 0) - (b.queuePosition || 0) ||
        (a.createdAt || "").localeCompare(b.createdAt || ""),
    )
}

/**
 * A bookable doctor from the doctor master, with their live load: the number of
 * today's OP patients still open against them. Nothing here is invented --
 * gender and room come from the master record, load from the encounter store.
 */
function toDoctorProfile(doc: MasterDoctor, encounters: DBOPEncounter[]): DoctorProfileInfo {
  const load = openQueueFor(doc.name, encounters).length
  const availability = availabilityOf(doc)
  return {
    id: doc.id,
    name: doc.name,
    specialty: doc.specialty || "",
    gender: doc.gender,
    status: load === 0 ? "Available" : "In Consultation",
    room: doc.room,
    workload: load,
    qualifications: doc.qualification,
    timing: availability.label,
    nextSlot: load === 0 ? "No one waiting" : `${load} patient${load === 1 ? "" : "s"} ahead`,
  }
}

/** Verified doctors for a specialty (all verified doctors when none match). */
function doctorProfilesFor(specialty: string, encounters: DBOPEncounter[]): DoctorProfileInfo[] {
  const verified = getDoctorMaster().filter((d) => d.verified)
  const matching = verified.filter(
    (d) =>
      d.specialty === specialty ||
      (specialty === "General Medicine" && (!d.specialty || d.specialty === "General Medicine")),
  )
  return (matching.length ? matching : verified).map((d) => toDoctorProfile(d, encounters))
}

function findDoctorProfile(name: string, encounters: DBOPEncounter[]): DoctorProfileInfo | null {
  const doc = getDoctorMaster().find((d) => d.name === name)
  return doc ? toDoctorProfile(doc, encounters) : null
}

const EMPTY_VITALS: OPPatient["vitals"] = { bp: "", pulse: "", temp: "", spo2: "", weight: "", notes: "" }

const EMPTY_OP_PATIENT: OPPatient = {
  umr: "",
  opNumber: "",
  name: "",
  age: 0,
  sex: "Male",
  phone: "",
  address: "",
  isNew: true,
  previousVisits: [],
  symptoms: [],
  chiefComplaint: "",
  aiSpecialty: "",
  aiDoctor: "",
  aiConfidence: 0,
  doctorGenderPref: "Any",
  assignedDoctor: "",
  doctorStatus: "Available",
  queueToken: "",
  queuePosition: 0,
  room: "",
  diagnosis: "",
  icd10: "",
  prescription: [],
  investigations: [],
  advice: "",
  vitals: EMPTY_VITALS,
  billing: { consultationFee: 0, labFee: 0, total: 0, status: "Pending", mode: "Cash" },
  furtherAction: "None",
  status: "Registered",
  timestamps: { arrival: "" },
}


export default function OPWorkflow({
  onComplete,
  onNavigateToRegistration,
  onOpenDoctorPortal,
  initialStep = 2,
  initialEncounterId,
}: {
  onComplete?: () => void
  onNavigateToRegistration?: () => void
  onOpenDoctorPortal?: (encounterId?: string) => void
  initialStep?: number
  initialEncounterId?: string
}) {
  // Deliberately NOT persisted. Sticky form *fields* are what the user asked for;
  // a sticky step number meant reception opened the journey on whatever panel they
  // last used -- often billing, and often for a different patient than the one now
  // in front of them. The position resets; the typed data does not.
  const [currentStep, setCurrentStep] = useState<number>(initialStep || 2)
  const branding = useBranding()
  const [dbEncounters, setDbEncounters] = useState<DBOPEncounter[]>([])

  // Load encounters from DB
  const refreshDb = () => {
    const encs = db.getEncounters()
    setDbEncounters(encs)
    return encs
  }

  // Patient workflow state
  const [patient, setPatient] = useState<OPPatient>(EMPTY_OP_PATIENT)
  const [selectedJourneyEncounter, setSelectedJourneyEncounter] = useState<DBOPEncounter | null>(null)
  const [printJourneyEncounter, setPrintJourneyEncounter] = useState<DBOPEncounter | null>(null)

  const handleSendJourneyWhatsApp = async (targetEnc?: DBOPEncounter | null) => {
    const enc = targetEnc || dbEncounters.find((e) => e.id === patient.id || (e.umr && e.umr === patient.umr)) || (patient as any)
    const phone = enc.phone || patient.phone
    const targetUmr = enc.umr || patient.umr
    const message =
      `🏥 *${branding.hospitalName.toUpperCase()}*\n` +
      `*Complete Outpatient Clinical Journey Summary*\n\n` +
      `👤 *Patient:* ${enc.patientName || patient.name}\n` +
      `🆔 *UMR:* ${targetUmr}\n` +
      `📋 *OP Encounter:* ${enc.opNumber || patient.opNumber}\n` +
      `👨‍⚕️ *Consultant:* ${enc.assignedDoctor || patient.assignedDoctor || "Unassigned"}\n` +
      `🩺 *Specialty:* ${enc.dept || patient.aiSpecialty || "General Medicine"}\n` +
      `📅 *Date:* ${enc.date || patient.date || new Date().toLocaleDateString()}\n\n` +
      `*Clinical Pathway Completed:*\n` +
      `✓ 1. OP Registration & UMR Verification\n` +
      `✓ 2. Symptom Triage & Physician Allocation\n` +
      `✓ 3. Clinical Consultation & Digital Prescription\n` +
      `✓ 4. Billing & Encounter Settlement\n\n` +
      `*View Live Digital OP Card & Care Record:* ${window.location.origin}/#/patient/${encodeURIComponent(targetUmr)}\n\n` +
      `For queries or emergency assistance: ${branding.helpline || "+91-8816-279999"}`

    try {
      await sendPatientMessage({
        patient: { name: enc.patientName || patient.name, phone, id: targetUmr, encounterId: enc.id || patient.id },
        kind: "patient_journey",
        channels: ["whatsapp"],
        message,
      })
      setSmsSentNotice(`✓ OP Journey sent via WhatsApp to ${phone}`)
    } catch {
      window.open(whatsAppHandoffUrl(phone, message), "_blank")
      setSmsSentNotice(`WhatsApp opened for ${phone}`)
    }
  }

  const handleSendJourneyEmail = async (targetEnc?: DBOPEncounter | null) => {
    const enc = targetEnc || dbEncounters.find((e) => e.id === patient.id || (e.umr && e.umr === patient.umr)) || (patient as any)
    const targetUmr = enc.umr || patient.umr
    let email = (enc as any).email || patient.email || ""
    if (!email) {
      email = window.prompt("Enter patient email to send OP Journey report:", "") || ""
    }
    if (!email || !email.includes("@")) return

    const subject = `Your Outpatient Care Journey & OP Card - ${branding.hospitalName}`
    const body =
      `Dear ${enc.patientName || patient.name},\n\n` +
      `Thank you for visiting ${branding.hospitalName}.\n\n` +
      `Here is a summary of your Outpatient Encounter (${enc.opNumber || patient.opNumber}):\n` +
      `- Permanent UMR: ${targetUmr}\n` +
      `- Consultant: ${enc.assignedDoctor || patient.assignedDoctor}\n` +
      `- Department: ${enc.dept || patient.aiSpecialty}\n` +
      `- Date: ${enc.date || patient.date || new Date().toLocaleDateString()}\n\n` +
      `You can review your complete clinical trajectory and digital OP Card at:\n` +
      `${window.location.origin}/#/patient/${encodeURIComponent(targetUmr)}\n\n` +
      `Warm regards,\n` +
      `${branding.hospitalName} Outpatient Care Team\n` +
      `Helpline: ${branding.helpline || "+91-8816-279999"}`

    try {
      await sendPatientMessage({
        patient: { name: enc.patientName || patient.name, phone: enc.phone || patient.phone, email, id: targetUmr, encounterId: enc.id || patient.id },
        kind: "patient_journey",
        channels: ["email"],
        subject,
        message: body,
      })
      setSmsSentNotice(`✓ OP Journey report sent via Email to ${email}`)
    } catch {
      window.open(emailHandoffUrl(email, subject, body), "_blank")
      setSmsSentNotice(`Email client opened for ${email}`)
    }
  }

  const handleCallPatientToNurse = () => {
    const enc = dbEncounters.find((e) => e.id === patient.id || (e.umr && e.umr === patient.umr)) || (patient as any)
    const targetId = enc?.id || patient.id
    if (!targetId && !patient.umr) {
      toast.error("Please register the patient first.")
      return
    }
    if (targetId) {
      db.callToNurseStation(targetId, "OP Reception")
    }
    notifyPatientCalledToNurse(enc || patient, "OP Nurse Station", "Room 102")
    setDbEncounters(db.getEncounters())
    toast.success(`Patient ${patient.name || "OP Patient"} called to Nurse Station!`)
  }

  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [aiAnalysisResult, setAiAnalysisResult] = useState<{
    specialty: string
    confidence: number
    rationale: string
    doctors: DoctorProfileInfo[]
  } | null>(null)
  const [selectedDoctorForBooking, setSelectedDoctorForBooking] =
    useState<DoctorProfileInfo | null>(null)
  const [bookingConfirmed, setBookingConfirmed] = useState<boolean>(false)
  const [bookingPriority, setBookingPriority] =
    useState<"Standard OP Queue" | "Priority / Senior Citizen" | "Emergency Triage">(
      "Standard OP Queue",
    )
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [smsSentNotice, setSmsSentNotice] = useState<string | null>(null)
  const [showOfficialReceiptModal, setShowOfficialReceiptModal] = useState(false)
  const [cashTendered, setCashTendered] = useState<string>("")
  const [cardNumber, setCardNumber] = useState<string>("")
  const [cardExpiry, setCardExpiry] = useState<string>("")
  const [cardCvv, setCardCvv] = useState<string>("")
  const [insuranceMemberId, setInsuranceMemberId] =
    useState<string>("")

  // Real-time Clinical & Patient Notifications
  interface ActiveNotification {
    id: string
    type: "doctor" | "patient"
    title: string
    recipient: string
    message: string
    timestamp: string
    token?: string
  }

  const [activeNotifications, setActiveNotifications] =
    useState<ActiveNotification[]>([])

  const triggerDoctorNotification = (
    docName: string,
    room: string,
    patientName: string,
    token: string,
    complaint: string,
  ) => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
    const notif: ActiveNotification = {
      id: `doc-${Date.now()}`,
      type: "doctor",
      title: `🔔 Doctor EMR Alert: Next Patient Queued`,
      recipient: `${docName} (${room})`,
      message: `Incoming OP Patient: ${patientName} (Token: ${token}) is waiting in your queue for consultation. Chief Complaint: ${complaint || "Clinical evaluation"}`,
      timestamp: time,
      token: token,
    }
    setActiveNotifications((prev) => [
      notif,
      ...prev.filter((n) => n.id !== notif.id),
    ])
  }

  const triggerPatientNotification = (
    patientName: string,
    phone: string,
    docName: string,
    room: string,
    token: string,
  ) => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
    const notif: ActiveNotification = {
      id: `pat-${Date.now()}`,
      type: "patient",
      title: `📱 Patient SMS Alert: Get Ready!`,
      recipient: `${patientName} (${phone})`,
      message: `🔔 Get ready! You are UP NEXT with ${docName} in ${room}. Token: ${token}. Please proceed to Door ${room}.`,
      timestamp: time,
      token: token,
    }
    setActiveNotifications((prev) => [
      notif,
      ...prev.filter((n) => n.id !== notif.id),
    ])
  }

  // The assigned doctor's live queue: today's open OP patients for that
  // doctor, from the encounter store, in queue order.
  const doctorQueue = openQueueFor(patient.assignedDoctor, dbEncounters)
  const youQueueIdx = doctorQueue.findIndex((e) => e.id === patient.id)
  const patientsAhead = youQueueIdx >= 0 ? youQueueIdx : 0
  const currentPosition = youQueueIdx >= 0 ? youQueueIdx + 1 : 1
  const isYourTurn =
    patient.status === "Under Consultation" || (youQueueIdx === 0 && doctorQueue.length > 0)

  // Check if Doctor has already finished consultation
  const hasDoctorConsulted =
    (patient.status === "Consultation Completed" ||
      patient.status === "OP Completed") &&
    ((patient.prescription && patient.prescription.length > 0) ||
      Boolean(patient.diagnosis?.trim()))

  // Sync step if initialStep prop changes
  useEffect(() => {
    if (initialStep) {
      setCurrentStep(initialStep)
    }
  }, [initialStep])

  // Load active encounter on mount or when initialEncounterId changes
  useEffect(() => {
    const encs = refreshDb()
    if (encs.length > 0) {
      const active = initialEncounterId
        ? encs.find((e) => e.id === initialEncounterId) || encs[0]
        : encs[0]
      loadEncounterIntoWorkflow(active)
    }
    const unsub = db.subscribe(() => {
      const latestEncs = refreshDb()
      if (latestEncs.length > 0) {
        const targetId = initialEncounterId || patient.id
        const active = targetId
          ? latestEncs.find((e) => e.id === targetId) || latestEncs[0]
          : latestEncs[0]
        if (active) {
          loadEncounterIntoWorkflow(active)
        }
      }
    })
    return () => {
      unsub()
    }
  }, [initialEncounterId, patient.id])

  const isFemaleGender = (sex?: string) => {
    const s = String(sex || "")
      .toLowerCase()
      .trim()
    return s === "female" || s === "girl" || s === "f" || s === "woman"
  }

  const getTargetDoctorGender = (
    currentPatient: OPPatient,
  ): "Female" | "Male" => {
    if (currentPatient.doctorGenderPref === "Female") return "Female"
    if (currentPatient.doctorGenderPref === "Male") return "Male"
    return isFemaleGender(currentPatient.sex) ? "Female" : "Male"
  }

  const loadEncounterIntoWorkflow = (enc: DBOPEncounter) => {
    const previousEncounters = db.getEncountersForPatient(enc.umr)
    const isFemalePatient = isFemaleGender(enc.sex)
    const patientGender: "Female" | "Male" = isFemalePatient ? "Female" : "Male"
    const dept =
      enc.dept && enc.dept !== "Awaiting Triage" ? enc.dept : "General Medicine"

    // Suggest a doctor from the master for this department: same gender as
    // preferred (when the master records it), then the shortest live queue.
    const targetGender =
      enc.doctorGenderPref === "Female"
        ? "Female"
        : enc.doctorGenderPref === "Male"
          ? "Male"
          : patientGender
    const allEncounters = db.getEncounters()
    const candidates = doctorProfilesFor(dept, allEncounters).sort(
      (x, y) =>
        Number(y.gender === targetGender) - Number(x.gender === targetGender) ||
        x.workload - y.workload,
    )
    const assignedProfile = enc.assignedDoctor
      ? findDoctorProfile(enc.assignedDoctor, allEncounters)
      : null
    const currentDocObj = assignedProfile || candidates[0] || null
    const currentAssignedDoc = enc.assignedDoctor || currentDocObj?.name || ""

    const isBooked = Boolean(
      enc.assignedDoctor && enc.status && enc.status !== "Registered",
    )
    setBookingConfirmed(isBooked)
    if (enc.assignedDoctor && currentDocObj) {
      setSelectedDoctorForBooking(currentDocObj)
    }

    setPatient({
      id: enc.id,
      umr: enc.umr,
      opNumber: enc.opNumber,
      date: enc.date,
      createdAt: enc.createdAt,
      name: enc.patientName,
      age: enc.age,
      sex: enc.sex as any,
      phone: enc.phone,
      address: enc.address || "",
      isNew: enc.isNew,
      previousVisits: previousEncounters
        .filter((e) => e.id !== enc.id)
        .map((e) => ({
          opNumber: e.opNumber,
          date: (e as any).date || e.createdAt?.split("T")[0] || e.registrationTime,
          doctor: e.assignedDoctor,
          diagnosis: e.diagnosis || e.chiefComplaint,
        })),
      symptoms: enc.symptoms || [],
      chiefComplaint: enc.chiefComplaint || "",
      aiSpecialty: dept,
      aiDoctor: enc.aiDoctor || currentAssignedDoc,
      aiConfidence: enc.aiConfidence || 0,
      doctorGenderPref: enc.doctorGenderPref as any || "Any",
      assignedDoctor: currentAssignedDoc,
      doctorStatus: enc.doctorStatus || "Available",
      queueToken: enc.queueToken || `${dept.substring(0, 1)}-${enc.opNumber}`,
      queuePosition: enc.queuePosition || 0,
      room: enc.room || currentDocObj?.room || "",
      assessment: enc.assessment || "",
      diagnosis: enc.diagnosis || "",
      icd10: enc.icd10 || "",
      prescription: enc.prescription || [],
      investigations: enc.investigations || [],
      advice: enc.advice || "",
      vitals: { ...EMPTY_VITALS, ...(enc.vitals || {}) },
      billing: {
        ...EMPTY_OP_PATIENT.billing,
        ...(enc.billing || {}),
        consultationFee:
          enc.billing?.consultationFee ?? getDoctorConsultationFee(currentAssignedDoc),
      } as OPPatient["billing"],
      furtherAction: enc.furtherAction || "None",
      status: enc.status as any || "Registered",
      timestamps: enc.timestamps || {
        arrival: enc.createdAt || enc.registrationTime,
        registration: enc.createdAt || enc.registrationTime,
      },
    })
  }

  // Symptom toggling
  const toggleSymptom = (sym: string) => {
    setPatient((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(sym)
        ? prev.symptoms.filter((s) => s !== sym)
        : [...prev.symptoms, sym],
    }))
  }

  // AI Specialty & Doctor Availability Engine
  const runAiSymptomAnalysis = () => {
    setAiAnalyzing(true)
    setBookingConfirmed(false)
    setTimeout(
      () => {
        const isFemalePatient = isFemaleGender(patient.sex)
        const patientGender: "Female" | "Male" = isFemalePatient
          ? "Female"
          : "Male"

        let specialty = "General Medicine"
        let confidence = 88
        let rationale =
          "General clinical assessment and systemic evaluation based on primary presenting symptoms."

        const complaintText = (patient.chiefComplaint || "").toLowerCase()
        const symptomsStr = (
          patient.symptoms.join(" ") +
          " " +
          complaintText
        ).toLowerCase()

        // Check Pediatric conditions first (if age < 18 or pediatric clinical keywords in complaint)
        const isPediatricPatient =
          (patient.age > 0 && patient.age < 18) ||
          symptomsStr.includes("child") ||
          symptomsStr.includes("infant") ||
          symptomsStr.includes("baby") ||
          symptomsStr.includes("toddler") ||
          symptomsStr.includes("pediatric")

        if (isPediatricPatient) {
          specialty = "Pediatrics"
          confidence = 96
          rationale = `Patient profile (${
            patient.age > 0 ? `${patient.age} yrs` : "Pediatric"
          }) and presenting narrative indicate dedicated care pathway in Pediatrics.`
        } else if (
          symptomsStr.includes("chest") ||
          symptomsStr.includes("breath") ||
          symptomsStr.includes("heart") ||
          symptomsStr.includes("tightness") ||
          symptomsStr.includes("palpitation") ||
          symptomsStr.includes("angina") ||
          symptomsStr.includes("bp high") ||
          symptomsStr.includes("hypertension")
        ) {
          specialty = "Cardiology"
          confidence = 97
          rationale =
            "Symptoms of chest discomfort, cardiac risk indicators, or shortness of breath require immediate clinical assessment by Cardiology."
        } else if (
          symptomsStr.includes("bone") ||
          symptomsStr.includes("joint") ||
          symptomsStr.includes("fracture") ||
          symptomsStr.includes("back pain") ||
          symptomsStr.includes("sprain") ||
          symptomsStr.includes("knee") ||
          symptomsStr.includes("ankle") ||
          symptomsStr.includes("ligament")
        ) {
          specialty = "Orthopedics"
          confidence = 94
          rationale =
            "Musculoskeletal symptoms, joint swelling, or mechanical trauma necessitate orthopedic physical evaluation and imaging review."
        } else if (
          symptomsStr.includes("headache") ||
          symptomsStr.includes("head injury") ||
          symptomsStr.includes("seizure") ||
          symptomsStr.includes("stroke") ||
          symptomsStr.includes("paralysis") ||
          symptomsStr.includes("spine") ||
          symptomsStr.includes("brain") ||
          symptomsStr.includes("numbness")
        ) {
          specialty = "Neurosurgery"
          confidence = 95
          rationale =
            "Neurological presenting symptoms, intracranial, or spine indicators require clinical evaluation by Neurosurgery."
        } else if (
          symptomsStr.includes("stomach") ||
          symptomsStr.includes("abdominal") ||
          symptomsStr.includes("gastric") ||
          symptomsStr.includes("acidity") ||
          symptomsStr.includes("reflux") ||
          symptomsStr.includes("jaundice") ||
          symptomsStr.includes("liver")
        ) {
          specialty = "Gastroenterology"
          confidence = 93
          rationale =
            "Gastrointestinal symptoms, abdominal discomfort, or hepatic indicators require clinical evaluation by Gastroenterology."
        } else if (
          symptomsStr.includes("diabet") ||
          symptomsStr.includes("sugar") ||
          symptomsStr.includes("glucose") ||
          symptomsStr.includes("insulin")
        ) {
          specialty = "Diabetology"
          confidence = 96
          rationale =
            "Glycemic control indicators and metabolic symptoms require evaluation by Diabetology."
        } else if (
          symptomsStr.includes("ear") ||
          symptomsStr.includes("nose") ||
          symptomsStr.includes("throat") ||
          symptomsStr.includes("sinus") ||
          symptomsStr.includes("tonsil")
        ) {
          specialty = "ENT"
          confidence = 92
          rationale =
            "Ear, nose, throat presentation or sinus discomfort warrants clinical evaluation by ENT specialists."
        } else if (
          symptomsStr.includes("cough") ||
          symptomsStr.includes("wheezing") ||
          symptomsStr.includes("lung") ||
          symptomsStr.includes("asthma") ||
          symptomsStr.includes("sputum") ||
          symptomsStr.includes("phlegm") ||
          symptomsStr.includes("respiratory")
        ) {
          specialty = "Pulmonology"
          confidence = 94
          rationale =
            "Respiratory symptoms require pulmonary evaluation for airway obstruction, asthma, or lower respiratory tract assessment."
        } else if (
          symptomsStr.includes("urine") ||
          symptomsStr.includes("kidney") ||
          symptomsStr.includes("bladder")
        ) {
          specialty = "Urology"
          confidence = 93
          rationale =
            "Renal, bladder, or urinary tract complaints require clinical evaluation by Urology."
        } else if (
          symptomsStr.includes("period") ||
          symptomsStr.includes("pregnant") ||
          symptomsStr.includes("pelvic") ||
          symptomsStr.includes("gynec")
        ) {
          specialty = "Gynecology"
          confidence = 95
          rationale =
            "Obstetric and gynecological symptoms require clinical evaluation in Gynecology."
        } else {
          specialty = "General Medicine"
          confidence = 91
          rationale =
            "Acute systemic presentation (fever, malaise, or non-specific symptoms) warrants comprehensive internal medicine evaluation."
        }

        // Verified doctors for the recommended specialty, with their live queues.
        const deptDoctors: DoctorProfileInfo[] = doctorProfilesFor(specialty, db.getEncounters())

        // Sort doctors: Same gender match first, Available first, lowest workload first
        const targetGender =
          patient.doctorGenderPref === "Female"
            ? "Female"
            : patient.doctorGenderPref === "Male"
              ? "Male"
              : patientGender
        deptDoctors.sort((a, b) => {
          if (a.gender === targetGender && b.gender !== targetGender) return -1
          if (b.gender === targetGender && a.gender !== targetGender) return 1
          if (a.status === "Available" && b.status !== "Available") return -1
          if (b.status === "Available" && a.status !== "Available") return 1
          return a.workload - b.workload
        })

        const topMatchedDoctor: DoctorProfileInfo | undefined = deptDoctors[0]

        setAiAnalysisResult({
          specialty,
          confidence,
          rationale,
          doctors: deptDoctors,
        })

        setSelectedDoctorForBooking(topMatchedDoctor || null)

        setPatient((prev) => ({
          ...prev,
          aiSpecialty: specialty,
          aiConfidence: confidence,
          aiReasoning: rationale,
          aiDoctor: topMatchedDoctor?.name || "",
        }))

        setAiAnalyzing(false)
      },
      600,
    )
  }

  // Nurse Manual Appointment Booking Handler
  const handleNurseBookAppointment = (chosenDoc?: DoctorProfileInfo) => {
    const docToBook = chosenDoc || selectedDoctorForBooking
    if (!docToBook) {
      window.alert("No verified doctor is available to book. Add doctors in the doctor master first.")
      return
    }
    const specialty = docToBook.specialty
    const assignedDoc = docToBook.name
    const assignedRoom = docToBook.room
    const queueToken = `${specialty.substring(0, 1)}-${patient.opNumber}`
    const queuePos =
      docToBook.status === "Available" ? 1 : docToBook.workload + 1
    const docRationale = `Nurse confirmed appointment booking with ${assignedDoc} (${docToBook.workload} active in queue, ${assignedRoom}) for ${specialty}.`

    const nowTime = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })

    setPatient((prev) => ({
      ...prev,
      aiSpecialty: specialty,
      aiDoctor: assignedDoc,
      assignedDoctor: assignedDoc,
      room: assignedRoom,
      doctorStatus: docToBook.status as any,
      queueToken: queueToken,
      queuePosition: queuePos,
      aiDoctorRationale: docRationale,
      status: "Doctor Assigned" as const,
      timestamps: {
        ...prev.timestamps,
        doctorAssigned: nowTime,
      },
    }))

    setBookingConfirmed(true)

    if (patient.id) {
      try {
        db.updateEncounter(patient.id, {
          dept: specialty,
          assignedDoctor: assignedDoc,
          room: assignedRoom,
          doctorStatus: docToBook.status as any,
          queueToken: queueToken,
          queuePosition: queuePos,
          chiefComplaint: patient.chiefComplaint,
          symptoms: patient.symptoms,
          status: "Doctor Assigned",
          timestamps: {
            ...patient.timestamps,
            doctorAssigned: nowTime,
          },
        })
      } catch (e) {
        console.warn("DB update failed:", e)
      }
    }

    // 1. Dispatch real-time alert to Doctor Portal EMR queue
    triggerDoctorNotification(
      assignedDoc,
      assignedRoom,
      patient.name,
      queueToken,
      patient.chiefComplaint || patient.symptoms.join(", "),
    )

    // 2. Dispatch Patient SMS & WhatsApp notification immediately
    triggerPatientNotification(
      patient.name,
      patient.phone,
      assignedDoc,
      assignedRoom,
      queueToken,
    )
    notifyAppointmentBooked({
      encounterId: patient.id || "",
      name: patient.name,
      umr: patient.umr,
      phone: patient.phone,
      doctor: assignedDoc,
      dept: specialty,
      room: assignedRoom,
      token: queueToken,
      time: nowTime,
    })
  }

  // Doctor assignment & Queue
  const assignDoctorAndQueue = (doc: DoctorProfileInfo) => {
    const isDocAvailable = doc.status === "Available"
    const queueToken = `${doc.specialty.substring(0, 1)}-${patient.opNumber}`
    const queuePos = isDocAvailable ? 1 : doc.workload + 1
    const newStatus = isDocAvailable ? "Doctor Assigned" : "In Queue"

    setPatient((prev) => ({
      ...prev,
      assignedDoctor: doc.name,
      doctorStatus: doc.status as any,
      room: doc.room,
      queueToken: queueToken,
      queuePosition: queuePos,
      status: newStatus as any,
      timestamps: {
        ...prev.timestamps,
        doctorAssigned: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    }))

    if (patient.id) {
      try {
        db.updateEncounter(patient.id, {
          assignedDoctor: doc.name,
          doctorStatus: doc.status as any,
          room: doc.room,
          queueToken: queueToken,
          queuePosition: queuePos,
          status: newStatus as any,
        })
        notifyAppointmentBooked({
          encounterId: patient.id,
          name: patient.name,
          umr: patient.umr,
          phone: patient.phone,
          doctor: doc.name,
          dept: doc.specialty || patient.aiSpecialty || "General Medicine",
          room: doc.room,
          token: queueToken,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        })
      } catch (e) {
        console.warn("DB update failed:", e)
      }
    }
  }

  /**
   * Reception's three jobs: register the patient, book the doctor, take payment.
   *
   * Each visible step covers one or more internal panels, so the desk sees three
   * things to do rather than a six-stage clinical pathway it is not responsible
   * for. Booking is one job even though it is two panels -- symptom triage picks
   * the specialty and the allocation panel confirms the doctor and queue token --
   * and the read-only consultation summary sits inside Billing, which is where
   * reception needs it: it is the itemisation of what they are about to charge for.
   *
   * Vitals are not here at all; the OP nurse records those at the Nurse Station
   * after reception is done. Nor is the consultation: the doctor writes that in
   * their own workspace, and the prescription is split to pharmacy and the lab
   * from there (`consultationDispatch.ts`).
   */
  const steps = [
    { nums: [1], label: "Registration", shortLabel: "Register" },
    { nums: [2, 4], label: "Doctor Appointment", shortLabel: "Appointment" },
    { nums: [5, 6], label: "Billing", shortLabel: "Billing" },
  ]

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F0F2F5]">
      {/* Clinical Workflow Header */}
      <div className="bg-white border-b border-[#DDE2EC] px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0 no-print print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-gray-900">
              Reception — Outpatient Desk
            </h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-[#1B4FD8] border border-blue-200">
              Active OP Pathway
            </span>
          </div>
          <p className="text-[11.5px] text-[#64748B]">
            Register the patient, book their doctor, take payment. Vitals are
            recorded by the OP nurse afterwards; the consultation is the
            doctor&apos;s own workspace.
          </p>
        </div>

        {/* Quick Patient Selector & Handheld Barcode Scanner */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-[#CBD5E1] px-2.5 py-1.5 rounded shadow-2xs">
            <span className="text-gray-500 text-[13px]">🏷️</span>
            <input
              type="text"
              placeholder="Scan OP Barcode / UMR..."
              title="Scan patient card barcode or press Enter"
              className="w-48 text-[12px] font-mono focus:outline-none placeholder:text-gray-400"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.currentTarget.value || "").trim().toUpperCase()
                  if (val) {
                    const match = dbEncounters.find(
                      (enc) =>
                        enc.umr?.toUpperCase() === val ||
                        enc.opNumber?.toUpperCase() === val ||
                        enc.id === val,
                    )
                    if (match) {
                      loadEncounterIntoWorkflow(match)
                      setSelectedJourneyEncounter(match)
                      e.currentTarget.value = ""
                    } else {
                      alert(`No outpatient record found for barcode: ${val}`)
                    }
                  }
                }
              }}
            />
          </div>

          <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] px-3.5 py-1.5 rounded text-[12px]">
            <span className="text-[#64748B] font-medium whitespace-nowrap">
              Active Encounter:
            </span>
            <select
              value={patient.id || ""}
              onChange={(e) => {
                const found = dbEncounters.find(
                  (enc) => enc.id === e.target.value,
                )
                if (found) {
                  loadEncounterIntoWorkflow(found)
                }
              }}
              className="font-semibold text-gray-900 bg-transparent border-none focus:outline-none cursor-pointer text-[12.5px]"
            >
              {dbEncounters.map((enc) => (
                <option key={enc.id} value={enc.id}>
                  {enc.patientName} ({enc.umr} · {enc.opNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Actions for OP Journey & Card */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                const match = dbEncounters.find(
                  (enc) => enc.id === patient.id || (enc.umr && enc.umr === patient.umr),
                )
                if (match) {
                  setSelectedJourneyEncounter(match)
                } else if (patient.umr) {
                  openJourneyForCode(cardBarcodeValue(patient.umr))
                }
              }}
              className="px-3 py-1.5 bg-[#1B4FD8] hover:bg-blue-700 text-white text-[12px] font-bold rounded cursor-pointer flex items-center gap-1.5 whitespace-nowrap shadow-xs transition-colors"
              title="View complete OP Journey & Card with WhatsApp, Mail and PDF send"
            >
              <span>🧭</span> OP Journey &amp; Card
            </button>
            <button
              type="button"
              onClick={() => handleSendJourneyWhatsApp()}
              className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-[12px] font-bold rounded cursor-pointer flex items-center gap-1 whitespace-nowrap transition-colors"
              title="Send OP Journey Summary to Patient via WhatsApp"
            >
              <span>💬</span> WhatsApp
            </button>
            <button
              type="button"
              onClick={() => handleSendJourneyEmail()}
              className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-800 text-[12px] font-bold rounded cursor-pointer flex items-center gap-1 whitespace-nowrap transition-colors"
              title="Send OP Journey Report to Patient via Email"
            >
              <span>✉️</span> Mail
            </button>
            <button
              type="button"
              onClick={() => {
                const match = dbEncounters.find(
                  (enc) => enc.id === patient.id || (enc.umr && enc.umr === patient.umr),
                )
                setPrintJourneyEncounter(match || null)
              }}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-[12px] font-semibold rounded cursor-pointer flex items-center gap-1 whitespace-nowrap shadow-2xs"
              title="Open clean publication-grade A4 Print Preview"
            >
              <span>📄</span> Print Journey
            </button>
            <button
              type="button"
              onClick={() =>
                printOpCard(
                  opCardDataFor(patient.umr, {
                    patientName: patient.name,
                    age: patient.age,
                    sex: patient.sex,
                    phone: patient.phone,
                  }),
                  branding,
                )
              }
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-[12px] font-semibold rounded cursor-pointer flex items-center gap-1 whitespace-nowrap shadow-2xs"
              title="Print physical ID card size OP Card"
            >
              <span>🪪</span> Print Card
            </button>
          </div>
        </div>
      </div>

      {/* Stepper Progress Bar */}
      <div className="bg-[#0C1524] px-6 py-3 border-b border-[#1E2D42] flex items-center justify-between flex-shrink-0 no-print print:hidden">
        <div className="flex items-center gap-1 sm:gap-2 w-full justify-between">
          {steps.map((s, idx) => {
            const isCurrent = s.nums.includes(currentStep)
            const isCompleted = !isCurrent && currentStep > Math.max(...s.nums)
            return (
              <React.Fragment key={s.label}>
                <div
                  onClick={() => setCurrentStep(s.nums[0])}
                  className={`flex items-center gap-2 cursor-pointer transition-all ${
                    isCurrent
                      ? "text-white font-semibold"
                      : isCompleted
                        ? "text-[#93C5FD]"
                        : "text-[#64748B]"
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold font-mono transition-colors ${
                      isCurrent
                        ? "bg-[#1B59F8] text-white ring-2 ring-blue-400/50"
                        : isCompleted
                          ? "bg-[#16A34A] text-white"
                          : "bg-white/10 text-[#94A3B8]"
                    }`}
                  >
                    {isCompleted ? "✓" : idx + 1}
                  </div>
                  <span className="text-[12px] hidden md:inline">
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 rounded ${
                      isCompleted ? "bg-[#16A34A]" : "bg-white/10"
                    }`}
                  />
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* ── FLOATING LIVE DUAL-CHANNEL NOTIFICATION TOASTS ── */}
      {activeNotifications.length > 0 && (
        <div className="fixed top-20 right-6 z-50 flex flex-col gap-3 max-w-md w-full pointer-events-none animate-in fade-in">
          {activeNotifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-4 rounded shadow-xl border-2 pointer-events-auto transition-all duration-300 ${
                notif.type === "doctor"
                  ? "bg-[#0F172A] border-[#3B82F6] text-white ring-2 ring-blue-500/20"
                  : "bg-[#064E3B] border-[#10B981] text-white ring-2 ring-emerald-500/20"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded flex items-center justify-center text-base font-bold shadow-xs ${
                      notif.type === "doctor"
                        ? "bg-[#2563EB] text-white"
                        : "bg-[#059669] text-white"
                    }`}
                  >
                    {notif.type === "doctor" ? "👨‍⚕️" : "📱"}
                  </div>
                  <div>
                    <div className="font-bold text-[13px] flex items-center gap-2">
                      <span>{notif.title}</span>
                      <span
                        className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                          notif.type === "doctor"
                            ? "bg-blue-800 text-blue-200"
                            : "bg-emerald-800 text-emerald-200"
                        }`}
                      >
                        {notif.type === "doctor"
                          ? "DOCTOR TERMINAL"
                          : "PATIENT SMS"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5 font-medium">
                      Recipient:{" "}
                      <strong className="text-white">{notif.recipient}</strong>
                    </div>
                    <div className="text-[12px] text-slate-100 mt-2 bg-white/10 p-2.5 rounded leading-relaxed border border-white/10">
                      {notif.message}
                    </div>
                    <div className="text-[10.5px] text-slate-400 mt-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        Dispatched at {notif.timestamp}
                      </span>
                      {notif.token && (
                        <span className="font-mono text-white font-bold">
                          {notif.token}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setActiveNotifications((prev) =>
                      prev.filter((n) => n.id !== notif.id),
                    )
                  }
                  className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main Step Workspace */}
      <div className="flex-1 overflow-y-auto p-6 w-full space-y-6">
        {/* ── STEP 1: DIGITAL OP BOOK & PASS ─────────────────────────── */}
        {currentStep === 1 && (
          <div className="bg-white border border-[#DDE2EC] rounded p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-[#1B4FD8] text-white text-[12px] flex items-center justify-center font-bold">
                    1
                  </span>
                  OP Card
                </h2>
                <p className="text-[12px] text-[#64748B] mt-0.5">
                  One card for life (UMR <strong>{patient.umr}</strong>), valid at
                  every department. This visit is <strong>{patient.opNumber}</strong>.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() =>
                    printOpCard(
                      opCardDataFor(patient.umr, {
                        patientName: patient.name,
                        age: patient.age,
                        sex: patient.sex,
                        phone: patient.phone,
                      }),
                      branding,
                    )
                  }
                  className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-[#CBD5E1] text-gray-800 text-[12px] font-semibold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Icon.Download /> Print OP Card
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const cardMsg =
                      `🏥 *${branding.hospitalName.toUpperCase()}*\n` +
                      `*Digital OP Card & Registration Slip*\n\n` +
                      `👤 *Patient:* ${patient.name}\n` +
                      `🆔 *Permanent UMR:* ${patient.umr}\n` +
                      `📋 *Active Visit:* ${patient.opNumber}\n` +
                      `👨‍⚕️ *Consultant:* ${patient.assignedDoctor || "Unassigned"}\n\n` +
                      `Present this card or UMR at the reception or nurse station during your visit.\n` +
                      `Helpline: ${branding.helpline || "+91-8816-279999"}`;
                    try {
                      await sendPatientMessage({
                        patient: { name: patient.name, phone: patient.phone, id: patient.umr, encounterId: patient.id },
                        kind: "op_registered",
                        channels: ["whatsapp"],
                        message: cardMsg,
                      });
                      setSmsSentNotice(`✓ OP Card sent via WhatsApp to ${patient.phone}`);
                    } catch {
                      window.open(whatsAppHandoffUrl(patient.phone, cardMsg), "_blank");
                      setSmsSentNotice(`WhatsApp opened with OP Card for ${patient.phone}`);
                    }
                  }}
                  className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-[12px] font-semibold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Send OP Card via WhatsApp"
                >
                  <span>💬</span> WhatsApp
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    let email = patient.email || "";
                    if (!email) {
                      email = window.prompt("Enter patient email to send OP Card:", "") || "";
                    }
                    if (!email || !email.includes("@")) return;
                    const cardMsg =
                      `Dear ${patient.name},\n\n` +
                      `Here are your OP registration details at ${branding.hospitalName}:\n\n` +
                      `Permanent UMR: ${patient.umr}\n` +
                      `Visit OP Number: ${patient.opNumber}\n` +
                      `Doctor: ${patient.assignedDoctor || "Unassigned"}\n` +
                      `Date: ${patient.date || new Date().toLocaleDateString()}\n\n` +
                      `Keep your UMR safe for future visits.\n` +
                      `Warm regards,\n${branding.hospitalName}`;
                    try {
                      await sendPatientMessage({
                        patient: { name: patient.name, phone: patient.phone, email, id: patient.umr, encounterId: patient.id },
                        kind: "op_registered",
                        channels: ["email"],
                        message: cardMsg,
                      });
                      setSmsSentNotice(`✓ OP Card sent via Email to ${email}`);
                    } catch {
                      window.open(emailHandoffUrl(email, `${branding.hospitalName} - OP Card (${patient.umr})`, cardMsg), "_blank");
                    }
                  }}
                  className="px-3.5 py-2 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-800 text-[12px] font-semibold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Send OP Card via Email"
                >
                  <span>✉️</span> Mail
                </button>

                <SendToPatientButton
                  patient={{
                    name: patient.name,
                    phone: patient.phone,
                    email: patient.email,
                    id: patient.umr,
                    encounterId: patient.id,
                  }}
                  kind="op_registered"
                  label="Share Card"
                  className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-300 text-[#1B4FD8] text-[12px] font-semibold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 py-2">
              <OpCardPreview
                card={opCardDataFor(patient.umr, {
                  patientName: patient.name,
                  age: patient.age,
                  sex: patient.sex,
                  phone: patient.phone,
                })}
                branding={branding}
              />
              <button
                type="button"
                onClick={() => openJourneyForCode(cardBarcodeValue(patient.umr))}
                className="text-[12px] font-semibold text-[#1B4FD8] hover:underline cursor-pointer"
              >
                Open patient record (same as scanning the card) →
              </button>
            </div>

            {/* Previous visits stay on screen for the desk; they are not printed on the card. */}
            {patient.previousVisits && patient.previousVisits.length > 0 && (
              <div className="max-w-xl mx-auto bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2.5 text-[11px]">
                <div className="text-[#64748B] font-bold mb-1">
                  Previous OP visits for {patient.umr}
                </div>
                <div className="space-y-1">
                  {patient.previousVisits.map((pv, i) => (
                    <div key={i} className="flex justify-between text-[#475569]">
                      <span>
                        • {pv.date} ({pv.opNumber}): {pv.diagnosis}
                      </span>
                      <span className="text-[#64748B] font-medium">{pv.doctor}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleCallPatientToNurse}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-bold rounded transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                title="Call patient to the nurse station for triage and baseline vitals recording"
              >
                <span>🩺</span>
                <span>Call Patient to Nurse Station</span>
              </button>
              <button
                onClick={() => setCurrentStep(2)}
                className="px-5 py-2.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12.5px] font-semibold rounded transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer ml-auto"
              >
                Proceed to Clinical Triage &amp; AI Analysis →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: SYMPTOM CAPTURE & AI SPECIALTY MATCH ─────────────── */}
        {currentStep === 2 && (
          <div className="bg-white border border-[#DDE2EC] rounded p-6 space-y-6">
            <div>
              <div className="border-b border-[#DDE2EC] pb-3 mb-4">
                <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-[#1B4FD8] text-white text-[12px] flex items-center justify-center font-bold">
                    2
                  </span>
                  Clinical Symptom Triage &amp; Specialty Doctor Allocation
                </h2>
                <p className="text-[12px] text-[#64748B] mt-0.5">
                  Input patient presenting symptoms or chief complaint to run AI
                  clinical triage, recommend the target specialty, and allocate
                  from our 30 verified attending doctors.
                </p>
              </div>
            </div>

            {/* Chief Complaint Input */}
            <div>
              <label className="text-[11.5px] font-semibold text-gray-700 block mb-1.5">
                Chief Complaint / Presenting Narrative
              </label>
              <textarea
                value={patient.chiefComplaint}
                onChange={(e) =>
                  setPatient({ ...patient, chiefComplaint: e.target.value })
                }
                placeholder="e.g. Patient complaining of severe chest tightness and shortness of breath since yesterday morning..."
                className="w-full h-20 border border-[#DDE2EC] rounded p-3 text-[13px] focus:outline-none focus:border-[#1B4FD8]"
              />
            </div>

            {/* Quick Symptom Checkboxes */}
            <div>
              <label className="text-[11.5px] font-semibold text-gray-700 block mb-2">
                Select Common Symptoms (Multi-select)
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  "Fever",
                  "Headache",
                  "Chest pain",
                  "Breathing difficulty",
                  "Sweating",
                  "Cough",
                  "Abdominal pain",
                  "Back pain",
                  "Joint swelling",
                  "Vomiting",
                  "Dizziness",
                  "Fatigue",
                ].map((sym) => {
                  const active = patient.symptoms.includes(sym)
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => toggleSymptom(sym)}
                      className={`px-3 py-1.5 rounded text-[12px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? "bg-[#1B4FD8] text-white border-[#1B4FD8] shadow-xs"
                          : "bg-white text-gray-700 border-[#DDE2EC] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {active ? "✓ " : "+ "} {sym}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Autonomous AI Patient Profile Bar */}
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-100 text-[#1B4FD8] flex items-center justify-center font-bold text-[14px]">
                  {patient.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-[12.5px] font-bold text-gray-900 flex items-center gap-2">
                    <span>{patient.name}</span>
                    <span className="text-[#64748B] font-medium text-[11.5px]">
                      ({patient.age} yrs)
                    </span>
                    <span
                      className={`font-mono text-[11px] px-2 py-0.5 rounded border font-bold ${
                        isFemaleGender(patient.sex)
                          ? "bg-pink-50 text-pink-700 border-pink-200"
                          : "bg-blue-50 text-[#1B4FD8] border-blue-200"
                      }`}
                    >
                      {patient.sex}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse"></span>
                    <span>
                      AI Autonomous Triage Protocol: Analyzes chief complaint
                      narrative and auto-assigns matching attending doctor.
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap self-start sm:self-auto">
                <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded">
                  <span className="text-[11px]">✨</span>
                  <span className="text-[11px] font-semibold text-[#1B4FD8]">
                    AI Triage
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const match = dbEncounters.find(
                      (enc) => enc.id === patient.id || (enc.umr && enc.umr === patient.umr),
                    )
                    setSelectedJourneyEncounter(match || (patient as any))
                  }}
                  className="px-2.5 py-1 bg-[#1B4FD8] hover:bg-blue-700 text-white text-[11.5px] font-bold rounded shadow-2xs flex items-center gap-1 cursor-pointer transition-colors"
                  title="View full interactive OP Journey & Card"
                >
                  <span>🧭</span> OP Journey &amp; Card
                </button>
                <button
                  type="button"
                  onClick={() => handleSendJourneyWhatsApp()}
                  className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                  title="Send OP Journey via WhatsApp"
                >
                  <span>💬</span> WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => handleSendJourneyEmail()}
                  className="px-2 py-1 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-800 text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                  title="Send OP Journey via Email"
                >
                  <span>✉️</span> Mail
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const match = dbEncounters.find(
                      (enc) => enc.id === patient.id || (enc.umr && enc.umr === patient.umr),
                    )
                    setPrintJourneyEncounter(match || null)
                  }}
                  className="px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Open clean A4 Print Preview for OP Journey"
                >
                  <span>📄</span> Print Journey
                </button>
                <button
                  type="button"
                  onClick={() =>
                    printOpCard(
                      opCardDataFor(patient.umr, {
                        patientName: patient.name,
                        age: patient.age,
                        sex: patient.sex,
                        phone: patient.phone,
                      }),
                      branding,
                    )
                  }
                  className="px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Print physical ID card size OP Card"
                >
                  <span>🪪</span> Print Card
                </button>
              </div>
            </div>

            {/* Run AI Analysis Button */}
            <div className="flex justify-center pt-2">
              <button
                onClick={runAiSymptomAnalysis}
                disabled={
                  aiAnalyzing ||
                  (patient.symptoms.length === 0 && !patient.chiefComplaint)
                }
                className="px-7 py-3 bg-gradient-to-r from-[#1E3A8A] to-[#1B4FD8] hover:from-[#1E40AF] hover:to-[#2563EB] text-white text-[13px] font-semibold rounded shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {aiAnalyzing ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>✨</span>
                )}
                {aiAnalyzing
                  ? "Analyzing Symptoms with Clinical AI Engine..."
                  : "Run AI Specialty & Doctor Recommendation"}
              </button>
            </div>

            {/* AI Recommendation & Available Doctors Selection for Nurse Booking */}
            {aiAnalysisResult && (
              <div className="space-y-5 animate-in fade-in">
                {/* 1. Clinical AI Triage & Specialty Recommendation Cards */}
                <div className="bg-[#F8FAFC] border-2 border-[#93C5FD] rounded-none p-5 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider bg-[#1D4ED8] text-white px-2.5 py-1 rounded">
                        ✨ Clinical AI Triage Engine
                      </span>
                      <span className="text-[12px] font-semibold text-[#1E3A8A] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                        Confidence: {aiAnalysisResult.confidence}% Match
                      </span>
                    </div>
                    <span className="text-[11.5px] font-medium text-[#64748B]">
                      Primary Speciality Match:{" "}
                      <strong className="text-[#1B4FD8] font-bold">
                        {aiAnalysisResult.specialty}
                      </strong>
                    </span>
                  </div>

                  <div className="bg-white p-4 rounded border border-[#E2E8F0] space-y-1.5">
                    <div className="text-[11px] uppercase font-bold text-[#64748B] tracking-wider flex items-center gap-1.5">
                      <span>🏥</span> Recommended Medical Specialty &amp;
                      Clinical Rationale
                    </div>
                    <div className="text-[17px] font-bold text-[#1B4FD8] flex items-center gap-2">
                      <span>{aiAnalysisResult.specialty}</span>
                      <span className="text-[11px] font-normal text-[#64748B] bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {aiAnalysisResult.doctors.length} Doctors on duty
                      </span>
                    </div>
                    <div className="text-[12.5px] text-gray-700 leading-relaxed pt-1">
                      {aiAnalysisResult.rationale}
                    </div>
                  </div>

                  {/* 2. Available Doctors Board according to Specialty and Availability */}
                  <div className="space-y-3 pt-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                      <div>
                        <h3 className="text-[13.5px] font-bold text-gray-900 flex items-center gap-2">
                          <span>👨‍⚕️</span> Available Doctors in{" "}
                          {aiAnalysisResult.specialty} (Sorted by Availability
                          &amp; Queue)
                        </h3>
                        <p className="text-[11.5px] text-[#64748B]">
                          Review attending doctors and their live OPD queues.
                          Select a doctor to manually book the appointment.
                        </p>
                      </div>
                      <span className="text-[11px] text-[#1B4FD8] font-semibold bg-blue-50 border border-blue-200 px-2.5 py-1 rounded self-start sm:self-auto">
                        Live Availability Status
                      </span>
                    </div>

                    {aiAnalysisResult.doctors.length === 0 ? (
                      <div className="p-6 bg-amber-50 border-2 border-amber-200 rounded text-center space-y-2">
                        <div className="text-3xl">👨‍⚕️</div>
                        <div className="text-[13.5px] font-bold text-amber-900">
                          No Doctor Staff Registered
                        </div>
                        <div className="text-[12px] text-amber-800 max-w-md mx-auto leading-relaxed">
                          There are currently no verified doctors registered in the hospital system for this specialty. Please add doctors in <strong>Administration &rarr; Doctor Master</strong> to enable doctor allocation and queue booking.
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {aiAnalysisResult.doctors.map((doc, idx) => {
                        const isSelected =
                          selectedDoctorForBooking?.id === doc.id
                        const isPrimaryMatch = idx === 0
                        const isAvailable = doc.status === "Available"

                        return (
                          <div
                            key={doc.id}
                            onClick={() => setSelectedDoctorForBooking(doc)}
                            className={`p-4 rounded-lg border-2 transition-all cursor-pointer relative flex flex-col justify-between gap-3 ${
                              isSelected
                                ? "border-[#1B4FD8] bg-blue-50/50 shadow-sm ring-2 ring-blue-500/20"
                                : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1] hover:bg-slate-50/50"
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold ${
                                      isSelected
                                        ? "bg-[#1B4FD8] text-white"
                                        : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {doc.gender === "Female" ? "👩‍⚕️" : "👨‍⚕️"}
                                  </div>
                                  <div>
                                    <div className="text-[13.5px] font-bold text-gray-900 flex items-center gap-2">
                                      <span>{doc.name}</span>
                                      <span
                                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                          doc.gender === "Female"
                                            ? "bg-pink-50 text-pink-700 border-pink-200"
                                            : "bg-blue-50 text-blue-700 border-blue-200"
                                        }`}
                                      >
                                        {doc.gender}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[#64748B] font-medium">
                                      {doc.qualifications} · {doc.specialty}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                  <span
                                    className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                      isAvailable
                                        ? "bg-green-100 text-green-800 border border-green-200"
                                        : "bg-amber-100 text-amber-800 border border-amber-200"
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        isAvailable
                                          ? "bg-green-600 animate-pulse"
                                          : "bg-amber-600"
                                      }`}
                                    ></span>
                                    {doc.status}
                                  </span>
                                </div>
                              </div>

                              {/* Badges / Rationale */}
                              {isPrimaryMatch && (
                                <div className="mb-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-2 py-0.5 rounded shadow-xs">
                                    ✨ AI Recommended Match (Shortest Queue)
                                  </span>
                                </div>
                              )}

                              {/* Availability Details Grid */}
                              <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded border border-slate-200 text-[11px] text-[#475569] mt-2">
                                <div>
                                  <span className="text-[#64748B] block text-[9.5px] uppercase font-bold">
                                    Room
                                  </span>
                                  <strong className="text-gray-900 font-semibold">
                                    {doc.room}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block text-[9.5px] uppercase font-bold">
                                    Queue Workload
                                  </span>
                                  <strong
                                    className={
                                      doc.workload <= 1
                                        ? "text-green-700 font-semibold"
                                        : "text-amber-700 font-semibold"
                                    }
                                  >
                                    {doc.workload} waiting
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block text-[9.5px] uppercase font-bold">
                                    Next Slot
                                  </span>
                                  <strong className="text-gray-900 font-semibold">
                                    {doc.nextSlot}
                                  </strong>
                                </div>
                              </div>
                            </div>

                            {/* Card Footer / Select Indicator */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-[11.5px]">
                              <span className="text-[#64748B] text-[11px]">
                                🕒 OPD Timings: <strong>{doc.timing}</strong>
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedDoctorForBooking(doc)
                                }}
                                className={`px-3 py-1 rounded text-[11.5px] font-semibold transition-all cursor-pointer ${
                                  isSelected
                                    ? "bg-[#1B4FD8] text-white shadow-xs"
                                    : "bg-white border border-[#CBD5E1] text-gray-700 hover:border-[#1B4FD8] hover:text-[#1B4FD8]"
                                }`}
                              >
                                {isSelected ? "✓ Selected" : "Select Doctor"}
                              </button>
                            </div>
                          </div>
                        )
                        })}
                      </div>
                    )}
                  </div>

                  {/* 3. Nurse Manual Booking Action Panel */}
                  {!bookingConfirmed && selectedDoctorForBooking && (
                    <div className="bg-[#EFF6FF] border-2 border-[#60A5FA] rounded-none p-4 space-y-3.5 mt-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-200/80 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#1B4FD8] text-white flex items-center justify-center font-bold text-[14px]">
                            👩‍⚕️
                          </div>
                          <div>
                            <div className="text-[13px] font-bold text-gray-900">
                              Nurse Manual Appointment Booking Station
                            </div>
                            <div className="text-[11.5px] text-[#475569]">
                              Patient: <strong>{patient.name}</strong> (
                              {patient.umr}) · Selected Doctor:{" "}
                              <strong>{selectedDoctorForBooking.name}</strong> (
                              {selectedDoctorForBooking.room})
                            </div>
                          </div>
                        </div>

                        {/* Priority Selector */}
                        <div className="flex items-center gap-2 self-start sm:self-auto">
                          <label className="text-[11px] font-bold text-[#475569]">
                            Priority:
                          </label>
                          <select
                            value={bookingPriority}
                            onChange={(e) =>
                              setBookingPriority(e.target.value as any)
                            }
                            className="bg-white border border-blue-300 rounded px-2.5 py-1 text-[11.5px] font-semibold text-gray-800 focus:outline-none focus:border-[#1B4FD8]"
                          >
                            <option value="Standard OP Queue">
                              Standard OP Queue
                            </option>
                            <option value="Priority / Senior Citizen">
                              Priority / Senior Citizen
                            </option>
                            <option value="Emergency Triage">
                              Urgent Triage Consultation
                            </option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <div className="text-[11.5px] text-[#1E40AF]">
                          <span>
                            ℹ️ Confirming will issue a live Queue Token, register
                            the visit in{" "}
                            <strong>
                              {selectedDoctorForBooking.specialty}
                            </strong>
                            , and send the encounter directly to{" "}
                            <strong>
                              Dr. {selectedDoctorForBooking.name}'s Doctor
                              Portal
                            </strong>
                            .
                          </span>
                        </div>

                        <button
                          onClick={() =>
                            handleNurseBookAppointment(selectedDoctorForBooking)
                          }
                          className="px-6 py-2.5 bg-[#16A34A] hover:bg-[#15803D] text-white text-[13px] font-bold rounded shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                        >
                          <span>👩‍⚕️</span> Book Appointment with{" "}
                          {selectedDoctorForBooking.name} →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. Booked Appointment & Dispatched Success Box */}
            {(bookingConfirmed ||
              (patient.status !== "Registered" && patient.assignedDoctor)) && (
              <div className="space-y-4 animate-in fade-in">
                {/* Appointment Booked & Queue Success Banner */}
                <div className="bg-[#F0FDF4] border-2 border-[#86EFAC] rounded-none p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-green-200/80 pb-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-[#16A34A] text-white flex items-center justify-center text-lg font-bold shadow-xs">
                        ✓
                      </div>
                      <div>
                        <div className="font-bold text-[15px] text-[#166534] flex items-center gap-2 flex-wrap">
                          <span>Doctor appointment booked</span>
                          <span className="text-[10.5px] font-mono font-bold bg-[#16A34A] text-white px-2 py-0.5 rounded">
                            CONFIRMED &amp; DISPATCHED TO DOCTOR PORTAL
                          </span>
                        </div>
                        <div className="text-[12.5px] text-[#15803D] mt-0.5">
                          Appointment confirmed with{" "}
                          <strong>{patient.assignedDoctor}</strong> (
                          {patient.room}) in{" "}
                          <strong>{patient.aiSpecialty}</strong>.
                        </div>
                      </div>
                    </div>

                    {/* Direct Actions: doctor allocation, or jump to the portal */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleCallPatientToNurse}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-bold rounded shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        title="Call patient to the nurse station for triage vitals"
                      >
                        <span>🩺</span> Call to Nurse Station
                      </button>
                      {onOpenDoctorPortal && (
                        <button
                          onClick={() => onOpenDoctorPortal(patient.id)}
                          className="px-4 py-2.5 bg-white hover:bg-slate-50 text-[#1B4FD8] border border-[#1B4FD8] text-[12.5px] font-semibold rounded shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>👨‍⚕️</span> View in Doctor Portal
                        </button>
                      )}
                      <button
                        onClick={() => setCurrentStep(4)}
                        className="px-5 py-2.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold rounded shadow-md transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <span>🩺</span> Proceed to Doctor &amp; Queue Allocation
                        →
                      </button>
                    </div>
                  </div>

                  {/* Live Queue Ticket Card with Dynamic Queue Estimation */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded border border-green-200 text-[12px]">
                    <div>
                      <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                        Queue Token
                      </span>
                      <span className="font-mono font-bold text-[16px] text-[#1B4FD8]">
                        {patient.queueToken}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                        Live Queue Position
                      </span>
                      <span className="font-bold text-[15px] text-[#D97706]">
                        Position #{patient.queuePosition}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                        Assigned Room
                      </span>
                      <span className="font-bold text-[14px] text-gray-900">
                        {patient.room}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                        Estimated Queue Time
                      </span>
                      <span className="font-semibold text-[#16A34A] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        ~5-10 mins (Calculated from Queue)
                      </span>
                    </div>
                  </div>

                  {/* Doctor Portal Integration & SMS Alerts */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px]">
                    <div className="bg-[#F8FAFC] border border-green-200/80 px-3.5 py-2 rounded text-[#166534] flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span>🔔</span>
                        <span>
                          <strong>Doctor Portal EMR:</strong> Encounter active
                          in <strong>{patient.assignedDoctor}</strong>'s waiting
                          queue.
                        </span>
                      </span>
                      <span className="text-[10px] font-mono font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        EMR SYNCED
                      </span>
                    </div>

                    <div className="bg-[#F8FAFC] border border-green-200/80 px-3.5 py-2 rounded text-[#166534] flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span>📱</span>
                        <span>
                          <strong>Patient SMS:</strong> Notification scheduled
                          for{" "}
                          <strong>{patient.phone || "registered phone"}</strong>
                          .
                        </span>
                      </span>
                      <span className="text-[10px] font-mono font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        SMS READY
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: PRE-CONSULTATION NURSE TRIAGE & VITALS STATION ── */}
        {/* Vitals are not recorded here. Reception registers, triages and
            allocates the doctor; the patient then walks to the OP department,
            where the nurse takes baseline observations at the Nurse Station
            (`NurseStation.tsx`) and only then hands them to the consulting room.
            Keeping a second vitals form on the reception journey meant two
            screens writing the same field, with no way to tell which one the
            doctor was looking at. */}

        {/* ── STEP 4: DOCTOR & LIVE QUEUE ALLOCATION ─────────────────── */}
        {currentStep === 4 && (
          <div className="bg-white border border-[#DDE2EC] rounded p-6 space-y-6 w-full">
            {/* 1. Header & Assigned Doctor Card */}
            <div className="bg-[#F8FAFC] border-2 border-[#CBD5E1] rounded p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded bg-gradient-to-tr from-[#1E3A8A] to-[#1B4FD8] text-white flex items-center justify-center text-xl font-bold shadow-sm">
                    👨‍⚕️
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                      Assigned Doctor
                    </div>
                    <div className="text-[18px] font-bold text-gray-900">
                      {patient.assignedDoctor}
                    </div>
                    <div className="text-[12.5px] text-[#475569] font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[#1B4FD8]">
                        {patient.aiSpecialty}
                      </span>
                      <span>•</span>
                      <span>{patient.room}</span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 text-[#16A34A] font-semibold text-[11.5px]">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        Available &amp; In Clinic
                      </span>
                    </div>
                  </div>
                </div>

                {/* Automatic / Background Alternate Doctor Switch if required */}
                <div className="flex items-center gap-2">
                  <select
                    value={patient.assignedDoctor}
                    onChange={(e) => {
                      const selectedDoc = getDoctorMaster().find(
                        (d) => d.name === e.target.value,
                      )
                      if (selectedDoc) {
                        setPatient((prev) => ({
                          ...prev,
                          assignedDoctor: selectedDoc.name,
                          room: selectedDoc.room,
                          doctorStatus: "Available",
                        }))
                      }
                    }}
                    className="text-[11.5px] font-semibold text-gray-700 bg-white border border-[#CBD5E1] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                  >
                    {getDoctorMaster().filter(
                      (d) =>
                        d.verified &&
                        (d.specialty === patient.aiSpecialty ||
                          !patient.aiSpecialty),
                    ).length === 0 ? (
                      <option value="">No doctors available in roster</option>
                    ) : (
                      getDoctorMaster()
                        .filter(
                          (d) =>
                            d.verified &&
                            (d.specialty === patient.aiSpecialty ||
                              !patient.aiSpecialty),
                        )
                        .map((d) => (
                          <option key={d.id} value={d.name}>
                            {d.name} ({d.qualification}) — {d.room}
                          </option>
                        ))
                    )}
                  </select>
                </div>
              </div>
            </div>

            {/* Vitals status, read-only. Reception does not record these -- the OP
                nurse does, after the patient walks over -- so this reports whether
                that has happened yet. It used to claim "Ready for Physician"
                unconditionally, including for patients whose vitals were blank. */}
            {(() => {
              const takenAt = patient.timestamps?.vitalsRecorded
              const hasVitals = Boolean(
                patient.vitals.bp ||
                  patient.vitals.pulse ||
                  patient.vitals.temp ||
                  patient.vitals.spo2 ||
                  patient.vitals.weight,
              )
              if (!takenAt && !hasVitals) {
                return (
                  <div className="bg-[#FFFBEB] border border-[#FDE68A] p-3.5 rounded text-[12px] shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#92400E] flex items-center gap-1.5">
                        <span>🩺</span> Vitals not taken yet
                      </span>
                      <span className="text-[10.5px] font-mono font-bold text-[#B45309] bg-white px-2 py-0.5 rounded border border-[#FDE68A]">
                        With OP department
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[#B45309] mt-1.5">
                      Send the patient to the OP department. The nurse records
                      baseline observations at the Nurse Station and the doctor
                      is notified the moment they are saved.
                    </p>
                  </div>
                )
              }
              return (
                <div className="bg-[#F0FDF4] border border-green-200 p-3.5 rounded text-[12px] space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#166534] flex items-center gap-1.5">
                      <span>✓</span> Nurse-recorded vital signs
                      {patient.timestamps?.vitalsBy && (
                        <span className="font-normal normal-case tracking-normal text-[#15803D]">
                          — {patient.timestamps.vitalsBy}
                          {takenAt ? ` at ${takenAt}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="text-[10.5px] font-mono font-bold text-[#16A34A] bg-white px-2 py-0.5 rounded border border-green-200">
                      Ready for Physician
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 font-mono text-[12px] text-gray-800">
                    <div>
                      <span className="text-[#64748B] text-[10px] block">
                        BP:
                      </span>{" "}
                      <strong>{patient.vitals.bp || "--"}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-[10px] block">
                        Pulse:
                      </span>{" "}
                      <strong>{patient.vitals.pulse || "--"}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-[10px] block">
                        Temp:
                      </span>{" "}
                      <strong>{patient.vitals.temp || "--"}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-[10px] block">
                        SpO2:
                      </span>{" "}
                      <strong>{patient.vitals.spo2 || "--"}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-[10px] block">
                        Weight:
                      </span>{" "}
                      <strong>{patient.vitals.weight || "--"}</strong>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Check if Doctor has already finished consultation */}
            {hasDoctorConsulted ? (
              <div className="bg-[#F0FDF4] border-2 border-[#16A34A] rounded p-6 text-center space-y-3.5 shadow-xs animate-in zoom-in-95 duration-200">
                <div className="inline-flex items-center gap-2 bg-[#16A34A] text-white text-[12px] font-mono font-bold px-3 py-1 rounded uppercase tracking-wider">
                  <span>✓</span> DOCTOR CONSULTATION COMPLETED
                </div>

                <div className="space-y-1">
                  <div className="text-[20px] font-bold text-gray-900">
                    Checked by {patient.assignedDoctor}
                  </div>
                  <div className="text-[13px] text-[#166534] font-medium">
                    Clinical Examination Completed · Official Prescription
                    Issued ({patient.prescription?.length || 0} Medications)
                  </div>
                  {patient.diagnosis && (
                    <div className="text-[12.5px] text-gray-800 font-semibold bg-white border border-green-200 p-2.5 rounded max-w-lg mx-auto mt-2">
                      <span className="text-[#64748B] text-[11px] block uppercase font-bold">
                        Confirmed Clinical Diagnosis:
                      </span>
                      {patient.diagnosis}{" "}
                      {patient.icd10 ? `(${patient.icd10})` : ""}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
                  <button
                    onClick={() => setCurrentStep(5)}
                    className="px-6 py-2.5 bg-white hover:bg-gray-50 border border-[#CBD5E1] text-gray-800 text-[13px] font-bold rounded shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>📋</span> View consultation summary →
                  </button>
                  <button
                    onClick={() => setCurrentStep(6)}
                    className="px-6 py-2.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-bold rounded shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>💳</span> Go straight to billing →
                  </button>
                </div>
              </div>
            ) : isYourTurn ? (
              /* 2. "YOUR TURN" Banner (When patient reaches position #1) */
              <div className="bg-[#F0FDF4] border-2 border-[#16A34A] rounded p-6 text-center space-y-4 shadow-md animate-in zoom-in-95 duration-200">
                <div className="inline-flex items-center gap-2 bg-[#16A34A] text-white text-[12px] font-mono font-bold px-3 py-1 rounded uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  🔔 YOUR TURN
                </div>

                <div className="space-y-1">
                  <div className="text-[26px] font-black font-mono text-[#15803D]">
                    {patient.queueToken}
                  </div>
                  <div className="text-[15px] font-bold text-gray-900">
                    Doctor: {patient.assignedDoctor} • {patient.room}
                  </div>
                  <p className="text-[13px] text-[#166534] font-medium">
                    Please proceed to the consultation room immediately.
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => setCurrentStep(5)}
                    className="px-8 py-3.5 bg-[#16A34A] hover:bg-[#15803D] text-white text-[14px] font-bold rounded shadow-lg hover:shadow-xl transition-all flex items-center gap-2 mx-auto cursor-pointer"
                  >
                    <span>👨‍⚕️</span> ENTER DOCTOR CONSULTATION (STEP 5) →
                  </button>
                </div>
              </div>
            ) : (
              /* 3. YOUR QUEUE STATUS Card (When Waiting) */
              <div className="bg-white border-2 border-[#93C5FD] rounded p-5 shadow-xs space-y-4">
                <div className="text-center border-b border-[#E2E8F0] pb-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    YOUR QUEUE STATUS
                  </div>
                  <div className="text-[28px] font-black font-mono text-[#1B4FD8] mt-0.5">
                    {patient.queueToken}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-[#F8FAFC] p-3 rounded border border-[#E2E8F0]">
                    <div className="text-[10.5px] font-bold uppercase text-[#64748B]">
                      Patients Ahead
                    </div>
                    <div className="text-[20px] font-black font-mono text-gray-900 mt-0.5">
                      {patientsAhead}
                    </div>
                  </div>
                  <div className="bg-[#EFF6FF] p-3 rounded border border-blue-200">
                    <div className="text-[10.5px] font-bold uppercase text-[#1B4FD8]">
                      Your Position
                    </div>
                    <div className="text-[20px] font-black font-mono text-[#1B4FD8] mt-0.5">
                      #{currentPosition}
                    </div>
                  </div>
                  <div className="bg-[#F8FAFC] p-3 rounded border border-[#E2E8F0]">
                    <div className="text-[10.5px] font-bold uppercase text-[#64748B]">
                      Est. Wait
                    </div>
                    <div className="text-[20px] font-black font-mono text-[#D97706] mt-0.5">
                      ~{patientsAhead * 5 + 5}m
                    </div>
                  </div>
                </div>

                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => setCurrentStep(5)}
                    className="px-6 py-2.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold rounded shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <span>🩺</span> View consultation summary →
                  </button>
                </div>
              </div>
            )}

            {/* Queue Controls */}
            <div className="bg-[#F8FAFC] border border-[#CBD5E1] p-4 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="text-[12.5px] text-[#64748B] hover:text-gray-900 font-medium cursor-pointer"
              >
                ← Back to Symptoms &amp; AI Triage
              </button>

              <div className="flex items-center gap-2">
                {/* Reception takes the consultation fee when the appointment is
                    booked, not after the doctor has seen the patient. The only
                    route to billing used to sit inside the "consultation
                    finished" branch, so the front desk could not collect the fee
                    up front at all -- which is when the patient is actually
                    standing there. */}
                <button
                  type="button"
                  onClick={() => setCurrentStep(6)}
                  className="px-3 py-1.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[11.5px] font-semibold rounded shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>💳</span> Collect consultation fee →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 5: PHYSICIAN CONSULTATION & SUBMITTED CLINICAL SUMMARY ── */}
        {currentStep === 5 &&
          (() => {
            return (
              <div className="bg-white border border-[#DDE2EC] rounded p-6 space-y-6 w-full">
                {/* Header with Doctor & Patient Meta */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                  <div>
                    <h2 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-[#1B4FD8] text-white text-[12px] flex items-center justify-center font-bold">
                        5
                      </span>
                      Physician Consultation Summary
                    </h2>
                    <p className="text-[12px] text-[#64748B] mt-0.5">
                      Official clinical consultation record performed by{" "}
                      <strong>{patient.assignedDoctor}</strong>. (Synced live
                      from Doctor Portal).
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11.5px] font-bold px-3 py-1.5 rounded border flex items-center gap-1.5 ${
                        hasDoctorConsulted
                          ? "bg-green-50 text-[#166534] border-green-200"
                          : "bg-amber-50 text-[#B45309] border-amber-200"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          hasDoctorConsulted
                            ? "bg-green-500"
                            : "bg-amber-500 animate-pulse"
                        }`}
                      ></span>
                      {hasDoctorConsulted
                        ? "✓ Consultation & Rx Completed"
                        : "Awaiting Doctor Portal Submission"}
                    </span>
                  </div>
                </div>

                {/* Pre-Consultation Nurse-Recorded Vitals Card */}
                {(() => {
                  const vitalsDone = hasRecordedVitals(patient.vitals, patient.timestamps)
                  const nurseName = patient.timestamps?.vitalsBy || "Triage Station Nurse"
                  return (
                    <div className={`border-2 rounded p-4.5 space-y-2.5 shadow-2xs ${
                      vitalsDone ? "bg-[#F8FAFC] border-[#93C5FD]" : "bg-amber-50/60 border-amber-300"
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-7 h-7 rounded flex items-center justify-center font-bold text-sm ${
                            vitalsDone ? "bg-blue-100 text-[#1B4FD8]" : "bg-amber-100 text-amber-800"
                          }`}>
                            🩺
                          </span>
                          <div>
                            <h3 className="text-[13.5px] font-bold text-gray-900">
                              Pre-Consultation Nurse Vital Signs
                            </h3>
                            <p className="text-[11px] text-[#64748B]">
                              {vitalsDone
                                ? `Recorded at Triage Station by ${nurseName} prior to physician examination.`
                                : "Awaiting triage: Baseline vitals have not yet been recorded at the nurse station."}
                            </p>
                          </div>
                        </div>
                        {vitalsDone ? (
                          <span className="text-[10.5px] font-bold bg-green-50 text-[#166534] border border-green-200 px-2 py-0.5 rounded">
                            ✓ Verified Triage Vitals
                          </span>
                        ) : (
                          <span className="text-[10.5px] font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded">
                            ⏳ Pending Triage Vitals
                          </span>
                        )}
                      </div>

                      {vitalsDone ? (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px]">
                          <div className="bg-white border border-[#CBD5E1] p-2.5 rounded">
                            <span className="text-[#64748B] block text-[10px] uppercase font-bold">
                              Blood Pressure
                            </span>
                            <span className="text-[15px] font-mono font-bold text-gray-900 block mt-0.5">
                              {patient.vitals?.bp || "—"}
                            </span>
                          </div>
                          <div className="bg-white border border-[#CBD5E1] p-2.5 rounded">
                            <span className="text-[#64748B] block text-[10px] uppercase font-bold">
                              Heart Rate / Pulse
                            </span>
                            <span className="text-[15px] font-mono font-bold text-gray-900 block mt-0.5">
                              {patient.vitals?.pulse || "—"}
                            </span>
                          </div>
                          <div className="bg-white border border-[#CBD5E1] p-2.5 rounded">
                            <span className="text-[#64748B] block text-[10px] uppercase font-bold">
                              Temperature
                            </span>
                            <span className="text-[15px] font-mono font-bold text-gray-900 block mt-0.5">
                              {patient.vitals?.temp || "—"}
                            </span>
                          </div>
                          <div className="bg-white border border-[#CBD5E1] p-2.5 rounded">
                            <span className="text-[#64748B] block text-[10px] uppercase font-bold">
                              Oxygen SpO2
                            </span>
                            <span className="text-[15px] font-mono font-bold text-gray-900 block mt-0.5">
                              {patient.vitals?.spo2 || "—"}
                            </span>
                          </div>
                          <div className="bg-white border border-[#CBD5E1] p-2.5 rounded">
                            <span className="text-[#64748B] block text-[10px] uppercase font-bold">
                              Body Weight
                            </span>
                            <span className="text-[15px] font-mono font-bold text-gray-900 block mt-0.5">
                              {patient.vitals?.weight || "—"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white/90 border border-amber-200 p-3 rounded text-[12px] text-amber-900 flex items-center justify-between">
                          <span>Patient has not completed vitals assessment at the Triage Station.</span>
                          <button
                            type="button"
                            onClick={() => setCurrentStep(3)}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] rounded shadow-2xs cursor-pointer"
                          >
                            Record Vitals Now →
                          </button>
                        </div>
                      )}

                      {vitalsDone && patient.vitals?.notes && (
                        <div className="bg-white border border-green-200 p-2.5 rounded text-[11.5px] text-[#166534] flex items-center gap-1.5">
                          <span className="font-bold">Nurse Observation:</span>
                          <span>{patient.vitals.notes}</span>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* STATE A: Awaiting Consultation Submission from Doctor Portal */}
                {!hasDoctorConsulted ? (
                  <div className="space-y-6">
                    <div className="bg-[#EFF6FF] border-2 border-[#93C5FD] rounded p-6 text-center space-y-4 shadow-xs animate-in fade-in">
                      <div className="w-12 h-12 rounded bg-[#1B4FD8] text-white flex items-center justify-center text-2xl mx-auto shadow-sm">
                        🩺
                      </div>
                      <div className="space-y-1">
                        <div className="text-[16px] font-bold text-[#1E3A8A]">
                          Awaiting Consultation Submission from Doctor Portal
                        </div>
                        <p className="text-[12.5px] text-[#2563EB] max-w-lg mx-auto">
                          In compliance with clinical role separation, all
                          diagnoses, prescriptions, and investigation orders
                          must be recorded and submitted by{" "}
                          <strong>{patient.assignedDoctor}</strong> from the
                          Doctor Portal.
                        </p>
                      </div>

                      <div className="pt-2 flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenDoctorPortal) {
                              onOpenDoctorPortal(patient.id)
                            }
                          }}
                          className="px-5 py-2.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-bold rounded shadow-md transition-all flex items-center gap-2 cursor-pointer"
                        >
                          <span>🩺</span> Open Doctor Portal Workspace →
                        </button>

                      </div>
                    </div>

                    <div className="flex justify-start pt-2 border-t border-[#E2E8F0]">
                      <button
                        type="button"
                        onClick={() => setCurrentStep(4)}
                        className="text-[12.5px] text-[#64748B] hover:text-gray-900 font-medium cursor-pointer"
                      >
                        ← Back to Doctor Appointment
                      </button>
                    </div>
                  </div>
                ) : (
                  /* STATE B: Doctor has Submitted -> Render Confirmed Prescriptions, Diagnosis & Orders */
                  <div className="space-y-5 animate-in fade-in">
                    {/* Doctor & Encounter Meta Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F8FAFC] border border-[#CBD5E1] p-3.5 rounded text-[12px]">
                      <div>
                        <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                          Attending Doctor
                        </span>
                        <span className="font-bold text-gray-900">
                          {patient.assignedDoctor}
                        </span>
                        <span className="text-[11px] text-[#64748B] block">
                          {patient.aiSpecialty} · {patient.room}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                          Patient UMR
                        </span>
                        <span className="font-mono font-bold text-[#1B4FD8]">
                          {patient.umr}
                        </span>
                        <span className="text-[11px] text-gray-700 block">
                          {patient.name} ({patient.age}y, {patient.sex})
                        </span>
                      </div>
                      <div>
                        <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                          Current OP Number
                        </span>
                        <span className="font-mono font-bold text-gray-900">
                          {patient.opNumber}
                        </span>
                        <span className="text-[11px] text-[#64748B] block">
                          Token: {patient.queueToken}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#64748B] block text-[10.5px] uppercase font-bold">
                          Consultation Time
                        </span>
                        <span className="font-mono font-semibold text-gray-900">
                          {patient.timestamps?.consultationEnd ||
                            new Date().toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                        </span>
                        <span className="text-[10.5px] font-bold text-[#16A34A] block">
                          ✓ Verified Record
                        </span>
                      </div>
                    </div>

                    {/* Clinical Assessment */}
                    <div className="bg-white border border-[#CBD5E1] rounded p-4 space-y-1 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                        Clinical Assessment &amp; Notes
                      </div>
                      <div className="text-[13px] text-gray-800 leading-relaxed font-medium bg-[#F8FAFC] p-3 rounded border border-[#E2E8F0]">
                        {patient.assessment ||
                          `Patient presents with ${patient.chiefComplaint || (patient.symptoms && patient.symptoms.join(", ")) || "presenting symptoms"}. Baseline vitals recorded by triage nurse: BP ${patient.vitals?.bp}, Pulse ${patient.vitals?.pulse}. Examination completed.`}
                      </div>
                    </div>

                    {/* Diagnosis & ICD-10 Code */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-white border border-[#CBD5E1] rounded p-4 space-y-1 shadow-2xs">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                          Confirmed Clinical Diagnosis
                        </div>
                        <div className="text-[15px] font-bold text-[#1B4FD8]">
                          {patient.diagnosis || "No formal diagnosis entered"}
                        </div>
                      </div>
                      <div className="bg-white border border-[#CBD5E1] rounded p-4 space-y-1 shadow-2xs">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                          ICD-10 Diagnostic Code
                        </div>
                        <div className="text-[15px] font-mono font-bold text-gray-900">
                          {patient.icd10 || "—"}
                        </div>
                      </div>
                    </div>

                    {/* Prescribed Medications Table */}
                    <div className="bg-white border border-[#CBD5E1] rounded p-4 space-y-2.5 shadow-2xs">
                      <div className="flex justify-between items-center">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                          Prescribed Medications (Rx Pad)
                        </div>
                        <span className="text-[10px] font-mono font-bold bg-blue-50 text-[#1B4FD8] px-2 py-0.5 rounded border border-blue-200 uppercase">
                          ✓ Locked / Official Rx
                        </span>
                      </div>
                      <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded overflow-hidden text-[12.5px]">
                        <div className="grid grid-cols-4 bg-[#F8FAFC] p-2.5 font-bold text-gray-700 text-[11px] uppercase">
                          <span>Medicine</span>
                          <span>Dosage</span>
                          <span>Frequency</span>
                          <span>Duration</span>
                        </div>
                        {patient.prescription &&
                        patient.prescription.length > 0 ? (
                          patient.prescription.map((rx, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-4 p-2.5 bg-white font-medium text-gray-800 hover:bg-gray-50"
                            >
                              <span className="font-bold text-gray-900">
                                {rx.medicine}
                              </span>
                              <span>{rx.dosage}</span>
                              <span>{rx.frequency}</span>
                              <span className="text-gray-600">
                                {rx.duration}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 text-[#64748B] italic">
                            No medications prescribed.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Investigations Ordered */}
                    <div className="bg-white border border-[#CBD5E1] rounded p-4 space-y-2.5 shadow-2xs">
                      <div className="flex justify-between items-center">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                          Diagnostic Investigations &amp; Lab Orders
                        </div>
                        <span className="text-[10.5px] font-mono font-bold bg-amber-50 text-[#B45309] px-2 py-0.5 rounded border border-amber-200">
                          PENDING SAMPLE / IMAGING
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {patient.investigations &&
                        patient.investigations.length > 0 ? (
                          patient.investigations.map((test) => (
                            <span
                              key={test}
                              className="px-3 py-1.5 rounded text-[12px] font-semibold bg-blue-50 text-[#1B4FD8] border border-blue-200 flex items-center gap-1.5 shadow-2xs"
                            >
                              <span>✓</span> {test}
                            </span>
                          ))
                        ) : (
                          <span className="text-[12px] text-[#64748B] italic">
                            No diagnostic orders requested.
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Doctor Advice & Instructions */}
                    <div className="bg-white border border-[#CBD5E1] rounded p-4 space-y-1 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                        Doctor Advice &amp; Instructions
                      </div>
                      <div className="text-[12.5px] text-gray-800 leading-relaxed bg-[#F8FAFC] p-3 rounded border border-[#E2E8F0]">
                        {patient.advice ||
                          "Adequate hydration, follow prescribed medication, return for review as advised."}
                      </div>
                    </div>

                    {/* Navigation Actions */}
                    <div className="flex justify-between items-center pt-3 border-t border-[#E2E8F0]">
                      <button
                        type="button"
                        onClick={() => setCurrentStep(4)}
                        className="text-[12px] text-[#64748B] hover:text-gray-900 font-medium cursor-pointer"
                      >
                        ← Back to Doctor Appointment
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const nowTime = new Date().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                          setPatient((prev) => ({
                            ...prev,
                            status: "Awaiting Billing",
                            timestamps: {
                              ...prev.timestamps,
                              consultationEnd: nowTime,
                            },
                          }))
                          if (patient.id) {
                            try {
                              db.updateEncounter(patient.id, {
                                status: "Awaiting Billing",
                                timestamps: {
                                  ...patient.timestamps,
                                  consultationEnd: nowTime,
                                },
                              })
                            } catch (e) {
                              console.warn("DB update failed:", e)
                            }
                          }
                          setCurrentStep(6)
                        }}
                        className="px-6 py-3 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-bold rounded shadow-md transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <span>💳</span> Continue to invoice →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

        {/* ── STEP 6: BILLING & OP VISIT COMPLETION ───────────────────── */}
        {currentStep === 6 &&
          (() => {
            // The OP desk bills two things only: the registration fee and the
            // doctor's consultation fee. Investigations are billed by the
            // laboratory / radiology desks against the doctor's orders, and
            // medicines by the pharmacy -- never on this receipt.
            const regFee = (patient.billing as any)?.registrationFee ?? (patient.isNew === false ? 0 : 20)
            const consultFee = patient.billing?.consultationFee || getDoctorConsultationFee(patient.assignedDoctor)
            const grossSubtotal = regFee + consultFee
            const netTotalPayable = grossSubtotal
            const tenderedNum = parseFloat(cashTendered) || netTotalPayable
            const changeDue = Math.max(0, tenderedNum - netTotalPayable)
            const isPaid = patient.billing?.status === "Paid"
            const receiptNo = (patient.billing as any)?.receiptNo as string | undefined
            const cashierName = (() => {
              try {
                const u = JSON.parse(localStorage.getItem("hospai_current_user") || "null")
                return (u?.name || u?.user || "") as string
              } catch {
                return ""
              }
            })()

            const printOpInvoiceReceipt = () => {
              const frame = document.createElement("iframe")
              frame.setAttribute("aria-hidden", "true")
              frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
              document.body.appendChild(frame)
              const doc = frame.contentDocument
              if (!doc || !frame.contentWindow) {
                frame.remove()
                window.print()
                return
              }

              const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice & OP Slip - ${patient.name} - ${receiptNo || patient.opNumber}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      font-size: 12px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .invoice-card {
      border: 1.5px solid #1E293B;
      border-radius: 6px;
      padding: 24px;
      position: relative;
    }
    .accent-bar {
      height: 4px;
      background: #1B4FD8;
      margin: -24px -24px 20px -24px;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #E2E8F0;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .hospital-name {
      font-size: 20px;
      font-weight: 800;
      color: #0F172A;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .hospital-sub {
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      margin-top: 2px;
    }
    .hospital-address {
      font-size: 10px;
      color: #64748B;
      margin-top: 3px;
    }
    .badge-paid {
      display: inline-block;
      padding: 4px 10px;
      background: #DCFCE7;
      color: #166534;
      border: 1px solid #86EFAC;
      border-radius: 4px;
      font-weight: 800;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .date-stamp {
      font-size: 10.5px;
      color: #64748B;
      margin-top: 4px;
      font-family: monospace;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      padding: 12px 14px;
      border-radius: 4px;
      margin-bottom: 18px;
    }
    .meta-col .label {
      font-size: 9.5px;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748B;
      margin-bottom: 2px;
    }
    .meta-col .value {
      font-size: 13px;
      font-weight: 700;
      color: #0F172A;
    }
    .meta-col .sub {
      font-size: 11px;
      color: #64748B;
      margin-top: 1px;
    }
    .fee-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      border: 1px solid #CBD5E1;
      border-radius: 4px;
      overflow: hidden;
    }
    .fee-table th {
      background: #F1F5F9;
      padding: 9px 14px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #334155;
      border-bottom: 1px solid #CBD5E1;
      text-align: left;
    }
    .fee-table th.right { text-align: right; }
    .fee-table td {
      padding: 9px 14px;
      font-size: 12px;
      border-bottom: 1px solid #E2E8F0;
      color: #1E293B;
    }
    .fee-table td.right { text-align: right; font-family: monospace; font-weight: 700; }
    .total-box {
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      padding: 12px 16px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .total-label {
      font-size: 14px;
      font-weight: 800;
      color: #0F172A;
    }
    .total-amount {
      font-size: 18px;
      font-weight: 900;
      color: #16A34A;
      font-family: monospace;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-top: 1px solid #E2E8F0;
      padding-top: 16px;
      font-size: 11px;
      color: #64748B;
    }
    .sign-box {
      text-align: center;
      border-top: 1px solid #64748B;
      padding-top: 6px;
      width: 190px;
      font-weight: 700;
      color: #0F172A;
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="accent-bar"></div>
    <div class="header">
      <div>
        <div class="hospital-name">${branding.hospitalName}</div>
        <div class="hospital-sub">A UNIT OF MUKUNDA HEALTHCARE PRIVATE LIMITED</div>
        <div class="hospital-address">Outpatient Consultation & Diagnostic Services · GSTIN: 37AALCM2238A1ZQ</div>
      </div>
      <div style="text-align: right;">
        <span class="badge-paid">✓ PAID & SETTLED</span>
        <div class="date-stamp">Date: ${patient.date || new Date().toLocaleDateString()} ${patient.timestamps?.billingCompleted || ""}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-col">
        <div class="label">Patient Name</div>
        <div class="value">${patient.name}</div>
        <div class="sub">${patient.age} yrs · ${patient.sex}</div>
      </div>
      <div class="meta-col">
        <div class="label">Permanent UMR</div>
        <div class="value" style="color: #1B4FD8; font-family: monospace;">${patient.umr}</div>
        <div class="sub">Token: ${patient.queueToken || "—"}</div>
      </div>
      <div class="meta-col">
        <div class="label">Visit OP Number</div>
        <div class="value" style="font-family: monospace;">${patient.opNumber}</div>
        <div class="sub">${patient.aiSpecialty || "General OP"}</div>
      </div>
      <div class="meta-col">
        <div class="label">Attending Doctor</div>
        <div class="value">${patient.assignedDoctor || "Duty Doctor"}</div>
        <div class="sub">${patient.room || "Room 101"}</div>
      </div>
    </div>

    <table class="fee-table">
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Patient Registration Fee ${regFee === 0 ? "(Revisit / Existing Patient)" : "(New Registration)"}</td>
          <td class="right">₹${regFee}.00</td>
        </tr>
        <tr>
          <td>Physician Consultation Fee (${patient.assignedDoctor || "Attending Consultant"})</td>
          <td class="right">₹${consultFee}.00</td>
        </tr>
      </tbody>
    </table>

    <div class="total-box">
      <span class="total-label">Total Amount Paid (${patient.billing?.mode || "Cash"}):</span>
      <span class="total-amount">₹${netTotalPayable}.00</span>
    </div>

    <div class="footer">
      <div>
        ${patient.billing?.collectedBy || cashierName ? `<div>Collected By: <strong>${patient.billing?.collectedBy || cashierName}</strong></div>` : ""}
        ${receiptNo ? `<div style="font-family: monospace; margin-top: 3px;">Receipt No: <strong>${receiptNo}</strong></div>` : ""}
        <div style="margin-top: 3px;">Computer generated receipt · Valid without physical seal</div>
      </div>
      <div class="sign-box">
        Authorized Signatory
      </div>
    </div>
  </div>
</body>
</html>`

              doc.open()
              doc.write(html)
              doc.close()

              setTimeout(() => {
                try {
                  frame.contentWindow?.focus()
                  frame.contentWindow?.print()
                } catch {
                  window.print()
                } finally {
                  setTimeout(() => frame.remove(), 60000)
                }
              }, 150)
            }

            const handleProcessPayment = () => {
              setPaymentProcessing(true)
              const nowTime = new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
              const paidAt = new Date().toISOString()
              const newReceiptNo = `RCP-${patient.opNumber || "OP"}-${Date.now().toString().slice(-6)}`
              // Collecting the fee does not finish the visit: a patient who pays
              // up front still has to see the doctor. Only a visit the doctor has
              // already closed becomes "OP Completed" here.
              const nextStatus = hasDoctorConsulted ? ("OP Completed" as const) : patient.status
              const billing = {
                ...patient.billing,
                registrationFee: regFee,
                consultationFee: consultFee,
                labFee: 0,
                total: netTotalPayable,
                status: "Paid" as const,
                mode: patient.billing?.mode || "Cash",
                receiptNo: newReceiptNo,
                paidAt,
                collectedBy: cashierName,
              }
              const timestamps = {
                ...patient.timestamps,
                billingCompleted: nowTime,
                ...(hasDoctorConsulted ? { visitCompleted: nowTime } : {}),
              }

              setPatient({ ...patient, status: nextStatus, billing, timestamps })
              setPaymentProcessing(false)

              if (patient.id) {
                try {
                  // Billing fields only: clinical fields belong to the doctor and
                  // nurse, and writing this screen's copy back could erase what
                  // they saved after it was loaded.
                  db.updateEncounter(patient.id, {
                    status: nextStatus,
                    billing: billing as any,
                    timestamps,
                  })
                } catch (err) {
                  console.warn("DB billing update:", err)
                }
              }
            }

            return (
              <div className="space-y-6 w-full">
                {/* Header */}
                <div className="bg-white border border-[#DDE2EC] rounded p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-[#1B4FD8] text-white text-[12px] flex items-center justify-center font-bold">
                        6
                      </span>
                      OP Billing, Payment &amp; Encounter Settlement
                    </h2>
                    <p className="text-[12px] text-[#64748B] mt-0.5">
                      Registration and physician consultation fees. Laboratory,
                      radiology and pharmacy items are billed at their own desks.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11.5px] font-bold px-3 py-1 rounded border flex items-center gap-1.5 ${
                        isPaid
                          ? "bg-green-100 text-[#15803D] border-green-300"
                          : "bg-amber-50 text-[#B45309] border-amber-200"
                      }`}
                    >
                      <span>
                        {isPaid ? "✓ PAID & SETTLED" : "⏳ PAYMENT PENDING"}
                      </span>
                    </span>
                  </div>
                </div>

                {/* SMS Notification Banner if triggered */}
                {smsSentNotice && (
                  <div className="bg-[#F0FDF4] border border-green-300 p-3 rounded text-[12px] text-[#166534] flex items-center justify-between animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <span>📱</span>
                      <span>{smsSentNotice}</span>
                    </div>
                    <button
                      onClick={() => setSmsSentNotice(null)}
                      className="text-green-700 hover:text-green-900 font-bold text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Main Settlement Worksheet */}
                {!isPaid ? (
                  <div className="w-full bg-white border border-[#CBD5E1] rounded p-6 space-y-5 shadow-xs">
                    <div className="border-b border-[#E2E8F0] pb-3 flex justify-between items-center">
                      <div>
                        <div className="text-[15px] font-bold text-gray-900">
                          Itemized Clinical Charges
                        </div>
                        <div className="text-[11.5px] text-[#64748B]">
                          Encounter No:{" "}
                          <strong className="font-mono text-gray-800">
                            {patient.opNumber}
                          </strong>{" "}
                          · Permanent UMR:{" "}
                          <strong className="font-mono text-gray-800">
                            {patient.umr}
                          </strong>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono font-bold bg-blue-50 text-[#1B4FD8] px-2.5 py-1 rounded border border-blue-200">
                        Fee Worksheet (INR ₹)
                      </span>
                    </div>

                    <div className="divide-y divide-[#E2E8F0] text-[12.5px]">
                      {/* 1. Registration */}
                      <div className="py-2.5 flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-gray-900">
                            1. Patient Registration Fee
                          </div>
                          <div className="text-[11px] text-[#64748B]">
                            {regFee === 0 ? "Existing patient -- no registration fee" : "New patient registration"}
                          </div>
                        </div>
                        <span className="font-mono font-bold text-gray-900">
                          ₹{regFee}.00
                        </span>
                      </div>

                      {/* 2. Consultation */}
                      <div className="py-2.5 flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-gray-900">
                            2. Physician Consultation Fee
                          </div>
                          <div className="text-[11px] text-[#64748B]">
                            Attending: {patient.assignedDoctor} (
                            {patient.aiSpecialty})
                          </div>
                        </div>
                        <span className="font-mono font-bold text-gray-900">
                          ₹{consultFee}.00
                        </span>
                      </div>

                    </div>

                    {/* Subtotals & Net Amount */}
                    <div className="bg-[#F8FAFC] border border-[#CBD5E1] p-4 rounded space-y-2 text-[13px]">
                      <div className="flex justify-between text-gray-600">
                        <span>Gross Subtotal:</span>
                        <span className="font-mono font-bold">
                          ₹{grossSubtotal}.00
                        </span>
                      </div>
                      <div className="border-t border-[#E2E8F0] pt-2 flex justify-between text-[16px] font-black text-gray-900">
                        <span>Total Amount Due:</span>
                        <span className="text-[#16A34A] font-mono">
                          ₹{grossSubtotal}.00
                        </span>
                      </div>
                    </div>

                    {/* Complete Payment Settlement Action Button */}
                    <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setCurrentStep(5)}
                        className="text-[12.5px] text-[#64748B] hover:text-gray-900 font-medium cursor-pointer"
                      >
                        ← Back to consultation summary
                      </button>

                      <button
                        type="button"
                        disabled={paymentProcessing}
                        onClick={handleProcessPayment}
                        className="px-8 py-3.5 bg-gradient-to-r from-[#16A34A] to-[#15803D] hover:from-[#15803D] hover:to-[#166534] text-white text-[14px] font-bold rounded shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {paymentProcessing ? (
                          <>
                            <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                            <span>Processing Settlement...</span>
                          </>
                        ) : (
                          <>
                            <span>💳</span>
                            <span>
                              Mark OP Visit Completed &amp; Settle Invoice (₹
                              {grossSubtotal}.00)
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* OFFICIAL PRINTABLE DISCHARGE & PAYMENT RECEIPT */
                  <div className="space-y-5">
                    <div className="printable-card bg-white border-2 border-[#CBD5E1] text-gray-900 rounded p-6 shadow-xl relative overflow-hidden ring-1 ring-black/5 max-w-3xl mx-auto space-y-4">
                      {/* Top Accent Strip */}
                      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#16A34A] via-[#1B4FD8] to-[#16A34A]"></div>

                      {/* Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#E2E8F0] pb-4 pt-1 gap-2">
                        <div className="flex items-center gap-3">
                          <HospAILogo variant="icon" className="w-12 h-12 shrink-0" />
                          <div>
                            <div className="font-bold text-[16px] text-gray-900">
                              {branding.hospitalName}
                            </div>
                            <div className="text-[11px] text-[#64748B]">
                              Outpatient Department · Consultation Fee Receipt
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] font-mono font-bold text-[#166534] bg-green-50 px-2.5 py-1 rounded border border-green-200 inline-block">
                            ✓ PAID &amp; SETTLED
                          </div>
                          <div className="text-[11px] text-gray-500 mt-1 font-mono">
                            Date: {patient.date || patient.createdAt?.split("T")[0] || new Date().toLocaleDateString()} ·{" "}
                            {patient.timestamps?.billingCompleted || "Now"}
                          </div>
                        </div>
                      </div>

                      {/* Patient & Doctor Meta Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F8FAFC] border border-[#CBD5E1] p-3.5 rounded text-[12px]">
                        <div>
                          <span className="text-[#64748B] text-[10px] uppercase font-bold block">
                            Patient Name
                          </span>
                          <span className="font-bold text-gray-900 text-[13px]">
                            {patient.name}
                          </span>
                          <span className="text-[11px] text-gray-600 block">
                            {patient.age} yrs · {patient.sex}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#64748B] text-[10px] uppercase font-bold block">
                            Permanent UMR
                          </span>
                          <span className="font-mono font-bold text-[#1B4FD8] text-[13px]">
                            {patient.umr}
                          </span>
                          <span className="text-[11px] text-gray-600 block">
                            Token: {patient.queueToken}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#64748B] text-[10px] uppercase font-bold block">
                            Visit OP Number
                          </span>
                          <span className="font-mono font-bold text-gray-900 text-[13px]">
                            {patient.opNumber}
                          </span>
                          <span className="text-[11px] text-gray-600 block">
                            {patient.aiSpecialty}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#64748B] text-[10px] uppercase font-bold block">
                            Attending Doctor
                          </span>
                          <span className="font-bold text-gray-900 text-[13px]">
                            {patient.assignedDoctor}
                          </span>
                          <span className="text-[11px] text-gray-600 block">
                            {patient.room}
                          </span>
                        </div>
                      </div>

                      {/* Itemised fees: registration and consultation only */}
                      <div className="border border-[#CBD5E1] rounded overflow-hidden text-[12px]">
                        <div className="grid grid-cols-12 bg-[#F1F5F9] p-2.5 font-bold text-gray-700 text-[11px] uppercase border-b border-[#CBD5E1]">
                          <span className="col-span-10">Description</span>
                          <span className="col-span-2 text-right">Amount (₹)</span>
                        </div>
                        <div className="divide-y divide-[#E2E8F0] p-1 text-gray-800">
                          <div className="grid grid-cols-12 p-2">
                            <span className="col-span-10 font-medium">
                              Patient Registration Fee
                              {regFee === 0 ? " (existing patient)" : ""}
                            </span>
                            <span className="col-span-2 text-right font-mono font-bold">
                              ₹{regFee}.00
                            </span>
                          </div>
                          <div className="grid grid-cols-12 p-2">
                            <span className="col-span-10 font-medium">
                              Doctor Consultation Fee ({patient.assignedDoctor || "—"})
                            </span>
                            <span className="col-span-2 text-right font-mono font-bold">
                              ₹{consultFee}.00
                            </span>
                          </div>
                        </div>
                        <div className="bg-[#F8FAFC] border-t border-[#CBD5E1] p-3 text-[12.5px]">
                          <div className="flex justify-between text-[15px] font-black text-gray-900">
                            <span>Total Paid ({patient.billing.mode}):</span>
                            <span className="text-[#16A34A] font-mono">₹{netTotalPayable}.00</span>
                          </div>
                        </div>
                      </div>
                      {/* Footer */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-3 border-t border-[#E2E8F0] text-[11px] text-[#64748B] gap-2">
                        <div>
                          {((patient.billing as any)?.collectedBy || cashierName) && (
                            <span>
                              Collected by:{" "}
                              <strong>{(patient.billing as any)?.collectedBy || cashierName}</strong>
                            </span>
                          )}
                          {receiptNo && (
                            <span className="block mt-0.5">
                              Receipt No:{" "}
                              <strong className="font-mono text-gray-900">{receiptNo}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap justify-center gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={printOpInvoiceReceipt}
                        className="px-4 py-2.5 bg-white hover:bg-gray-50 border border-[#CBD5E1] text-gray-800 text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Print clean A4 Tax Invoice"
                      >
                        <Icon.Download /> Print Tax Invoice &amp; OP Summary
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowOfficialReceiptModal(true)}
                        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Open Official Hospital Receipt Slip (NABH / Mukunda Healthcare)"
                      >
                        <span>🏛️</span> Official Receipt Slip
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const message =
                            `🏥 *${branding.hospitalName.toUpperCase()}*\n` +
                            `*Outpatient Consultation & Tax Invoice*\n\n` +
                            `👤 *Patient:* ${patient.name} (${patient.umr})\n` +
                            `📋 *OP Visit:* ${patient.opNumber} | Token: ${patient.queueToken || "—"}\n` +
                            `👨‍⚕️ *Consultant:* ${patient.assignedDoctor} (${patient.aiSpecialty || "OPD"})\n` +
                            `📅 *Date:* ${patient.date || new Date().toLocaleDateString()}\n\n` +
                            `*Billing Summary:*\n` +
                            `• Registration Fee: ₹${regFee}.00\n` +
                            `• Consultation Fee: ₹${consultFee}.00\n` +
                            `--------------------------------\n` +
                            `*Net Paid:* ₹${netTotalPayable}.00 via ${patient.billing.mode}\n` +
                            `*Receipt No:* ${receiptNo || "RCP-" + patient.opNumber}\n\n` +
                            `Thank you for trusting ${branding.hospitalName}. For queries, call ${branding.helpline || "+91-8816-279999"}.`
                          try {
                            const res = await sendPatientMessage({
                              patient: { name: patient.name, phone: patient.phone, id: patient.umr, encounterId: patient.id },
                              kind: "bill",
                              channels: ["whatsapp"],
                              message,
                            })
                            const r = res.results.find((item) => item.channel === "whatsapp") || res.results[0]
                            if (r && (r.status === "sent" || r.status === "delivered")) {
                              setSmsSentNotice(`✓ Receipt sent via WhatsApp to ${patient.phone}.`)
                            } else {
                              const url = whatsAppHandoffUrl(patient.phone, message)
                              if (url) window.open(url, "_blank")
                              setSmsSentNotice(`WhatsApp opened for ${patient.phone} (direct chat).`)
                            }
                          } catch {
                            const url = whatsAppHandoffUrl(patient.phone, message)
                            if (url) window.open(url, "_blank")
                            setSmsSentNotice(`WhatsApp opened for ${patient.phone}.`)
                          }
                        }}
                        className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Send invoice via WhatsApp to patient phone"
                      >
                        <span>💬</span> Send via WhatsApp
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          let targetEmail = patient.email || ""
                          if (!targetEmail) {
                            targetEmail = window.prompt("Enter recipient email address for receipt delivery:", "") || ""
                          }
                          if (!targetEmail || !targetEmail.includes("@")) {
                            if (targetEmail) alert("Please enter a valid email address.")
                            return
                          }
                          const subject = `${branding.hospitalName} - Consultation Tax Invoice & OP Slip (${patient.opNumber})`
                          const message =
                            `Dear ${patient.name},\n\n` +
                            `Thank you for visiting ${branding.hospitalName}.\n\n` +
                            `RECEIPT DETAILS:\n` +
                            `Receipt No: ${receiptNo || "RCP-" + patient.opNumber}\n` +
                            `Permanent UMR: ${patient.umr}\n` +
                            `OP Number: ${patient.opNumber}\n` +
                            `Attending Doctor: ${patient.assignedDoctor} (${patient.aiSpecialty || "General Medicine"})\n` +
                            `Date of Service: ${patient.date || new Date().toLocaleDateString()}\n\n` +
                            `CHARGES ITEMIZED:\n` +
                            `1. Patient Registration Fee: ₹${regFee}.00\n` +
                            `2. Doctor Consultation Fee: ₹${consultFee}.00\n` +
                            `Total Paid: ₹${netTotalPayable}.00 (${patient.billing.mode})\n` +
                            `Status: PAID & SETTLED\n\n` +
                            `For any assistance, please reach out to ${branding.helpline || "+91-8816-279999"}.\n\n` +
                            `Warm regards,\n${branding.hospitalName}`
                          try {
                            const res = await sendPatientMessage({
                              patient: { name: patient.name, phone: patient.phone, email: targetEmail, id: patient.umr, encounterId: patient.id },
                              kind: "bill",
                              channels: ["email"],
                              message,
                            })
                            const r = res.results.find((item) => item.channel === "email") || res.results[0]
                            if (r && (r.status === "sent" || r.status === "delivered")) {
                              setSmsSentNotice(`✓ Receipt sent via Email to ${targetEmail}.`)
                            } else {
                              const url = emailHandoffUrl(targetEmail, subject, message)
                              if (url) window.open(url, "_blank")
                              setSmsSentNotice(`Email client opened for ${targetEmail}.`)
                            }
                          } catch {
                            const url = emailHandoffUrl(targetEmail, subject, message)
                            if (url) window.open(url, "_blank")
                            setSmsSentNotice(`Email client opened for ${targetEmail}.`)
                          }
                        }}
                        className="px-4 py-2.5 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-800 text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Send invoice via Email to patient"
                      >
                        <span>✉️</span> Send via Mail
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const message =
                            `${branding.hospitalName}: Receipt ${receiptNo || ""} for ${patient.name} (${patient.umr}). ` +
                            `Registration ₹${regFee}, consultation ₹${consultFee} (${patient.assignedDoctor}). ` +
                            `Total paid ₹${netTotalPayable} by ${patient.billing.mode}.`
                          try {
                            const res = await sendPatientMessage({
                              patient: { name: patient.name, phone: patient.phone, id: patient.umr, encounterId: patient.id },
                              kind: "bill",
                              channels: ["sms"],
                              message,
                            })
                            const r = res.results[0]
                            setSmsSentNotice(
                              r && (r.status === "sent" || r.status === "delivered")
                                ? `Receipt SMS sent to ${patient.phone}.`
                                : `Receipt SMS not sent${r?.error ? `: ${r.error}` : "."} It is queued in Patient Messages.`,
                            )
                          } catch (err: any) {
                            setSmsSentNotice(`Receipt SMS not sent: ${err?.message || "messaging unavailable"}.`)
                          }
                        }}
                        className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1B4FD8] text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>📱</span> Send SMS
                      </button>

                      <SendToPatientButton
                        patient={{
                          name: patient.name,
                          phone: patient.phone,
                          email: patient.email,
                          id: patient.umr,
                          encounterId: patient.id,
                        }}
                        kind="bill"
                        vars={{
                          patientName: patient.name,
                          umr: patient.umr,
                          receiptNo: receiptNo || "RCP-" + patient.opNumber,
                          billNo: receiptNo || "RCP-" + patient.opNumber,
                          total: netTotalPayable,
                          doctor: patient.assignedDoctor,
                        }}
                        label="Share & PDF"
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          const match = dbEncounters.find(
                            (enc) => enc.id === patient.id || (enc.umr && enc.umr === patient.umr),
                          )
                          setSelectedJourneyEncounter(match || (patient as any))
                        }}
                        className="px-4 py-2.5 bg-[#1B4FD8] hover:bg-blue-700 text-white text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="View complete OP Journey & Card"
                      >
                        <span>🧭</span> OP Journey &amp; Card
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const match = dbEncounters.find(
                            (enc) => enc.id === patient.id || (enc.umr && enc.umr === patient.umr),
                          )
                          setPrintJourneyEncounter(match || null)
                        }}
                        className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 text-indigo-800 text-[12.5px] font-bold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Open clean A4 Print Preview for OP Journey Report"
                      >
                        <span>📄</span> Print OP Journey
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          printOpCard(
                            opCardDataFor(patient.umr, {
                              patientName: patient.name,
                              age: patient.age,
                              sex: patient.sex,
                              phone: patient.phone,
                            }),
                            branding,
                          )
                        }
                        className="px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-[12.5px] font-semibold rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Print physical ID-card OP Card"
                      >
                        <span>🪪</span> Print OP Card
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCurrentStep(1)
                        }}
                        className="px-5 py-2.5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12.5px] font-bold rounded shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>➕</span> Next Patient →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
      </div>

      {showOfficialReceiptModal && (
        <HospitalReceiptModal
          claim={{
            id: 1,
            invoiceNo: (patient.billing as any)?.receiptNo || `RCP-${patient.opNumber || "OP"}`,
            claimNumber: `CLM-${patient.opNumber || "OP"}`,
            encounterId: patient.opNumber,
            patientId: patient.umr,
            patientName: patient.name,
            gender: patient.sex,
            age: patient.age,
            department: "Outpatient",
            attendingDoctor: patient.assignedDoctor,
            totalAmount: patient.billing?.total || 500,
            claimedAmount: patient.billing?.total || 500,
            settledAmount: patient.billing?.total || 500,
            paymentStatus: "Paid",
            claimStatus: "Settled",
            billingCategory: "Self-Pay",
            claimItems: [
              {
                id: "1",
                description: "Patient Registration Fee",
                category: "Registration",
                quantity: 1,
                unitPrice: (patient.billing as any)?.registrationFee ?? (patient.isNew === false ? 0 : 20),
                total: (patient.billing as any)?.registrationFee ?? (patient.isNew === false ? 0 : 20),
              },
              {
                id: "2",
                description: `Physician Consultation - ${patient.assignedDoctor || "Duty Doctor"}`,
                category: "Consultation",
                quantity: 1,
                unitPrice: patient.billing?.consultationFee || 480,
                total: patient.billing?.consultationFee || 480,
              },
            ],
            createdAt: patient.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as any}
          payment={{
            id: 1,
            claimId: 1,
            receiptNumber: (patient.billing as any)?.receiptNo || `RCP-${patient.opNumber || "OP"}`,
            amountPaid: patient.billing?.total || 500,
            paymentMethod: patient.billing?.mode || "Cash",
            paymentDate: new Date().toISOString(),
            status: "Completed",
          } as any}
          onClose={() => setShowOfficialReceiptModal(false)}
        />
      )}

      {/* Patient Journey & OP Card Modal */}
      {selectedJourneyEncounter && (
        <PatientJourneyModal
          encounter={selectedJourneyEncounter}
          onClose={() => setSelectedJourneyEncounter(null)}
          onNavigateToDoctorPortal={(encId) => {
            if (onOpenDoctorPortal) onOpenDoctorPortal(encId)
          }}
          onNavigateToOPWorkflow={(encId, step) => {
            const found = dbEncounters.find((e) => e.id === encId)
            if (found) {
              loadEncounterIntoWorkflow(found)
              setCurrentStep(step ?? 1)
            }
          }}
        />
      )}

      {/* Clean Publication-Grade A4 Journey Print Preview Modal */}
      {printJourneyEncounter && (
        <JourneyReportPrintModal
          encounter={printJourneyEncounter}
          onClose={() => setPrintJourneyEncounter(null)}
        />
      )}
    </div>
  )
}
