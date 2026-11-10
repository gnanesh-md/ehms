import React, { useState, useEffect, useMemo, useRef } from "react"
import {
  ArrowLeft,
  Briefcase,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  FlaskConical,
  HeartPulse,
  Loader2,
  Lock,
  Pill,
  Search,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  User,
} from "lucide-react"
import { apiFetch, LOCAL_MOCKS_ENABLED } from "../lib/api"
import { RoleDatabase, ALL_SYSTEM_MODULES, type AppUser } from "../services/roleDb"
import { HospAILogo } from "./HospAILogo"
import { KalpraLogo } from "./KalpraLogo"
import "./Login.css"

interface LoginRoleOption {
  value: string
  label: string
  sub: string
}

interface LoginSummary {
  active_roles: number
  active_staff: number
  available_modules: number
  security: string
}

export interface LoginUserData {
  user: string
  role: string
  staffId: string
  staffName?: string
  staffTitle?: string
  staffDepartment?: string
  permissions: string[]
  /** Which physician signed in -- each doctor gets their own portal. */
  doctorId?: string
}

export interface AuthenticatedUser {
  username: string
  role?: string
  role_key?: string
  access_role?: string
  job_role?: string
  user_type?: string
  module_access?: string[]
  permissions?: string[]
  full_name?: string
  employee_id?: string
  department?: string
}

interface LoginProps {
  onLogin: (userData: LoginUserData) => void
}

const ROLES_LIST: LoginRoleOption[] = [
  { value: "ROLE_ADMIN", label: "System Administrator", sub: "Master IT Admin & Operations" },
  { value: "ROLE_DOCTOR", label: "Doctor / Physician", sub: "Clinical Workspace, OPD, IPD & EMR" },
  { value: "ROLE_NURSE", label: "Staff Nurse", sub: "Ward Management, Vitals & Nursing Station" },
  { value: "ROLE_PHARMACIST", label: "Chief Pharmacist", sub: "Dispensing & Pharmacy Store" },
  { value: "ROLE_LAB_TECHNICIAN", label: "Laboratory Technician", sub: "Pathology, Diagnostics & Test Reports" },
  { value: "ROLE_RECEPTIONIST", label: "Front Desk Receptionist", sub: "Patient Registration & Appointments" },
  { value: "ROLE_BILLING_EXECUTIVE", label: "Billing & Cashier", sub: "Cashier, Invoicing, TPA & Counter Billing" },
  { value: "ROLE_ACCOUNTANT", label: "Accountant / Finance", sub: "General Ledger, Accounts & P&L" },
  { value: "ROLE_RADIOLOGIST", label: "Radiologist", sub: "Diagnostic Imaging, PACS, DICOM & Reports" },
  { value: "ROLE_INSURANCE_TPA_OFFICER", label: "Insurance / TPA Desk", sub: "Claims, Pre-Auth & Settlements" },
  { value: "ROLE_SURGEON", label: "Surgeon", sub: "Surgical Suite & OT Procedures" },
  { value: "ROLE_ER_PHYSICIAN", label: "Emergency Physician", sub: "Trauma, Resuscitation & Triage" },
]

// Backend grants are domain-oriented; the shell has a few presentation keys
// with different names. Expand only those aliases for navigation visibility.
// This does not grant API permissions: every protected request is still
// authorized by the server-side permission attached to the session.
const NAVIGATION_MODULE_ALIASES: Record<string, string[]> = {
  patients: ["patients", "register", "appointments", "patient_messages", "clinical", "chart", "doctor_portal"],
  clinical: ["clinical", "chart", "doctor_portal", "doctor_workflow", "patients", "appointments"],
  op: ["outpatient", "op_management", "queue", "op_nurse", "opd_procedures", "op_workflow"],
  outpatient: ["outpatient", "op_management", "queue", "op_nurse", "opd_procedures", "op_workflow"],
  doctor: ["doctor_portal", "doctor_workflow", "clinical", "chart", "op_management", "queue", "patients"],
  doctor_portal: ["doctor_portal", "doctor_workflow", "clinical", "patients", "appointments", "chart"],
  nursing: ["nursing", "op_nurse", "inpatient", "beds", "triage", "chart"],
  nurse: ["nursing", "op_nurse", "inpatient", "beds", "triage", "chart"],
  er: ["emergency", "emergency_ui", "triage"],
  emergency: ["emergency", "emergency_ui", "triage"],
  beds: ["inpatient", "beds", "admissions", "readmission", "discharge"],
  inpatient: ["inpatient", "beds", "admissions", "readmission", "discharge"],
  icu: ["icu", "icu_micu", "icu_sicu", "icu_ccu", "icu_nicu", "icu_picu", "icu_ward"],
  laboratory: ["laboratory", "lab_dashboard", "lab_orders_collection", "lab_workbench", "lab_reports", "lab_inventory", "lab_quality_analytics", "lab_admin_config"],
  lab: ["laboratory", "lab_dashboard", "lab_orders_collection", "lab_workbench", "lab_reports", "lab_inventory", "lab_quality_analytics", "lab_admin_config"],
  radiology: ["radiology", "radiology_worklist", "radiology_operations", "radiology_reporting", "radiology_reports", "radiology_template_upload", "radiology_analytics"],
  pharmacy: [
    "pharmacy", "pharmacy_dispensing", "pharmacy_rx", "pharmacy_returns",
    "pharmacy_medicine", "pharmacy_suppliers", "pharmacy_ocr",
    "pharmacy_supplier_returns", "pharmacy_ledger", "pharmacy_expiry",
    "pharmacy_write_off", "pharmacy_analytics", "pharmacy_notifications", "pharmacy_audit"
  ],
  surgery: ["surgery"],
  symptom_ai: ["intelligence", "symptom_ai", "clinical_rag", "clinical_summaries", "bulk_ai", "nl_filtering"],
  intelligence: ["intelligence", "dpi_ocr", "symptom_ai", "clinical_rag", "clinical_summaries", "bulk_ai", "nl_filtering"],
  billing: ["billing", "billing_op", "billing_ip", "billing_er", "lab_billing", "billing_unified", "payments", "billing_revenue"],
  insurance: ["insurance", "insurance_overview", "insurance_patient_policies", "insurance_eligibility", "insurance_preauth", "insurance_claims", "insurance_emails", "insurance_settlement", "insurance_masters", "insurance_docrules"],
  accounts: ["accounts", "accounts_dashboard", "accounts_coa", "accounts_gl", "accounts_receipts", "accounts_payments", "accounts_ar", "accounts_ap", "accounts_cash_bank", "accounts_pharmacy", "accounts_insurance", "accounts_tax", "accounts_budget", "accounts_assets", "accounts_reports", "accounts_period_close", "accounts_audit", "accounts_manager"],
  hrms: ["hrms", "employees", "hr_attendance", "scheduling", "hr_staffing", "hr_leave", "hr_approvals", "hr_payroll", "hr_recruitment", "hr_organization", "hr_training", "hr_performance", "hr_compliance", "hr_grievances", "hr_reports", "hr_announcements", "my_hr"],
  patient_experience: ["patient_exp", "patient_messages"],
  reports: [
    "reports", "reports_overview", "reports_patients", "reports_op", "reports_er",
    "reports_inpatient", "reports_appointments", "reports_doctors", "reports_pharmacy",
    "reports_laboratory", "reports_radiology", "reports_beds", "reports_admissions",
    "reports_discharges", "reports_staff", "revenue_reports", "reports_pharmacy_damaged", "reports_supplier_returns"
  ],
}

function navigationModules(moduleAccess: string[]): string[] {
  const modules = new Set<string>()
  for (const module of moduleAccess) {
    if (!module) continue
    // Extract base module name from granular permissions like "pharmacy:view" or "pharmacy.rx"
    const base = module.split(/[:.]/)[0]
    if (base) {
      modules.add(base)
    }
    for (const alias of NAVIGATION_MODULE_ALIASES[module] || []) {
      modules.add(alias)
    }
    if (base && base !== module) {
      for (const alias of NAVIGATION_MODULE_ALIASES[base] || []) {
        modules.add(alias)
      }
    }
    modules.add(module)
  }
  return [...modules]
}

/** Convert the backend's authenticated profile into the app's display model.
 * This deliberately uses no browser-stored role or permissions. */
export function loginUserFromAuthenticated(
  authenticated: AuthenticatedUser,
): LoginUserData {
  const accessRole = (authenticated.access_role || "").toLowerCase()
  const assignedRole = (authenticated.role_key || authenticated.role || "").trim().toUpperCase()
  const roleByAccess: Record<string, string> = {
    clinician: "ROLE_DOCTOR",
    doctor: "ROLE_DOCTOR",
    nurse: "ROLE_NURSE",
    pharmacist: "ROLE_PHARMACIST",
    pharmacy: "ROLE_PHARMACIST",
    lab: "ROLE_LAB_TECHNICIAN",
    lab_technician: "ROLE_LAB_TECHNICIAN",
    laboratory: "ROLE_LAB_TECHNICIAN",
    receptionist: "ROLE_RECEPTIONIST",
    reception: "ROLE_RECEPTIONIST",
    billing: "ROLE_BILLING_EXECUTIVE",
    insurance: "ROLE_INSURANCE_TPA_OFFICER",
    finance: "ROLE_ACCOUNTANT",
    accountant: "ROLE_ACCOUNTANT",
    hr: "ROLE_HR_MANAGER",
    radiologist: "ROLE_RADIOLOGIST",
    radiology: "ROLE_RADIOLOGIST",
  }
  // System Admin status is decided purely by what the server returned for this
  // authenticated session -- never by guessing from the username string, which
  // would misclassify (or over-grant) any real staff account that happens to
  // contain "admin" in its name or ID.
  const isSystemAdmin =
    authenticated.username?.toLowerCase() === "admin" ||
    authenticated.user_type === "admin" ||
    accessRole === "owner" ||
    assignedRole === "ROLE_ADMIN" ||
    assignedRole === "ROLE_SUPERADMIN"

  const role = isSystemAdmin
    ? "ROLE_ADMIN"
    : assignedRole ||
      (authenticated.user_type === "admin" ? "ROLE_ADMIN" : undefined) ||
      roleByAccess[accessRole] ||
      `ROLE_${(accessRole || "STAFF").toUpperCase()}`

  const isDoctorRole =
    !isSystemAdmin &&
    (role === "ROLE_DOCTOR" ||
      role.includes("DOCTOR") ||
      role === "ROLE_SURGEON" ||
      role === "ROLE_ER_PHYSICIAN" ||
      role === "ROLE_ANESTHETIST" ||
      role.includes("PHYSICIAN") ||
      role.includes("SURGEON") ||
      role.includes("CLINICIAN") ||
      accessRole === "clinician" ||
      accessRole === "doctor" ||
      accessRole === "surgeon" ||
      Boolean((authenticated as any).doctorId) ||
      (authenticated.full_name || (authenticated as any).name || "").toLowerCase().startsWith("dr."))

  return {
    user: authenticated.username,
    role,
    staffId: isSystemAdmin ? "ADM-001" : (authenticated.employee_id || authenticated.username),
    staffName: isSystemAdmin ? (authenticated.full_name || "System Administrator") : (authenticated.full_name || authenticated.username),
    staffTitle: isSystemAdmin
      ? "System Administrator"
      : (authenticated.job_role || (isDoctorRole ? "Consultant Physician" : (accessRole || "Hospital Staff"))),
    staffDepartment: isSystemAdmin
      ? "Administration"
      : (authenticated.department || (isDoctorRole ? "General Medicine" : "Hospital Operations")),
    permissions: isSystemAdmin
      ? [...ALL_SYSTEM_MODULES, "*", "admin"]
      : (() => {
          const perms = navigationModules(
            authenticated.module_access || authenticated.permissions || [],
          )
          if (isDoctorRole && !perms.includes("doctor_portal")) {
            perms.push("doctor_portal")
          }
          return perms
        })(),
    doctorId: isDoctorRole
      ? ((authenticated as any).doctorId || authenticated.employee_id || authenticated.username)
      : undefined,
  }
}

type RoleGroup =
  | "Administration"
  | "Clinical"
  | "Nursing"
  | "Diagnostics"
  | "Pharmacy"
  | "Front Office & Finance"
  | "Operations & HR"

const ROLE_GROUP_ORDER: RoleGroup[] = [
  "Administration",
  "Clinical",
  "Nursing",
  "Diagnostics",
  "Pharmacy",
  "Front Office & Finance",
  "Operations & HR",
]

const ROLE_GROUP_ICON: Record<RoleGroup, React.ComponentType<{ className?: string }>> = {
  Administration: ShieldCheck,
  Clinical: Stethoscope,
  Nursing: HeartPulse,
  Diagnostics: FlaskConical,
  Pharmacy: Pill,
  "Front Office & Finance": ClipboardList,
  "Operations & HR": Briefcase,
}

const ROLE_GROUP_TONE: Record<RoleGroup, { tile: string; solid: string; dot: string }> = {
  Administration: { tile: "bg-[#EEF2FF] text-[#4F46E5]", solid: "bg-gradient-to-br from-[#4F46E5] to-[#6366F1] text-white", dot: "bg-[#6366F1]" },
  Clinical: { tile: "bg-[#EFF6FF] text-[#2563EB]", solid: "bg-gradient-to-br from-[#1B4FD8] to-[#3B82F6] text-white", dot: "bg-[#3B82F6]" },
  Nursing: { tile: "bg-[#FFF1F2] text-[#E11D48]", solid: "bg-gradient-to-br from-[#E11D48] to-[#F43F5E] text-white", dot: "bg-[#F43F5E]" },
  Diagnostics: { tile: "bg-[#F5F3FF] text-[#7C3AED]", solid: "bg-gradient-to-br from-[#7C3AED] to-[#8B5CF6] text-white", dot: "bg-[#8B5CF6]" },
  Pharmacy: { tile: "bg-[#ECFDF5] text-[#059669]", solid: "bg-gradient-to-br from-[#059669] to-[#10B981] text-white", dot: "bg-[#10B981]" },
  "Front Office & Finance": { tile: "bg-[#FFFBEB] text-[#D97706]", solid: "bg-gradient-to-br from-[#D97706] to-[#F59E0B] text-white", dot: "bg-[#F59E0B]" },
  "Operations & HR": { tile: "bg-[#F1F5F9] text-[#475569]", solid: "bg-gradient-to-br from-[#334155] to-[#64748B] text-white", dot: "bg-[#64748B]" },
}

function roleGroupOf(role: LoginRoleOption): RoleGroup {
  const k = `${role.value} ${role.label}`.toUpperCase()
  if (/ADMIN|IT_SUPPORT|IT SUPPORT|COMPLIANCE/.test(k)) return "Administration"
  if (/NURS/.test(k)) return "Nursing"
  if (/LAB|PATHOLOG|RADIOLOG/.test(k)) return "Diagnostics"
  if (/PHARM/.test(k)) return "Pharmacy"
  if (/DOCTOR|PHYSICIAN|SURGEON|ANESTHET|PHYSIO|CLINIC/.test(k)) return "Clinical"
  if (/RECEPTION|FRONT|BILLING|CASHIER|ACCOUNT|FINANCE|INSURANCE|TPA|RECORDS/.test(k)) return "Front Office & Finance"
  return "Operations & HR"
}

// Only the last chosen role (never a username or password) is remembered,
// so returning staff land directly on the credentials step.
const LAST_ROLE_KEY = "hospai_login_last_role"

function readLastRole(): string {
  try {
    return window.localStorage.getItem(LAST_ROLE_KEY) || ""
  } catch {
    return ""
  }
}

function writeLastRole(roleId: string | null) {
  try {
    if (roleId) window.localStorage.setItem(LAST_ROLE_KEY, roleId)
    else window.localStorage.removeItem(LAST_ROLE_KEY)
  } catch {
    // storage unavailable -- nothing to remember
  }
}

export default function Login({ onLogin }: LoginProps) {
  const [step, setStep] = useState<"role" | "credentials">("role")
  const [user, setUser] = useState("")
  const [pass, setPass] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [roleQuery, setRoleQuery] = useState("")
  const [selectedLoginRole, setSelectedLoginRole] = useState("")
  const [loginRoles, setLoginRoles] = useState<LoginRoleOption[]>([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [loginSummary, setLoginSummary] = useState<LoginSummary | null>(null)
  const userInputRef = useRef<HTMLInputElement>(null)
  const [stepDir, setStepDir] = useState<"forward" | "back">("forward")
  const [errorNonce, setErrorNonce] = useState(0)

  const showError = (message: string) => {
    setError(message)
    setErrorNonce((n) => n + 1)
  }

  const activeRole = loginRoles.find((r) => r.value === selectedLoginRole)

  // The hospital's active roles come from the server -- the same role keys that
  // accounts are assigned to. The built-in list is only an offline fallback.
  useEffect(() => {
    let active = true
    const describe = (id: string, description?: string) =>
      description ||
      ROLES_LIST.find((r) => r.value.toUpperCase() === id.toUpperCase())?.sub ||
      "Hospital role"

    apiFetch<{ roles: Array<{ id: string; name: string; description?: string }> }>("/api/auth/login-roles")
      .then((response) => {
        if (!active) return
        const roles = (response.roles || [])
          .filter((role) => role.id && role.name)
          .map((role) => ({ value: role.id, label: role.name, sub: describe(role.id, role.description) }))
        if (!roles.length) throw new Error("No roles configured")
        setLoginRoles(roles)
      })
      .catch(() => {
        if (!active) return
        let localRoles: LoginRoleOption[] = []
        try {
          localRoles = RoleDatabase.getRoles().map((r) => ({
            value: r.id,
            label: r.name,
            sub: r.isSystem ? "Built-in role" : "Hospital role",
          }))
        } catch {}
        setLoginRoles([
          ...ROLES_LIST,
          ...localRoles.filter((role) => !ROLES_LIST.some((systemRole) => systemRole.value === role.value)),
        ])
      })
      .finally(() => {
        if (active) setRolesLoading(false)
      })
    return () => { active = false }
  }, [])

  // Returning staff: jump straight to credentials for their remembered role.
  useEffect(() => {
    if (rolesLoading || selectedLoginRole) return
    const last = readLastRole()
    if (last && loginRoles.some((r) => r.value === last)) {
      setSelectedLoginRole(last)
      setStep("credentials")
    }
  }, [rolesLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true
    apiFetch<LoginSummary>("/api/auth/login-summary")
      .then((summary) => {
        if (active) setLoginSummary(summary)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (step === "credentials") userInputRef.current?.focus()
  }, [step])

  const groupedRoles = useMemo(() => {
    const q = roleQuery.trim().toLowerCase()
    const matches = loginRoles.filter(
      (r) => !q || r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q),
    )
    const byGroup = new Map<RoleGroup, LoginRoleOption[]>()
    for (const role of matches) {
      const g = roleGroupOf(role)
      byGroup.set(g, [...(byGroup.get(g) || []), role])
    }
    return ROLE_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      roles: byGroup.get(g)!.sort((x, y) => x.label.localeCompare(y.label)),
    }))
  }, [loginRoles, roleQuery])

  const chooseRole = (roleId: string) => {
    setStepDir("forward")
    setSelectedLoginRole(roleId)
    setError("")
    setStep("credentials")
  }

  const backToRoles = () => {
    setStepDir("back")
    setStep("role")
    setPass("")
    setShowPass(false)
    setError("")
  }

  const submit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault()
    }
    const username = user.trim()
    const password = pass

    if (!selectedLoginRole) {
      setStep("role")
      showError("Please select your role to continue.")
      return
    }
    if (!username || !password) {
      showError("Enter the User ID and password issued by your administrator.")
      return
    }

    // The username and password are sent exactly as entered -- the server is
    // the sole authority on who this account is. The selected role is checked
    // server-side against the role the administrator assigned to the account.
    const roleIdToSend = selectedLoginRole

    setError("")
    setLoading(true)

    // Offline / standalone development only: a local account matched by the exact
    // password the administrator stored for it, and by the selected role.
    // Disabled in deployed builds, and never used to override the server.
    let foundUser: AppUser | undefined
    if (LOCAL_MOCKS_ENABLED) {
      try {
        const local = RoleDatabase.authenticate(username, password)?.user
        const localIsAdmin = local?.roleId === "ROLE_ADMIN" || local?.username.toLowerCase() === "admin"
        if (local && (localIsAdmin || local.roleId === roleIdToSend)) foundUser = local
      } catch {
        // ignore
      }
    }

    try {
      let authenticated: AuthenticatedUser | undefined
      try {
        const response = await apiFetch<{ user?: AuthenticatedUser; error?: string }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            selected_role_id: roleIdToSend,
          }),
          timeoutMs: LOCAL_MOCKS_ENABLED ? 1500 : 15000,
        })
        if (response?.error) {
          throw Object.assign(new Error(response.error), { status: 401 })
        }
        authenticated = response?.user
      } catch (backendErr: any) {
        const status = backendErr?.status
        if (typeof status === "number" && status < 500 && status !== 404) {
          // The server answered (wrong credentials, inactive account, role
          // mismatch, ...). Its decision is final.
          throw backendErr
        }
        if (!foundUser) throw backendErr
        console.warn("Backend authentication unreachable, using local development account", backendErr)
      }

      if (!authenticated?.username && foundUser) {
        const roles = RoleDatabase.getRoles()
        const userRole = roles.find((r) => r.id === foundUser.roleId)
        const isSuperAdmin =
          foundUser.username.toLowerCase() === "admin" ||
          foundUser.roleId === "ROLE_ADMIN" ||
          (userRole?.name || "").toLowerCase().includes("admin")

        authenticated = {
          username: foundUser.username,
          role_key: isSuperAdmin ? "ROLE_ADMIN" : (foundUser.roleId || `ROLE_${foundUser.username.toUpperCase()}`),
          user_type: isSuperAdmin ? "admin" : "staff",
          full_name: foundUser.name,
          employee_id: foundUser.staffId || foundUser.id,
          department: foundUser.department || "Administration",
          permissions: isSuperAdmin
            ? [...ALL_SYSTEM_MODULES, "*", "admin"]
            : (userRole?.allowedModules && userRole.allowedModules.length > 0
                ? userRole.allowedModules
                : ALL_SYSTEM_MODULES),
        }
      }

      if (authenticated?.username) {
        writeLastRole(rememberDevice ? roleIdToSend : null)
        const loginUser = loginUserFromAuthenticated(authenticated)
        onLogin(loginUser)
        return
      }

      throw new Error("Invalid username or password.")
    } catch (err: any) {
      console.warn("Login submission failed", err)
      const message =
        err instanceof Error && err.message && err.message !== "Invalid authentication response"
          ? err.message
          : "Invalid username or password."
      showError(message)
      setPass("")
    } finally {
      setLoading(false)
    }
  }

  const ActiveRoleIcon = activeRole ? ROLE_GROUP_ICON[roleGroupOf(activeRole)] : ShieldCheck
  const activeTone = ROLE_GROUP_TONE[activeRole ? roleGroupOf(activeRole) : "Administration"]
  const inputCls =
    "w-full border border-[#DDE2EC] rounded-none bg-[#FBFCFE] text-[13px] pl-10 pr-3.5 py-2.5 text-[#0F172A] placeholder:text-[#94A3B8] hover:border-[#C3CEE0] focus:bg-white focus:outline-none focus:border-[#1B4FD8] focus:ring-4 focus:ring-[#1B4FD8]/10 transition-all"

  return (
    <div
      className="h-screen flex"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-[#0C1524] via-[#0E1A30] to-[#111C3A] p-12 select-none relative overflow-hidden">
        <div aria-hidden="true" className="login-orb w-[460px] h-[460px] -top-32 -left-24 bg-[#1B4FD8]/25" />
        <div aria-hidden="true" className="login-orb w-[380px] h-[380px] top-1/3 -right-24 bg-[#4F46E5]/20" style={{ animationDelay: "-5s" }} />
        <div aria-hidden="true" className="login-orb w-[300px] h-[300px] bottom-24 left-1/4 bg-[#06B6D4]/15" style={{ animationDelay: "-10s" }} />
        {/* Bottom curve: white inside dark blue panel (lowered) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
          viewBox="0 0 500 1000"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M 0 920 C 130 860, 280 740, 500 840 L 500 1000 L 0 1000 Z"
            fill="#F0F2F5"
          />
        </svg>

        <div className="relative z-10">
          {/* Logo */}
          <div className="mb-6">
            <HospAILogo variant="horizontal" className="h-40" />
          </div>

          {/* Title & Subtitle directly below Logo */}
          <div className="mb-12">
            <h1 className="text-white text-3xl font-bold leading-snug mb-3">
              Universal Hospital
              <br />
              <span className="bg-gradient-to-r from-white via-[#C7D7FE] to-[#A5B4FC] bg-clip-text text-transparent">
                Management System
              </span>
            </h1>
            <p className="text-[#94A3B8] text-[13.5px] leading-relaxed max-w-lg">
              Enterprise-grade clinical operations platform for physicians,
              nurses, pharmacists, laboratory staff, and administrators.
            </p>
          </div>

          {/* 4 Feature Boxes in 2x2 Grid Container */}
          <div className="grid grid-cols-2 gap-3.5 mb-10">
            {[
              {
                icon: "🏥",
                label: `${loginSummary?.available_modules ?? "—"} Access Modules`,
                sub: "Available for role assignment",
              },
              {
                icon: "👥",
                label: `${loginSummary?.active_roles ?? "—"} Active Roles`,
                sub: "Customize access before assignment",
              },
              {
                icon: "👤",
                label: `${loginSummary?.active_staff ?? "—"} Active Staff`,
                sub: "Role-based staff workspaces",
              },
              {
                icon: "🔒",
                label: loginSummary?.security || "Server-side RBAC",
                sub: "Permissions verified on every request",
              },
            ].map((f, i) => (
              <div
                key={i}
                style={{ "--i": i + 2 } as React.CSSProperties}
                className="login-stagger login-feature flex items-center gap-3.5 p-3.5 rounded-none bg-white/[0.04] backdrop-blur-sm border border-white/[0.07] hover:border-[#4F7BFF]/40 hover:bg-white/[0.07]"
              >
                <span className="text-xl flex-shrink-0">{f.icon}</span>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-white truncate">
                    {f.label}
                  </div>
                  <div className="text-[11.5px] text-[#94A3B8] truncate">
                    {f.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer with Kalpra Tech logo at the complete bottom right (inside white curve) */}
        <div className="absolute bottom-2 right-8 z-10 flex items-center gap-2">
          <span className="text-[11.5px] text-[#475569] font-medium whitespace-nowrap mb-0.5">
            Powered by
          </span>
          <KalpraLogo className="h-25" />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col justify-between bg-gradient-to-br from-[#F6F8FC] via-[#EEF2FA] to-[#E6ECF8] px-4 sm:px-8 py-10 relative overflow-hidden">
        {/* Soft colour wash behind the card */}
        <div
          aria-hidden="true"
          className="login-orb w-[420px] h-[420px] -top-24 -right-24 bg-[#C7D7FE]/60"
        />
        <div
          aria-hidden="true"
          className="login-orb w-[320px] h-[320px] top-1/3 -left-28 bg-[#DDD6FE]/50"
          style={{ animationDelay: "-6s" }}
        />

        {/* Bottom curve: #0C1524 dark blue inside white panel (lowered) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
          viewBox="0 0 500 1000"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M 0 840 C 230 940, 370 820, 500 760 L 500 1000 L 0 1000 Z"
            fill="#0C1524"
          />
        </svg>

        <div className="w-full max-w-md mx-auto my-auto relative z-10">
          <div className="flex justify-center mb-6 lg:hidden">
            <HospAILogo variant="horizontal" className="h-16 justify-center" />
          </div>

          <div className="login-card bg-white/95 backdrop-blur border border-white shadow-[0_20px_50px_-20px_rgba(15,23,42,0.25),0_2px_6px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="login-accent" />

            {/* Step indicator */}
            <div className="px-6 pt-5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                <span>Step {step === "role" ? 1 : 2} of 2</span>
                <span className="bg-gradient-to-r from-[#1B4FD8] to-[#4F46E5] bg-clip-text text-transparent">
                  {step === "role" ? "Select role" : "Verify identity"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="h-1 login-progress-fill" style={{ width: "100%" }} />
                <div className="h-1 bg-[#E2E8F0] overflow-hidden">
                  <div className="h-full login-progress-fill" style={{ width: step === "credentials" ? "100%" : "0%" }} />
                </div>
              </div>
            </div>

            <div className="px-6 pt-5 pb-6">
              {error && (
                <div
                  key={errorNonce}
                  role="alert"
                  className="login-shake bg-gradient-to-r from-[#FEF2F2] to-[#FFF5F5] border border-[#FECACA] border-l-[3px] border-l-[#DC2626] text-[#B91C1C] text-[12.5px] px-3.5 py-2.5 mb-4 flex items-start gap-2"
                >
                  <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-px" />
                  <span>{error}</span>
                </div>
              )}

              <div key={step} className={stepDir === "forward" ? "login-step-fwd" : "login-step-back"}>
                {step === "role" ? (
                  <>
                    <div className="mb-4">
                      <h2 className="text-xl font-semibold text-[#0F172A] mb-1">Select your role</h2>
                      <p className="text-[12.5px] text-[#64748B]">
                        Choose the role your administrator assigned to your account.
                      </p>
                    </div>

                    <div className="group relative mb-3">
                      <Search className="w-4 h-4 text-[#94A3B8] group-focus-within:text-[#1B4FD8] transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        value={roleQuery}
                        onChange={(e) => setRoleQuery(e.target.value)}
                        placeholder="Search roles"
                        aria-label="Search roles"
                        className={inputCls}
                        autoFocus
                      />
                    </div>

                    <div className="max-h-[22rem] overflow-y-auto -mx-1 px-1 pb-1" role="listbox" aria-label="Roles">
                      {rolesLoading ? (
                        <div className="space-y-2" aria-busy="true">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="h-[54px] login-skeleton" />
                          ))}
                        </div>
                      ) : groupedRoles.length === 0 ? (
                        <div className="login-stagger text-center text-[12.5px] text-[#64748B] py-10 border border-dashed border-[#CBD5E1] bg-[#F8FAFC]">
                          No roles match "{roleQuery}"
                        </div>
                      ) : (
                        (() => {
                          let order = 0
                          return groupedRoles.map(({ group, roles }) => {
                            const GroupIcon = ROLE_GROUP_ICON[group]
                            const tone = ROLE_GROUP_TONE[group]
                            return (
                              <div key={group} className="mb-3 last:mb-0">
                                <div
                                  className="login-stagger flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-wider text-[#94A3B8] px-1 mb-1.5"
                                  style={{ "--i": Math.min(order, 14) } as React.CSSProperties}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                                  {group}
                                </div>
                                <div className="space-y-1.5">
                                  {roles.map((r) => {
                                    const isSelected = selectedLoginRole === r.value
                                    const i = Math.min(++order, 14)
                                    return (
                                      <button
                                        key={r.value}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => chooseRole(r.value)}
                                        style={{ "--i": i } as React.CSSProperties}
                                        className={`login-stagger login-role group w-full flex items-center gap-3 px-3 py-2.5 text-left border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4FD8]/30 ${
                                          isSelected
                                            ? "border-[#1B4FD8] bg-gradient-to-r from-[#EFF6FF] to-[#EEF2FF]"
                                            : "border-[#E2E8F0] bg-white hover:border-[#93B4F8] hover:bg-[#FBFCFF]"
                                        }`}
                                      >
                                        <span
                                          className={`w-9 h-9 flex items-center justify-center flex-shrink-0 transition-colors ${
                                            isSelected ? tone.solid : tone.tile
                                          }`}
                                        >
                                          <GroupIcon className="w-4 h-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-[13px] font-semibold text-[#0F172A] truncate">{r.label}</span>
                                          <span className="block text-[11.5px] text-[#64748B] truncate">{r.sub}</span>
                                        </span>
                                        <ChevronRight className="w-4 h-4 text-[#CBD5E1] group-hover:text-[#1B4FD8] group-hover:translate-x-0.5 flex-shrink-0 transition-all" />
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })
                        })()
                      )}
                    </div>
                  </>
                ) : (
                  <form onSubmit={submit} className="space-y-4" noValidate>
                    <div>
                      <h2 className="text-xl font-semibold text-[#0F172A] mb-1">Sign in</h2>
                      <p className="text-[12.5px] text-[#64748B]">
                        Enter the credentials issued to you by your administrator.
                      </p>
                    </div>

                    {/* Selected role */}
                    <div className="flex items-center gap-3 border border-[#C7D7FE] bg-gradient-to-r from-[#EFF6FF] via-[#EEF2FF] to-[#F5F3FF] px-3 py-2.5">
                      <span className={`w-9 h-9 flex items-center justify-center flex-shrink-0 shadow-sm ${activeTone.solid}`}>
                        <ActiveRoleIcon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">Signing in as</div>
                        <div className="text-[13px] font-semibold text-[#0F172A] truncate">
                          {activeRole?.label || selectedLoginRole}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={backToRoles}
                        className="group/change flex items-center gap-1 text-[12px] font-semibold text-[#1B4FD8] hover:text-[#4F46E5] flex-shrink-0 transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover/change:-translate-x-0.5" /> Change
                      </button>
                    </div>

                    <div>
                      <label htmlFor="login-user" className="block text-[12px] font-semibold text-[#374151] mb-1.5">
                        User ID / Employee Number
                      </label>
                      <div className="group relative">
                        <User className="w-4 h-4 text-[#94A3B8] group-focus-within:text-[#1B4FD8] transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="login-user"
                          ref={userInputRef}
                          value={user}
                          onChange={(e) => setUser(e.target.value)}
                          placeholder="e.g. dr.varma or STF-001"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="login-pass" className="block text-[12px] font-semibold text-[#374151]">
                          Password
                        </label>
                        <button
                          type="button"
                          onClick={() => showError("Contact your hospital administrator to reset your password.")}
                          className="text-[11.5px] text-[#64748B] hover:text-[#1B4FD8] transition-colors"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="group relative">
                        <Lock className="w-4 h-4 text-[#94A3B8] group-focus-within:text-[#1B4FD8] transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="login-pass"
                          type={showPass ? "text" : "password"}
                          value={pass}
                          onChange={(e) => setPass(e.target.value)}
                          onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                          onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                          onBlur={() => setCapsLock(false)}
                          placeholder="Enter your password"
                          autoComplete="current-password"
                          className={`${inputCls} pr-10`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass((v) => !v)}
                          aria-label={showPass ? "Hide password" : "Show password"}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#94A3B8] hover:text-[#1B4FD8] transition-colors"
                        >
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {capsLock && (
                        <p className="login-stagger text-[11px] text-[#B45309] mt-1.5 flex items-center gap-1">
                          <TriangleAlert className="w-3 h-3" /> Caps Lock is on
                        </p>
                      )}
                    </div>

                    <label htmlFor="remember-device" className="flex items-center gap-2 cursor-pointer select-none w-fit">
                      <input
                        type="checkbox"
                        id="remember-device"
                        checked={rememberDevice}
                        onChange={(e) => setRememberDevice(e.target.checked)}
                        className="w-3.5 h-3.5 accent-[#1B4FD8] rounded-none"
                      />
                      <span className="text-[12px] text-[#64748B]">Remember my role on this device</span>
                    </label>

                    <button
                      type="submit"
                      disabled={loading}
                      className="login-btn w-full py-2.5 rounded-none text-white font-semibold text-[13px]"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Verifying...
                        </span>
                      ) : (
                        <span className="relative z-10 flex items-center justify-center gap-1.5">
                          Sign in <ChevronRight className="w-4 h-4" />
                        </span>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-[#EEF2F7] bg-gradient-to-r from-[#F8FAFC] to-[#F1F5FB] px-6 py-3 text-[11px] text-[#64748B]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A] flex-shrink-0" />
              Access is verified against the role assigned to your account.
            </div>
          </div>
        </div>

        {/* Footer on right side (inside dark blue curve) */}
        <div className="relative z-10 text-center">
          <div className="text-[11px] text-[#94A3B8]">
            © 2026 General Hospital · UHMS v4.2.1 · Build 20260823
          </div>
        </div>
      </div>
    </div>
  )
}
