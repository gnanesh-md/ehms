import React, { useState, useEffect } from "react"
import { toast } from "react-hot-toast"
import { Stethoscope, Users as UsersIcon } from "lucide-react"
import DoctorsOverview from "./doctor/DoctorsOverview"
import DoctorPortal from "./doctor/DoctorPortal"
import { DoctorAccount, getDoctorById } from "../services/doctorPortalDb"
import { clearAllApplicationData } from "../services/legacySeedPurge"
import {
  getDoctorMaster,
  addDoctorMaster,
  updateDoctorMaster,
  deleteDoctorMaster,
  MasterDoctor,
  DoctorSection,
  availabilityOf,
} from "../services/doctorMaster"
import {
  AppRole,
  AppUser,
  RoleDatabase,
  getGrantedActionsForModule,
  hasGranularPermission,
} from "../services/roleDb"
import { AuditDatabase, AuditLog, detectDevice } from "../services/auditDb"
import { apiFetch } from "../lib/api"
import {
  DiagnosticTariffDatabase,
  DiagnosticTariffItem,
  DiagnosticDepartment,
  RADIOLOGY_MODALITIES,
} from "../services/diagnosticTariffDb"
import { AdminCredentialsModal } from "./AdminCredentialsModal"

// Canonical module keys accepted by the backend RBAC layer.
const MODULE_CATEGORIES = [
  {
    id: "clinical",
    title: "Clinical Operations",
    description: "Patient administration, outpatient care, inpatient beds, ER, and doctor encounters",
    modules: ["patients", "op", "beds", "er", "clinical", "surgery", "icu"],
  },
  {
    id: "diagnostics",
    title: "Diagnostics & Pharmacy",
    description: "Medication inventory, prescriptions, pathology tests, and radiology PACS imaging",
    modules: ["pharmacy", "laboratory", "radiology"],
  },
  {
    id: "finance",
    title: "Revenue, Billing & Insurance",
    description: "Cashier billing, financial accounts ledger, and cashless TPA insurance claims",
    modules: ["billing", "accounts", "insurance"],
  },
  {
    id: "workforce",
    title: "Staff & Workforce Governance",
    description: "Hospital staff directory, employee credentials, and patient experience",
    modules: ["employees", "patient_experience"],
  },
  {
    id: "platform",
    title: "Platform, Administration & Intelligence",
    description: "Centralized administration, role security, command dashboard, and AI tools",
    modules: ["admin", "dashboard", "symptom_ai"],
  },
]

export const ALL_ADMIN_ASSIGNABLE_MODULES: Array<{
  key: string
  label: string
  category: string
  icon: string
}> = [
  { key: "dashboard", label: "Executive Dashboard", category: "Core & Clinical", icon: "📊" },
  { key: "doctor_portal", label: "Doctor Workspace (Individual Consultation)", category: "Core & Clinical", icon: "🩺" },
  { key: "doctors_overview", label: "Doctors Overview & Patient Allocation", category: "Core & Clinical", icon: "👥" },
  { key: "patients", label: "Patient Reception & Registration", category: "Core & Clinical", icon: "👤" },
  { key: "outpatient", label: "Outpatient Department (OPD)", category: "Core & Clinical", icon: "📋" },
  { key: "clinical", label: "Clinical Encounters & Charting", category: "Core & Clinical", icon: "📑" },
  { key: "emergency", label: "Emergency Care (ED / ER)", category: "Core & Clinical", icon: "🚨" },
  { key: "inpatient", label: "Inpatient Care & Bed Board", category: "Core & Clinical", icon: "🛏️" },
  { key: "icu", label: "Critical Care (ICU / NICU)", category: "Core & Clinical", icon: "💓" },
  { key: "surgery", label: "Surgery & Operation Theatre", category: "Core & Clinical", icon: "🔪" },
  { key: "laboratory", label: "Laboratory Diagnostics", category: "Diagnostics", icon: "🧪" },
  { key: "radiology", label: "Radiology & Imaging", category: "Diagnostics", icon: "🩻" },
  { key: "pharmacy", label: "Pharmacy & Dispensary", category: "Pharmacy", icon: "💊" },
  { key: "billing", label: "Billing & Cash Counter", category: "Finance", icon: "💳" },
  { key: "insurance", label: "Insurance & TPA Claims", category: "Finance", icon: "🛡️" },
  { key: "accounts", label: "Accounts & General Ledger", category: "Finance", icon: "🏦" },
  { key: "employees", label: "Hospital Staff & User Accounts", category: "Management", icon: "👥" },
  { key: "intelligence", label: "Hosp AI Clinical Intelligence", category: "Management", icon: "🤖" },
  { key: "reports", label: "Reports & Hospital Analytics", category: "Management", icon: "📈" },
  { key: "admin", label: "Administration & RBAC", category: "Management", icon: "⚙️" },
]

const ACTIONS_LIST: Array<{ key: string; label: string; icon: string; description: string }> = [
  { key: "view", label: "View", icon: "👁️", description: "View records, lists, and clinical details" },
  { key: "create", label: "Create", icon: "➕", description: "Register new records and submit entries" },
  { key: "edit", label: "Edit", icon: "✏️", description: "Modify and update existing information" },
  { key: "delete", label: "Delete", icon: "🗑️", description: "Void, cancel, or remove records" },
  { key: "approve", label: "Approve", icon: "✅", description: "Authorize clinical, financial, or administrative orders" },
  { key: "export", label: "Export", icon: "🖨️", description: "Print documents, download PDF and CSV reports" },
]

const MODULE_METADATA: Record<string, { name: string; icon: string; description: string }> = {
  patients: { name: "Patient Registration", icon: "👤", description: "Patient demographic intake, search, and MRN master records" },
  op: { name: "Outpatient (OPD)", icon: "🩺", description: "Doctor consultations, appointment queues, and vitals recording" },
  beds: { name: "Inpatient & Beds", icon: "🛏️", description: "Ward occupancy, bed transfers, admission and discharge management" },
  er: { name: "Emergency / ER", icon: "🚨", description: "Emergency triage, resuscitation bays, trauma care, and rapid intake" },
  clinical: { name: "Doctor Portal", icon: "📋", description: "Clinical notes, electronic prescriptions, diagnosis and encounter history" },
  surgery: { name: "Surgery & OT", icon: "🔪", description: "Operation theatre bookings, surgical notes, and anesthesia records" },
  icu: { name: "ICU Management", icon: "💓", description: "Critical care monitoring, ventilators, and bedside telemetry" },
  pharmacy: { name: "Pharmacy", icon: "💊", description: "Medication inventory, prescription dispensing, returns, and stock batches" },
  laboratory: { name: "Laboratory", icon: "🧪", description: "Specimen collection, hematology/biochemistry tests, and lab result sign-offs" },
  radiology: { name: "Radiology & Imaging", icon: "🩻", description: "X-Ray, CT, MRI, Ultrasound imaging worklists and radiologist reports" },
  billing: { name: "Billing & Cashier", icon: "💳", description: "OP/IP/ER invoices, cash desk receipts, lab payments, and refunds" },
  accounts: { name: "Financial Accounts", icon: "📊", description: "General ledger, journal vouchers, accounts payable/receivable, and P&L" },
  insurance: { name: "Insurance & TPA", icon: "🛡️", description: "Cashless pre-auth requests, claim document packs, query responses, settlements" },
  admin: { name: "Administration", icon: "⚙️", description: "Centralized RBAC, user provisioning, clinical directory, tariff catalog" },
  employees: { name: "Hospital Staff & Users", icon: "👥", description: "Employee master directory, credentials, and access role governance" },
  dashboard: { name: "Command Center", icon: "📈", description: "Hospital-wide operational KPIs, real-time census, and executive metrics" },
  patient_experience: { name: "Patient Experience", icon: "⭐", description: "Feedback, patient satisfaction scores, and grievance handling" },
  symptom_ai: { name: "AI Clinical Intelligence", icon: "🤖", description: "Symptom checker, diagnostic triage suggestions, and clinical NLP" },
  doctor_portal: { name: "Doctor Workspace", icon: "🩺", description: "Individual doctor consultation whiteboard, voice AI, prescription dispatch, and queue" },
  doctors_overview: { name: "Doctors Oversight & Patient Allocation", icon: "👥", description: "Complete hospital clinical overview: all doctors, active consults, and patient queue assignments" },
}

interface SpecialtyOption {
  id: number
  specialty_name: string
  department_name?: string
  status?: string
}

type RoleCatalogueItem = {
  id: string
  name: string
  description?: string
  is_system?: boolean
}

const roleFromCatalogue = (role: RoleCatalogueItem): AppRole => ({
  id: String(role.id),
  name: String(role.name),
  allowedModules: [],
  status: "Active",
  isSystem: Boolean(role.is_system),
})

/** Full / blanket module grant (e.g. `patients` or `*`) */
const hasFullModuleAccess = (rules: string[], moduleKey: string) =>
  Boolean(rules && (rules.includes("*") || rules.includes(moduleKey)))

/** A saved role can grant the whole module (`patients`) or a specific
 * granular action / sub-module (`patients:view`, `patients.clinical_records`).
 * Treat both as active in the matrix so reloading never makes a persisted grant look lost.
 */
const hasSavedModuleAccess = (rules: string[], moduleKey: string) =>
  Boolean(
    rules &&
      rules.some(
        (rule) =>
          rule === "*" ||
          rule === moduleKey ||
          rule.startsWith(`${moduleKey}.`) ||
          rule.startsWith(`${moduleKey}:`),
      ),
  )

const savedRulesForModule = (rules: string[], moduleKey: string) =>
  (rules || []).filter(
    (rule) =>
      rule === moduleKey ||
      rule.startsWith(`${moduleKey}.`) ||
      rule.startsWith(`${moduleKey}:`),
  )

const formatPermissionRule = (rule: string) =>
  rule
    .replace(/[.:]/g, " › ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

// This is the fixed hospital catalogue seeded by the backend.  It keeps the
// administration screen useful from its first paint (and during a transient
// gateway restart); the API result below supplies the saved permissions,
// active state and any custom roles.  These are intentionally the same role
// identifiers exposed by Login.
const FIXED_HOSPITAL_ROLE_CATALOGUE: AppRole[] = [
  ["ROLE_ADMIN", "System Administrator"],
  ["ROLE_DOCTOR", "Doctor"],
  ["ROLE_SURGEON", "Surgeon"],
  ["ROLE_ANESTHETIST", "Anesthetist"],
  ["ROLE_ER_PHYSICIAN", "Emergency Physician"],
  ["ROLE_PATHOLOGIST", "Pathologist"],
  ["ROLE_RADIOLOGIST", "Radiologist"],
  ["ROLE_PHYSIOTHERAPIST", "Physiotherapist"],
  ["ROLE_RECEPTIONIST", "Receptionist"],
  ["ROLE_FRONT_OFFICE_MANAGER", "Front Office Manager"],
  ["ROLE_NURSE", "Nurse"],
  ["ROLE_NURSING_SUPERVISOR", "Nursing Supervisor"],
  ["ROLE_PHARMACIST", "Pharmacist"],
  ["ROLE_PHARMACY_MANAGER", "Pharmacy Manager"],
  ["ROLE_LAB_TECHNICIAN", "Lab Technician"],
  ["ROLE_RADIOLOGY_TECHNICIAN", "Radiology Technician"],
  ["ROLE_HR_MANAGER", "HR Manager"],
  ["ROLE_HR_EXECUTIVE", "HR Executive"],
  ["ROLE_ACCOUNTANT", "Accountant"],
  ["ROLE_FINANCE_MANAGER", "Finance Manager"],
  ["ROLE_BILLING_EXECUTIVE", "Billing Executive"],
  ["ROLE_INSURANCE_TPA_OFFICER", "Insurance / TPA Officer"],
  ["ROLE_MEDICAL_RECORDS_OFFICER", "Medical Records Officer"],
  ["ROLE_INVENTORY_MANAGER", "Inventory Manager"],
  ["ROLE_FACILITY_MANAGER", "Facility Manager"],
  ["ROLE_COMPLIANCE_OFFICER", "Compliance Officer"],
  ["ROLE_IT_SUPPORT", "IT Support"],
].map(([id, name]) => ({
  id,
  name,
  allowedModules: [],
  status: "Active",
  isSystem: true,
}))

export default function Administration({
  initialTab,
  initialDoctorSubTab,
  onNavigateToDoctorPortal,
}: {
  initialTab?: "overview" | "roles" | "users" | "doctors" | "audit" | "settings" | "tariffs"
  initialDoctorSubTab?: "workspace" | "directory"
  onNavigateToDoctorPortal?: () => void
} = {}) {
  const [activeTab, setActiveTab] =
    useState<"overview" | "roles" | "users" | "doctors" | "audit" | "settings" | "tariffs">(initialTab || "overview")

  const [doctorSubTab, setDoctorSubTab] = useState<"workspace" | "directory">(
    initialDoctorSubTab || "workspace"
  )
  const [adminInspectingDoctor, setAdminInspectingDoctor] = useState<DoctorAccount | null>(null)

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  useEffect(() => {
    if (initialDoctorSubTab) {
      setDoctorSubTab(initialDoctorSubTab)
    }
  }, [initialDoctorSubTab])

  // Database States
  // The Login role catalogue is also the source for the administrator's
  // assignment list.  Render the fixed catalogue immediately; live data
  // enriches it with the saved permissions and custom roles.
  const [roles, setRoles] = useState<AppRole[]>(() => {
    try {
      const stored = RoleDatabase.getRoles()
      return stored && stored.length > 0 ? stored : FIXED_HOSPITAL_ROLE_CATALOGUE
    } catch {
      return FIXED_HOSPITAL_ROLE_CATALOGUE
    }
  })
  const [users, setUsers] = useState<AppUser[]>(() => {
    try {
      return RoleDatabase.getUsers()
    } catch {
      return []
    }
  })
  const [doctors, setDoctors] = useState<MasterDoctor[]>([])
  const [specialties, setSpecialties] = useState<SpecialtyOption[]>([])
  const [showSpecialtyModal, setShowSpecialtyModal] = useState(false)
  const [newSpecialtyName, setNewSpecialtyName] = useState("")
  const [specialtyNotice, setSpecialtyNotice] = useState("")
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoadingMore, setAuditLoadingMore] = useState(false)

  // Roles Tab State
  const [selectedRoleId, setSelectedRoleId] = useState<string>("ROLE_ADMIN")
  const [roleSearch, setRoleSearch] = useState("")
  const [moduleSearch, setModuleSearch] = useState("")
  const [matrixViewMode, setMatrixViewMode] = useState<"grid" | "table">("grid")
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false)
  const [showCloneRoleModal, setShowCloneRoleModal] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [newRoleDescription, setNewRoleDescription] = useState("")
  const [cloneSourceRoleId, setCloneSourceRoleId] = useState("ROLE_ADMIN")
  const [expandedGranularModule, setExpandedGranularModule] =
    useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  )
  const [roleNotice, setRoleNotice] = useState("")

  // Users Tab State
  const [userSearch, setUserSearch] = useState("")
  const [userRoleFilter, setUserRoleFilter] = useState("all")
  const [userStatusFilter, setUserStatusFilter] = useState("Active")
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)
  const [userDoctorDetails, setUserDoctorDetails] = useState<{
    specialty: string
    qualification: string
    room: string
    consultationFee: number
  }>({
    specialty: "General Medicine",
    qualification: "MBBS, MD",
    room: "Room 101",
    consultationFee: 500,
  })
  const [resetPassUser, setResetPassUser] = useState<AppUser | null>(null)
  const [newPassInput, setNewPassInput] = useState("")
  const [userNotice, setUserNotice] = useState("")

  // Doctor Master Tab State
  const [doctorSearch, setDoctorSearch] = useState("")
  const [doctorSectionFilter, setDoctorSectionFilter] = useState<string>("all")
  const [doctorStatusFilter, setDoctorStatusFilter] = useState<string>("all")
  const [showDoctorModal, setShowDoctorModal] = useState(false)
  const [editingDoctor, setEditingDoctor] = useState<MasterDoctor | null>(null)
  const [doctorNotice, setDoctorNotice] = useState("")

  // Credentials Editing Modal State
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [credentialsForm, setCredentialsForm] = useState<{
    id: string
    name: string
    username: string
    password?: string
    roleId: string
    staffId: string
    status: "Active" | "Inactive"
    doctorId?: string
  } | null>(null)

  // Audit Tab State
  const [auditSearch, setAuditSearch] = useState("")
  const [auditActionFilter, setAuditActionFilter] = useState("all")
  const [auditUserFilter, setAuditUserFilter] = useState("all")
  const [auditDateFilter, setAuditDateFilter] = useState("all")
  const [auditStatusFilter, setAuditStatusFilter] = useState("all")
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog | null>(
    null,
  )

  // Settings State
  const [mfaEnforced, setMfaEnforced] = useState(true)
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState<number | "">(30)
  const [minPasswordLength, setMinPasswordLength] = useState<number | "">(10)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState("")

  // Diagnostic Tariffs Tab State
  const [tariffs, setTariffs] = useState<DiagnosticTariffItem[]>([])
  const [tariffSearch, setTariffSearch] = useState("")
  const [tariffDepartmentFilter, setTariffDepartmentFilter] = useState<
    "all" | "Radiology" | DiagnosticDepartment
  >("all")
  const [tariffSubCategoryFilter, setTariffSubCategoryFilter] = useState<string>("all")
  const [editingTariffId, setEditingTariffId] = useState<string | null>(null)
  const [editingTariffPrice, setEditingTariffPrice] = useState<number | "">("")
  const [showAddTariffModal, setShowAddTariffModal] = useState(false)
  const [newTariffForm, setNewTariffForm] = useState<{
    code: string
    name: string
    department: DiagnosticDepartment
    modality: string
    bodyRegion: string
    subCategory: string
    variantProtocol: string
    hospitalAvailability: string
    tariffReference: string
    responsibleInCharge: string
    reportTemplate: string
    price: number | ""
    tat: string
  }>({
    code: "",
    name: "",
    department: "CT Scan",
    modality: "CT Scan",
    bodyRegion: "Brain",
    subCategory: "Neuro / Head",
    variantProtocol: "Plain",
    hospitalAvailability: "Enabled",
    tariffReference: "Existing Billing tariff",
    responsibleInCharge: "Dr. Sunita Rao (Senior Radiologist)",
    reportTemplate: "Approved CT Brain Plain Template",
    price: "",
    tat: "2 Hours",
  })
  const [tariffNotice, setTariffNotice] = useState("")

  const refreshAccessGovernance = async () => {
    // Fetch the public catalogue separately from administration details.
    // A delayed staff request must never make role templates disappear from
    // the role-assignment screen.
    const [catalogueResult, rolesResult, usersResult] = await Promise.allSettled([
      apiFetch<{ roles: RoleCatalogueItem[] }>("/api/auth/login-roles"),
      apiFetch<{ roles: any[] }>("/api/admin/roles"),
      apiFetch<{ users: any[] }>("/api/admin/users/all"),
    ])

    const catalogueRoles = catalogueResult.status === "fulfilled"
      ? (catalogueResult.value.roles || []).map(roleFromCatalogue)
      : []
    const serverRoles = rolesResult.status === "fulfilled"
      ? (rolesResult.value.roles || []).map((role) => ({
      id: String(role.id || role.role_key || ""),
      name: String(role.name || role.role_name || role.id || "Unnamed role"),
      allowedModules: Array.isArray(role.allowedModules)
        ? role.allowedModules
        : Array.isArray(role.allowed_modules)
          ? role.allowed_modules
          : [],
      status: String(role.status || "active").toLowerCase() === "active" ? "Active" : "Inactive",
      isSystem: Boolean(role.is_system),
    }))
      : []

    let localRoles: AppRole[] = []
    try {
      localRoles = RoleDatabase.getRoles()
    } catch {
      localRoles = []
    }

    const mergedRoles = new Map<string, AppRole>()

    // 1. Initial base catalogue
    FIXED_HOSPITAL_ROLE_CATALOGUE.forEach((role) => {
      mergedRoles.set(role.id, { ...role })
    })

    // 2. Local database roles (has saved customizations & defaults)
    localRoles.forEach((role) => {
      const existing = mergedRoles.get(role.id)
      mergedRoles.set(role.id, {
        ...existing,
        ...role,
        allowedModules: Array.isArray(role.allowedModules) ? role.allowedModules : (existing?.allowedModules || []),
        status: (role.status || existing?.status || "Active") as "Active" | "Inactive",
        isSystem: role.isSystem ?? existing?.isSystem ?? false,
      })
    })

    // 3. Auth login-roles catalogue (enrich names/status without wiping allowedModules)
    catalogueRoles.forEach((role) => {
      const existing = mergedRoles.get(role.id)
      if (existing) {
        mergedRoles.set(role.id, {
          ...existing,
          name: role.name || existing.name,
          isSystem: role.isSystem ?? existing.isSystem,
        })
      } else {
        mergedRoles.set(role.id, { ...role })
      }
    })

    // 4. Server roles from Admin API (has allowedModules)
    serverRoles.forEach((role) => {
      const existing = mergedRoles.get(role.id)
      const allowed = Array.isArray(role.allowedModules)
        ? role.allowedModules
        : (existing?.allowedModules || [])
      mergedRoles.set(role.id, {
        id: role.id,
        name: role.name || existing?.name || role.id,
        allowedModules: allowed,
        status: (role.status || existing?.status || "Active") as "Active" | "Inactive",
        isSystem: role.isSystem ?? existing?.isSystem ?? false,
      })
    })

    setRoles(Array.from(mergedRoles.values()).sort((a, b) => a.name.localeCompare(b.name)))

    const serverUsers = usersResult.status === "fulfilled"
      ? (usersResult.value.users || []).map((user) => ({
      id: String(user.id),
      username: String(user.username || ""),
      roleId: String(user.roleId || `ROLE_${String(user.access_role || "STAFF").toUpperCase()}`),
      name: String(user.name || user.full_name || user.username || ""),
      staffId: String(user.staffId || user.employee_id || `STF-${user.id}`),
      status: String(user.status || "active").toLowerCase() === "active" ? "Active" : "Inactive",
      customModules: user.customModules || user.allowedModules,
      allowedModules: user.allowedModules || user.customModules,
      department: user.department,
    } as AppUser))
      : []

    let localUsers: AppUser[] = []
    try {
      localUsers = RoleDatabase.getUsers()
    } catch {
      localUsers = []
    }
    const mergedUsersMap = new Map<string, AppUser>()
    localUsers.forEach((u) => {
      if (u.username) mergedUsersMap.set(u.username.toLowerCase(), { ...u })
    })
    serverUsers.forEach((u) => {
      const key = u.username.toLowerCase()
      const existing = mergedUsersMap.get(key)
      mergedUsersMap.set(key, {
        ...existing,
        ...u,
        customModules: existing?.customModules || u.customModules,
        allowedModules: existing?.allowedModules || u.allowedModules,
        department: existing?.department || u.department,
      })
    })
    setUsers(Array.from(mergedUsersMap.values()))
  }

  const loadRoleCatalogueFallback = async () => {
    const response = await apiFetch<{ roles: RoleCatalogueItem[] }>("/api/auth/login-roles")
    const fallbackRoles = new Map(FIXED_HOSPITAL_ROLE_CATALOGUE.map((role) => [role.id, role]))
    ;(response.roles || []).map(roleFromCatalogue).forEach((role) => {
      fallbackRoles.set(role.id, { ...fallbackRoles.get(role.id), ...role })
    })
    setRoles(Array.from(fallbackRoles.values()).sort((a, b) => a.name.localeCompare(b.name)))
  }

  const refreshSpecialties = async () => {
    let response: { specialties: SpecialtyOption[] }
    try {
      response = await apiFetch<{ specialties: SpecialtyOption[] }>("/api/admin/specialties")
    } catch {
      response = await apiFetch<{ specialties: SpecialtyOption[] }>("/api/auth/login-specialties")
    }
    setSpecialties((response.specialties || []).filter((specialty) =>
      String(specialty.status || "active").toLowerCase() === "active",
    ))
  }

  const refreshData = () => {
    void refreshAccessGovernance().catch((error) => {
      void loadRoleCatalogueFallback()
        .then(() => setRoleNotice("Role templates loaded. Sign in again if you need to edit permissions or assign staff."))
        .catch(() => setRoleNotice(error instanceof Error ? error.message : "Unable to load access governance records."))
    })

    const masterDocs = getDoctorMaster()
    setDoctors(masterDocs)
    setAuditLogs(AuditDatabase.getLogs())
    setTariffs(DiagnosticTariffDatabase.getTariffs())

    // Auto-reconcile Doctor Master with RoleDatabase so all doctors have an active login and assigned role
    const currentUsers = RoleDatabase.getUsers()
    let usersReconciled = false
    masterDocs.forEach((doc) => {
      if (!doc || !doc.name) return
      const cleanName = (doc.name || "").toLowerCase().replace(/dr\.?\s*/, "").replace(/[^a-z0-9]/g, "")
      const docUser = (doc.username || cleanName || `doc_${doc.id.toLowerCase()}`).trim().toLowerCase()
      const exists = currentUsers.some(
        (u) => u.username.toLowerCase() === docUser || u.id === `U_${doc.id}`,
      )
      if (!exists) {
        RoleDatabase.upsertUser({
          id: `U_${doc.id}`,
          name: doc.name,
          username: docUser,
          password: doc.password || "Doctor@123",
          roleId: doc.roleId || "ROLE_DOCTOR",
          staffId: doc.staffId || doc.id,
          status: doc.verified !== false ? "Active" : "Inactive",
          department: doc.specialty || "Clinical",
          allowedModules: [
            "patients",
            "appointments",
            "clinical",
            "inpatient",
            "emergency",
            "laboratory",
            "radiology",
            "pharmacy",
            "surgery",
            "icu",
            "discharge",
            "triage",
          ],
        })
        usersReconciled = true
      }
    })
    if (usersReconciled) {
      setUsers(RoleDatabase.getUsers())
    }
  }

  useEffect(() => {
    refreshData()
    void refreshSpecialties().catch(() => {
      setSpecialtyNotice("Unable to load the Specialty Master.")
    })

    const handleDoctorUpdate = () => refreshData()
    const handleTariffUpdate = () => refreshData()

    window.addEventListener("doctor_master_updated", handleDoctorUpdate)
    window.addEventListener("diagnostic_tariffs_updated", handleTariffUpdate)
    return () => {
      window.removeEventListener("doctor_master_updated", handleDoctorUpdate)
      window.removeEventListener("diagnostic_tariffs_updated", handleTariffUpdate)
    }
  }, [])

  const handleCreateSpecialty = async (event: React.FormEvent) => {
    event.preventDefault()
    const specialtyName = newSpecialtyName.trim()
    if (!specialtyName) return

    setShowSpecialtyModal(false)
    setNewSpecialtyName("")
    toast.success(`Specialty "${specialtyName}" added.`, { duration: 3500 })
    setSpecialtyNotice(`Specialty "${specialtyName}" added.`)
    setTimeout(() => setSpecialtyNotice(""), 4000)

    try {
      await apiFetch("/api/admin/specialties", {
        method: "POST",
        body: JSON.stringify({ specialty_name: specialtyName, department_name: specialtyName }),
      })
      await refreshSpecialties()
    } catch (error) {
      console.warn("Backend create specialty notice:", error)
    }
  }

  const AUDIT_PAGE_SIZE = 50

  function mapAuditRow(row: any): AuditLog {
    let description = row.action
    if (row.entity_key) description += ` ${row.module_name} #${row.entity_key}`
    else description += ` ${row.module_name}`
    if (row.payload) {
      try {
        const parsed = JSON.parse(row.payload)
        description += ` -- ${JSON.stringify(parsed)}`
      } catch {
        // payload wasn't JSON -- leave description as-is
      }
    }
    return {
      id: String(row.id),
      userId: row.actor_username || "",
      username: row.actor_username || "system",
      action: row.action,
      module: row.module_name,
      description,
      timestamp: row.created_at,
      status: "Success",
    }
  }

  useEffect(() => {
    setAuditLogs(AuditDatabase.getLogs())
  }, [activeTab])

  const loadMoreAuditLogs = async () => {
    setAuditLoadingMore(true)
    try {
      const res = await apiFetch<{ logs: any[] ;total: number }>(
        `/api/audit/logs?limit=${AUDIT_PAGE_SIZE}&offset=${auditLogs.length}`,
      )
      setAuditLogs((prev) => [...prev, ...(res.logs || []).map(mapAuditRow)])
      setAuditTotal(res.total || 0)
    } catch {
      // Leave the already-loaded page in place on failure.
    } finally {
      setAuditLoadingMore(false)
    }
  }

  const selectedRole =
    roles.find((r) => r.id === selectedRoleId) || roles[0] || null
  const assignableRoles = roles.filter(
    (role) => !role.id.includes("ADMIN") && role.status !== "Inactive",
  )
  const selectedRoleIsProtected = Boolean(selectedRole?.id.includes("ADMIN"))

  const openNewUser = (preferredRoleId?: string) => {
    if (!assignableRoles.length) {
      setRoleNotice("Create an access role first, then assign it to staff members.")
      setActiveTab("roles")
      return
    }
    const selectedAssignableRole = assignableRoles.find(
      (role) => role.id === preferredRoleId,
    ) || assignableRoles[0]
    setEditingUser({
      id: "U_" + Date.now(),
      username: "",
      password: "",
      roleId: selectedAssignableRole.id,
      name: "",
      staffId: "EMP-" + Math.floor(100 + Math.random() * 900),
      status: "Active",
    })
    setShowUserModal(true)
    setActiveTab("users")
  }

  // Role Operations
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoleName.trim()) return

    const roleId =
      "ROLE_" +
      newRoleName
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "_")
    const existing = roles.find((r) => r.id === roleId)
    if (existing) {
      toast.error("A role with a similar identifier already exists.")
      return
    }

    const newRole: AppRole = {
      id: roleId,
      name: newRoleName.trim(),
      allowedModules: [],
    }

    // 1. Immediately save to RoleDatabase
    RoleDatabase.upsertRole(newRole)
    setRoles(RoleDatabase.getRoles().sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedRoleId(newRole.id)

    // 2. Immediately close modal and reset fields
    setShowCreateRoleModal(false)
    setNewRoleName("")
    setNewRoleDescription("")

    // 3. Show toast and banner notice
    const msg = `Role "${newRole.name}" created successfully.`
    toast.success(msg, { duration: 4000 })
    setRoleNotice(msg)
    setTimeout(() => setRoleNotice(""), 6000)

    // 4. Background API sync
    try {
      await apiFetch("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ ...newRole, description: newRoleDescription }),
      })
      void refreshAccessGovernance().catch(() => {})
    } catch (error) {
      console.warn("Backend create role sync notice:", error)
    }
  }

  const handleCloneRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoleName.trim()) return

    const sourceRole = roles.find((r) => r.id === cloneSourceRoleId)
    const sourceModules = sourceRole
      ? [...sourceRole.allowedModules]
      : ["dashboard"]

    const roleId =
      "ROLE_" +
      newRoleName
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "_")
    const newRole: AppRole = {
      id: roleId,
      name: newRoleName.trim(),
      allowedModules: sourceModules,
    }

    // 1. Immediately save to RoleDatabase
    RoleDatabase.upsertRole(newRole)
    setRoles(RoleDatabase.getRoles().sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedRoleId(newRole.id)

    // 2. Immediately close modal
    setShowCloneRoleModal(false)
    setNewRoleName("")

    // 3. Show toast and notice
    const msg = `Cloned role "${newRole.name}" created with ${sourceModules.length} module grants.`
    toast.success(msg, { duration: 4000 })
    setRoleNotice(msg)
    setTimeout(() => setRoleNotice(""), 6000)

    // 4. Background API sync
    try {
      await apiFetch("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ ...newRole, description: newRoleDescription }),
      })
      void refreshAccessGovernance().catch(() => {})
    } catch (error) {
      console.warn("Backend clone role sync notice:", error)
    }
  }

  const handleSaveRoleModules = async () => {
    if (!selectedRole) return
    setSaveStatus("saving")
    setRoleNotice("")
    try {
      // 1. Immediately persist to local RoleDatabase
      RoleDatabase.upsertRole(selectedRole)

      // 2. Dispatch update to API
      const result = await apiFetch<{
        success: boolean
        role?: { allowedModules?: string[]; allowed_modules?: string[] }
      }>(`/api/admin/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          allowedModules: selectedRole.allowedModules,
          name: selectedRole.name,
          status: selectedRole.status,
        }),
      })

      if (!result.success) throw new Error("The database did not confirm the permission update.")

      const finalAllowed = Array.isArray(result.role?.allowedModules)
        ? result.role.allowedModules
        : Array.isArray(result.role?.allowed_modules)
          ? result.role.allowed_modules
          : selectedRole.allowedModules

      const savedRole: AppRole = { ...selectedRole, allowedModules: finalAllowed }
      RoleDatabase.upsertRole(savedRole)

      // Ensure React state maintains the updated role and allowedModules
      setRoles((prev) => prev.map((r) => (r.id === selectedRole.id ? savedRole : r)))

      setSaveStatus("saved")
      setRoleNotice(
        `${selectedRole.name} access saved to database (${savedRole.allowedModules.length} permission rules).`,
      )
      setTimeout(() => setSaveStatus("idle"), 3500)
    } catch (error) {
      setSaveStatus("idle")
      setRoleNotice(error instanceof Error ? error.message : "Unable to save role permissions.")
    }
  }

  const handleToggleRoleStatus = async () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const nextStatus = selectedRole.status === "Inactive" ? "active" : "inactive"
    try {
      await apiFetch(`/api/admin/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      })
      await refreshAccessGovernance()
      setRoleNotice(`${selectedRole.name} is now ${nextStatus}.`)
    } catch (error) {
      setRoleNotice(error instanceof Error ? error.message : "Unable to update role status.")
    }
  }

  const toggleModuleForSelectedRole = (moduleKey: string) => {
    if (!selectedRole || selectedRoleIsProtected) return
    const currentModules = selectedRole.allowedModules
    const isCurrentlyFull = hasFullModuleAccess(currentModules, moduleKey)

    let newModules: string[]
    if (isCurrentlyFull) {
      newModules = currentModules.filter(
        (m) =>
          m !== moduleKey &&
          m !== "*" &&
          !m.startsWith(`${moduleKey}.`) &&
          !m.startsWith(`${moduleKey}:`),
      )
    } else {
      newModules = [
        ...currentModules.filter(
          (m) =>
            m !== moduleKey &&
            !m.startsWith(`${moduleKey}.`) &&
            !m.startsWith(`${moduleKey}:`),
        ),
        moduleKey,
      ]
    }

    const updatedRole = { ...selectedRole, allowedModules: newModules }
    RoleDatabase.upsertRole(updatedRole)
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
  }

  const isActionGranted = (rules: string[], moduleKey: string, actionKey: string): boolean => {
    if (!rules || !Array.isArray(rules)) return false
    if (rules.includes("*") || rules.includes(moduleKey)) return true
    if (actionKey === "view" && (rules.includes(`${moduleKey}:read`) || rules.includes(`${moduleKey}.read`))) return true
    if ((actionKey === "create" || actionKey === "edit") && (rules.includes(`${moduleKey}:write`) || rules.includes(`${moduleKey}.write`))) return true
    return rules.includes(`${moduleKey}:${actionKey}`) || rules.includes(`${moduleKey}.${actionKey}`)
  }

  const toggleActionForSelectedRole = (moduleKey: string, actionKey: string) => {
    if (!selectedRole || selectedRoleIsProtected) return
    const currentRules = selectedRole.allowedModules
    const hasFull = currentRules.includes(moduleKey) || currentRules.includes("*")
    const specificRule = `${moduleKey}:${actionKey}`
    const isGranted = isActionGranted(currentRules, moduleKey, actionKey)

    let newRules: string[]
    if (hasFull) {
      // Decompose blanket access: keep all 5 other actions, disable only the clicked action
      const allActionKeys = ["view", "create", "edit", "delete", "approve", "export"]
      const remaining = allActionKeys.filter((a) => a !== actionKey)
      newRules = currentRules.filter(
        (r) => r !== moduleKey && r !== "*" && !r.startsWith(`${moduleKey}:`) && !r.startsWith(`${moduleKey}.`),
      )
      remaining.forEach((a) => newRules.push(`${moduleKey}:${a}`))
    } else if (isGranted) {
      newRules = currentRules.filter(
        (r) =>
          r !== specificRule &&
          r !== `${moduleKey}.${actionKey}` &&
          !(actionKey === "view" && (r === `${moduleKey}:read` || r === `${moduleKey}.read`)) &&
          !((actionKey === "create" || actionKey === "edit") && (r === `${moduleKey}:write` || r === `${moduleKey}.write`)),
      )
    } else {
      newRules = [...currentRules, specificRule]
    }

    const updatedRole = { ...selectedRole, allowedModules: newRules }
    RoleDatabase.upsertRole(updatedRole)
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
  }

  const selectAllCategoryModules = (categoryModules: string[]) => {
    if (!selectedRole || selectedRoleIsProtected) return
    const combined = Array.from(
      new Set([...selectedRole.allowedModules, ...categoryModules]),
    )
    const updatedRole = { ...selectedRole, allowedModules: combined }
    RoleDatabase.upsertRole(updatedRole)
    setRoles(
      roles.map((r) =>
        r.id === selectedRole.id ? updatedRole : r,
      ),
    )
  }

  const clearCategoryModules = (categoryModules: string[]) => {
    if (!selectedRole || selectedRoleIsProtected) return
    const updated = selectedRole.allowedModules.filter((m) => {
      const baseMod = m.split(/[.:]/, 1)[0]
      return !categoryModules.includes(baseMod)
    })
    const updatedRole = { ...selectedRole, allowedModules: updated }
    RoleDatabase.upsertRole(updatedRole)
    setRoles(
      roles.map((r) =>
        r.id === selectedRole.id ? updatedRole : r,
      ),
    )
  }

  // Preset Role Permissions
  const applyPresetFullAccess = () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const allModulesList = MODULE_CATEGORIES.flatMap((c) => c.modules)
    const updatedRole = { ...selectedRole, allowedModules: Array.from(new Set([...allModulesList, "*"])) }
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
    setRoleNotice("Applied Full Administrator Access preset.")
  }

  const applyPresetClinical = () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const clinicalMods = ["patients", "op", "beds", "er", "clinical", "surgery", "icu"]
    const clinicalRules = clinicalMods.flatMap((m) => [`${m}:view`, `${m}:create`, `${m}:edit`, `${m}:export`])
    const updatedRole = { ...selectedRole, allowedModules: clinicalRules }
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
    setRoleNotice("Applied Clinical Standard Care preset.")
  }

  const applyPresetDiagnostics = () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const diagMods = ["pharmacy", "laboratory", "radiology"]
    const diagRules = diagMods.flatMap((m) => [`${m}:view`, `${m}:create`, `${m}:edit`, `${m}:approve`, `${m}:export`])
    const updatedRole = { ...selectedRole, allowedModules: diagRules }
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
    setRoleNotice("Applied Diagnostic & Pharmacy Suite preset.")
  }

  const applyPresetFinance = () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const finMods = ["billing", "accounts", "insurance"]
    const finRules = finMods.flatMap((m) => [`${m}:view`, `${m}:create`, `${m}:edit`, `${m}:approve`, `${m}:export`])
    const updatedRole = { ...selectedRole, allowedModules: finRules }
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
    setRoleNotice("Applied Finance, Billing & TPA preset.")
  }

  const applyPresetReadOnly = () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const allMods = MODULE_CATEGORIES.flatMap((c) => c.modules)
    const readRules = allMods.map((m) => `${m}:view`)
    const updatedRole = { ...selectedRole, allowedModules: readRules }
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
    setRoleNotice("Applied View-Only Auditor preset across all modules.")
  }

  const applyPresetRevokeAll = () => {
    if (!selectedRole || selectedRoleIsProtected) return
    const updatedRole = { ...selectedRole, allowedModules: [] }
    setRoles(roles.map((r) => (r.id === selectedRole.id ? updatedRole : r)))
    setRoleNotice("Revoked all permissions for this role.")
  }

  const handleDeleteRole = async (role: AppRole) => {
    if (role.id === "ROLE_ADMIN" || role.id === "ROLE_SUPERADMIN") {
      alert("System Administrator roles cannot be deleted.")
      return
    }
    if (role.isSystem) {
      alert("Built-in system role templates cannot be deleted. You can deactivate this role instead.")
      return
    }
    const assignedUsers = users.filter((u) => u.roleId === role.id)
    if (assignedUsers.length > 0) {
      alert(
        `Cannot delete role "${role.name}" because ${assignedUsers.length} staff member(s) are currently assigned to it. Please reassign those staff members first.`,
      )
      return
    }
    if (!confirm(`Are you sure you want to permanently delete the role "${role.name}" (${role.id})?`)) {
      return
    }
    try {
      await apiFetch(`/api/admin/roles/${encodeURIComponent(role.id)}`, {
        method: "DELETE",
      })
      await refreshAccessGovernance()
      const remaining = roles.filter((r) => r.id !== role.id)
      if (selectedRoleId === role.id) {
        setSelectedRoleId(remaining[0]?.id || "ROLE_ADMIN")
      }
      setRoleNotice(`Role "${role.name}" has been deleted.`)
    } catch {
      RoleDatabase.deleteRole(role.id)
      await refreshAccessGovernance()
      setRoleNotice(`Role "${role.name}" deleted.`)
    }
  }

  // Quick 1-click User Status Toggle
  const handleQuickToggleUserStatus = async (user: AppUser) => {
    const nextStatus = (user.status || "Active") === "Active" ? "Inactive" : "Active"
    const updated = { ...user, status: nextStatus as "Active" | "Inactive" }
    RoleDatabase.upsertUser(updated)
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      })
    } catch {}
    await refreshAccessGovernance()
    setUserNotice(`User @${user.username} is now ${nextStatus}.`)
  }

  // User Accounts Operations
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return

    const trimmedUsername = (editingUser.username || "").trim().toLowerCase()
    const trimmedName = (editingUser.name || "").trim()

    if (!trimmedUsername) {
      toast.error("Username ID is required.")
      return
    }
    if (!trimmedName) {
      toast.error("Full name is required.")
      return
    }

    const currentUsers = RoleDatabase.getUsers()
    const existingIndex = currentUsers.findIndex(
      (u) =>
        u.id === editingUser.id ||
        (u.username && u.username.toLowerCase() === trimmedUsername),
    )
    const existingUser = existingIndex >= 0 ? currentUsers[existingIndex] : null
    const isNew = !existingUser

    // Validate password for new user
    if (isNew && (!editingUser.password || editingUser.password.trim().length < 4)) {
      toast.error("Password is required for new accounts (minimum 4 characters).")
      return
    }

    const passwordToSave =
      editingUser.password && editingUser.password.trim()
        ? editingUser.password.trim()
        : existingUser?.password || "password123"

    const role = roles.find((item) => item.id === editingUser.roleId)
    const effectiveAllowed =
      Array.isArray(editingUser.customModules) && editingUser.customModules.length > 0
        ? editingUser.customModules
        : role?.allowedModules || []

    const userToSave: AppUser = {
      id: editingUser.id || existingUser?.id || `U_${Date.now()}`,
      name: trimmedName,
      username: trimmedUsername,
      password: passwordToSave,
      staffId:
        (editingUser.staffId || "").trim() ||
        existingUser?.staffId ||
        `STF-${String(currentUsers.length + 1).padStart(3, "0")}`,
      roleId: editingUser.roleId || existingUser?.roleId || "ROLE_STAFF",
      status: editingUser.status || "Active",
      department: editingUser.department || existingUser?.department,
      allowedModules: effectiveAllowed,
      customModules:
        editingUser.customModules && editingUser.customModules.length > 0
          ? editingUser.customModules
          : undefined,
    }

    // 1. Instantly save to RoleDatabase (localStorage + memory)
    const updatedUsers = RoleDatabase.upsertUser(userToSave)
    setUsers(updatedUsers)

    // 2. If assigned role is a doctor, automatically sync to doctor master
    const isDoctor =
      userToSave.roleId === "ROLE_DOCTOR" ||
      userToSave.roleId.toLowerCase().includes("doctor") ||
      userToSave.roleId.toLowerCase().includes("surgeon")

    if (isDoctor) {
      try {
        const masterDocs = getDoctorMaster()
        const existingDoc = masterDocs.find(
          (d) =>
            d.id === userToSave.id ||
            (d.username && d.username.toLowerCase() === userToSave.username.toLowerCase()),
        )
        if (existingDoc) {
          updateDoctorMaster({
            ...existingDoc,
            name: userToSave.name,
            specialty: userDoctorDetails.specialty,
            qualification: userDoctorDetails.qualification,
            room: userDoctorDetails.room,
            consultationFee: userDoctorDetails.consultationFee,
          })
        } else {
          addDoctorMaster({
            id: userToSave.id,
            name: userToSave.name,
            username: userToSave.username,
            staffId: userToSave.staffId,
            specialty: userDoctorDetails.specialty,
            qualification: userDoctorDetails.qualification,
            room: userDoctorDetails.room,
            consultationFee: userDoctorDetails.consultationFee,
            section: "Main",
            verified: true,
          })
        }
        setDoctors(getDoctorMaster())
      } catch (err) {
        console.warn("Could not sync doctor master:", err)
      }
    }

    // 3. Immediately close modal card and clear editing state
    setShowUserModal(false)
    setEditingUser(null)

    // 4. Show clear feedback message via toast and banner
    const successMsg = isNew
      ? `User account "${userToSave.name}" (@${userToSave.username}) created successfully.`
      : `User account "${userToSave.name}" (@${userToSave.username}) updated successfully.`

    toast.success(successMsg, { duration: 4500, id: "admin-save-user-toast" })
    setUserNotice(successMsg)
    setTimeout(() => {
      setUserNotice((prev) => (prev === successMsg ? "" : prev))
    }, 6000)

    // 5. Asynchronously synchronize with backend API
    const payload = {
      username: userToSave.username,
      password: userToSave.password,
      name: userToSave.name,
      staffId: userToSave.staffId,
      roleId: userToSave.roleId,
      status: userToSave.status || "Active",
      department: userToSave.department,
      allowedModules: effectiveAllowed,
      customModules: userToSave.customModules || null,
    }

    try {
      await apiFetch(
        isNew ? "/api/admin/users/create" : `/api/admin/users/${encodeURIComponent(userToSave.id)}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify(payload),
        },
      )
      void refreshAccessGovernance().catch(() => {})
    } catch (apiError) {
      console.warn("Backend user sync notice:", apiError)
      if (
        apiError instanceof Error &&
        !apiError.message.includes("Failed to fetch") &&
        !apiError.message.includes("404")
      ) {
        toast(apiError.message, { icon: "ℹ️", duration: 4000 })
      }
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetPassUser || !newPassInput) return
    const targetUser = resetPassUser
    const newPassword = newPassInput.trim()

    if (newPassword.length < 4) {
      toast.error("New password must be at least 4 characters.")
      return
    }

    // 1. Update in RoleDatabase
    RoleDatabase.upsertUser({
      ...targetUser,
      password: newPassword,
    })
    setUsers(RoleDatabase.getUsers())

    // 2. Close modal immediately
    setResetPassUser(null)
    setNewPassInput("")

    // 3. Show toast notification
    const msg = `Password for @${targetUser.username} updated successfully.`
    toast.success(msg, { duration: 4000, id: "admin-reset-pw-toast" })
    setUserNotice(msg)
    setTimeout(() => {
      setUserNotice((prev) => (prev === msg ? "" : prev))
    }, 6000)

    // 4. Sync with backend
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(targetUser.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: newPassword }),
      })
    } catch (error) {
      console.warn("Backend reset-password sync notice:", error)
    }
  }

  const handleDeleteUser = async (user: AppUser) => {
    if (
      !confirm(
        `Deactivate access for @${user.username} (${user.name})? They will be signed out immediately and can no longer log in. The account stays in the inactive list for audit history.`,
      )
    )
      return

    // 1. Update status to Inactive in RoleDatabase
    RoleDatabase.upsertUser({
      ...user,
      status: "Inactive",
    })
    setUsers(RoleDatabase.getUsers())

    // 2. Show toast notification
    const msg = `User @${user.username} access deactivated.`
    toast.success(msg, { duration: 4000, id: "admin-delete-user-toast" })
    setUserNotice(msg)
    setTimeout(() => {
      setUserNotice((prev) => (prev === msg ? "" : prev))
    }, 6000)

    // 3. Sync with backend
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" })
      void refreshAccessGovernance().catch(() => {})
    } catch (error) {
      console.warn("Backend delete user sync notice:", error)
    }
  }

  // ── Doctor Master Operations ─────────────────────────────────────────────

  const handleOpenAddDoctorModal = () => {
    const nextNum = doctors.length + 1
    const nextId = `IMP-${String(nextNum).padStart(3, "0")}`
    setEditingDoctor({
      id: nextId,
      name: "",
      qualification: "M.B.B.S.",
      specialty: "General Medicine",
      section: "Main",
      verified: true,
      username: "",
      roleId: "ROLE_DOCTOR",
      password: "Doctor@123",
      room: `Room ${200 + nextNum}`,
      staffId: nextId,
      consultationFee: 500,
    })
    setShowDoctorModal(true)
  }

  const handleSaveDoctor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingDoctor || !editingDoctor.name.trim()) return

    const isNew = !doctors.some((d) => d.id === editingDoctor.id)
    let updatedDocs: MasterDoctor[]

    // Generate clean username if missing
    let finalDoc = {
      ...editingDoctor,
      consultationFee:
        editingDoctor.consultationFee !== undefined &&
        editingDoctor.consultationFee !== null &&
        (editingDoctor.consultationFee as any) !== "" &&
        !isNaN(Number(editingDoctor.consultationFee))
          ? Math.max(0, Number(editingDoctor.consultationFee))
          : 500,
    }

    if (!finalDoc.username) {
      const cleanName = finalDoc.name
        .toLowerCase()
        .replace(/dr\.?\s*/, "")
        .replace(/[^a-z0-9]/g, "")
      finalDoc.username = cleanName || `doc_${finalDoc.id.toLowerCase()}`
    }

    const assignedRoleId = finalDoc.roleId || "ROLE_DOCTOR"
    finalDoc.roleId = assignedRoleId

    const docPassword =
      finalDoc.password && finalDoc.password.trim()
        ? finalDoc.password.trim()
        : "Doctor@123"
    finalDoc.password = docPassword

    if (isNew) {
      updatedDocs = addDoctorMaster(finalDoc)
    } else {
      updatedDocs = updateDoctorMaster(finalDoc)
    }
    setDoctors(updatedDocs)

    // AUTOMATIC ROLE ASSIGNMENT & USER ACCOUNT PROVISIONING
    const doctorRole =
      roles.find((r) => r.id === assignedRoleId) ||
      roles.find((r) => r.id === "ROLE_DOCTOR")
    const baseAllowed = doctorRole?.allowedModules || [
      "doctor_portal",
      "patients",
      "appointments",
      "clinical",
      "inpatient",
      "emergency",
      "laboratory",
      "radiology",
      "pharmacy",
      "surgery",
      "icu",
      "discharge",
      "triage",
    ]
    const roleAllowed = baseAllowed.includes("doctor_portal") ? baseAllowed : ["doctor_portal", ...baseAllowed]

    const docUser: AppUser = {
      id: `U_${finalDoc.id}`,
      name: finalDoc.name,
      username: finalDoc.username,
      password: docPassword,
      staffId: finalDoc.staffId || finalDoc.id,
      roleId: assignedRoleId,
      status: finalDoc.verified ? "Active" : "Inactive",
      department: finalDoc.specialty || "Clinical",
      allowedModules: roleAllowed,
    }

    // 1. Instantly update RoleDatabase and users state
    const updatedUsers = RoleDatabase.upsertUser(docUser)
    setUsers(updatedUsers)

    // 2. Immediately close modal and clear editing doctor
    setShowDoctorModal(false)
    setEditingDoctor(null)

    // 3. Show clear feedback toast and banner
    const docSuccessMsg = `Doctor "${finalDoc.name}" saved with role "${doctorRole?.name || assignedRoleId}" and login ID "@${finalDoc.username}" (Password: ${docPassword})!`
    toast.success(docSuccessMsg, { duration: 5000, id: "doctor-saved-toast" })
    setDoctorNotice(docSuccessMsg)
    setTimeout(() => setDoctorNotice(""), 6000)

    AuditDatabase.logEvent(
      isNew ? "Doctor Added & Role Assigned" : "Doctor Profile & Role Updated",
      "Doctor Management",
      `${isNew ? "Added doctor" : "Updated doctor"} '${finalDoc.name}' (${finalDoc.specialty}) — Assigned Role: ${assignedRoleId}, Login ID: @${finalDoc.username}`,
      "Success",
    )

    // 4. Asynchronously sync to backend doctor & user APIs
    try {
      await apiFetch(
        isNew
          ? "/api/admin/doctors"
          : `/api/admin/doctors/${encodeURIComponent(finalDoc.id)}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify({
            name: finalDoc.name,
            doctor_name: finalDoc.name,
            qualification: finalDoc.qualification,
            specialty: finalDoc.specialty,
            section: finalDoc.section,
            staffId: finalDoc.staffId,
            staff_id: finalDoc.staffId,
            username: finalDoc.username,
            room: finalDoc.room,
            consultationFee: finalDoc.consultationFee,
            consultation_fee: finalDoc.consultationFee,
            role_key: assignedRoleId,
            roleId: assignedRoleId,
            password: docPassword,
            status: finalDoc.verified ? "available" : "inactive",
          }),
        },
      )
    } catch (apiErr) {
      console.warn("Backend doctor sync notice:", apiErr)
    }

    try {
      await apiFetch("/api/admin/users/create", {
        method: "POST",
        body: JSON.stringify({
          username: docUser.username,
          password: docUser.password,
          name: docUser.name,
          staffId: docUser.staffId,
          roleId: docUser.roleId,
          status: docUser.status,
          department: docUser.department,
          allowedModules: docUser.allowedModules,
        }),
      })
    } catch (userErr) {
      try {
        await apiFetch(`/api/admin/users/${encodeURIComponent(docUser.id)}`, {
          method: "PUT",
          body: JSON.stringify({
            username: docUser.username,
            password: docUser.password,
            name: docUser.name,
            staffId: docUser.staffId,
            roleId: docUser.roleId,
            status: docUser.status,
            department: docUser.department,
          }),
        })
      } catch {}
    }
  }

  const handleDeleteDoctor = (doc: MasterDoctor) => {
    if (
      !confirm(
        `Are you sure you want to remove ${doc.name} (${doc.id}) from the Doctor Master roster?`,
      )
    )
      return
    const updated = deleteDoctorMaster(doc.id)
    setDoctors(updated)

    AuditDatabase.logEvent(
      "Doctor Deleted",
      "Doctor Management",
      `Removed doctor '${doc.name}' (${doc.id}) from Doctor Master`,
      "Success",
    )
    setDoctorNotice(`Doctor "${doc.name}" removed from roster.`)
    setTimeout(() => setDoctorNotice(""), 3500)
  }

  const handleOpenCredentialsModal = (doc: MasterDoctor) => {
    const existingUser = users.find(
      (u) =>
        u.id === `U_${doc.id}` ||
        u.username.toLowerCase() === (doc.username || "").toLowerCase(),
    )
    setCredentialsForm({
      id: existingUser?.id || `U_${doc.id}`,
      name: doc.name,
      username:
        doc.username ||
        doc.name
          .toLowerCase()
          .replace(/dr\.?\s*/, "")
          .replace(/[^a-z0-9]/g, ""),
      password: existingUser?.password || "",
      roleId: existingUser?.roleId || roles.find((r) => !r.id.includes("ADMIN"))?.id || "",
      staffId: doc.staffId || doc.id,
      status: existingUser?.status as any || "Active",
      doctorId: doc.id,
    })
    setShowCredentialsModal(true)
  }

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!credentialsForm) return

    const trimmedUsername = credentialsForm.username.trim().toLowerCase()
    const isNew = !users.some(
      (user) =>
        user.id === credentialsForm.id ||
        (user.username && user.username.toLowerCase() === trimmedUsername),
    )
    const role = roles.find((item) => item.id === credentialsForm.roleId)

    // 1. Immediately persist to RoleDatabase
    RoleDatabase.upsertUser({
      id: credentialsForm.id,
      username: trimmedUsername,
      password: credentialsForm.password || "password123",
      roleId: credentialsForm.roleId,
      name: credentialsForm.name,
      staffId: credentialsForm.staffId,
      status: credentialsForm.status || "Active",
      allowedModules: role?.allowedModules || [],
    })
    setUsers(RoleDatabase.getUsers())

    // 2. Also update DoctorMaster username & staffId if this was linked to a doctor
    if (credentialsForm.doctorId) {
      const doc = doctors.find((d) => d.id === credentialsForm.doctorId)
      if (doc) {
        updateDoctorMaster({
          ...doc,
          username: trimmedUsername,
          staffId: credentialsForm.staffId,
        })
        setDoctors(getDoctorMaster())
      }
    }

    // 3. Immediately close modal and clear form
    setShowCredentialsModal(false)
    const savedName = credentialsForm.name
    setCredentialsForm(null)

    // 4. Show toast notification
    const msg = `Credentials for "${savedName}" updated successfully.`
    toast.success(msg, { duration: 4000 })
    setDoctorNotice(msg)
    setTimeout(() => setDoctorNotice(""), 3500)

    // 5. Background API call
    try {
      await apiFetch(
        isNew ? "/api/admin/users/create" : `/api/admin/users/${encodeURIComponent(credentialsForm.id)}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify({
            username: trimmedUsername,
            password: credentialsForm.password,
            roleId: credentialsForm.roleId,
            name: credentialsForm.name,
            staffId: credentialsForm.staffId,
            status: credentialsForm.status,
            allowedModules: role?.allowedModules || [],
          }),
        },
      )
      void refreshAccessGovernance().catch(() => {})
    } catch (error) {
      console.warn("Backend credentials sync notice:", error)
    }
  }

  // Filters
  const filteredRoles = roles.filter(
    (r) =>
      r.name.toLowerCase().includes(roleSearch.toLowerCase()) ||
      r.id.toLowerCase().includes(roleSearch.toLowerCase()),
  )

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.staffId.toLowerCase().includes(userSearch.toLowerCase())
    const matchesRole = userRoleFilter === "all" || u.roleId === userRoleFilter
    const matchesStatus =
      userStatusFilter === "all" || (u.status || "Active") === userStatusFilter
    return matchesSearch && matchesRole && matchesStatus
  })

  const filteredDoctors = doctors.filter((d) => {
    const q = doctorSearch.toLowerCase()
    const matchesSearch =
      d.name.toLowerCase().includes(q) ||
      (d.specialty || "").toLowerCase().includes(q) ||
      d.qualification.toLowerCase().includes(q) ||
      d.staffId.toLowerCase().includes(q) ||
      d.room.toLowerCase().includes(q) ||
      (d.username || "").toLowerCase().includes(q)
    const matchesSection =
      doctorSectionFilter === "all" || d.section === doctorSectionFilter
    const matchesStatus =
      doctorStatusFilter === "all" ||
      (doctorStatusFilter === "active" && d.verified) ||
      (doctorStatusFilter === "unverified" && !d.verified)
    return matchesSearch && matchesSection && matchesStatus
  })

  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchesSearch =
      log.description.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.username.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.action.toLowerCase().includes(auditSearch.toLowerCase())
    const matchesAction =
      auditActionFilter === "all" || log.action === auditActionFilter
    const matchesUser =
      auditUserFilter === "all" || log.username === auditUserFilter

    let matchesDate = true
    if (auditDateFilter === "today") {
      const today = new Date().toISOString().split("T")[0]
      matchesDate = log.timestamp.startsWith(today)
    } else if (auditDateFilter === "7days") {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      matchesDate = new Date(log.timestamp).getTime() >= sevenDaysAgo
    }

    return matchesSearch && matchesAction && matchesUser && matchesDate
  })

  const uniqueAuditActions = Array.from(
    new Set(auditLogs.map((l) => l.action)),
  ).sort()
  const uniqueAuditUsers = Array.from(
    new Set(auditLogs.map((l) => l.username)),
  ).sort()

  // ── Diagnostic Tariffs Operations ────────────────────────────────────────

  const handleSaveTariffPrice = (id: string) => {
    if (editingTariffPrice === "" || isNaN(Number(editingTariffPrice))) return
    const num = Math.max(0, Number(editingTariffPrice))
    const updated = DiagnosticTariffDatabase.updateTariffPrice(id, num)
    if (updated) {
      AuditDatabase.logEvent(
        "Diagnostic Tariff Updated",
        "Tariff Management",
        `Updated price for '${updated.name}' (${updated.code}) to ₹${num}`,
        "Success",
      )
      setTariffNotice(`Price for "${updated.name}" updated to ₹${num}.`)
      setTimeout(() => setTariffNotice(""), 3500)
    }
    setEditingTariffId(null)
    setEditingTariffPrice("")
    setTariffs(DiagnosticTariffDatabase.getTariffs())
  }

  const handleCreateTariff = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTariffForm.name.trim() || newTariffForm.price === "") return
    const isLab = newTariffForm.department === "Laboratory"
    const deptPrefix = isLab
      ? "LAB"
      : newTariffForm.department === "X-Ray"
      ? "XR"
      : newTariffForm.department === "CT Scan"
      ? "CT"
      : newTariffForm.department === "MRI"
      ? "MR"
      : newTariffForm.department === "Ultrasound (USG)"
      ? "USG"
      : newTariffForm.department === "Doppler"
      ? "DOP"
      : newTariffForm.department === "Mammography"
      ? "MAM"
      : newTariffForm.department === "Fluoroscopy / Contrast"
      ? "FL"
      : newTariffForm.department === "Nuclear Medicine"
      ? "NM"
      : newTariffForm.department === "DEXA"
      ? "DEXA"
      : newTariffForm.department === "Dental"
      ? "DNT"
      : newTariffForm.department === "Interventional Radiology"
      ? "IR"
      : "RAD"

    const code =
      newTariffForm.code.trim() ||
      `${deptPrefix}-${Math.floor(100 + Math.random() * 900)}`
    const category = isLab ? "Laboratory" : "Radiology"
    const item = DiagnosticTariffDatabase.addTariffItem({
      code,
      name: newTariffForm.name.trim(),
      category,
      department: newTariffForm.department,
      modality: isLab ? "Laboratory" : newTariffForm.modality || newTariffForm.department,
      bodyRegion: newTariffForm.bodyRegion.trim() || "General",
      subCategory: newTariffForm.subCategory.trim() || newTariffForm.bodyRegion.trim() || "General",
      variantProtocol: newTariffForm.variantProtocol.trim() || "Plain",
      hospitalAvailability: newTariffForm.hospitalAvailability || "Enabled",
      tariffReference: newTariffForm.tariffReference.trim() || "Existing Billing tariff",
      responsibleInCharge: newTariffForm.responsibleInCharge.trim() || "",
      reportTemplate:
        newTariffForm.reportTemplate.trim() ||
        `Approved ${newTariffForm.name.trim()} Template`,
      price: Number(newTariffForm.price),
      tat: newTariffForm.tat.trim() || "2 Hours",
    })

    AuditDatabase.logEvent(
      "Diagnostic Tariff Added",
      "Tariff Management",
      `Added new ${item.department} investigation '${item.name}' (${item.code}) priced at ₹${item.price}`,
      "Success",
    )

    setShowAddTariffModal(false)
    toast.success(`Tariff item "${item.name}" added successfully!`, { duration: 3500 })
    setNewTariffForm({
      code: "",
      name: "",
      department: "CT Scan",
      modality: "CT Scan",
      bodyRegion: "Brain",
      subCategory: "Neuro / Head",
      variantProtocol: "Plain",
      hospitalAvailability: "Enabled",
      tariffReference: "Existing Billing tariff",
      responsibleInCharge: "Dr. Sunita Rao (Senior Radiologist)",
      reportTemplate: "Approved CT Brain Plain Template",
      price: "",
      tat: "2 Hours",
    })
    setTariffNotice(
      `Added new ${item.department} investigation "${item.name}" (₹${item.price}).`,
    )
    setTimeout(() => setTariffNotice(""), 3500)
    setTariffs(DiagnosticTariffDatabase.getTariffs())
  }

  const handleDeleteTariff = (item: DiagnosticTariffItem) => {
    if (
      !confirm(
        `Are you sure you want to delete ${item.name} (${item.code}) from the diagnostic price master?`,
      )
    )
      return
    DiagnosticTariffDatabase.deleteTariffItem(item.id)
    AuditDatabase.logEvent(
      "Diagnostic Tariff Deleted",
      "Tariff Management",
      `Deleted diagnostic test '${item.name}' (${item.code})`,
      "Success",
    )
    setTariffNotice(`Deleted test "${item.name}".`)
    setTimeout(() => setTariffNotice(""), 3500)
    setTariffs(DiagnosticTariffDatabase.getTariffs())
  }

  const handleResetTariffs = () => {
    if (
      !confirm(
        "Are you sure you want to reset all Diagnostic Tariffs to the official Hospital Rate Card prices? Any custom edits will be restored to default.",
      )
    )
      return
    const reset = DiagnosticTariffDatabase.resetToHospitalRateCard()
    setTariffs(reset)
    AuditDatabase.logEvent(
      "Diagnostic Tariffs Reset",
      "Tariff Management",
      "Reset all diagnostic prices to official Hospital Rate Card defaults",
      "Success",
    )
    setTariffNotice(
      "Diagnostic tariffs successfully reset to official Hospital Rate Card defaults.",
    )
    setTimeout(() => setTariffNotice(""), 3500)
  }

  const tariffSubCategories = Array.from(
    new Set(
      tariffs
        .filter(
          (t) =>
            tariffDepartmentFilter === "all" ||
            t.department === tariffDepartmentFilter ||
            (tariffDepartmentFilter === "Radiology" &&
              (t.category === "Radiology" || t.department !== "Laboratory")),
        )
        .map((t) => t.bodyRegion || t.subCategory),
    ),
  )
    .filter(Boolean)
    .sort()

  const filteredTariffs = tariffs.filter((t) => {
    const q = tariffSearch.toLowerCase()
    const matchesSearch =
      t.name.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      (t.subCategory || "").toLowerCase().includes(q) ||
      (t.bodyRegion || "").toLowerCase().includes(q) ||
      (t.modality || "").toLowerCase().includes(q) ||
      (t.variantProtocol || "").toLowerCase().includes(q) ||
      (t.responsibleInCharge || "").toLowerCase().includes(q) ||
      (t.reportTemplate || "").toLowerCase().includes(q) ||
      (t.department || "").toLowerCase().includes(q) ||
      (t.aliases && t.aliases.some((a) => a.toLowerCase().includes(q)))

    const matchesDept =
      tariffDepartmentFilter === "all" ||
      t.department === tariffDepartmentFilter ||
      (tariffDepartmentFilter === "Radiology" &&
        (t.category === "Radiology" || t.department !== "Laboratory"))

    const matchesSubCat =
      tariffSubCategoryFilter === "all" ||
      t.subCategory === tariffSubCategoryFilter ||
      t.bodyRegion === tariffSubCategoryFilter

    return matchesSearch && matchesDept && matchesSubCat
  })

  return (
    <div className="flex flex-col h-full bg-[#F4F7FB] text-[#0F172A] font-sans overflow-y-auto">
      {/* Executive Module Header */}
      <div className="bg-white border-b border-[#DDE2EC] px-8 py-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xl">⚙️</span>
              <h1 className="text-xl font-extrabold tracking-tight text-[#0F172A]">
                System Administration & Governance
              </h1>
              <span className="bg-[#DCFCE7] text-[#15803D] text-[11px] font-bold px-2.5 py-0.5 border border-[#BBF7D0]">
                ENTERPRISE ACTIVE
              </span>
            </div>
            <p className="text-[13px] text-[#64748B] mt-1">
              A guided control centre for hospital setup, workforce access, governance and compliance.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                handleOpenAddDoctorModal()
                setActiveTab("doctors")
              }}
              className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white font-semibold text-[12.5px] px-3.5 py-1.5 transition-colors border border-blue-600 shadow-2xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>+</span> Add Doctor
            </button>
            <button
              onClick={() => openNewUser()}
              className="bg-white hover:bg-gray-50 text-[#0F172A] font-semibold text-[12.5px] px-3.5 py-1.5 transition-colors border border-[#CBD5E1] cursor-pointer shadow-2xs"
            >
              + Add User
            </button>
          </div>
        </div>

        {/* Guided workflow navigation */}
        <div className="flex items-center gap-6 overflow-x-auto text-[12.5px] font-semibold border-t border-[#F1F5F9] pt-1">
          {[
            { id: "overview", label: "Control Centre" },
            {
              id: "doctors",
              label: "1. Doctor Master & Workspace",
              count: doctors.length,
            },
            {
              id: "tariffs",
              label: "2. Service Catalogue",
              count: tariffs.length,
            },
            {
              id: "roles",
              label: "3. Roles & Access",
              count: roles.length,
            },
            {
              id: "users",
              label: "4. Hospital Staff & Users",
              count: users.length,
            },
            { id: "audit", label: "5. Review Activity", count: auditLogs.length },
            { id: "settings", label: "6. Configure" },
          ].map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-2.5 border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  isActive
                    ? "border-[#1B4FD8] text-[#1B4FD8] font-bold"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 font-mono ${
                      isActive
                        ? "bg-blue-50 text-[#1B4FD8]"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Main Tab Content Container ─────────────────────────────────── */}
      <div className="px-8 py-6 flex-1 flex flex-col min-h-0 bg-[#F4F7FB]">
        {activeTab === "overview" && (
          <div className="space-y-5 max-w-7xl">
            <div className="rounded-xl border border-blue-100 bg-gradient-to-r from-[#0C2461] via-[#1447A6] to-[#2563D9] px-6 py-5 text-white shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-200">Administration workflow</p>
                  <h2 className="mt-1 text-xl font-bold">Set up people and access in the right order</h2>
                  <p className="mt-1 max-w-2xl text-[12.5px] leading-5 text-blue-100">Start with a fixed hospital role template, customize its department access, then assign that role to staff. Add a custom role only when the templates do not fit.</p>
                </div>
                <button onClick={() => setActiveTab("roles")} className="rounded-lg bg-white px-4 py-2 text-[12px] font-bold text-[#1740B4] shadow-sm transition hover:bg-blue-50">Start role setup →</button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Doctor Workspace & Master", value: doctors.length, detail: "Clinical profiles & live oversight", tone: "bg-blue-50 text-blue-700", target: "doctors" },
                { label: "User accounts", value: users.length, detail: "Identities provisioned", tone: "bg-violet-50 text-violet-700", target: "users" },
                { label: "Access roles", value: roles.length, detail: "Permission templates", tone: "bg-emerald-50 text-emerald-700", target: "roles" },
                { label: "Activity records", value: auditLogs.length, detail: "Recent governance events", tone: "bg-amber-50 text-amber-700", target: "audit" },
              ].map((metric) => (
                <button key={metric.label} onClick={() => setActiveTab(metric.target as typeof activeTab)} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3"><span className="text-[12px] font-semibold text-slate-600">{metric.label}</span><span className={`rounded-md px-2 py-1 text-[11px] font-bold ${metric.tone}`}>View</span></div>
                  <div className="mt-3 text-2xl font-bold text-slate-900">{metric.value}</div>
                  <p className="mt-1 text-[11px] text-slate-500">{metric.detail}</p>
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4"><h3 className="text-[14px] font-bold text-slate-900">Operating workflow</h3><p className="mt-0.5 text-[12px] text-slate-500">Follow the sequence to avoid orphan profiles, unscoped access, or unreviewed changes.</p></div>
              <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
                {[
                  { step: "01", title: "Choose a role template", description: "Start with Doctor, Receptionist, Nurse, Pharmacy, Lab, HR, Accounts or Billing.", action: "Open roles", target: "roles" },
                  { step: "02", title: "Customize access", description: "Choose the hospital modules and workflows the selected role may use.", action: "Set permissions", target: "roles" },
                  { step: "03", title: "Assign staff or doctors", description: "Create each person’s individual account and attach the prepared role.", action: "Assign people", target: "users" },
                  { step: "04", title: "Role-based sign in", description: "Staff choose their role, select their identity, and use their own credentials.", action: "Review activity", target: "audit" },
                ].map((step) => (
                  <div key={step.step} className="p-5"><span className="text-[11px] font-extrabold tracking-wider text-blue-600">STEP {step.step}</span><h4 className="mt-2 text-[14px] font-bold text-slate-900">{step.title}</h4><p className="mt-1 min-h-10 text-[12px] leading-5 text-slate-500">{step.description}</p><button onClick={() => setActiveTab(step.target as typeof activeTab)} className="mt-3 text-[12px] font-bold text-[#1B4FD8] hover:text-[#1740B4]">{step.action} →</button></div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-[12px] font-bold">Governance checkpoint</p><p className="mt-0.5 text-[12px] text-amber-800">Review the activity log after granting access and revisit system controls regularly.</p></div>
              <div className="flex gap-2"><button onClick={() => setActiveTab("audit")} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-bold text-amber-900 hover:bg-amber-100">Review activity</button><button onClick={() => setActiveTab("settings")} className="rounded-lg bg-amber-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-800">System controls</button></div>
            </div>
          </div>
        )}

        {/* ── TAB: DIAGNOSTIC TARIFFS & PRICE MASTER ─────────────────────── */}
        {activeTab === "tariffs" && (
          <div className="space-y-4">
            {tariffNotice && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] p-3 rounded font-semibold flex items-center justify-between">
                <span>✓ {tariffNotice}</span>
                <button
                  onClick={() => setTariffNotice("")}
                  className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Diagnostic Tariffs Data Table Container */}
            <div className="bg-white border border-[#DDE2EC] shadow-2xs">
              {/* Toolbar & Filters */}
              <div className="p-4 border-b border-[#DDE2EC] bg-[#F8FAFC] space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-bold text-gray-900">
                      Hospital Diagnostic Investigation & Radiology Price Master
                    </h3>
                    <p className="text-[11.5px] text-[#64748B]">
                      Official Hospital Rate Card covering 184 Laboratory Tests and 173 Radiology Examinations across all 11 clinical modalities.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowAddTariffModal(true)}
                      className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12.5px] font-semibold px-3.5 py-1.5 border border-blue-600 transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    >
                      <span>+</span> Add Investigation
                    </button>

                    <button
                      onClick={handleResetTariffs}
                      title="Reset all prices to official Imperial Hospital Rate Card defaults"
                      className="bg-white hover:bg-gray-50 text-slate-700 text-[12.5px] font-semibold px-3 py-1.5 border border-slate-300 transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                    >
                      <span>🔄</span> Reset Rate Card
                    </button>
                  </div>
                </div>

                {/* Primary Category & Modality Filter Tabs */}
                <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                  <div className="flex border border-[#CBD5E1] rounded overflow-hidden flex-wrap bg-white text-[12px]">
                    <button
                      onClick={() => {
                        setTariffDepartmentFilter("all")
                        setTariffSubCategoryFilter("all")
                      }}
                      className={`px-3 py-1.5 font-semibold transition-colors cursor-pointer ${
                        tariffDepartmentFilter === "all"
                          ? "bg-[#1B4FD8] text-white font-bold"
                          : "bg-white text-[#334155] hover:bg-gray-50"
                      }`}
                    >
                      All ({tariffs.length})
                    </button>
                    <button
                      onClick={() => {
                        setTariffDepartmentFilter("Laboratory")
                        setTariffSubCategoryFilter("all")
                      }}
                      className={`px-3 py-1.5 font-semibold transition-colors cursor-pointer ${
                        tariffDepartmentFilter === "Laboratory"
                          ? "bg-blue-600 text-white font-bold"
                          : "bg-white text-[#334155] hover:bg-gray-50"
                      }`}
                    >
                      Laboratory ({tariffs.filter((t) => t.category === "Laboratory" || t.department === "Laboratory").length})
                    </button>
                    <button
                      onClick={() => {
                        setTariffDepartmentFilter("Radiology")
                        setTariffSubCategoryFilter("all")
                      }}
                      className={`px-3 py-1.5 font-semibold transition-colors cursor-pointer ${
                        tariffDepartmentFilter === "Radiology" ||
                        RADIOLOGY_MODALITIES.includes(tariffDepartmentFilter as any)
                          ? "bg-purple-700 text-white font-bold"
                          : "bg-white text-[#334155] hover:bg-gray-50"
                      }`}
                    >
                      Radiology ({tariffs.filter((t) => t.category === "Radiology" || t.department !== "Laboratory").length})
                    </button>
                  </div>

                  {/* Search Bar & Sub-Category */}
                  <div className="flex items-center gap-2 flex-1 max-w-xl justify-end">
                    {/* Sub-category / Body Region Filter */}
                    <select
                      value={tariffSubCategoryFilter}
                      onChange={(e) => setTariffSubCategoryFilter(e.target.value)}
                      className="bg-white border border-[#CBD5E1] px-2.5 py-1.5 text-[12px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                    >
                      <option value="all">All Anatomical Regions</option>
                      {tariffSubCategories.map((subCat) => (
                        <option key={subCat} value={subCat}>
                          {subCat}
                        </option>
                      ))}
                    </select>

                    <input
                      value={tariffSearch}
                      onChange={(e) => setTariffSearch(e.target.value)}
                      placeholder="Search code, exam name, modality, body region, in-charge..."
                      className="flex-1 bg-white border border-[#CBD5E1] px-3 py-1.5 text-[12px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B4FD8]"
                    />
                  </div>
                </div>

                {/* Modality Pills Strip - Only displayed when Radiology department is active */}
                {(tariffDepartmentFilter === "Radiology" ||
                  RADIOLOGY_MODALITIES.includes(tariffDepartmentFilter as any)) && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-2 pb-1 text-[11px] border-t border-purple-100 bg-purple-50/50 p-2.5 rounded-xs">
                    <span className="text-purple-900 font-bold uppercase tracking-wider text-[10px] mr-1 flex items-center gap-1">
                      <span>⚡</span> Modalities:
                    </span>
                    <button
                      onClick={() => {
                        setTariffDepartmentFilter("Radiology")
                        setTariffSubCategoryFilter("all")
                      }}
                      className={`px-2.5 py-0.5 border rounded cursor-pointer transition-colors font-medium flex items-center gap-1 ${
                        tariffDepartmentFilter === "Radiology"
                          ? "bg-purple-700 text-white border-purple-700 font-bold shadow-2xs"
                          : "bg-white text-purple-900 border-purple-200 hover:bg-purple-100/70"
                      }`}
                    >
                      <span>All Modalities</span>
                      <span
                        className={`px-1 py-0.2 rounded text-[9.5px] ${
                          tariffDepartmentFilter === "Radiology"
                            ? "bg-white/20 text-white"
                            : "bg-purple-100 text-purple-800"
                        }`}
                      >
                        {tariffs.filter((t) => t.category === "Radiology" || t.department !== "Laboratory").length}
                      </span>
                    </button>
                    {RADIOLOGY_MODALITIES.map((mod) => {
                      const count = tariffs.filter((t) => t.department === mod || t.modality === mod).length
                      const isSelected = tariffDepartmentFilter === mod
                      return (
                        <button
                          key={mod}
                          onClick={() => {
                            setTariffDepartmentFilter(mod)
                            setTariffSubCategoryFilter("all")
                          }}
                          className={`px-2 py-0.5 border rounded cursor-pointer transition-colors font-medium flex items-center gap-1 ${
                            isSelected
                              ? "bg-[#0F172A] text-white border-[#0F172A] font-bold shadow-2xs"
                              : "bg-white text-[#475569] border-[#CBD5E1] hover:bg-slate-100"
                          }`}
                        >
                          <span>{mod}</span>
                          <span
                            className={`px-1 py-0.2 rounded text-[9.5px] ${
                              isSelected
                                ? "bg-white/20 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px] border-collapse">
                  <thead>
                    <tr className="bg-[#F1F5F9] text-[#475569] font-bold text-[11px] uppercase tracking-wider border-b border-[#DDE2EC]">
                      <th className="py-3 px-3 w-32 font-mono">Test Code</th>
                      <th className="py-3 px-4">Examination Name & Protocol</th>
                      <th className="py-3 px-3 w-36">Modality</th>
                      <th className="py-3 px-3 w-32">Body Region</th>
                      <th className="py-3 px-2 w-28 text-center">Availability</th>
                      <th className="py-3 px-3 w-44">Responsible In-Charge</th>
                      <th className="py-3 px-3 w-44">Report Template</th>
                      <th className="py-3 px-3 w-32 text-right">Tariff (₹)</th>
                      <th className="py-3 px-3 w-28 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {filteredTariffs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-[#64748B]">
                          No investigations found matching "{tariffSearch}".
                        </td>
                      </tr>
                    ) : (
                      filteredTariffs.map((item) => {
                        const isEditing = editingTariffId === item.id
                        const dept = item.department || (item.category === "Laboratory" ? "Laboratory" : "X-Ray")
                        const modality = item.modality || dept
                        return (
                          <tr
                            key={item.id}
                            className={`hover:bg-[#F8FAFC] transition-colors ${
                              isEditing ? "bg-amber-50/60" : ""
                            }`}
                          >
                            {/* Test Code */}
                            <td className="py-2.5 px-3 font-mono font-bold text-[#1B4FD8] text-[12px]">
                              {item.code}
                            </td>

                            {/* Examination Name & Variant Protocol */}
                            <td className="py-2.5 px-4">
                              <div className="font-bold text-[#0F172A] text-[13px]">{item.name}</div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {item.variantProtocol && (
                                  <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 border border-slate-200 rounded font-medium">
                                    {item.variantProtocol}
                                  </span>
                                )}
                                {item.aliases && item.aliases.length > 0 && (
                                  <span className="text-[10.5px] text-slate-500 italic">
                                    Alias: {item.aliases.join(", ")}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Modality */}
                            <td className="py-2.5 px-3">
                              <span
                                className={`text-[10.5px] font-bold px-2 py-0.5 border rounded ${
                                  modality === "Laboratory"
                                    ? "bg-blue-50 text-[#1B4FD8] border-blue-200"
                                    : modality === "X-Ray"
                                    ? "bg-purple-50 text-purple-700 border-purple-200"
                                    : modality === "CT Scan"
                                    ? "bg-amber-50 text-amber-800 border-amber-300"
                                    : modality === "MRI"
                                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                    : modality === "Ultrasound (USG)"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : modality === "Doppler"
                                    ? "bg-cyan-50 text-cyan-800 border-cyan-200"
                                    : modality === "Mammography"
                                    ? "bg-pink-50 text-pink-700 border-pink-200"
                                    : modality === "Fluoroscopy / Contrast"
                                    ? "bg-sky-50 text-sky-800 border-sky-200"
                                    : modality === "Nuclear Medicine"
                                    ? "bg-violet-50 text-violet-800 border-violet-200"
                                    : modality === "DEXA"
                                    ? "bg-orange-50 text-orange-800 border-orange-200"
                                    : modality === "Dental"
                                    ? "bg-teal-50 text-teal-800 border-teal-200"
                                    : modality === "Interventional Radiology"
                                    ? "bg-rose-50 text-rose-800 border-rose-200"
                                    : "bg-slate-50 text-slate-700 border-slate-200"
                                }`}
                              >
                                {modality}
                              </span>
                            </td>

                            {/* Body Region */}
                            <td className="py-2.5 px-3 text-[#475569] font-medium text-[12px]">
                              {item.bodyRegion || item.subCategory || "General"}
                            </td>

                            {/* Hospital Availability */}
                            <td className="py-2.5 px-2 text-center">
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                {item.hospitalAvailability || "Enabled"}
                              </span>
                            </td>

                            {/* Responsible In-Charge */}
                            <td className="py-2.5 px-3">
                              <div className="text-[12px] font-semibold text-[#1E293B]">
                                {item.responsibleInCharge || "-"}
                              </div>
                            </td>

                            {/* Report Template */}
                            <td className="py-2.5 px-3">
                              <div
                                className="text-[11px] text-[#475569] font-mono truncate max-w-[180px]"
                                title={item.reportTemplate || `Approved ${item.name} Template`}
                              >
                                {item.reportTemplate || `Approved ${item.name} Template`}
                              </div>
                            </td>

                            {/* Tariff Price (₹) */}
                            <td className="py-2.5 px-3 text-right font-mono">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-gray-500 font-bold">₹</span>
                                  <input
                                    type="number"
                                    min="0"
                                    autoFocus
                                    value={editingTariffPrice}
                                    onChange={(e) =>
                                      setEditingTariffPrice(
                                        e.target.value === "" ? "" : Number(e.target.value),
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleSaveTariffPrice(item.id)
                                      if (e.key === "Escape") setEditingTariffId(null)
                                    }}
                                    className="w-24 bg-white border border-[#1B4FD8] px-2 py-1 text-right text-[13px] font-mono font-bold focus:outline-none"
                                  />
                                </div>
                              ) : (
                                <span className="font-extrabold text-[#0F172A] text-[13px]">
                                  ₹{Number(item.price ?? 0).toLocaleString("en-IN")}
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="py-2.5 px-3 text-center">
                              {isEditing ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => handleSaveTariffPrice(item.id)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2.5 py-1 border border-emerald-700 cursor-pointer rounded-xs"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingTariffId(null)}
                                    className="bg-white hover:bg-gray-100 text-gray-700 text-[11px] font-semibold px-2 py-1 border border-gray-300 cursor-pointer rounded-xs"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingTariffId(item.id)
                                      setEditingTariffPrice(item.price ?? 0)
                                    }}
                                    className="text-[#1B4FD8] hover:text-[#1740B4] text-[12px] font-semibold cursor-pointer"
                                  >
                                    Edit Price
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTariff(item)}
                                    className="text-red-600 hover:text-red-800 text-[12px] font-semibold cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-3 bg-[#F8FAFC] border-t border-[#DDE2EC] text-[12px] text-[#64748B] flex items-center justify-between">
                <span>
                  Showing <strong>{filteredTariffs.length}</strong> of <strong>{tariffs.length}</strong> total diagnostic rate card entries (184 Laboratory, 173 Radiology)
                </span>
                <span>
                  Press <kbd className="bg-white border border-[#CBD5E1] px-1 py-0.5 text-[10px] font-mono font-bold">Enter</kbd> to save price edits
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 1: DOCTOR MASTER & WORKSPACE ─────────────────────────── */}
        {activeTab === "doctors" && (
          <div className="space-y-4">
            {/* View Sub-Tabs: Doctor Master Directory vs Live Doctor Workspace & Oversight */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 border border-[#DDE2EC] rounded-lg shadow-2xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDoctorSubTab("directory")
                    setAdminInspectingDoctor(null)
                  }}
                  className={`flex items-center gap-2 px-3.5 py-1.5 text-[12.5px] font-bold rounded-md transition-all cursor-pointer ${
                    doctorSubTab === "directory"
                      ? "bg-[#1B4FD8] text-white shadow-xs"
                      : "bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] hover:text-[#0F172A]"
                  }`}
                >
                  <UsersIcon size={15} />
                  <span>Doctor Master Directory & Credentials</span>
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono ${
                      doctorSubTab === "directory"
                        ? "bg-white/20 text-white"
                        : "bg-white text-slate-700 border border-slate-200"
                    }`}
                  >
                    {doctors.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDoctorSubTab("workspace")
                    setAdminInspectingDoctor(null)
                  }}
                  className={`flex items-center gap-2 px-3.5 py-1.5 text-[12.5px] font-bold rounded-md transition-all cursor-pointer ${
                    doctorSubTab === "workspace"
                      ? "bg-[#1B4FD8] text-white shadow-xs"
                      : "bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] hover:text-[#0F172A]"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <Stethoscope size={15} />
                  <span>Live Doctors Workspace & Patient Oversight</span>
                </button>
              </div>

              {doctorSubTab === "directory" ? (
                <button
                  type="button"
                  onClick={() => {
                    setDoctorSubTab("workspace")
                    setAdminInspectingDoctor(null)
                  }}
                  className="text-[12px] font-bold text-[#1B4FD8] hover:text-[#1740B4] flex items-center gap-1.5 cursor-pointer"
                >
                  <span>View live OPD patient assignments & doctor workloads</span>
                  <span>➔</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDoctorSubTab("directory")
                    setAdminInspectingDoctor(null)
                  }}
                  className="text-[12px] font-bold text-[#1B4FD8] hover:text-[#1740B4] flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Manage doctor credentials, rooms & fees in Master</span>
                  <span>➔</span>
                </button>
              )}
            </div>

            {doctorNotice && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] p-3 rounded font-semibold flex items-center justify-between">
                <span>✓ {doctorNotice}</span>
                <button
                  onClick={() => setDoctorNotice("")}
                  className="text-emerald-600 hover:text-emerald-900"
                >
                  ✕
                </button>
              </div>
            )}
            {specialtyNotice && (
              <div className="flex items-center justify-between border border-blue-200 bg-blue-50 p-3 text-[12.5px] font-semibold text-blue-800">
                <span>{specialtyNotice}</span>
                <button onClick={() => setSpecialtyNotice("")} className="text-blue-700 hover:text-blue-950">×</button>
              </div>
            )}

            {/* LIVE WORKSPACE VIEW */}
            {doctorSubTab === "workspace" && (
              <div className="border border-[#DDE2EC] rounded-lg overflow-hidden bg-white shadow-2xs flex flex-col min-h-[750px] h-[calc(100vh-230px)]">
                {adminInspectingDoctor ? (
                  <DoctorPortal
                    key={adminInspectingDoctor.id}
                    doctor={adminInspectingDoctor}
                    isSuperAdmin={true}
                    onBackToOverview={() => setAdminInspectingDoctor(null)}
                    onSwitchDoctor={(docId) => setAdminInspectingDoctor(getDoctorById(docId))}
                  />
                ) : (
                  <DoctorsOverview
                    onOpenWorkspace={(doc) => setAdminInspectingDoctor(doc)}
                    onOpenAdminMaster={() => {
                      setDoctorSubTab("directory")
                      setAdminInspectingDoctor(null)
                    }}
                  />
                )}
              </div>
            )}

            {/* DOCTOR MASTER DIRECTORY VIEW */}
            {doctorSubTab === "directory" && (
            <div className="bg-white border border-[#DDE2EC] shadow-2xs">
              {/* Doctor Toolbar */}
              <div className="p-4 border-b border-[#DDE2EC] bg-[#F8FAFC] flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-[14px] font-bold text-gray-900">
                    Hospital Doctor Master Directory
                  </h3>
                  <p className="text-[11.5px] text-[#64748B]">
                    Active roster of physicians, consultants, rooms & login
                    credentials. Total {doctors.length} doctors onboarded.
                  </p>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
                  <input
                    value={doctorSearch}
                    onChange={(e) => setDoctorSearch(e.target.value)}
                    placeholder="Search doctor name, specialty, room, staff ID..."
                    className="w-full md:w-72 bg-white border border-[#DDE2EC] px-3 py-1.5 text-[12.5px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B4FD8]"
                  />

                  <select
                    value={doctorSectionFilter}
                    onChange={(e) => setDoctorSectionFilter(e.target.value)}
                    className="bg-white border border-[#DDE2EC] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                  >
                    <option value="all">All Panels</option>
                    <option value="Main">Main Resident Panel</option>
                    <option value="Visiting">Visiting Consultants</option>
                  </select>

                  <select
                    value={doctorStatusFilter}
                    onChange={(e) => setDoctorStatusFilter(e.target.value)}
                    className="bg-white border border-[#DDE2EC] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                  >
                    <option value="all">All Verification Status</option>
                    <option value="active">Active & Verified</option>
                    <option value="unverified">Needs Verification</option>
                  </select>

                  <button
                    onClick={() => {
                      setNewSpecialtyName("")
                      setShowSpecialtyModal(true)
                    }}
                    className="bg-white hover:bg-gray-50 text-[#334155] text-[12.5px] font-semibold px-3.5 py-1.5 border border-[#CBD5E1] transition-colors cursor-pointer"
                  >
                    + Specialty
                  </button>

                  <button
                    onClick={handleOpenAddDoctorModal}
                    className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12.5px] font-semibold px-3.5 py-1.5 border border-blue-600 transition-colors cursor-pointer"
                  >
                    + Add New Doctor
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDoctorSubTab("workspace")
                      setAdminInspectingDoctor(null)
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    title="Switch to live doctor workspace & patient oversight"
                  >
                    <Stethoscope size={14} />
                    <span>Live Patient Oversight</span>
                  </button>
                </div>
              </div>

              {/* Doctor Table */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b border-[#DDE2EC] text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                      <th className="text-left px-4 py-3">Doctor & Staff ID</th>
                      <th className="text-left px-4 py-3">Qualification</th>
                      <th className="text-left px-4 py-3">
                        Specialty / Department
                      </th>
                      <th className="text-left px-4 py-3">Panel</th>
                      <th className="text-left px-4 py-3">Consultation Fee</th>
                      <th className="text-left px-4 py-3">Availability</th>
                      <th className="text-left px-4 py-3">Login Username</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] text-[12.5px]">
                    {filteredDoctors.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-[#64748B]">
                          No doctors found matching the search criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredDoctors.map((d) => {
                        const av = availabilityOf(d)
                        return (
                          <tr
                            key={d.id}
                            className="hover:bg-[#F8FAFC] transition-colors"
                          >
                            <td className="px-4 py-3">
                              <p
                                className={`text-[13px] ${
                                  d.verified
                                    ? "font-bold text-gray-900"
                                    : "italic text-[#92400E]"
                                }`}
                              >
                                {d.name}
                              </p>
                              <p className="text-[11px] font-mono text-[#64748B]">
                                {d.id} • {d.staffId} • {d.room}
                              </p>
                            </td>

                            <td className="px-4 py-3 text-[#475569] font-medium">
                              {d.qualification}
                            </td>

                            <td className="px-4 py-3 text-[#0F172A] font-semibold">
                              {d.specialty || (
                                <span className="italic text-[#94A3B8]">
                                  {d.specialtyNote || "Unspecified"}
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-3 text-[#475569]">
                              <span
                                className={`px-2 py-0.5 text-[11px] font-semibold ${
                                  d.section === "Main"
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-purple-50 text-purple-700"
                                }`}
                              >
                                {d.section}
                              </span>
                            </td>

                            <td className="px-4 py-3 font-mono font-bold text-[#15803D]">
                              ₹{d.consultationFee ?? 500}
                            </td>

                            <td className="px-4 py-3 text-[12px]">
                              <span
                                className={
                                  av.bookable
                                    ? av.onRequest
                                      ? "text-[#B45309] font-medium"
                                      : "text-[#15803D] font-medium"
                                    : "text-[#94A3B8]"
                                }
                              >
                                {av.label}
                              </span>
                            </td>

                            <td className="px-4 py-3">
                              <div className="font-mono text-[#1B4FD8] font-semibold">
                                {d.username ? (
                                  `@${d.username}`
                                ) : (
                                  <span className="text-[#94A3B8]">—</span>
                                )}
                              </div>
                              <div className="mt-0.5">
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                  🛡️ {roles.find((r) => r.id === (d.roleId || "ROLE_DOCTOR"))?.name || "Doctor"}
                                </span>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <span
                                className={`text-[10.5px] font-bold uppercase px-2 py-0.5 ${
                                  d.verified
                                    ? "bg-[#DCFCE7] text-[#15803D] border border-emerald-200"
                                    : "bg-[#FEF3C7] text-[#92400E] border border-amber-200"
                                }`}
                              >
                                {d.verified ? "Active" : "Unverified"}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => {
                                    const cleanName = (d.name || "")
                                      .toLowerCase()
                                      .replace(/dr\.?\s*/, "")
                                      .replace(/[^a-z0-9]/g, "")
                                    const docUser = users.find(
                                      (u) =>
                                        u.id === d.id ||
                                        u.id === `U_${d.id}` ||
                                        (u.username &&
                                          d.username &&
                                          u.username.toLowerCase() ===
                                            d.username.toLowerCase()) ||
                                        (u.username &&
                                          u.username.toLowerCase() === cleanName),
                                    )
                                    setEditingDoctor({
                                      ...d,
                                      roleId: d.roleId || docUser?.roleId || "ROLE_DOCTOR",
                                      password: d.password || docUser?.password || "",
                                    })
                                    setShowDoctorModal(true)
                                  }}
                                  title="Edit Doctor Profile"
                                  className="bg-white hover:bg-gray-100 text-[#334155] border border-[#CBD5E1] px-2.5 py-1 text-[11.5px] font-semibold cursor-pointer"
                                >
                                  ✏️ Edit Profile
                                </button>

                                <button
                                  onClick={() => handleDeleteDoctor(d)}
                                title="Deactivate access"
                                  className="bg-white hover:bg-red-50 text-red-600 border border-red-200 px-2 py-1 text-[11.5px] cursor-pointer"
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </div>
        )}

        {/* ── TAB 2: USER ACCOUNTS & CREDENTIALS ─────────────────────────── */}
        {activeTab === "users" && (
          <div className="bg-white border border-[#DDE2EC] flex flex-col flex-1 overflow-hidden shadow-sm">
            {/* Header Banner */}
            <div className="flex flex-col gap-3 border-b border-blue-100 bg-blue-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[14px] font-bold text-slate-900">Hospital Staff Identity & User Access Governance</p>
                <p className="mt-0.5 text-[12px] text-slate-600">
                  Provision employee accounts, assign role-based hospital access, set secure credentials, and control active login status.
                </p>
              </div>
              <button
                onClick={() => setActiveTab("roles")}
                className="shrink-0 text-[12.5px] font-bold text-[#1B4FD8] hover:text-[#1740B4] flex items-center gap-1"
              >
                {assignableRoles.length ? "Configure Access Roles & Permissions" : "1. Create an access role first"} →
              </button>
            </div>

            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <div className="bg-white border border-[#E2E8F0] p-4 rounded-xs shadow-2xs">
                <div className="flex items-center justify-between text-[#64748B] text-[12px] font-semibold">
                  <span>Total User Accounts</span>
                  <span className="text-base">👥</span>
                </div>
                <div className="text-2xl font-bold text-[#0F172A] mt-1">{users.length}</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Provisioned staff accounts</div>
              </div>

              <div className="bg-white border border-emerald-200 p-4 rounded-xs shadow-2xs">
                <div className="flex items-center justify-between text-emerald-700 text-[12px] font-semibold">
                  <span>Active Logins</span>
                  <span className="text-base">🟢</span>
                </div>
                <div className="text-2xl font-bold text-emerald-700 mt-1">
                  {users.filter((u) => (u.status || "Active") === "Active").length}
                </div>
                <div className="text-[11px] text-emerald-600 mt-0.5">Permitted to sign in</div>
              </div>

              <div className="bg-white border border-amber-200 p-4 rounded-xs shadow-2xs">
                <div className="flex items-center justify-between text-amber-700 text-[12px] font-semibold">
                  <span>Inactive / Suspended</span>
                  <span className="text-base">⏸️</span>
                </div>
                <div className="text-2xl font-bold text-amber-700 mt-1">
                  {users.filter((u) => u.status === "Inactive").length}
                </div>
                <div className="text-[11px] text-amber-600 mt-0.5">Access disabled</div>
              </div>

              <div className="bg-white border border-blue-200 p-4 rounded-xs shadow-2xs">
                <div className="flex items-center justify-between text-blue-700 text-[12px] font-semibold">
                  <span>Doctors & Specialists</span>
                  <span className="text-base">🩺</span>
                </div>
                <div className="text-2xl font-bold text-blue-700 mt-1">
                  {
                    users.filter(
                      (u) =>
                        u.roleId === "ROLE_DOCTOR" ||
                        u.roleId.toLowerCase().includes("doctor") ||
                        u.roleId.toLowerCase().includes("surgeon"),
                    ).length
                  }
                </div>
                <div className="text-[11px] text-blue-600 mt-0.5">Clinical providers</div>
              </div>
            </div>

            {userNotice && (
              <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-xs border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-900 shadow-2xs">
                <span className="flex items-center gap-2">
                  <span>✓</span>
                  <span>{userNotice}</span>
                </span>
                <button
                  onClick={() => setUserNotice("")}
                  className="text-emerald-700 hover:text-emerald-950 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* User Search & Filter Toolbar */}
            <div className="p-4 border-b border-[#DDE2EC] bg-white flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
                <div className="relative w-full md:w-80">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#94A3B8]">🔍</span>
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search name, username, or staff ID..."
                    className="w-full bg-[#F8FAFC] border border-[#CBD5E1] pl-9 pr-3.5 py-1.5 text-[13px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B4FD8] focus:bg-white"
                  />
                </div>

                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="bg-[#F8FAFC] border border-[#CBD5E1] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                >
                  <option value="all">All Roles ({roles.length})</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>

                <select
                  value={userStatusFilter}
                  onChange={(e) => setUserStatusFilter(e.target.value)}
                  className="bg-[#F8FAFC] border border-[#CBD5E1] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="Active">Active Accounts</option>
                  <option value="Inactive">Inactive / Suspended</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdminModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold px-3.5 py-2 border border-emerald-700 transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5"
                >
                  <span>🔑</span>
                  <span>Edit Admin Credentials</span>
                </button>
                <button
                  onClick={() => openNewUser()}
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-4 py-2 border border-blue-600 transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5"
                >
                  <span>➕</span>
                  <span>Add Staff Account</span>
                </button>
              </div>
            </div>

            {/* System Admin Account Banner */}
            <div className="bg-gradient-to-r from-blue-50/70 via-indigo-50/60 to-purple-50/70 border border-blue-200/80 p-3.5 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-[#1B4FD8] text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                  🛡️
                </span>
                <div>
                  <div className="font-bold text-[#0F172A] flex items-center gap-2">
                    <span>System Administrator Master Account</span>
                    <span className="text-[10.5px] bg-blue-100 text-[#1B4FD8] font-bold px-2 py-0.5 rounded-full">
                      Root Governance
                    </span>
                  </div>
                  <div className="text-[11.5px] text-[#64748B]">
                    Full hospital governance account with unrestricted access across all clinical and operational modules.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminModal(true)}
                className="bg-white hover:bg-blue-50 text-[#1B4FD8] border border-blue-300 font-bold px-3 py-1.5 text-[12px] shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>✏️</span>
                <span>Edit Credentials</span>
              </button>
            </div>

            {/* Users Table */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F1F5F9] border-b border-[#DDE2EC] text-[11px] text-[#475569] uppercase font-mono tracking-wider">
                    <th className="px-6 py-3.5">Staff Member</th>
                    <th className="px-6 py-3.5">Username</th>
                    <th className="px-6 py-3.5">Staff ID</th>
                    <th className="px-6 py-3.5">Assigned System Role</th>
                    <th className="px-6 py-3.5 text-center">Account Status</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[13px] text-[#334155]">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-[#64748B]">
                        No user accounts match the current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const userRole = roles.find((r) => r.id === u.roleId)
                      const isDoc =
                        u.roleId === "ROLE_DOCTOR" ||
                        u.roleId.toLowerCase().includes("doctor") ||
                        u.roleId.toLowerCase().includes("surgeon")
                      const isAdmin = u.roleId === "ROLE_ADMIN" || u.roleId === "ROLE_SUPERADMIN"
                      const isNurse = u.roleId.toLowerCase().includes("nurse")
                      const isPharmacy = u.roleId.toLowerCase().includes("pharm")

                      const avatarBg = isAdmin
                        ? "bg-purple-100 text-purple-700 border-purple-200"
                        : isDoc
                          ? "bg-blue-100 text-blue-700 border-blue-200"
                          : isNurse
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : isPharmacy
                              ? "bg-amber-100 text-amber-700 border-amber-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"

                      const initials = (u.name || "U")
                        .split(" ")
                        .filter(Boolean)
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()

                      return (
                        <tr key={u.id} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="px-6 py-3.5 font-bold text-[#0F172A]">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-8 h-8 rounded-full border flex items-center justify-center font-bold text-[12px] shrink-0 ${avatarBg}`}
                              >
                                {initials}
                              </div>
                              <div>
                                <div className="font-bold text-[#0F172A]">{u.name}</div>
                                <div className="text-[11px] text-[#64748B] font-normal">
                                  {isDoc ? "Clinical Specialist" : isAdmin ? "Administrator" : "Hospital Staff"}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-3.5 font-mono text-[#1B4FD8] font-medium">
                            @{u.username}
                          </td>

                          <td className="px-6 py-3.5 font-mono text-[12px] text-[#64748B]">
                            {u.staffId}
                          </td>

                          <td className="px-6 py-3.5">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="text-[11.5px] bg-blue-50 text-[#1B4FD8] px-2.5 py-1 border border-blue-200 font-semibold rounded-xs">
                                {userRole?.name || u.roleId}
                              </span>
                              {u.customModules && u.customModules.length > 0 ? (
                                <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.5 font-bold rounded flex items-center gap-1" title={u.customModules.join(", ")}>
                                  <span>⚡ Custom:</span>
                                  <span>{u.customModules.length} depts</span>
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#64748B]">
                                  Role Default ({userRole?.allowedModules?.length || 0} depts)
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-6 py-3.5 text-center">
                            <button
                              onClick={() => handleQuickToggleUserStatus(u)}
                              title="Click to toggle account status"
                              className={`text-[11px] font-bold px-2.5 py-1 border rounded-xs cursor-pointer transition-all ${
                                (u.status || "Active") === "Active"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                                  : "bg-red-50 text-red-700 border-red-300 hover:bg-red-100"
                              }`}
                            >
                              {(u.status || "Active") === "Active" ? "● Active" : "○ Inactive"}
                            </button>
                          </td>

                          <td className="px-6 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => {
                                  setEditingUser({
                                    ...u,
                                    customModules: u.customModules || (u.allowedModules && u.allowedModules.length > 0 ? u.allowedModules : undefined),
                                  })
                                  setShowUserModal(true)
                                }}
                                className="text-[12px] bg-white hover:bg-gray-100 text-[#334155] border border-[#CBD5E1] px-2.5 py-1 font-semibold cursor-pointer"
                              >
                                ✏️ Edit
                              </button>

                              <button
                                onClick={() => {
                                  setResetPassUser(u)
                                  setNewPassInput("")
                                }}
                                className="text-[12px] bg-white hover:bg-amber-50 text-amber-700 border border-amber-300 px-2.5 py-1 font-semibold cursor-pointer"
                              >
                                🔑 Reset Pass
                              </button>

                              <button
                                onClick={() => handleDeleteUser(u)}
                                title="Deactivate user access"
                                className="text-[12px] bg-white hover:bg-red-50 text-red-600 border border-red-200 px-2 py-1 cursor-pointer"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: ROLES & GRANULAR PERMISSION MATRIX ──────────────────── */}
        {activeTab === "roles" && (
          <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-[600px]">
            {/* Left Column: Roles Sidebar */}
            <div className="w-full lg:w-84 bg-white border border-[#DDE2EC] flex flex-col overflow-hidden shadow-sm">
              <div className="p-4 border-b border-[#DDE2EC] bg-[#F8FAFC]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-[13px] font-bold text-[#0F172A] tracking-wider uppercase">
                      Access Roles ({filteredRoles.length})
                    </h3>
                    <p className="text-[11px] text-[#64748B]">Central RBAC profiles</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        void refreshAccessGovernance().catch((error) => {
                          void loadRoleCatalogueFallback()
                            .then(() => setRoleNotice("Role templates reloaded."))
                            .catch(() =>
                              setRoleNotice(
                                error instanceof Error ? error.message : "Unable to reload roles.",
                              ),
                            )
                        })
                      }}
                      title="Reload role templates and staff assignments"
                      className="text-[11px] bg-white hover:bg-gray-50 text-[#334155] px-2 py-1 border border-[#CBD5E1] font-semibold cursor-pointer"
                    >
                      Reload
                    </button>
                    <button
                      onClick={() => setShowCloneRoleModal(true)}
                      title="Clone selected role"
                      className="text-[11px] bg-white hover:bg-gray-50 text-[#334155] px-2 py-1 border border-[#CBD5E1] font-semibold cursor-pointer"
                    >
                      Clone
                    </button>
                    <button
                      onClick={() => {
                        setShowCreateRoleModal(true)
                        setNewRoleName("")
                      }}
                      title="Create new role"
                      className="text-[11px] bg-[#1B4FD8] hover:bg-[#1740B4] text-white px-2 py-1 font-semibold cursor-pointer"
                    >
                      + New
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-[#94A3B8] text-[12px]">
                    🔍
                  </span>
                  <input
                    value={roleSearch}
                    onChange={(e) => setRoleSearch(e.target.value)}
                    placeholder="Search roles..."
                    className="w-full bg-white border border-[#DDE2EC] pl-8 pr-3 py-1.5 text-[12.5px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 divide-y divide-[#F1F5F9]">
                {filteredRoles.map((role) => {
                  const isSelected = selectedRoleId === role.id
                  const assignedCount = users.filter(
                    (u) => u.roleId === role.id,
                  ).length
                  const isProtected =
                    role.id === "ROLE_SUPERADMIN" || role.id === "ROLE_ADMIN"

                  const roleAbbr = role.name
                    .split(" ")
                    .filter(Boolean)
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 3)
                    .toUpperCase()

                  return (
                    <div
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`p-3 cursor-pointer transition-all flex items-start justify-between group ${
                        isSelected
                          ? "bg-[#EFF6FF] border-l-4 border-[#1B4FD8] text-[#1B4FD8]"
                          : "hover:bg-gray-50 text-[#334155]"
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`w-6 h-6 rounded flex items-center justify-center font-bold text-[10px] shrink-0 ${
                              isProtected
                                ? "bg-purple-100 text-purple-700 border border-purple-200"
                                : isSelected
                                  ? "bg-[#1B4FD8] text-white"
                                  : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {roleAbbr}
                          </span>
                          <span
                            className={`text-[13px] font-bold truncate ${
                              isSelected ? "text-[#1B4FD8]" : "text-[#0F172A]"
                            }`}
                          >
                            {role.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap ml-8">
                          {isProtected && (
                            <span className="text-[9.5px] bg-purple-50 text-purple-700 px-1.5 py-0.2 border border-purple-200 font-mono font-bold">
                              SYSTEM
                            </span>
                          )}
                          {role.isSystem && !isProtected && (
                            <span className="text-[9.5px] bg-blue-50 text-blue-700 px-1.5 py-0.2 border border-blue-200 font-mono">
                              TEMPLATE
                            </span>
                          )}
                          {role.status === "Inactive" && (
                            <span className="text-[9.5px] bg-amber-50 text-amber-700 px-1.5 py-0.2 border border-amber-200 font-mono">
                              INACTIVE
                            </span>
                          )}
                          <span className="text-[11.5px] text-[#64748B] font-mono">
                            {assignedCount} staff
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setCloneSourceRoleId(role.id)
                            setShowCloneRoleModal(true)
                          }}
                          title="Clone this role"
                          className="text-[11px] text-slate-400 hover:text-blue-600 p-1"
                        >
                          📋
                        </button>
                        {!isProtected && !role.isSystem && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteRole(role)
                            }}
                            title="Delete custom role"
                            className="text-[11px] text-slate-400 hover:text-red-600 p-1"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right Column: Permission Matrix for Selected Role */}
            <div className="flex-1 bg-white border border-[#DDE2EC] flex flex-col overflow-hidden shadow-sm">
              {selectedRole ? (
                <>
                  {/* Top Role Header */}
                  <div className="p-4 border-b border-[#DDE2EC] bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
                          <span>🛡️</span>
                          <span>{selectedRole.name}</span>
                        </h2>
                        <span className="text-[11px] font-mono text-[#64748B] bg-white px-2 py-0.5 border border-[#DDE2EC]">
                          {selectedRole.id}
                        </span>
                        <span
                          className={`text-[10.5px] font-bold px-2 py-0.5 border rounded-xs ${
                            (selectedRole.status || "Active") === "Active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {selectedRole.status || "Active"}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#64748B] mt-0.5">
                        {selectedRoleIsProtected
                          ? "This protected System Administrator role maintains unrestricted access across all hospital suites."
                          : "Configure granular action-level permissions (View, Create, Edit, Delete, Approve, Export) for this role."}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                      {roleNotice && (
                        <span className="text-[12px] text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 border border-emerald-200 shadow-2xs">
                          ✓ {roleNotice}
                        </span>
                      )}

                      {!selectedRoleIsProtected && (
                        <button
                          onClick={handleToggleRoleStatus}
                          className="border border-[#CBD5E1] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#334155] hover:bg-slate-50 cursor-pointer"
                        >
                          {selectedRole.status === "Inactive" ? "Activate Role" : "Deactivate Role"}
                        </button>
                      )}

                      <button
                        onClick={handleSaveRoleModules}
                        disabled={saveStatus === "saving" || selectedRoleIsProtected}
                        className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white font-semibold text-[13px] px-4 py-1.5 transition-colors border border-blue-600 shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                      >
                        <span>💾</span>
                        <span>
                          {saveStatus === "saving"
                            ? "Saving..."
                            : saveStatus === "saved"
                              ? "✓ Saved Matrix!"
                              : "Save Permission Matrix"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Preset Action Toolbar */}
                  <div className="px-5 py-2.5 bg-[#EFF6FF] border-b border-blue-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wide">
                        Quick Presets:
                      </span>
                      <button
                        onClick={applyPresetFullAccess}
                        disabled={selectedRoleIsProtected}
                        className="text-[11px] bg-white text-blue-700 hover:bg-blue-50 px-2.5 py-1 border border-blue-300 font-semibold rounded-xs cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        ⚡ Full Access
                      </button>
                      <button
                        onClick={applyPresetClinical}
                        disabled={selectedRoleIsProtected}
                        className="text-[11px] bg-white text-blue-700 hover:bg-blue-50 px-2.5 py-1 border border-blue-300 font-semibold rounded-xs cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        🩺 Clinical Standard
                      </button>
                      <button
                        onClick={applyPresetDiagnostics}
                        disabled={selectedRoleIsProtected}
                        className="text-[11px] bg-white text-blue-700 hover:bg-blue-50 px-2.5 py-1 border border-blue-300 font-semibold rounded-xs cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        🧪 Diagnostics Suite
                      </button>
                      <button
                        onClick={applyPresetFinance}
                        disabled={selectedRoleIsProtected}
                        className="text-[11px] bg-white text-blue-700 hover:bg-blue-50 px-2.5 py-1 border border-blue-300 font-semibold rounded-xs cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        💳 Billing & Finance
                      </button>
                      <button
                        onClick={applyPresetReadOnly}
                        disabled={selectedRoleIsProtected}
                        className="text-[11px] bg-white text-slate-700 hover:bg-slate-50 px-2.5 py-1 border border-slate-300 font-semibold rounded-xs cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        👁️ Read Only All
                      </button>
                      <button
                        onClick={applyPresetRevokeAll}
                        disabled={selectedRoleIsProtected}
                        className="text-[11px] bg-white text-red-700 hover:bg-red-50 px-2.5 py-1 border border-red-300 font-semibold rounded-xs cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        🚫 Revoke All
                      </button>
                    </div>

                    {/* View Switcher & Module Search */}
                    <div className="flex items-center gap-3">
                      <div className="relative w-48">
                        <input
                          value={moduleSearch}
                          onChange={(e) => setModuleSearch(e.target.value)}
                          placeholder="Filter modules..."
                          className="w-full bg-white border border-blue-300 px-2.5 py-1 text-[11.5px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B4FD8]"
                        />
                      </div>

                      <div className="inline-flex border border-blue-300 rounded-xs bg-white p-0.5 shadow-2xs">
                        <button
                          onClick={() => setMatrixViewMode("grid")}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-xs cursor-pointer transition-colors ${
                            matrixViewMode === "grid"
                              ? "bg-[#1B4FD8] text-white"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          🔲 Card Grid
                        </button>
                        <button
                          onClick={() => setMatrixViewMode("table")}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-xs cursor-pointer transition-colors ${
                            matrixViewMode === "table"
                              ? "bg-[#1B4FD8] text-white"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          📑 Spreadsheet Matrix
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Matrix Content Area */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    {/* View Mode 1: SPREADSHEET MATRIX TABLE */}
                    {matrixViewMode === "table" ? (
                      <div className="border border-[#CBD5E1] bg-white overflow-x-auto shadow-2xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-[#0F172A] text-white text-[11px] uppercase font-mono tracking-wider">
                              <th className="px-4 py-3">Hospital Module / Service</th>
                              <th className="px-3 py-3 text-center">Master Access</th>
                              {ACTIONS_LIST.map((act) => (
                                <th key={act.key} className="px-3 py-3 text-center">
                                  <span className="mr-1">{act.icon}</span>
                                  <span>{act.label}</span>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E8F0] text-[12.5px]">
                            {MODULE_CATEGORIES.map((cat) => {
                              const matchingModules = cat.modules.filter((m) => {
                                if (!moduleSearch) return true
                                const meta = MODULE_METADATA[m]
                                const term = moduleSearch.toLowerCase()
                                return (
                                  m.toLowerCase().includes(term) ||
                                  meta?.name.toLowerCase().includes(term) ||
                                  cat.title.toLowerCase().includes(term)
                                )
                              })

                              if (matchingModules.length === 0) return null

                              return (
                                <React.Fragment key={cat.id}>
                                  {/* Category Header Row */}
                                  <tr className="bg-[#F1F5F9] font-bold text-[#0F172A] border-y border-[#CBD5E1]">
                                    <td colSpan={8} className="px-4 py-2 text-[12px] bg-slate-100">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[#1B4FD8]">●</span>
                                          <span>{cat.title}</span>
                                          <span className="text-[11px] font-normal text-slate-500">
                                            ({cat.description})
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => selectAllCategoryModules(cat.modules)}
                                            disabled={selectedRoleIsProtected}
                                            className="text-[10.5px] text-[#1B4FD8] hover:underline cursor-pointer"
                                          >
                                            Select Category
                                          </button>
                                          <span className="text-slate-300">|</span>
                                          <button
                                            onClick={() => clearCategoryModules(cat.modules)}
                                            disabled={selectedRoleIsProtected}
                                            className="text-[10.5px] text-slate-500 hover:underline cursor-pointer"
                                          >
                                            Clear Category
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>

                                  {/* Module Rows */}
                                  {matchingModules.map((modKey) => {
                                    const meta = MODULE_METADATA[modKey]
                                    const isFullMaster = hasFullModuleAccess(
                                      selectedRole.allowedModules,
                                      modKey,
                                    )
                                    const hasAny = hasSavedModuleAccess(
                                      selectedRole.allowedModules,
                                      modKey,
                                    )

                                    return (
                                      <tr
                                        key={modKey}
                                        className={`hover:bg-[#F8FAFC] transition-colors ${
                                          isFullMaster ? "bg-blue-50/40" : hasAny ? "bg-blue-50/15" : ""
                                        }`}
                                      >
                                        <td className="px-4 py-3 font-semibold text-[#0F172A]">
                                          <div className="flex items-center gap-2.5">
                                            <span className="text-base">{meta?.icon || "📦"}</span>
                                            <div>
                                              <div className="font-bold text-[#0F172A] flex items-center gap-2">
                                                <span>{meta?.name || modKey}</span>
                                                {hasAny && !isFullMaster && (
                                                  <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                                    Customized
                                                  </span>
                                                )}
                                              </div>
                                              <div className="text-[11px] text-slate-500 font-normal">
                                                {meta?.description || modKey}
                                              </div>
                                            </div>
                                          </div>
                                        </td>

                                        {/* Master Access Checkbox */}
                                        <td className="px-3 py-3 text-center">
                                          <input
                                            type="checkbox"
                                            checked={isFullMaster}
                                            disabled={selectedRoleIsProtected}
                                            onChange={() => toggleModuleForSelectedRole(modKey)}
                                            className="w-4 h-4 text-[#1B4FD8] rounded border-gray-300 focus:ring-[#1B4FD8] cursor-pointer"
                                            title={isFullMaster ? "Revoke full module access" : "Grant full module access"}
                                          />
                                        </td>

                                        {/* 6 Action Checkboxes */}
                                        {ACTIONS_LIST.map((act) => {
                                          const granted = isActionGranted(
                                            selectedRole.allowedModules,
                                            modKey,
                                            act.key,
                                          )
                                          return (
                                            <td key={act.key} className="px-3 py-3 text-center">
                                              <input
                                                type="checkbox"
                                                checked={granted}
                                                disabled={selectedRoleIsProtected}
                                                onChange={() =>
                                                  toggleActionForSelectedRole(modKey, act.key)
                                                }
                                                className="w-4 h-4 text-[#1B4FD8] rounded border-gray-300 focus:ring-[#1B4FD8] cursor-pointer"
                                              />
                                            </td>
                                          )
                                        })}
                                      </tr>
                                    )
                                  })}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* View Mode 2: CARD GRID VIEW */
                      <div className="space-y-6">
                        {MODULE_CATEGORIES.map((cat) => {
                          const matchingModules = cat.modules.filter((m) => {
                            if (!moduleSearch) return true
                            const meta = MODULE_METADATA[m]
                            const term = moduleSearch.toLowerCase()
                            return (
                              m.toLowerCase().includes(term) ||
                              meta?.name.toLowerCase().includes(term) ||
                              cat.title.toLowerCase().includes(term)
                            )
                          })

                          if (matchingModules.length === 0) return null

                          return (
                            <div key={cat.id} className="border border-[#CBD5E1] bg-[#FAFCFF] p-4.5 rounded-xs shadow-2xs">
                              {/* Category Header */}
                              <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] mb-4">
                                <div>
                                  <h4 className="text-[14px] font-bold text-[#0F172A] flex items-center gap-2">
                                    <span className="text-[#1B4FD8]">●</span>
                                    <span>{cat.title}</span>
                                  </h4>
                                  <p className="text-[11.5px] text-[#64748B] mt-0.5">
                                    {cat.description}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => selectAllCategoryModules(cat.modules)}
                                    disabled={selectedRoleIsProtected}
                                    className="text-[11.5px] text-[#1B4FD8] hover:underline font-semibold cursor-pointer"
                                  >
                                    Select All
                                  </button>
                                  <span className="text-gray-300">|</span>
                                  <button
                                    onClick={() => clearCategoryModules(cat.modules)}
                                    disabled={selectedRoleIsProtected}
                                    className="text-[11.5px] text-[#64748B] hover:underline cursor-pointer"
                                  >
                                    Clear All
                                  </button>
                                </div>
                              </div>

                              {/* Module Cards Grid */}
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                {matchingModules.map((modKey) => {
                                  const meta = MODULE_METADATA[modKey]
                                  const isModuleEnabled = hasSavedModuleAccess(
                                    selectedRole.allowedModules,
                                    modKey,
                                  )
                                  const isFullMaster = hasFullModuleAccess(
                                    selectedRole.allowedModules,
                                    modKey,
                                  )

                                  return (
                                    <div
                                      key={modKey}
                                      className={`p-3.5 border transition-all rounded-xs shadow-2xs ${
                                        isFullMaster
                                          ? "bg-white border-[#1B4FD8] ring-1 ring-[#1B4FD8]/30 shadow-xs"
                                          : isModuleEnabled
                                            ? "bg-blue-50/20 border-blue-300"
                                            : "bg-white/80 border-slate-200"
                                      }`}
                                    >
                                      {/* Module Title & Master Toggle */}
                                      <div className="flex items-start justify-between gap-2 mb-2">
                                        <label className="flex items-start gap-2.5 cursor-pointer font-bold text-[13px] text-[#0F172A]">
                                          <input
                                            type="checkbox"
                                            checked={isFullMaster}
                                            disabled={selectedRoleIsProtected}
                                            onChange={() => toggleModuleForSelectedRole(modKey)}
                                            className="w-4 h-4 mt-0.5 text-[#1B4FD8] rounded border-gray-300 focus:ring-[#1B4FD8] cursor-pointer"
                                            title={isFullMaster ? "Revoke full module access" : "Grant full module access"}
                                          />
                                          <div>
                                            <div className="flex items-center gap-1.5">
                                              <span>{meta?.icon || "📦"}</span>
                                              <span>{meta?.name || modKey}</span>
                                              {isModuleEnabled && !isFullMaster && (
                                                <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                                  Customized
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-[11px] text-[#64748B] font-normal leading-4 mt-0.5">
                                              {meta?.description || modKey}
                                            </div>
                                          </div>
                                        </label>
                                      </div>

                                      {/* Granular Action Pills */}
                                      <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-1.5">
                                        {ACTIONS_LIST.map((act) => {
                                          const hasAction = isActionGranted(
                                            selectedRole.allowedModules,
                                            modKey,
                                            act.key,
                                          )
                                          return (
                                            <button
                                              key={act.key}
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                toggleActionForSelectedRole(modKey, act.key)
                                              }}
                                              disabled={selectedRoleIsProtected}
                                              title={`${act.description} for ${meta?.name || modKey}`}
                                              className={`px-2 py-1 flex items-center justify-center gap-1 text-[11px] font-semibold border transition-all cursor-pointer rounded-xs ${
                                                hasAction
                                                  ? "bg-[#1B4FD8] text-white border-blue-700 shadow-2xs font-bold"
                                                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                                              }`}
                                            >
                                              <span>{act.icon}</span>
                                              <span>{act.label}</span>
                                            </button>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-12 text-center text-gray-500">
                  Select a role from the sidebar to view permissions.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 4: AUDIT LOGS ─────────────────────────────────────────── */}
        {activeTab === "audit" && (
          <div className="bg-white border border-[#DDE2EC] flex flex-col flex-1 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[#DDE2EC] bg-[#F8FAFC] flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
                <input
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search log description, user, or action..."
                  className="w-full md:w-80 bg-white border border-[#DDE2EC] px-3.5 py-1.5 text-[13px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B4FD8]"
                />

                <select
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  className="bg-white border border-[#DDE2EC] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                >
                  <option value="all">All Event Actions</option>
                  {uniqueAuditActions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>

                <select
                  value={auditUserFilter}
                  onChange={(e) => setAuditUserFilter(e.target.value)}
                  className="bg-white border border-[#DDE2EC] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                >
                  <option value="all">All Users</option>
                  {uniqueAuditUsers.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>

                <select
                  value={auditDateFilter}
                  onChange={(e) => setAuditDateFilter(e.target.value)}
                  className="bg-white border border-[#DDE2EC] px-3 py-1.5 text-[12.5px] text-[#334155] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="7days">Last 7 Days</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => alert("Audit log report exported to CSV.")}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[12.5px] font-semibold px-3 py-1.5 border border-[#CBD5E1] transition-colors shadow-sm cursor-pointer"
                >
                  Export Audit CSV
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F1F5F9] border-b border-[#DDE2EC] text-[11.5px] text-[#475569] uppercase font-mono tracking-wider whitespace-nowrap">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Action Event</th>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Device</th>
                    <th className="px-4 py-3">Login Time</th>
                    <th className="px-4 py-3">Logout Time</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[13px] text-[#334155]">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-[#64748B]">
                        No audit log records match the selected search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((log) => {
                      const isLoginSession =
                        log.action.toLowerCase().includes("login") || log.module === "Authentication"

                      return (
                        <tr 
                          key={log.id} 
                          onClick={() => setSelectedAuditLog(log)}
                          className="hover:bg-[#F8FAFC] cursor-pointer transition-colors text-[12.5px]"
                        >
                          <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748B] whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>

                          <td className="px-4 py-3 font-bold text-[#0F172A] whitespace-nowrap">
                            {log.username}
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-[11.5px] bg-blue-50 text-[#1B4FD8] px-2 py-0.5 border border-blue-200 font-semibold">
                              {log.action}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-[#64748B] font-medium whitespace-nowrap">
                            {log.module}
                          </td>

                          <td className="px-4 py-3 text-[#334155] max-w-xs truncate">
                            {log.description}
                          </td>

                          <td className="px-4 py-3 font-medium text-[#0F172A] whitespace-nowrap">
                            {log.device || detectDevice()}
                          </td>

                          <td className="px-4 py-3 font-mono text-[12px] text-[#334155] whitespace-nowrap">
                            {log.loginTime || "—"}
                          </td>

                          <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap">
                            {log.logoutTime === "Active" ? (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 border border-emerald-200 font-bold rounded">
                                Active
                              </span>
                            ) : log.logoutTime === "Session Expired" ? (
                              <span className="text-amber-800 bg-amber-50 px-2 py-0.5 border border-amber-200 font-semibold rounded">
                                Session Expired
                              </span>
                            ) : (
                              log.logoutTime || "—"
                            )}
                          </td>

                          <td className="px-4 py-3 font-mono font-bold text-[#1B4FD8] whitespace-nowrap">
                            {log.duration || "—"}
                          </td>

                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 border ${
                                log.status === "Success"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-red-50 text-red-700 border-red-200"
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {auditLogs.length < auditTotal && (
              <div className="p-3 border-t border-[#DDE2EC] flex items-center justify-center">
                <button
                  onClick={loadMoreAuditLogs}
                  disabled={auditLoadingMore}
                  className="text-[12.5px] font-semibold text-[#1B4FD8] hover:text-[#1E40AF] disabled:opacity-50 cursor-pointer"
                >
                  {auditLoadingMore
                    ? "Loading..."
                    : `Load more (${auditLogs.length} of ${auditTotal})`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 5: SYSTEM & GOVERNANCE SETTINGS ────────────────────────── */}
        {activeTab === "settings" && (
          <div className="space-y-6 w-full">
            <div className="bg-white border border-[#DDE2EC] p-6 space-y-6 shadow-sm">
              <div className="border-b border-[#E2E8F0] pb-4">
                <h3 className="text-base font-bold text-[#0F172A]">
                  Hospital System Security Policies
                </h3>
                <p className="text-[12.5px] text-[#64748B]">
                  Configure global authentication requirements, session expiry,
                  and access limits.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center justify-between p-4 bg-[#F8FAFC] border border-[#E2E8F0]">
                  <div>
                    <div className="font-bold text-[#0F172A] text-[13.5px]">
                      Enforce Multi-Factor Auth (MFA)
                    </div>
                    <div className="text-[11.5px] text-[#64748B]">
                      Require OTP code on unknown device logins
                    </div>
                  </div>
                  <button
                    onClick={() => setMfaEnforced(!mfaEnforced)}
                    className={`w-12 h-6 flex items-center p-1 border transition-colors cursor-pointer ${
                      mfaEnforced
                        ? "bg-[#1B4FD8] border-blue-600 justify-end"
                        : "bg-gray-200 border-gray-300 justify-start"
                    }`}
                  >
                    <div className="w-4 h-4 bg-white shadow"></div>
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-[#F8FAFC] border border-[#E2E8F0]">
                  <div>
                    <div className="font-bold text-[#0F172A] text-[13.5px]">
                      Maintenance Mode
                    </div>
                    <div className="text-[11.5px] text-[#64748B]">
                      Restrict logins to Super Admins only
                    </div>
                  </div>
                  <button
                    onClick={() => setMaintenanceMode(!maintenanceMode)}
                    className={`w-12 h-6 flex items-center p-1 border transition-colors cursor-pointer ${
                      maintenanceMode
                        ? "bg-amber-600 border-amber-500 justify-end"
                        : "bg-gray-200 border-gray-300 justify-start"
                    }`}
                  >
                    <div className="w-4 h-4 bg-white shadow"></div>
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-rose-50/50 border border-rose-200">
                  <div>
                    <div className="font-bold text-rose-900 text-[13.5px]">
                      Wipe All Patient &amp; Test Data
                    </div>
                    <div className="text-[11.5px] text-rose-700">
                      Remove all patients, encounters, queue entries, visits, and billing claims to start from a completely clean slate.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "⚠️ Reset Application to Clean Slate?\n\nThis will completely remove all patients, visits, queue records, lab orders, pharmacy dispensing, and invoices so you can test from scratch.\n\nUser logins, roles, and rate cards will be preserved.\n\nClick OK to proceed.",
                        )
                      ) {
                        clearAllApplicationData()
                      }
                    }}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    🧹 Clear All Data
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Session Idle Timeout (Minutes)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 30"
                    value={sessionTimeoutMinutes}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === "") {
                        setSessionTimeoutMinutes("")
                      } else {
                        const val = parseInt(raw, 10)
                        if (isNaN(val)) {
                          setSessionTimeoutMinutes("")
                        } else {
                          setSessionTimeoutMinutes(Math.max(0, Math.abs(val)))
                        }
                      }
                    }}
                    onBlur={() => {
                      if (sessionTimeoutMinutes === "") {
                        setSessionTimeoutMinutes(0)
                      }
                    }}
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Minimum Password Length
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 10"
                    value={minPasswordLength}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === "") {
                        setMinPasswordLength("")
                      } else {
                        const val = parseInt(raw, 10)
                        if (isNaN(val)) {
                          setMinPasswordLength("")
                        } else {
                          setMinPasswordLength(Math.max(0, Math.abs(val)))
                        }
                      }
                    }}
                    onBlur={() => {
                      if (minPasswordLength === "") {
                        setMinPasswordLength(0)
                      }
                    }}
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-[#E2E8F0]">
                <button
                  onClick={() => {
                    setSettingsNotice(
                      "System governance security policy saved successfully.",
                    )
                    setTimeout(() => setSettingsNotice(""), 3000)
                  }}
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white font-semibold text-[13px] px-5 py-2 transition-colors border border-blue-600 shadow-sm cursor-pointer"
                >
                  Save Governance Policies
                </button>
              </div>

              {settingsNotice && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] p-3 font-semibold">
                  ✓ {settingsNotice}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────── */}

      {showSpecialtyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="w-full max-w-md border border-[#DDE2EC] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#DDE2EC] bg-[#F8FAFC] px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">Add Specialty</h3>
                <p className="mt-0.5 text-[11.5px] text-[#64748B]">Doctors can then be assigned to this specialty.</p>
              </div>
              <button onClick={() => setShowSpecialtyModal(false)} className="text-[#64748B] hover:text-black">×</button>
            </div>
            <form onSubmit={handleCreateSpecialty} className="space-y-4 p-6">
              <div>
                <label className="mb-1.5 block text-[12px] font-bold text-[#334155]">Specialty Name</label>
                <input
                  required
                  autoFocus
                  value={newSpecialtyName}
                  onChange={(event) => setNewSpecialtyName(event.target.value)}
                  placeholder="e.g. Nephrology"
                  className="w-full border border-[#DDE2EC] bg-white px-3.5 py-2 text-[13px] text-[#0F172A] focus:border-[#1B4FD8] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-3 border-t border-[#E2E8F0] pt-4">
                <button type="button" onClick={() => setShowSpecialtyModal(false)} className="border border-[#CBD5E1] bg-white px-4 py-2 text-[13px] font-semibold text-[#334155]">Cancel</button>
                <button type="submit" className="border border-blue-600 bg-[#1B4FD8] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#1740B4]">Add Specialty</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 1. Add / Edit Doctor Modal */}
      {showDoctorModal && editingDoctor && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A]">
                {doctors.some((d) => d.id === editingDoctor.id)
                  ? "Edit Doctor Profile"
                  : "Add New Doctor to Roster"}
              </h3>
              <button
                onClick={() => setShowDoctorModal(false)}
                className="text-[#64748B] hover:text-black"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveDoctor} className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Doctor Full Name
                </label>
                <input
                  required
                  autoFocus
                  value={editingDoctor.name}
                  onChange={(e) =>
                    setEditingDoctor({ ...editingDoctor, name: e.target.value })
                  }
                  placeholder="e.g. Dr. P. R. K. Varma"
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Qualifications & Degrees
                  </label>
                  <input
                    required
                    value={editingDoctor.qualification}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        qualification: e.target.value,
                      })
                    }
                    placeholder="e.g. M.D., D.M. (Cardiology)"
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Specialty / Department
                  </label>
                  <select
                    required
                    value={editingDoctor.specialty || ""}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        specialty: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  >
                    <option value="">Select Specialty</option>
                    {specialties.map((specialty) => (
                      <option key={specialty.id} value={specialty.specialty_name}>
                        {specialty.specialty_name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-[#64748B]">
                    Add a new option from <span className="font-semibold">+ Specialty</span> before creating the doctor.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Panel Category
                  </label>
                  <select
                    value={editingDoctor.section}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        section: e.target.value as DoctorSection,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-semibold cursor-pointer"
                  >
                    <option value="Main">Main Resident Panel</option>
                    <option value="Visiting">Visiting Consultant</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Consultation Room
                  </label>
                  <input
                    required
                    value={editingDoctor.room}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        room: e.target.value,
                      })
                    }
                    placeholder="e.g. Room 201"
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">Consultation Fee (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    required
                    value={
                      editingDoctor.consultationFee === undefined ||
                      editingDoctor.consultationFee === null ||
                      (editingDoctor.consultationFee as any) === "" ||
                      isNaN(editingDoctor.consultationFee as any)
                        ? ""
                        : editingDoctor.consultationFee
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditingDoctor({
                        ...editingDoctor,
                        consultationFee: val === "" ? ("" as any) : Number(val),
                      });
                    }}
                    placeholder="e.g. 500"
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[13px] text-[#0F172A] font-semibold focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Staff Employee ID
                  </label>
                  <input
                    required
                    value={editingDoctor.staffId}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        staffId: e.target.value,
                      })
                    }
                    placeholder="e.g. IMP-201"
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Login Username ID
                  </label>
                  <input
                    value={editingDoctor.username || ""}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        username: e.target.value.toLowerCase().trim(),
                      })
                    }
                    placeholder="e.g. prkvarma"
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                  />
                </div>
              </div>

              {/* Assigned Access Role & Portal Password */}
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Assigned Access Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={editingDoctor.roleId || "ROLE_DOCTOR"}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        roleId: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                  >
                    <option value="ROLE_DOCTOR">Doctor (Full OPD & Clinical Access)</option>
                    <option value="ROLE_SURGEON">Surgeon (OT, Ward & Clinical)</option>
                    <option value="ROLE_ANESTHETIST">Anesthetist (Surgical & Sedation)</option>
                    <option value="ROLE_ER_PHYSICIAN">Emergency Physician (Triage & ER)</option>
                    <option value="ROLE_RADIOLOGIST">Radiologist (Imaging & Scans)</option>
                    {roles
                      .filter(
                        (r) =>
                          ![
                            "ROLE_DOCTOR",
                            "ROLE_SURGEON",
                            "ROLE_ANESTHETIST",
                            "ROLE_ER_PHYSICIAN",
                            "ROLE_RADIOLOGIST",
                            "ROLE_ADMIN",
                            "ROLE_SUPERADMIN",
                          ].includes(r.id) && r.status !== "Inactive",
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-[11px] text-[#64748B]">
                    Assigns the security role & permissions for doctor login.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[12px] font-bold text-[#334155]">
                      Portal Login Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const rand = Math.floor(100 + Math.random() * 900)
                        setEditingDoctor({
                          ...editingDoctor,
                          password: `Doctor@${rand}`,
                        })
                      }}
                      className="text-[11px] text-[#1B4FD8] hover:underline font-semibold cursor-pointer"
                    >
                      🎲 Generate
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editingDoctor.password || ""}
                    onChange={(e) =>
                      setEditingDoctor({
                        ...editingDoctor,
                        password: e.target.value,
                      })
                    }
                    placeholder="e.g. Doctor@123"
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] font-mono focus:outline-none focus:border-[#1B4FD8]"
                  />
                  <p className="mt-1 text-[11px] text-[#64748B]">
                    Default: <span className="font-semibold font-mono text-slate-700">Doctor@123</span> (or custom).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="doctorVerifiedCheck"
                  checked={editingDoctor.verified}
                  onChange={(e) =>
                    setEditingDoctor({
                      ...editingDoctor,
                      verified: e.target.checked,
                    })
                  }
                  className="w-4 h-4 text-[#1B4FD8] rounded cursor-pointer"
                />
                <label
                  htmlFor="doctorVerifiedCheck"
                  className="text-[12.5px] font-semibold text-[#0F172A] cursor-pointer"
                >
                  Verified Doctor (Enable for appointment booking & portal
                  login)
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowDoctorModal(false)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-5 py-2 border border-blue-600 shadow-sm cursor-pointer"
                >
                  Save Doctor Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* System Admin Credentials Modal */}
      {showAdminModal && (
        <AdminCredentialsModal
          isOpen={showAdminModal}
          onClose={() => setShowAdminModal(false)}
          onSaved={(updated) => {
            setUsers(RoleDatabase.getUsers())
            toast.success(`Admin credentials updated successfully (@${updated.username}).`)
            setUserNotice(`Admin credentials updated successfully (@${updated.username}).`)
            setTimeout(() => setUserNotice(""), 5000)
          }}
        />
      )}

      {/* 2. Edit Credentials Modal */}
      {showCredentialsModal && credentialsForm && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A]">
                Edit Login Credentials
              </h3>
              <button
                onClick={() => setShowCredentialsModal(false)}
                className="text-[#64748B] hover:text-black"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveCredentials} className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 p-3 text-[12.5px] text-[#1B4FD8] font-semibold">
                Editing credentials for <strong>{credentialsForm.name}</strong>{" "}
                ({credentialsForm.staffId})
              </div>

              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Username (Login ID)
                </label>
                <input
                  required
                  value={credentialsForm.username}
                  onChange={(e) =>
                    setCredentialsForm({
                      ...credentialsForm,
                      username: e.target.value.toLowerCase().trim(),
                    })
                  }
                  placeholder="e.g. prkvarma"
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-bold text-[#334155]">
                    Account Password
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setCredentialsForm({
                        ...credentialsForm,
                        password: `Pass#${Math.floor(1000 + Math.random() * 9000)}`,
                      })
                    }
                    className="text-[11px] font-semibold text-[#1B4FD8] hover:underline"
                  >
                    🎲 Generate Password
                  </button>
                </div>
                <input
                  required
                  type="text"
                  value={credentialsForm.password ?? ""}
                  onChange={(e) =>
                    setCredentialsForm({
                      ...credentialsForm,
                      password: e.target.value,
                    })
                  }
                  placeholder="Enter or generate password..."
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Assigned System Role
                  </label>
                  <select
                    value={credentialsForm.roleId}
                    onChange={(e) =>
                      setCredentialsForm({
                        ...credentialsForm,
                        roleId: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-semibold cursor-pointer"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
                    This staff member will receive the department access saved for the selected role.
                  </p>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Account Status
                  </label>
                  <select
                    value={credentialsForm.status}
                    onChange={(e) =>
                      setCredentialsForm({
                        ...credentialsForm,
                        status: e.target.value as any,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-semibold cursor-pointer"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Staff ID
                </label>
                <input
                  required
                  value={credentialsForm.staffId}
                  onChange={(e) =>
                    setCredentialsForm({
                      ...credentialsForm,
                      staffId: e.target.value,
                    })
                  }
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowCredentialsModal(false)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-5 py-2 border border-blue-600 shadow-sm cursor-pointer"
                >
                  Update Credentials
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Create Role Modal */}
      {showCreateRoleModal && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A]">
                Create New Custom Role
              </h3>
              <button
                onClick={() => setShowCreateRoleModal(false)}
                className="text-[#64748B] hover:text-black"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateRole} className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Role Name
                </label>
                <input
                  required
                  autoFocus
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Senior Critical Care Registrar"
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  placeholder="Responsibilities and access scope..."
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowCreateRoleModal(false)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-5 py-2 border border-blue-600 shadow-sm cursor-pointer"
                >
                  Create & Configure Modules
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Clone Role Modal */}
      {showCloneRoleModal && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A]">
                Clone Existing Role
              </h3>
              <button
                onClick={() => setShowCloneRoleModal(false)}
                className="text-[#64748B] hover:text-black"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCloneRole} className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Source Role to Copy Permissions From
                </label>
                <select
                  value={cloneSourceRoleId}
                  onChange={(e) => setCloneSourceRoleId(e.target.value)}
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.allowedModules.length} Rules)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  New Role Name
                </label>
                <input
                  required
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. ICU Charge Nurse"
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowCloneRoleModal(false)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-5 py-2 border border-blue-600 shadow-sm cursor-pointer"
                >
                  Clone Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Create / Edit User Account Modal */}
      {showUserModal && editingUser && (() => {
        const isExisting = users.some(
          (u) =>
            u.id === editingUser.id ||
            Boolean(u.username && editingUser.username && u.username.toLowerCase() === editingUser.username.trim().toLowerCase()),
        )
        return (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-[#0F172A] flex items-center gap-2">
                <span>👤</span>
                <span>
                  {isExisting
                    ? "Edit Staff User Account"
                    : "Create New Staff Account"}
                </span>
              </h3>
              <button
                onClick={() => {
                  setShowUserModal(false)
                  setEditingUser(null)
                }}
                className="text-[#64748B] hover:text-black font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Full Name */}
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={editingUser.name}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, name: e.target.value })
                  }
                  placeholder="e.g. Dr. Robert Miller"
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              {/* Username & Staff ID */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Username ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    value={editingUser.username}
                    onChange={(e) =>
                      setEditingUser({
                        ...editingUser,
                        username: e.target.value.toLowerCase().trim(),
                      })
                    }
                    placeholder="e.g. rmiller"
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[12px] font-bold text-[#334155]">
                      Staff Employee ID <span className="text-red-500">*</span>
                    </label>
                    {!editingUser.staffId && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingUser({
                            ...editingUser,
                            staffId: `STF-${Math.floor(100 + Math.random() * 900)}`,
                          })
                        }
                        className="text-[11px] text-[#1B4FD8] hover:underline"
                      >
                        Auto ID
                      </button>
                    )}
                  </div>
                  <input
                    required
                    value={editingUser.staffId}
                    onChange={(e) =>
                      setEditingUser({
                        ...editingUser,
                        staffId: e.target.value,
                      })
                    }
                    placeholder="e.g. DOC-901"
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                  />
                </div>
              </div>

              {/* Role & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Assigned System Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editingUser.roleId}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, roleId: e.target.value })
                    }
                    disabled={editingUser.roleId === "ROLE_ADMIN" || editingUser.username === "admin"}
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-semibold cursor-pointer disabled:bg-gray-100 disabled:text-gray-600"
                  >
                    {(editingUser.roleId === "ROLE_ADMIN" || editingUser.username === "admin") && (
                      <option value="ROLE_ADMIN">System Administrator (Root Governance)</option>
                    )}
                    {assignableRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1.5">
                    Account Status
                  </label>
                  <select
                    value={editingUser.status || "Active"}
                    onChange={(e) =>
                      setEditingUser({
                        ...editingUser,
                        status: e.target.value as any,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-semibold cursor-pointer"
                  >
                    <option value="Active">Active (Can Login)</option>
                    <option value="Inactive">Inactive / Suspended</option>
                  </select>
                </div>
              </div>

              {/* Password with Generator Button */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-bold text-[#334155]">
                    Account Login Password {isExisting ? <span className="text-[#64748B] font-normal">(leave blank to keep current)</span> : <span className="text-red-500">*</span>}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingUser({
                        ...editingUser,
                        password: `Hosp@${Math.floor(1000 + Math.random() * 9000)}`,
                      })
                    }
                    className="text-[11px] font-bold text-[#1B4FD8] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>🎲</span>
                    <span>Generate Strong Password</span>
                  </button>
                </div>
                <input
                  required={!isExisting}
                  type="text"
                  value={editingUser.password ?? ""}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, password: e.target.value })
                  }
                  placeholder={
                    isExisting
                      ? "•••••••• (unchanged, enter new password only if resetting)"
                      : "Enter secure initial password..."
                  }
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                />
              </div>

              {/* Doctor-Specific Professional Details (Shown if Doctor role selected) */}
              {(editingUser.roleId === "ROLE_DOCTOR" ||
                editingUser.roleId.toLowerCase().includes("doctor") ||
                editingUser.roleId.toLowerCase().includes("surgeon")) && (
                <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xs space-y-3">
                  <div className="text-[12px] font-bold text-blue-900 flex items-center gap-1.5">
                    <span>🩺</span>
                    <span>Clinical Profile & Doctor Roster Settings</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[#334155] mb-1">
                        Medical Specialty
                      </label>
                      <select
                        value={userDoctorDetails.specialty}
                        onChange={(e) =>
                          setUserDoctorDetails({
                            ...userDoctorDetails,
                            specialty: e.target.value,
                          })
                        }
                        className="w-full bg-white border border-blue-200 px-3 py-1.5 text-[12px] text-[#0F172A] font-semibold"
                      >
                        <option value="General Medicine">General Medicine</option>
                        <option value="Cardiology">Cardiology</option>
                        <option value="Orthopedics">Orthopedics</option>
                        <option value="Pediatrics">Pediatrics</option>
                        <option value="Obstetrics & Gynecology">Obstetrics & Gynecology</option>
                        <option value="Neurology">Neurology</option>
                        <option value="General Surgery">General Surgery</option>
                        <option value="Emergency Medicine">Emergency Medicine</option>
                        <option value="Pathology">Pathology</option>
                        <option value="Radiology">Radiology</option>
                        <option value="Dermatology">Dermatology</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[#334155] mb-1">
                        Qualification
                      </label>
                      <input
                        value={userDoctorDetails.qualification}
                        onChange={(e) =>
                          setUserDoctorDetails({
                            ...userDoctorDetails,
                            qualification: e.target.value,
                          })
                        }
                        placeholder="e.g. MBBS, MD, DM"
                        className="w-full bg-white border border-blue-200 px-3 py-1.5 text-[12px] text-[#0F172A]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[#334155] mb-1">
                        OPD Cabin / Room No
                      </label>
                      <input
                        value={userDoctorDetails.room}
                        onChange={(e) =>
                          setUserDoctorDetails({
                            ...userDoctorDetails,
                            room: e.target.value,
                          })
                        }
                        placeholder="e.g. Room 102"
                        className="w-full bg-white border border-blue-200 px-3 py-1.5 text-[12px] text-[#0F172A]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[#334155] mb-1">
                        Consultation Fee (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="50"
                        value={userDoctorDetails.consultationFee}
                        onChange={(e) =>
                          setUserDoctorDetails({
                            ...userDoctorDetails,
                            consultationFee: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-white border border-blue-200 px-3 py-1.5 text-[12px] text-[#0F172A]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Individual User Module Access (Custom Department Permissions) */}
              <div className="p-4 bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🛡️</span>
                    <div>
                      <div className="text-[13px] font-bold text-[#0F172A]">
                        Individual Department & Module Permissions
                      </div>
                      <div className="text-[11px] text-[#64748B]">
                        Customize specific department access for this user or inherit from role
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 border border-slate-300 rounded shadow-xs">
                    <input
                      type="checkbox"
                      checked={Array.isArray(editingUser.customModules) && editingUser.customModules.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const baseRole = roles.find((r) => r.id === editingUser.roleId)
                          const initialModules = baseRole?.allowedModules?.length
                            ? [...baseRole.allowedModules]
                            : ["dashboard"]
                          setEditingUser({ ...editingUser, customModules: initialModules })
                        } else {
                          setEditingUser({ ...editingUser, customModules: undefined })
                        }
                      }}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                    />
                    <span className="text-[12px] font-bold text-[#0F172A]">
                      Enable Custom Overrides
                    </span>
                  </label>
                </div>

                {/* If custom overrides are OFF: show role default info */}
                {(!editingUser.customModules || editingUser.customModules.length === 0) ? (
                  <div className="bg-blue-50/60 border border-blue-200 p-3 text-[12px] text-blue-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-600 font-bold">ℹ️</span>
                      <span>
                        Inheriting <strong>{roles.find((r) => r.id === editingUser.roleId)?.name || "Assigned Role"}</strong> defaults:
                        {" "}<span className="font-semibold">{roles.find((r) => r.id === editingUser.roleId)?.allowedModules.length || 0} module(s) granted</span>.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const baseRole = roles.find((r) => r.id === editingUser.roleId)
                        setEditingUser({
                          ...editingUser,
                          customModules: baseRole?.allowedModules ? [...baseRole.allowedModules] : ["dashboard"],
                        })
                      }}
                      className="text-[11.5px] font-bold text-[#1B4FD8] hover:underline cursor-pointer"
                    >
                      Customize Permissions →
                    </button>
                  </div>
                ) : (
                  /* If custom overrides are ON: show quick actions and module checkboxes */
                  <div className="space-y-3 pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-bold text-[#334155]">
                        Granted: <span className="text-[#1B4FD8] font-bold">{editingUser.customModules.length}</span> department(s)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const allKeys = ALL_ADMIN_ASSIGNABLE_MODULES.map((m) => m.key)
                            setEditingUser({ ...editingUser, customModules: allKeys })
                          }}
                          className="px-2 py-1 bg-white hover:bg-slate-100 text-[#0F172A] border border-slate-300 text-[11px] font-bold cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const baseRole = roles.find((r) => r.id === editingUser.roleId)
                            setEditingUser({
                              ...editingUser,
                              customModules: baseRole?.allowedModules ? [...baseRole.allowedModules] : ["dashboard"],
                            })
                          }}
                          className="px-2 py-1 bg-white hover:bg-slate-100 text-[#1B4FD8] border border-slate-300 text-[11px] font-bold cursor-pointer"
                        >
                          Role Defaults
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUser({ ...editingUser, customModules: [] })
                          }}
                          className="px-2 py-1 bg-white hover:bg-slate-100 text-red-600 border border-slate-300 text-[11px] font-bold cursor-pointer"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    {/* Categorized module checkboxes */}
                    <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-2 bg-white border border-slate-200">
                      {ALL_ADMIN_ASSIGNABLE_MODULES.map((mod) => {
                        const isChecked = editingUser.customModules?.includes(mod.key)
                        return (
                          <label
                            key={mod.key}
                            className={`flex items-center gap-2 p-1.5 border rounded cursor-pointer transition-colors ${
                              isChecked
                                ? "bg-blue-50/70 border-blue-300 text-blue-950 font-semibold"
                                : "hover:bg-slate-50 border-slate-200 text-slate-700"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(isChecked)}
                              onChange={(e) => {
                                const current = editingUser.customModules || []
                                if (e.target.checked) {
                                  setEditingUser({
                                    ...editingUser,
                                    customModules: [...current, mod.key],
                                  })
                                } else {
                                  setEditingUser({
                                    ...editingUser,
                                    customModules: current.filter((k) => k !== mod.key),
                                  })
                                }
                              }}
                              className="w-3.5 h-3.5 text-blue-600 rounded cursor-pointer"
                            />
                            <span className="text-[14px]">{mod.icon}</span>
                            <span className="text-[12px] truncate">{mod.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserModal(false)
                    setEditingUser(null)
                  }}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-5 py-2 border border-blue-600 shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  <span>💾</span>
                  <span>Save User Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
        )
      })()}

      {/* 6. Reset Password Modal */}
      {resetPassUser && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A] flex items-center gap-2">
                <span>🔑</span>
                <span>Reset Staff Password</span>
              </h3>
              <button
                onClick={() => setResetPassUser(null)}
                className="text-[#64748B] hover:text-black font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <div className="text-[12.5px] text-[#334155]">
                Resetting password for staff member{" "}
                <strong className="text-[#0F172A]">{resetPassUser.name}</strong>{" "}
                (@{resetPassUser.username}).
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-bold text-[#334155]">
                    New Password
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setNewPassInput(`Hosp@${Math.floor(1000 + Math.random() * 9000)}`)
                    }
                    className="text-[11px] font-bold text-[#1B4FD8] hover:underline cursor-pointer"
                  >
                    🎲 Generate Password
                  </button>
                </div>
                <input
                  required
                  type="text"
                  value={newPassInput}
                  onChange={(e) => setNewPassInput(e.target.value)}
                  placeholder="Enter new password..."
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8] font-mono"
                />
              </div>

              {newPassInput && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(newPassInput)
                    setUserNotice("Password copied to clipboard!")
                  }}
                  className="w-full text-center text-[11.5px] text-blue-700 bg-blue-50 border border-blue-200 py-1 font-semibold rounded-xs cursor-pointer hover:bg-blue-100"
                >
                  📋 Copy Password to Clipboard
                </button>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setResetPassUser(null)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold px-4 py-2 border border-amber-600 shadow-sm cursor-pointer"
                >
                  Confirm Password Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Audit Detail Modal */}
      {selectedAuditLog && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A]">
                Security Event Log Inspector
              </h3>
              <button
                onClick={() => setSelectedAuditLog(null)}
                className="text-[#64748B] hover:text-black"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 text-[13px]">
              <div className="grid grid-cols-2 gap-4 bg-[#F8FAFC] p-4 border border-[#E2E8F0]">
                <div>
                  <div className="text-[11px] text-[#64748B] uppercase font-mono">
                    Event ID
                  </div>
                  <div className="font-mono text-[#0F172A] text-[12px]">
                    {selectedAuditLog.id}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#64748B] uppercase font-mono">
                    Timestamp
                  </div>
                  <div className="font-mono text-[#0F172A] text-[12px]">
                    {new Date(selectedAuditLog.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[#64748B] uppercase font-mono">
                    Executing User
                  </div>
                  <div className="font-bold text-[#0F172A]">
                    {selectedAuditLog.username}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#64748B] uppercase font-mono">
                    Event Action
                  </div>
                  <div className="font-semibold text-[#1B4FD8]">
                    {selectedAuditLog.action}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-[#64748B] uppercase font-mono mb-1">
                  Target Module
                </div>
                <div className="text-[#0F172A] font-mono">
                  {selectedAuditLog.module}
                </div>
              </div>

              {(selectedAuditLog.device || selectedAuditLog.action.toLowerCase().includes("login") || selectedAuditLog.module === "Authentication") && (
                <div className="grid grid-cols-2 gap-4 bg-[#F8FAFC] p-3.5 border border-[#E2E8F0]">
                  <div>
                    <div className="text-[11px] text-[#64748B] uppercase font-mono mb-0.5">Device</div>
                    <div className="font-bold text-[#0F172A]">{selectedAuditLog.device || detectDevice()}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#64748B] uppercase font-mono mb-0.5">Session Duration</div>
                    <div className="font-mono text-[#1B4FD8] font-bold text-[12px]">{selectedAuditLog.duration || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#64748B] uppercase font-mono mb-0.5">Login Time</div>
                    <div className="font-mono text-[#0F172A] text-[12px]">{selectedAuditLog.loginTime || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#64748B] uppercase font-mono mb-0.5">Logout Time</div>
                    <div className="font-mono text-[#0F172A] text-[12px]">
                      {selectedAuditLog.logoutTime === "Active" ? (
                        <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200 font-bold rounded">
                          Active
                        </span>
                      ) : selectedAuditLog.logoutTime === "Session Expired" ? (
                        <span className="text-amber-800 bg-amber-50 px-1.5 py-0.5 border border-amber-200 font-semibold rounded">
                          Session Expired
                        </span>
                      ) : (
                        selectedAuditLog.logoutTime || "—"
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] text-[#64748B] uppercase font-mono mb-1">
                  Event Description
                </div>
                <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] text-[#334155] font-mono text-[12px]">
                  {selectedAuditLog.description}
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-[#E2E8F0]">
                <button
                  onClick={() => setSelectedAuditLog(null)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. Add New Diagnostic Tariff Modal */}
      {showAddTariffModal && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DDE2EC] shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#DDE2EC] flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">
                  Add Investigation to Diagnostic Price Master
                </h3>
                <p className="text-[12px] text-[#64748B]">
                  Configure catalogue test code, modality, anatomy, variant protocol & tariff.
                </p>
              </div>
              <button
                onClick={() => setShowAddTariffModal(false)}
                className="text-[#64748B] hover:text-black cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTariff} className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Department / Modality */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Department / Modality <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={newTariffForm.department}
                    onChange={(e) => {
                      const dept = e.target.value as DiagnosticDepartment
                      let defRegion = "General"
                      let defInCharge = ""
                      let defVariant = "Standard"

                      if (dept === "Laboratory") {
                        defRegion = "Haematology"
                        defVariant = "Standard Lab Profile"
                      } else if (dept === "X-Ray") {
                        defRegion = "Chest"
                        defVariant = "PA View"
                      } else if (dept === "CT Scan") {
                        defRegion = "Brain"
                        defVariant = "Plain"
                      } else if (dept === "MRI") {
                        defRegion = "Brain"
                        defVariant = "Plain Multiplanar"
                      } else if (dept === "Ultrasound (USG)" || dept === "Doppler") {
                        defRegion = dept === "Doppler" ? "Cardiovascular" : "Abdomen & Pelvis"
                        defVariant = dept === "Doppler" ? "Color Duplex" : "Transabdominal"
                      } else {
                        defRegion = dept === "Dental" ? "Dental / Maxillofacial" : dept === "Mammography" ? "Breast" : "Special Procedures"
                        defVariant = "Diagnostic Protocol"
                      }

                      setNewTariffForm({
                        ...newTariffForm,
                        department: dept,
                        modality: dept === "Laboratory" ? "Laboratory" : dept,
                        bodyRegion: defRegion,
                        subCategory: defRegion,
                        responsibleInCharge: defInCharge,
                        variantProtocol: defVariant,
                        reportTemplate: `Approved ${dept} Template`,
                      })
                    }}
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                  >
                    <option value="Laboratory">Laboratory</option>
                    {RADIOLOGY_MODALITIES.map((mod) => (
                      <option key={mod} value={mod}>
                        Radiology: {mod}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Test Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. CT-BRAIN-PLAIN or XR-CHEST-PA"
                    value={newTariffForm.code}
                    onChange={(e) =>
                      setNewTariffForm({ ...newTariffForm, code: e.target.value.toUpperCase() })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] font-mono font-bold focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              {/* Examination Name */}
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1">
                  Examination / Investigation Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. CT Scan Brain Plain"
                  value={newTariffForm.name}
                  onChange={(e) => {
                    const name = e.target.value
                    setNewTariffForm({
                      ...newTariffForm,
                      name,
                      reportTemplate: `Approved ${name || "Examination"} Template`,
                    })
                  }}
                  className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] font-bold focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              {/* Body Region & Variant Protocol */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Body Region
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Brain, Chest, Spine, Abdomen"
                    value={newTariffForm.bodyRegion}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        bodyRegion: e.target.value,
                        subCategory: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Variant / Protocol
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Plain, Contrast, PA View"
                    value={newTariffForm.variantProtocol}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        variantProtocol: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              {/* Hospital Availability & Tariff Reference */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Hospital Availability
                  </label>
                  <select
                    value={newTariffForm.hospitalAvailability}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        hospitalAvailability: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] font-semibold focus:outline-none focus:border-[#1B4FD8] cursor-pointer"
                  >
                    <option value="Enabled">Enabled (In-House)</option>
                    <option value="Unavailable">Unavailable</option>
                    <option value="Referred Externally">Referred Externally</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Tariff Reference
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Existing Billing tariff"
                    value={newTariffForm.tariffReference}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        tariffReference: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              {/* Responsible In-Charge & Report Template */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Responsible In-Charge
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Dr. Sunita Rao (Senior Radiologist)"
                    value={newTariffForm.responsibleInCharge}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        responsibleInCharge: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Report Template
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Approved CT Brain Template"
                    value={newTariffForm.reportTemplate}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        reportTemplate: e.target.value,
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              {/* Price & Turnaround Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Price (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    placeholder="e.g. 2800"
                    value={newTariffForm.price}
                    onChange={(e) =>
                      setNewTariffForm({
                        ...newTariffForm,
                        price: e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] font-mono font-bold focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Turnaround Time (TAT)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2 Hours, 4 Hours"
                    value={newTariffForm.tat}
                    onChange={(e) =>
                      setNewTariffForm({ ...newTariffForm, tat: e.target.value })
                    }
                    className="w-full bg-white border border-[#DDE2EC] px-3 py-2 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddTariffModal(false)}
                  className="bg-white hover:bg-gray-50 text-[#334155] text-[13px] font-semibold px-4 py-2 border border-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-semibold px-5 py-2 border border-blue-600 shadow-2xs cursor-pointer"
                >
                  Save Catalogue Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
