import React, { useState, useEffect, useCallback, useRef } from "react"
import { Toaster } from "react-hot-toast"
import {
  LayoutDashboard,
  Stethoscope,
  Users,
  ClipboardList,
  FileText,
  Siren,
  BedDouble,
  HeartPulse,
  Syringe,
  FlaskConical,
  Scan,
  Pill,
  Scissors,
  CreditCard,
  ShieldCheck,
  UsersRound,
  Calendar,
  Sparkles,
  BarChart3,
  Landmark,
} from "lucide-react"

import { Icon, type IconProps } from "./components/icons"

import Login, {
  loginUserFromAuthenticated,
  type AuthenticatedUser,
  type LoginUserData,
} from "./components/Login"

import Dashboard from "./components/Dashboard"

import PatientSearch from "./components/PatientSearch"

import PatientChart from "./components/PatientChart"

import ErPage from "./pages/ErPage"

import BedManagementPage from "./pages/BedManagementPage"

import NursingPortal from "./components/nursing/NursingPortal"

import type { Notice } from "./types"

import { apiFetch } from "./lib/api"
import { setAppSessionAuthenticated } from "./lib/authState"

import Laboratory from "./components/Laboratory"
import LaboratoryManagementSuite from "./components/laboratory/LaboratoryManagementSuite"

import Pharmacy from "./components/Pharmacy"

import Billing from "./components/Billing"
import LabBillingQueue from "./components/LabBillingQueue"
import InsuranceClaims from "./components/insurance/ClaimsHome"
import InsuranceSettlementPage from "./components/insurance/SettlementPage"
import InsuranceMastersPage from "./components/insurance/MastersPage"
import EnhancedAuditRulesPage from "./components/insurance/EnhancedAuditRulesPage"
import InsuranceDashboardView from "./components/insurance/InsuranceDashboardView"
import InsuranceCommandDashboard from "./components/insurance/InsuranceCommandDashboard"
import CashlessCaseBoard from "./components/insurance/CashlessCaseBoard"
import InsuranceCaseDetailView from "./components/insurance/InsuranceCaseDetailView"
import DischargeFinalizationView from "./components/insurance/DischargeFinalizationView"
import InsuranceReportsView from "./components/insurance/InsuranceReportsView"
import InsuranceEmailHubPage from "./components/insurance/InsuranceEmailHubPage"
import InsuranceIntakeView from "./components/insurance/InsuranceIntakeView"
import PreAuthRequestView from "./components/insurance/PreAuthRequestView"
import { InsuranceEngineService } from "./services/insuranceDb"
import { HospAILogo } from "./components/HospAILogo"
import BillingDashboard from "./components/billing/BillingDashboard"

import RevenueDashboard from "./components/billing/RevenueDashboard"

import Inpatient from "./components/Inpatient"

import Surgery from "./components/Surgery"

import Appointments from "./components/Appointments"

import Radiology from "./components/Radiology"

import ICU from "./components/ICU"

import Analytics from "./components/Analytics"

import Discharge from "./components/Discharge"

import Triage from "./components/Triage"


import OrderDrawer from "./components/OrderDrawer"

import CommandPalette from "./components/CommandPalette"

import Registration from "./components/Registration"
import PatientJourneyModal from "./components/PatientJourneyModal"
import JourneyScanHost from "./components/opcard/JourneyScan"
import { patientPageUrl } from "./components/patientRecord/patientRecord"
import NurseStation from "./components/NurseStation"

import OPWorkflow from "./components/OPWorkflow"

import SmartOCR from "./components/SmartOCR"

import DpiOcrPortal from "./components/DpiOcrPortal"

import SymptomAI from "./components/SymptomAI"

import ClinicalRAG from "./components/ClinicalRAG"

import ClinicalSummaries from "./components/ClinicalSummaries"

import BulkAI from "./components/BulkAI"

import NLFiltering from "./components/NLFiltering"

import IntelligenceHub from "./components/IntelligenceHub"

import QueueManagement from "./components/QueueManagement"

import OPManagement from "./components/OPManagement"
import OPDProcedures from "./components/OPDProcedures"
import DoctorPortal from "./components/doctor/DoctorPortal"
import DoctorsOverview from "./components/doctor/DoctorsOverview"

import DoctorScheduling from "./components/DoctorScheduling"

import PatientExperience from "./components/PatientExperience"
import PatientMessages from "./components/messaging/PatientMessages"

import HrWorkspace, { type HrSection } from "./components/hr/HrWorkspace"
import OnDutyStrip from "./components/hr/OnDutyStrip"
import { HrmsDatabase } from "./services/hrmsDb"
import HRMS from "./components/HRMS"
import ApplyLeaveModal from "./components/hrms/ApplyLeaveModal"

import Admissions from "./components/Admissions"

import Readmission from "./components/Readmission"

import PaymentCollection from "./components/PaymentCollection"

import RevenueReports from "./components/RevenueReports"

import Administration from "./components/Administration"
import DepartmentAccessDenied from "./components/DepartmentAccessDenied"

import OpReportsPage from "./components/reports/OpReportsPage"

import GeneralReportsOverviewPage from "./components/reports/GeneralReportsOverviewPage"
import PatientPoliciesPage from "./components/insurance/PatientPoliciesPage"

import GenericReportPage, {
  ReportType,
} from "./components/reports/GenericReportPage"

import AccountsModule from "./components/AccountsModule"
import MessagesPanel from "./components/MessagesPanel"
import { useMediaQuery } from "./hooks/useMediaQuery"
import PageErrorBoundary from "./components/PageErrorBoundary"

import {
  DoctorAccount,
  DoctorPortalDatabase,
  resolveDoctorAccount,
  getAllDoctorAccounts,
  DOCTOR_ROSTER,
} from "./services/doctorPortalDb"

import { ALL_SYSTEM_MODULES } from "./services/roleDb"

import { LabOrderDatabase } from "./services/labOrdersDb"
import { LabInventoryDatabase } from "./services/labInventoryDb"
import { PharmacyDatabase, isAwaitingVerification } from "./services/pharmacyDb"
import { ErDatabase } from "./services/erDb"
import { BedDatabase } from "./services/bedDb"
import { db } from "./services/db"
import { getDischargedIcuPatients } from "./components/icu/IcuDischargeModal"
import { RadiologyWorkflowDb } from "./services/radiologyWorkflowDb"
import { UniversalRadiologyDb } from "./services/universalRadiologyDb"

/** Insurance sub-modules and legacy key mappings */
const insuranceModule = (m: string): string =>
  m === "insurance_reconciliation"
    ? "insurance_settlement"
    : m === "insurance_desk"
      ? "insurance_overview"
      : m === "insurance"
        ? "insurance_claims"
        : m


type Module = "dashboard" | "patients" | "appointments" | "emergency" | "emergency_ui" | "clinical" | "inpatient" | "nursing" | "laboratory" | "lab_dashboard" | "lab_orders_collection" | "lab_workbench" | "lab_review_reports" | "lab_admin_config" | "lab_orders" | "lab_sample_collection" | "lab_sample_reception" | "lab_worklists" | "lab_analyzers" | "lab_result_entry" | "lab_pathologist_review" | "lab_critical_alerts" | "lab_reports" | "lab_test_master" | "lab_quality_analytics" | "lab_settings" | "lab_processing" | "lab_critical" | "lab_catalog" | "lab_inventory" | "lab_analytics" | "lab_tat" | "radiology" | "radiology_overview" | "radiology_worklist" | "radiology_scheduling" | "radiology_operations" | "radiology_reporting" | "radiology_finalized" | "radiology_exceptions" | "radiology_analytics" | "radiology_admin" | "radiology_template_upload" | "radiology_templates" | "radiology_xray" | "radiology_ct" | "radiology_usg" | "radiology_mri" | "radiology_reports" | "pharmacy" | "pharmacy_dispensing" | "pharmacy_rx" | "pharmacy_ocr" | "pharmacy_returns" | "pharmacy_supplier_returns" | "pharmacy_medicine" | "pharmacy_category" | "pharmacy_suppliers" | "pharmacy_po" | "pharmacy_grn" | "pharmacy_ledger" | "pharmacy_transfers" | "pharmacy_expiry" | "pharmacy_write_off" | "pharmacy_analytics" | "pharmacy_notifications" | "pharmacy_users" | "pharmacy_audit" | "pharmacy_settings" | "surgery" | "billing" | "billing_op" | "billing_ip" | "billing_er" | "billing_unified" | "billing_revenue" | "icu" | "icu_micu" | "icu_sicu" | "icu_ccu" | "icu_nicu" | "icu_picu" | "icu_ward" | "discharge" | "triage" | "insurance" | "insurance_overview" | "insurance_desk" | "insurance_board" | "insurance_case" | "insurance_discharge" | "insurance_reports" | "insurance_preauth" | "insurance_eligibility" | "insurance_claims" | "insurance_queries" | "insurance_emails" | "insurance_settlement" | "insurance_reconciliation" | "insurance_masters" | "insurance_tpas" | "insurance_packages" | "insurance_pricing" | "insurance_docrules" | "insurance_patient_policies" | "analytics" | "reports" | "reports_overview" | "reports_patients" | "reports_op" | "reports_er" | "reports_inpatient" | "reports_appointments" | "reports_doctors" | "reports_pharmacy" | "reports_laboratory" | "reports_radiology" | "reports_beds" | "reports_admissions" | "reports_discharges" | "reports_staff" | "admin" | "admin_doctors" | "chart" | "register" | "outpatient" | "queue" | "op_management" | "op_registration" | "op_workflow" | "op_nurse" | "opd_procedures" | "doctor_workflow" | "doctor_portal" | "scheduling" | "lab_billing" | "admissions" | "readmission" | "payments" | "revenue_reports" | "reports_pharmacy_damaged" | "reports_supplier_returns" | "hrms" | "my_hr" | "employees" | "hr_dashboard" | "hr_attendance" | "hr_staffing" | "hr_leave" | "hr_approvals" | "hr_payroll" | "hr_recruitment" | "hr_organization" | "hr_training" | "hr_performance" | "hr_compliance" | "hr_grievances" | "hr_reports" | "hr_announcements" | "hr_muster" | "hr_biometric" | "hr_timetables" | "hr_audit" | "patient_exp" | "patient_messages" | "intelligence" | "ocr" | "dpi_ocr" | "symptom_ai" | "clinical_rag" | "clinical_summaries" | "bulk_ai" | "nl_filtering" | "beds" | "accounts" | "accounts_dashboard" | "accounts_coa" | "accounts_gl" | "accounts_receipts" | "accounts_payments" | "accounts_ar" | "accounts_ap" | "accounts_cash_bank" | "accounts_pharmacy" | "accounts_insurance" | "accounts_tax" | "accounts_budget" | "accounts_assets" | "accounts_reports" | "accounts_period_close" | "accounts_audit" | "accounts_manager"

const HR_MODULE_SECTION_MAP: Record<string, HrSection> = {
  hrms: "dashboard",
  hr_dashboard: "dashboard",
  employees: "employees",
  hr_attendance: "attendance",
  scheduling: "shifts",
  hr_staffing: "staffing",
  hr_leave: "leave",
  hr_approvals: "approvals",
  hr_payroll: "payroll",
  hr_recruitment: "recruitment",
  hr_organization: "organization",
  hr_training: "training",
  hr_performance: "performance",
  hr_compliance: "compliance",
  hr_grievances: "grievances",
  hr_reports: "reports",
  hr_announcements: "announcements",
  hr_muster: "attendance",
  hr_biometric: "attendance",
  hr_timetables: "shifts",
  hr_audit: "reports",
  my_hr: "leave",
}


interface NavItem {
  key: Module

  label: string

  Icon: React.ComponentType<{ className?: string; size?: number | string }>

  badge?: number

  children?: { key: Module; label: string; group?: string }[]
}

const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },

  { key: "doctor_portal", label: "Doctor Workspace", Icon: Stethoscope },

  {
    key: "patients",
    label: "Reception",
    Icon: Users,

    children: [
      { key: "patients", label: "Patient Search" },

      { key: "register", label: "Registration" },

      { key: "appointments", label: "Appointments" },

      { key: "patient_messages", label: "Patient Messages" },
    ],
  },

  {
    key: "outpatient",
    label: "OP Department",
    Icon: ClipboardList,
    children: [
      { key: "op_management", label: "OP Management" },
      { key: "queue", label: "Live Queue Board" },
      { key: "op_nurse", label: "Nurse Station" },
      { key: "opd_procedures", label: "OPD Minor Procedures" },
    ],
  },

  {
    key: "clinical",
    label: "Clinical",
    Icon: FileText,

    children: [{ key: "chart", label: "Encounters" }],
  },

  {
    key: "emergency",
    label: "Emergency",
    Icon: Siren,

    children: [
      { key: "emergency", label: "ED Track Board" },
      { key: "triage", label: "Triage" },
    ],
  },

  {
    key: "inpatient",
    label: "Inpatient",
    Icon: BedDouble,

    children: [
      { key: "inpatient", label: "Bed Board" },

      { key: "beds", label: "Bed Management" },

      { key: "admissions", label: "Admissions" },

      { key: "readmission", label: "Readmission" },

      { key: "discharge", label: "Discharge" },
    ],
  },

  {
    // Each ICU unit is its own sub-page of one Critical Care workspace; the
    // sub-keys inherit the "icu" grant, so no role needs updating.
    key: "icu",
    label: "Critical Care",
    Icon: HeartPulse,

    children: [
      { key: "icu", label: "All ICUs" },
      { key: "icu_micu", label: "Medical ICU (MICU)" },
      { key: "icu_sicu", label: "Surgical ICU (SICU)" },
      { key: "icu_ccu", label: "Cardiac ICU (CCU)" },
      { key: "icu_nicu", label: "Neuro ICU (NICU)" },
      { key: "icu_picu", label: "Pediatric ICU (PICU)" },
      { key: "icu_ward", label: "ICU Ward" },
    ],
  },

  {
    key: "laboratory",
    label: "Laboratory",
    Icon: FlaskConical,
    children: [
      { key: "lab_dashboard", label: "Lab Dashboard" },
      { key: "lab_orders_collection", label: "Lab Orders Directory" },
      { key: "lab_workbench", label: "Lab Workbench" },
      { key: "lab_reports", label: "Lab Reports" },
      { key: "lab_inventory", label: "Lab Inventory & Consumables" },
      { key: "lab_quality_analytics", label: "Quality & Analytics" },
      { key: "lab_admin_config", label: "Admin Configuration" },
    ],
  },

  {
    key: "radiology",
    label: "Radiology",
    Icon: Scan,
    children: [
      { key: "radiology", label: "Overview Hub" },
      { key: "radiology_worklist", label: "Examination Worklist" },
      { key: "radiology_operations", label: "Scanning Operations" },
      { key: "radiology_reporting", label: "Reporting Workspace" },
      { key: "radiology_reports", label: "Finalized Reports" },
      { key: "radiology_template_upload", label: "Template Management" },
      { key: "radiology_analytics", label: "Department Analytics" },
    ],
  },

  {
    key: "pharmacy",
    label: "Pharmacy",
    Icon: Pill,

    children: [
      { key: "pharmacy", label: "Dashboard" },
      { key: "pharmacy_dispensing", label: "Dispensing & Billing" },
      { key: "pharmacy_rx", label: "Doctor Prescriptions" },
      { key: "pharmacy_returns", label: "Patient Returns & Refunds" },
      { key: "pharmacy_medicine", label: "Medicine Catalog & Batches" },
      { key: "pharmacy_suppliers", label: "Suppliers Directory" },
      { key: "pharmacy_ocr", label: "Inward Stock Entry (GRN)" },
      { key: "pharmacy_supplier_returns", label: "Supplier Returns (Debit Notes)" },
      { key: "pharmacy_ledger", label: "Stock Movement Ledger" },
      { key: "pharmacy_expiry", label: "Expiry & Low Stock Alerts" },
      { key: "pharmacy_write_off", label: "Medicine Disposal & Write-Off" },
      { key: "pharmacy_analytics", label: "Pharmacy Analytics & Reports" },
      { key: "pharmacy_notifications", label: "Alerts & Notifications" },
      { key: "pharmacy_audit", label: "Pharmacy Audit Log" },
    ],
  },

  { key: "surgery", label: "Surgery", Icon: Scissors },

  {
    key: "billing",
    label: "Billing",
    Icon: CreditCard,

    // One page per counter. Grouped children render under a caption, so the
    // counters, the lab desk and the records read as three short lists.
    children: [
      // "billing" is the Billing Dashboard -- the module's landing page, as
      // Dashboard is for the app. Screens that deep-link to "billing" with a
      // bill preselected are forwarded by the dashboard to that bill's counter.
      { key: "billing", label: "Billing Dashboard" },
      { key: "billing_op", label: "OP Billing", group: "Counters" },
      { key: "billing_ip", label: "IP Billing", group: "Counters" },
      { key: "billing_er", label: "Emergency Billing", group: "Counters" },
      { key: "lab_billing", label: "Investigation Billing", group: "Counters" },
      { key: "billing_unified", label: "Unified Patient Bill", group: "Records" },
      { key: "payments", label: "Payment History", group: "Records" },
      { key: "billing_revenue", label: "Revenue & Dues", group: "Records" },
    ],
  },

  {
    // The insurance engine shared by OP / IP / ER / OT / ICU: one case per
    // insured encounter, from
    // eligibility and pre-auth through claim, queries and settlement.
    key: "insurance",
    label: "Insurance",
    Icon: ShieldCheck,

    children: [
      { key: "insurance_overview", label: "Command Dashboard" },
      { key: "insurance_patient_policies", label: "Patient Policies" },
      { key: "insurance_eligibility", label: "New Patient / Intake" },
      { key: "insurance_preauth", label: "Pre-Authorization" },
      { key: "insurance_claims", label: "Claims & Queries" },
      { key: "insurance_emails", label: "Email & TPA Decision Hub" },
      { key: "insurance_settlement", label: "Settlements" },
      { key: "insurance_masters", label: "Master Setup" },
      { key: "insurance_docrules", label: "Audit Log & Rules" },
    ],


  },

  {
    key: "accounts",
    label: "Accounts & Finance",
    Icon: Landmark,

    children: [
      { key: "accounts", label: "Finance Dashboard", group: "Overview" },
      { key: "accounts_coa", label: "Chart of Accounts", group: "General Ledger" },
      { key: "accounts_gl", label: "General Ledger & Journals", group: "General Ledger" },
      { key: "accounts_receipts", label: "Receipt Vouchers", group: "Vouchers & Cash" },
      { key: "accounts_payments", label: "Payment Vouchers", group: "Vouchers & Cash" },
      { key: "accounts_cash_bank", label: "Cash & Bank", group: "Vouchers & Cash" },
      { key: "accounts_ar", label: "Accounts Receivable (AR)", group: "Sub-Ledgers" },
      { key: "accounts_ap", label: "Accounts Payable (AP)", group: "Sub-Ledgers" },
      { key: "accounts_pharmacy", label: "Pharmacy Accounts", group: "Operational Accounts" },
      { key: "accounts_insurance", label: "Insurance Accounts", group: "Operational Accounts" },
      { key: "accounts_tax", label: "GST & Tax Setup", group: "Tax & Compliance" },
      { key: "accounts_budget", label: "Budgeting & Cost Centres", group: "Management" },
      { key: "accounts_assets", label: "Fixed Assets", group: "Assets" },
      { key: "accounts_reports", label: "Financial Statements", group: "Reporting" },
      { key: "accounts_period_close", label: "Period Closing", group: "Closing" },
      { key: "accounts_audit", label: "Audit & Integrations", group: "Compliance" },
      { key: "accounts_manager", label: "Finance Manager Hub", group: "Administration" },
    ],
  },

  {
    key: "hrms",
    label: "HR & Staff",
    Icon: UsersRound,
    children: [
      { key: "hrms", label: "Executive Dashboard" },
      { key: "employees", label: "Employees Master" },
      { key: "hr_attendance", label: "Attendance & Bio" },
      { key: "scheduling", label: "Duty Shifts & Roster" },
      { key: "hr_staffing", label: "Department Staffing" },
      { key: "hr_leave", label: "Leave Requests" },
      { key: "hr_approvals", label: "Pending Approvals" },
      { key: "hr_payroll", label: "Payroll Processing" },
      { key: "hr_recruitment", label: "Recruitment & Onboarding" },
      { key: "hr_organization", label: "Organization Structure" },
      { key: "hr_training", label: "Training & Compliance" },
      { key: "hr_performance", label: "Staff Appraisals" },
      { key: "hr_compliance", label: "Regulatory Audits" },
      { key: "hr_grievances", label: "Disciplinary & Grievances" },
      { key: "hr_reports", label: "Statutory HR Reports" },
      { key: "hr_announcements", label: "Staff Circulars" },
    ],
  },

  {
    key: "intelligence",
    label: "Hosp AI",
    Icon: Sparkles,

    children: [
      { key: "dpi_ocr", label: "Keppler OCR" },

      { key: "symptom_ai", label: "Symptom AI" },

      { key: "clinical_summaries", label: "Clinical Summaries" },

      { key: "bulk_ai", label: "Bulk Patient AI" },

      { key: "nl_filtering", label: "PatientReach AI" },
    ],
  },

  {
    key: "reports",
    label: "Reports",
    Icon: BarChart3,

    children: [
      { key: "reports_overview", label: "Overview", group: "General Reports" },

      {
        key: "reports_patients",
        label: "Patient Reports",
        group: "General Reports",
      },

      { key: "reports_op", label: "OP Reports", group: "General Reports" },

      { key: "reports_er", label: "ER Reports", group: "General Reports" },

      {
        key: "reports_inpatient",
        label: "IP / Inpatient Reports",
        group: "General Reports",
      },

      {
        key: "reports_appointments",
        label: "Appointment Reports",
        group: "General Reports",
      },

      {
        key: "reports_doctors",
        label: "Doctor Reports",
        group: "General Reports",
      },

      {
        key: "reports_pharmacy",
        label: "Pharmacy Reports",
        group: "General Reports",
      },

      {
        key: "reports_laboratory",
        label: "Laboratory Reports",
        group: "General Reports",
      },

      {
        key: "reports_radiology",
        label: "Radiology Reports",
        group: "General Reports",
      },

      { key: "reports_beds", label: "Bed Reports", group: "General Reports" },

      {
        key: "reports_admissions",
        label: "Admission Reports",
        group: "General Reports",
      },

      {
        key: "reports_discharges",
        label: "Discharge Reports",
        group: "General Reports",
      },

      {
        key: "reports_staff",
        label: "Staff Reports",
        group: "General Reports",
      },

      {
        key: "revenue_reports",
        label: "Revenue Reports",
        group: "Financial Reports",
      },

      {
        key: "reports_pharmacy_damaged",
        label: "Pharmacy Damaged Stock",
        group: "Financial Reports",
      },

      {
        key: "reports_supplier_returns",
        label: "Supplier Return Ledger",
        group: "Financial Reports",
      },
    ],
  },

  {
    key: "admin",
    label: "Administration",
    Icon: Icon.Admin,
    children: [
      { key: "admin", label: "Control Centre" },
      { key: "admin_doctors", label: "Doctor Workspace & Master" },
    ],
  },
]

// Breadcrumb label for a module. NAV already carries a proper label for every

// entry -- including all 18 pharmacy screens -- so the trail is read from there

// instead of a ternary chain that had to be extended by hand and fell through to

// the raw module key ("Pharmacy_rx") for anything nobody had added yet.

const BREADCRUMB_OVERRIDES: Record<string, string | string[]> = {
  laboratory: "Laboratory",
  chart: "Patient Chart",

  register: "Registration",

  discharge: "Discharge Workflow",

  op_management: "OP Management",
  op_workflow: "OP Clinical Journey",
  doctor_workflow: "Doctor Workspace",
  doctor_portal: "Doctor Workspace",
  admin_doctors: ["Administration", "Doctor Workspace & Master"],
  patient_exp: "Patient Experience",
  patient_messages: ["Reception", "Patient Messages"],

  clinical_rag: "Clinical RAG",

  reports: ["Reports", "General Reports", "Overview"],

  reports_overview: ["Reports", "General Reports", "Overview"],

  reports_patients: ["Reports", "General Reports", "Patient Reports"],

  reports_op: ["Reports", "General Reports", "OP Reports"],

  reports_er: ["Reports", "General Reports", "ER Reports"],

  reports_inpatient: ["Reports", "General Reports", "IP / Inpatient Reports"],

  reports_appointments: ["Reports", "General Reports", "Appointment Reports"],

  reports_doctors: ["Reports", "General Reports", "Doctor Reports"],

  reports_pharmacy: ["Reports", "General Reports", "Pharmacy Reports"],

  reports_laboratory: ["Reports", "General Reports", "Laboratory Reports"],

  reports_radiology: ["Reports", "General Reports", "Radiology Reports"],

  reports_beds: ["Reports", "General Reports", "Bed Reports"],

  reports_admissions: ["Reports", "General Reports", "Admission Reports"],

  reports_discharges: ["Reports", "General Reports", "Discharge Reports"],

  reports_staff: ["Reports", "General Reports", "Staff Reports"],

  revenue_reports: ["Reports", "Financial Reports", "Revenue Reports"],

  reports_pharmacy_damaged: [
    "Reports",
    "Financial Reports",
    "Pharmacy Damaged Stock",
  ],

  reports_supplier_returns: [
    "Reports",
    "Financial Reports",
    "Supplier Return Ledger",
  ],
}

function moduleTrail(module: string): string[] {
  const override = BREADCRUMB_OVERRIDES[module]

  if (override) return Array.isArray(override) ? override : [override]

  for (const item of NAV) {
    if (item.key === module && !item.children) return [item.label]

    const child = item.children?.find((c) => c.key === module)

    if (child) {
      if (child.group) {
        return [item.label, child.group, child.label]
      }

      // A module's own landing page repeats the section name otherwise.

      return child.key === item.key ? [item.label] : [item.label, child.label]
    }

    if (item.key === module) return [item.label]
  }

  return [module]
}

function NotificationPanel({
  onClose,
  onNavigate,
}: {
  onClose: () => void
  onNavigate: (module: string, sub?: string) => void
}) {
  const [readState, setReadState] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("hospai_dashboard_notifs_read")
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  const [hrNotes, setHrNotes] = useState<{ id: string; severity: string; title: string; body: string | null; at: string | null; target: string }[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      hr.get<typeof hrNotes>("/api/v1/me/notifications")
        .then((rows) => alive && setHrNotes(Array.isArray(rows) ? rows.slice(0, 8) : []))
        .catch(() => alive && setHrNotes([])) // HR service down: the bell just shows the rest
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const items = React.useMemo(() => {
    const list: {
      id: string
      type: "critical" | "warning" | "info"
      icon: string
      title: string
      body: string
      time: string
      target: string
      sub?: string
    }[] = []

    // 1. Bed Transfer notifications
    const transfers = BedDatabase.getTransferNotifications()
    transfers.slice(0, 3).forEach((tr) => {
      list.push({
        id: `tr-${tr.id}`,
        type: tr.priority.includes("Stat") ? "critical" : "warning",
        icon: "🛏️",
        title: `Bed Transfer: ${tr.patient_name}`,
        body: `${tr.source_department} → ${tr.target_destination}`,
        time: "Just now",
        target: "inpatient",
        sub: tr.target_ward,
      })
    })

    // 2. Critical & Pending Labs
    const labs = LabOrderDatabase.getOrders()
    labs
      .filter((l) => l.status === "Awaiting Billing" || l.status === "Sample Collected" || l.status === "In Progress" || l.tests?.some(t => t.flag === "Critical"))
      .slice(0, 3)
      .forEach((l) => {
        const isCrit = l.tests?.some((t) => t.flag === "Critical" || t.urgency === "STAT")
        const testName = l.tests && l.tests[0] ? l.tests[0].name : "Diagnostic Order"
        list.push({
          id: `lab-${l.id}`,
          type: isCrit ? "critical" : "info",
          icon: "🧪",
          title: isCrit ? `Critical Lab: ${l.patientName}` : `Pending Lab: ${testName}`,
          body: `${testName} (${l.umr}) · Status: ${l.status}`,
          time: "10m ago",
          target: "laboratory",
        })
      })

    // 3. ER Active Visits / Census
    const erVisits = ErDatabase.getVisits("active")
    const criticalEr = erVisits.filter(
      (v) => v.triage_category === "B1" || v.triage_category === "ESI-1",
    )
    if (erVisits.length > 0) {
      list.push({
        id: "er-census",
        type: criticalEr.length > 0 ? "warning" : "info",
        icon: "🚨",
        title: `ER Census: ${erVisits.length} Active Patients`,
        body: `${criticalEr.length} critical patient(s) in resuscitation/emergency bay`,
        time: "5m ago",
        target: "emergency",
      })
    }

    // 4. ICU Discharges
    const icuDis = getDischargedIcuPatients()
    if (icuDis.length > 0) {
      list.push({
        id: "icu-discharge",
        type: "info",
        icon: "📋",
        title: `ICU Discharge Handoffs (${icuDis.length})`,
        body: `${icuDis[0].patientName} ready for reception bed allocation`,
        time: "15m ago",
        target: "discharge",
      })
    }

    // 5. Today's Appointments
    const encs = db.getEncounters()
    if (encs.length > 0) {
      list.push({
        id: "op-appointments",
        type: "info",
        icon: "📅",
        title: `Appointments: ${encs.length} Booked Today`,
        body: `Next: ${encs[0].patientName} with ${encs[0].assignedDoctor}`,
        time: "Today",
        target: "appointments",
      })
    }

    // 6. HR: approvals waiting for me, leave decisions, expiring credentials,
    // roster changes, payslips, announcements (derived server-side, like the rest).
    for (const n of hrNotes) {
      list.push({
        id: `hr-${n.id}`,
        type: n.severity === "warning" ? "warning" : "info",
        icon: "👥",
        title: n.title,
        body: n.body ?? "",
        time: n.at ? new Date(n.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "",
        target: n.target === "approvals" ? "hr_leave" : "hrms",
      })
    }

    return list
  }, [hrNotes])

  const markAllRead = () => {
    const updated: Record<string, boolean> = { ...readState }
    items.forEach((item) => {
      updated[item.id] = true
    })
    setReadState(updated)
    try {
      localStorage.setItem(
        "hospai_dashboard_notifs_read",
        JSON.stringify(updated),
      )
    } catch { }
  }

  const markSingleRead = (id: string, target: string, sub?: string) => {
    const updated = { ...readState, [id]: true }
    setReadState(updated)
    try {
      localStorage.setItem(
        "hospai_dashboard_notifs_read",
        JSON.stringify(updated),
      )
    } catch { }
    onNavigate(target, sub)
    onClose()
  }

  const unreadCount = items.filter((i) => !readState[i.id]).length

  return (
    <div className="fixed left-2 right-2 top-12 sm:absolute sm:left-auto sm:right-0 sm:top-full mt-1 sm:w-84 bg-white border border-[#DDE2EC] rounded shadow-xl z-50 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[#DDE2EC] bg-[#FAFCFF] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-bold text-gray-900">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-mono">
              {unreadCount} New
            </span>
          )}
        </div>
        <button
          onClick={markAllRead}
          className="text-[11px] text-[#1B4FD8] font-semibold hover:underline cursor-pointer"
        >
          Mark all read
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-[#F1F5F9]">
        {items.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            No active notifications
          </div>
        ) : (
          items.map((n) => {
            const isRead = Boolean(readState[n.id])
            return (
              <div
                key={n.id}
                onClick={() => markSingleRead(n.id, n.target, n.sub)}
                className={`flex gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-blue-50/60 transition-colors ${!isRead ? "bg-[#F4F7FF]" : "bg-white"
                  }`}
              >
                <span className="text-base mt-0.5">{n.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-[12px] truncate ${!isRead
                        ? "font-bold text-gray-900"
                        : "font-medium text-gray-700"
                        }`}
                    >
                      {n.title}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                      {n.time}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-[#64748B] truncate mt-0.5">
                    {n.body}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function NursingDashboard() {
  return (
    <div className="flex-1 overflow-y-auto bg-[#F0F2F5]">
      <div className="bg-white border-b border-[#DDE2EC] px-6 py-3">
        <h1 className="text-base font-semibold text-gray-900">
          Nursing Dashboard — 3N Medical
        </h1>
        <p className="text-[11.5px] text-[#64748B]">
          RN Jessica Carter · Shift: 07:00–19:00 · Aug 23, 2026
        </p>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              room: "204",
              patient: "John Smith",
              age: 41,
              vitals: "Due 11:00",
              meds: "Insulin 11:00 ▲",
              status: "Active",
              acuity: 2,
            },

            {
              room: "208",
              patient: "Mary Jones",
              age: 53,
              vitals: "Done ✓",
              meds: "None due",
              status: "Stable",
              acuity: 3,
            },

            {
              room: "212",
              patient: "Frank Torres",
              age: 55,
              vitals: "Due 12:00",
              meds: "Labetalol PRN",
              status: "Active",
              acuity: 2,
            },

            {
              room: "215",
              patient: "Helen Park",
              age: 72,
              vitals: "Done ✓",
              meds: "Done ✓",
              status: "Isolation",
              acuity: 3,
            },

            {
              room: "221",
              patient: "Robert Lee",
              age: 66,
              vitals: "Overdue ⚠",
              meds: "Overdue ⚠",
              status: "Concern",
              acuity: 2,
            },

            {
              room: "225",
              patient: "Sandra Hill",
              age: 48,
              vitals: "Done ✓",
              meds: "None due",
              status: "Stable",
              acuity: 4,
            },
          ].map((p, i) => (
            <div
              key={i}
              className={`bg-white border rounded p-4 ${p.status === "Concern"
                ? "border-[#FECACA]"
                : p.status === "Isolation"
                  ? "border-[#FED7AA]"
                  : "border-[#DDE2EC]"
                }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#94A3B8]">
                      Rm {p.room}
                    </span>
                    <span
                      className={`text-[10.5px] font-semibold px-1.5 py-px rounded ${p.acuity === 2
                        ? "bg-[#FEE2E2] text-[#B91C1C]"
                        : p.acuity === 3
                          ? "bg-[#FEF3C7] text-[#B45309]"
                          : "bg-[#DCFCE7] text-[#15803D]"
                        }`}
                    >
                      Acuity {p.acuity}
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold text-gray-900 mt-0.5">
                    {p.patient}
                  </div>
                  <div className="text-[11.5px] text-[#64748B]">
                    {p.age} yrs
                  </div>
                </div>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded ${p.status === "Concern"
                    ? "bg-[#FEE2E2] text-[#B91C1C]"
                    : p.status === "Isolation"
                      ? "bg-[#FEF3C7] text-[#B45309]"
                      : p.status === "Active"
                        ? "bg-[#EFF6FF] text-[#1D4ED8]"
                        : "bg-[#F0FDF4] text-[#15803D]"
                    }`}
                >
                  {p.status}
                </span>
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Vitals</span>
                  <span
                    className={`font-medium ${p.vitals.includes("Overdue")
                      ? "text-[#DC2626]"
                      : p.vitals.includes("Due")
                        ? "text-[#D97706]"
                        : "text-[#16A34A]"
                      }`}
                  >
                    {p.vitals}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Medications</span>
                  <span
                    className={`font-medium ${p.meds.includes("Overdue")
                      ? "text-[#DC2626]"
                      : p.meds.includes("▲")
                        ? "text-[#D97706]"
                        : "text-[#16A34A]"
                      }`}
                  >
                    {p.meds}
                  </span>
                </div>
              </div>
              <div className="flex gap-1.5 mt-3">
                <button className="flex-1 text-[11px] font-medium py-1 rounded border border-[#DDE2EC] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-gray-700">
                  Vitals
                </button>
                <button className="flex-1 text-[11px] font-medium py-1 rounded border border-[#DDE2EC] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-gray-700">
                  Meds
                </button>
                <button className="flex-1 text-[11px] font-medium py-1 rounded border border-[#DDE2EC] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-gray-700">
                  Notes
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface StaffProfile {
  id: string

  name: string

  role: string

  title: string

  department: string

  activeShift?: string
}

const DEFAULT_STAFF: StaffProfile = {
  id: "ADM-001",

  name: "Hospital Administrator",

  role: "Admin",

  title: "Hospital Administrator",

  department: "Administration",
}

function getRoleProfile(roleId: string, username?: string): StaffProfile {
  return {
    id: "ADM-001",
    name: "System Administrator",
    role: "ROLE_ADMIN",
    title: "System Administrator",
    department: "Administration",
  }
}

function isModuleAccessible(
  targetModule: string,
  role: string,
  permissions: string[] = [],
  staff?: StaffProfile,
): boolean {
  const roleUpper = (role || "").toUpperCase()
  const isSuperAdmin =
    roleUpper === "ROLE_ADMIN" ||
    roleUpper === "ROLE_SUPERADMIN" ||
    roleUpper === "ADMIN" ||
    staff?.id === "ADM-001" ||
    staff?.role === "ROLE_ADMIN" ||
    permissions.includes("*") ||
    permissions.includes("admin")
  if (isSuperAdmin) return true

  // Universal modules
  if (targetModule === "dashboard" || targetModule === "my_hr") return true

  // Direct match or prefix
  if (permissions.includes(targetModule)) return true
  if (permissions.some((p) => p.startsWith(targetModule + ":") || p.startsWith(targetModule + "."))) return true

  // Doctor portal and clinical records
  if (
    (targetModule === "doctor_portal" || targetModule === "doctor_workflow" || targetModule === "doctors_overview" || targetModule === "doctor_scheduling") &&
    (permissions.includes("clinical") || permissions.includes("patients") || permissions.includes("doctor_portal") || roleUpper.includes("DOCTOR") || roleUpper.includes("PHYSICIAN"))
  ) return true

  // Nursing
  if (
    targetModule === "nursing" &&
    (permissions.includes("nursing") || permissions.includes("clinical") || permissions.includes("beds") || roleUpper.includes("NURSE"))
  ) return true

  // Reception and patient care
  if (
    (targetModule === "patients" || targetModule === "register" || targetModule === "op_registration" || targetModule === "appointments" || targetModule === "patient_messages" || targetModule === "patient_experience" || targetModule === "patient_exp") &&
    (permissions.includes("patients") || permissions.includes("reception") || roleUpper.includes("RECEPT") || roleUpper.includes("FRONT_DESK"))
  ) return true

  // OP Department
  if (
    (targetModule === "outpatient" || targetModule === "op_management" || targetModule === "queue" || targetModule === "op_nurse" || targetModule === "opd_procedures" || targetModule === "journey_scan" || targetModule === "op_workflow") &&
    (permissions.includes("outpatient") || permissions.includes("op") || permissions.includes("clinical") || roleUpper.includes("DOCTOR") || roleUpper.includes("NURSE"))
  ) return true

  // Clinical & Charting
  if (
    (targetModule === "clinical" || targetModule === "chart") &&
    (permissions.includes("clinical") || permissions.includes("patients") || roleUpper.includes("DOCTOR") || roleUpper.includes("NURSE"))
  ) return true

  // Emergency
  if (
    (targetModule === "emergency" || targetModule === "emergency_ui" || targetModule === "triage") &&
    (permissions.includes("emergency") || permissions.includes("er") || roleUpper.includes("ER"))
  ) return true

  // Inpatient & Beds
  if (
    (targetModule === "inpatient" || targetModule === "beds" || targetModule === "admissions" || targetModule === "readmission" || targetModule === "discharge") &&
    (permissions.includes("inpatient") || permissions.includes("beds") || roleUpper.includes("NURSE") || roleUpper.includes("DOCTOR"))
  ) return true

  // Critical Care ICU
  if (targetModule === "icu" || targetModule.startsWith("icu_")) {
    if (permissions.includes("icu") || roleUpper.includes("DOCTOR") || roleUpper.includes("NURSE")) return true
  }

  // Laboratory Diagnostics
  if (targetModule === "laboratory" || targetModule.startsWith("lab_")) {
    if (permissions.includes("laboratory") || permissions.includes("lab") || roleUpper.includes("LAB")) return true
  }

  // Radiology & Imaging
  if (targetModule === "radiology" || targetModule.startsWith("radiology_")) {
    if (permissions.includes("radiology") || roleUpper.includes("RADIOL")) return true
  }

  // Pharmacy
  if (targetModule === "pharmacy" || targetModule.startsWith("pharmacy_")) {
    if (
      permissions.includes("pharmacy") ||
      permissions.includes("ROLE_PHARMACIST") ||
      permissions.includes("ROLE_PHARMACY") ||
      roleUpper.includes("PHARMAC")
    ) return true
  }

  // Surgery
  if (targetModule === "surgery" && (permissions.includes("surgery") || roleUpper.includes("SURGEON"))) return true

  // Billing
  if (
    (targetModule === "billing" || targetModule.startsWith("billing_") || targetModule === "payments" || targetModule === "lab_billing") &&
    (permissions.includes("billing") || permissions.includes("laboratory") || roleUpper.includes("BILLING"))
  ) return true

  // Insurance
  if (
    (targetModule === "insurance" || targetModule.startsWith("insurance_")) &&
    (permissions.includes("insurance") || roleUpper.includes("INSURANCE"))
  ) return true

  // Accounts & Finance
  if (
    (targetModule === "accounts" || targetModule.startsWith("accounts_")) &&
    (permissions.includes("accounts") || permissions.includes("finance") || roleUpper.includes("ACCOUNT") || roleUpper.includes("FINANCE"))
  ) return true

  // HRMS
  if (
    (targetModule === "hrms" || targetModule === "employees" || targetModule === "scheduling" || targetModule.startsWith("hr_")) &&
    (permissions.includes("hrms") || permissions.some((p) => p.startsWith("hrms:") || p.startsWith("hr_")) || roleUpper.includes("HR"))
  ) return true

  // Hosp AI Intelligence
  if (
    (targetModule === "intelligence" || targetModule === "dpi_ocr" || targetModule === "smart_ocr" || targetModule === "symptom_ai" || targetModule === "clinical_rag" || targetModule === "clinical_summaries" || targetModule === "bulk_ai" || targetModule === "nl_filtering") &&
    (permissions.includes("intelligence") || permissions.includes("clinical"))
  ) return true

  // Reports
  if (
    (targetModule === "reports" || targetModule.startsWith("reports_") || targetModule === "revenue_reports") &&
    (permissions.includes("reports") || permissions.some((p) => p.startsWith("reports:")))
  ) return true

  // Administration
  if (targetModule === "admin") return isSuperAdmin

  // Check parent nav item as a catch-all
  const parentNav = NAV.find(
    (n) => n.key === targetModule || n.children?.some((c) => c.key === targetModule)
  )
  if (parentNav && parentNav.key !== "hrms" && parentNav.key !== "admin") {
    if (
      permissions.includes(parentNav.key) ||
      permissions.some((p) => p.startsWith(parentNav.key + ":") || p.startsWith(parentNav.key + "."))
    ) {
      return true
    }
  }

  return false
}

function getFirstAllowedModule(
  role: string,
  permissions: string[] = [],
  staff?: StaffProfile,
): Module {
  for (const item of NAV) {
    if (item.key === "admin" && role !== "ROLE_ADMIN" && !permissions.includes("admin")) continue
    if (isModuleAccessible(item.key, role, permissions, staff)) {
      return item.key
    }
    if (item.children) {
      for (const child of item.children) {
        if (isModuleAccessible(child.key, role, permissions, staff)) {
          return child.key
        }
      }
    }
  }
  return "dashboard"
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)

  const [userRole, setUserRole] = useState<string>("ROLE_ADMIN")

  const [userPermissions, setUserPermissions] = useState<string[]>([])

  const [activeStaff, setActiveStaff] = useState<StaffProfile>(DEFAULT_STAFF)

  // Set when a physician signs in: their portal is scoped to this one doctor.
  const [activeDoctor, setActiveDoctor] = useState<DoctorAccount | null>(null)
  // Set when a super admin inspects a specific doctor workspace from the complete overview
  const [adminInspectingDoctor, setAdminInspectingDoctor] = useState<DoctorAccount | null>(null)
  const [adminDoctorView, setAdminDoctorView] = useState<"workspace" | "overview">("workspace")

  const [roleMenuOpen, setRoleMenuOpen] = useState(false)

  const [notice, setNotice] = useState<Notice | null>(null)

  const stableSetNotice = useCallback((n: Notice | null) => setNotice(n), [])

  const [module, setModule] = useState<Module>("dashboard")

  // Insurance pages link to one another by case, e.g. a query row -> its claim.
  const [insuranceCaseId, setInsuranceCaseId] = useState<string | undefined>()
  // Which Master Setup tab to open when navigating there (insurers by default).
  const [mastersSection, setMastersSection] = useState<"insurers" | "tpas" | "packages" | "pricing" | "docrules">("insurers")
  const openInsurance = (m: string, caseId?: string) => {
    setInsuranceCaseId(caseId)
    setModule(insuranceModule(m) as Module)
  }

  // Set alongside setModule("chart") when another page (e.g. a bed card's

  // patient name) wants Patient Chart to open directly on that patient

  // instead of its own directory.

  const [clinicalPatientId, setClinicalPatientId] = useState<string | null>(
    null,
  )
  const [scannedJourneyEncounter, setScannedJourneyEncounter] = useState<DBOPEncounter | null>(null)

  const openPatientClinical = (patientId: string) => {
    setClinicalPatientId(patientId)

    setModule("chart")
  }

  const [expanded, setExpanded] = useState<string[]>([])
  const [expandedReportGroups, setExpandedReportGroups] = useState<string[]>([
    "General Reports",
  ])
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [showAllDepartments, setShowAllDepartments] = useState<boolean>(true)
  const [radiologyStudyId, setRadiologyStudyId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("hospai_active_radiology_study_id")
    } catch {
      return null
    }
  })
  const [subBadges, setSubBadges] = useState<Record<string, number>>({})

  // Bumped whenever the doctor inbox or the lab-order queue changes, so the

  // sidebar counts move without waiting for the next navigation.

  const [badgeTick, setBadgeTick] = useState(0)

  useEffect(
    () => DoctorPortalDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  useEffect(
    () => LabOrderDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  useEffect(
    () => LabInventoryDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  useEffect(
    () => PharmacyDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  // Below lg (phones, portrait tablets) the sidebar is an off-canvas drawer:
  // a fixed 288px column would leave a phone ~90px for the page itself. On
  // small laptops (lg..xl) it starts as the icon rail so the page keeps most
  // of the width; the toggle still expands it.
  const isCompactViewport = useMediaQuery("(max-width: 1023px)")
  const isNarrowLaptop = useMediaQuery("(max-width: 1279px)")

  const [sidebarCollapsed, setSidebarCollapsed] = useState(isNarrowLaptop)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setSidebarCollapsed(isNarrowLaptop)
  }, [isNarrowLaptop])

  useEffect(() => {
    if (!sidebarCollapsed) {
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current)
        hoverLeaveTimerRef.current = null
      }
      setSidebarHovered(false)
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
    }
  }, [])

  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!isCompactViewport) setMobileNavOpen(false)
  }, [isCompactViewport])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileNavOpen])

  // The drawer shows full labels; the icon rail only exists on wide screens.
  // When closed, moving cursor to the sidebar opens it completely; removing cursor closes it.
  const isHoverExpanded = sidebarCollapsed && sidebarHovered && !isCompactViewport
  const railCollapsed = sidebarCollapsed && !sidebarHovered && !isCompactViewport
  const isSidebarOpen = isCompactViewport ? mobileNavOpen : !railCollapsed

  const handleSidebarMouseEnter = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    if (sidebarCollapsed && !isCompactViewport) {
      setSidebarHovered(true)
    }
  }

  const handleSidebarMouseLeave = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
    }
    // Smooth grace window (200ms) before slow, smooth collapse
    hoverLeaveTimerRef.current = setTimeout(() => {
      setSidebarHovered(false)
      hoverLeaveTimerRef.current = null
    }, 200)
  }

  // Picking a page from the drawer should reveal the page, not leave the menu
  // covering it. Expanding a parent group does not close it.
  const closeMobileNav = () => {
    if (isCompactViewport) setMobileNavOpen(false)
  }

  // Keppler OCR is a whole separate React app in an iframe: unmounting it on

  // every nav away means re-downloading its module graph and re-running its

  // silent sign-in on every return (~3s cold). Mount it once, then just hide

  // it, so going back is instant.

  const [ocrMounted, setOcrMounted] = useState(false)

  useEffect(() => {
    if (module === "dpi_ocr") setOcrMounted(true)
  }, [module])

  const mainRef = useRef<HTMLElement>(null)

  // Automatically scroll workspace to top whenever opening or switching modules/reports
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [module])

  const [orderOpen, setOrderOpen] = useState(false)

  const [cmdOpen, setCmdOpen] = useState(false)

  const [notifOpen, setNotifOpen] = useState(false)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(3)
  const [globalApplyLeaveOpen, setGlobalApplyLeaveOpen] = useState(false)

  const [globalSearch, setGlobalSearch] = useState("")

  const [isFullscreen, setIsFullscreen] = useState(false)

  const [zoomLevel, setZoomLevel] = useState(() => {
    // Persisted so a chosen text size survives a reload; storage can throw in

    // private windows, and a bad/stale value must not scale the whole app.

    try {
      const saved = parseFloat(localStorage.getItem("hms.zoomLevel") ?? "")

      if (Number.isFinite(saved)) return Math.min(1.2, Math.max(0.7, saved))
    } catch { }

    return 1
  })

  useEffect(() => {
    try {
      localStorage.setItem("hms.zoomLevel", String(zoomLevel))
    } catch { }
  }, [zoomLevel])

  const [newMenuOpen, setNewMenuOpen] = useState(false)

  const [workflowInitialStep, setWorkflowInitialStep] = useState<number>(2)

  const [selectedWorkflowEncounterId, setSelectedWorkflowEncounterId] =
    useState<string | undefined>()

  const [selectedTriageVisitId, setSelectedTriageVisitId] =
    useState<number | null>(null)

  const isNurse = userRole === "rn"

  /**
   * Whether this user may open a clinical consultation screen at all.
   *
   * The sidebar is already filtered by permission, but the OP screens also carry
   * their own "View in Doctor Portal" / "Doctor Portal ➔" buttons, and those
   * bypassed the nav entirely: a receptionist clicking one was bounced to the
   * dashboard by the route guard below with no explanation. Reception books the
   * appointment and takes payment -- the consultation is not theirs to open --
   * so the entry points are withheld rather than left to fail.
   */

  const roleIdUpper = (userRole || "").toUpperCase()
  const isSuperAdminUser =
    userRole === "ROLE_ADMIN" ||
    userRole === "ROLE_SUPERADMIN" ||
    userRole === "admin" ||
    activeStaff?.id === "ADM-001" ||
    activeStaff?.role === "ROLE_ADMIN" ||
    userPermissions.includes("*") ||
    userPermissions.includes("admin")

  const isDoctorUser =
    Boolean(activeDoctor) ||
    userRole === "ROLE_DOCTOR" ||
    Boolean(
      userRole &&
        (roleIdUpper.includes("DOCTOR") ||
          roleIdUpper.includes("SURGEON") ||
          roleIdUpper.includes("PHYSICIAN") ||
          roleIdUpper.includes("CLINICIAN")),
    )

  const canOpenConsultation = isDoctorUser || isSuperAdminUser

  // Check route access
  useEffect(() => {
    if (!loggedIn) return
    if (isSuperAdminUser) return

    // If all departments are visible in the sidebar, restricted modules are handled
    // in-place by DepartmentAccessDenied rather than bouncing the user back.
    if (showAllDepartments) return

    // If restricted departments are hidden, redirect unauthorized routes to first allowed module
    if (!isModuleAccessible(module, userRole, userPermissions, activeStaff)) {
      const fallback = getFirstAllowedModule(userRole, userPermissions, activeStaff)
      if (fallback !== module) {
        setModule(fallback)
      }
    }
  }, [module, loggedIn, userPermissions, userRole, showAllDepartments, activeStaff])

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" })
    } catch (error) {
      // Clear the local UI state even if the session has already expired. The
      // server remains the source of truth and will reject the old cookie.
      console.warn("Logout request failed", error)
    } finally {
      setRoleMenuOpen(false)
      setActiveDoctor(null)
      setAdminInspectingDoctor(null)
      setAppSessionAuthenticated(false)
      setLoggedIn(false)
    }
  }

  const handleLogin = (userData: LoginUserData) => {
    setAdminInspectingDoctor(null)
    setAppSessionAuthenticated(true)
    setUserRole(userData.role)
    const resolvedDoctor = resolveDoctorAccount({
      doctorId: userData.doctorId,
      username: userData.user,
      name: userData.staffName || userData.user,
      specialty: userData.staffDepartment,
      department: userData.staffDepartment,
    })

    const roleIdUpper = (userData.role || "").toUpperCase()
    const userRoleKey = userData.user.trim().toLowerCase()

    const isDoctor =
      roleIdUpper === "ROLE_DOCTOR" ||
      roleIdUpper.includes("DOCTOR") ||
      roleIdUpper.includes("SURGEON") ||
      roleIdUpper.includes("PHYSICIAN") ||
      roleIdUpper.includes("CLINICIAN") ||
      Boolean(userData.doctorId) ||
      userRoleKey.startsWith("doctor") ||
      userRoleKey.startsWith("doc") ||
      (userData.staffName || "").toLowerCase().startsWith("dr.") ||
      Boolean(
        resolvedDoctor &&
          (resolvedDoctor.username.toLowerCase() === userRoleKey ||
            resolvedDoctor.id.toLowerCase() === userRoleKey ||
            resolvedDoctor.staffId.toLowerCase() === userRoleKey),
      )

    const doctor = isDoctor ? resolvedDoctor : null
    setActiveDoctor(doctor)

    const effectivePermissions = [...userData.permissions]
    if (doctor && !effectivePermissions.includes("doctor_portal")) {
      effectivePermissions.push("doctor_portal")
    }
    setUserPermissions(effectivePermissions)

    if (doctor) {
      setActiveStaff({
        id: doctor.staffId,
        name: doctor.name,
        role: userData.role || "ROLE_DOCTOR",
        title: doctor.qualification || "Consultant Physician",
        department: `${doctor.specialty} · ${doctor.room}`,
      })
    } else if (userData.staffName) {
      setActiveStaff({
        id: userData.staffId,
        name: userData.staffName,
        role: userData.role,
        title: userData.staffTitle || "Hospital Staff",
        department: userData.staffDepartment || "Clinical Operations",
      })
    } else {
      setActiveStaff(getRoleProfile(userData.role, userData.user))
    }

    let defaultModule: Module = "dashboard"

    const isSuperAdminAccount =
      roleIdUpper === "ROLE_ADMIN" ||
      roleIdUpper === "ROLE_SUPERADMIN" ||
      userRoleKey === "admin" ||
      userRoleKey.includes("admin") ||
      userData.staffId === "ADM-001" ||
      userData.permissions.includes("admin") ||
      userData.permissions.includes("*")

    if (isSuperAdminAccount) {
      defaultModule = "admin"
    } else if (
      doctor ||
      roleIdUpper.includes("DOCTOR") ||
      roleIdUpper.includes("PHYSICIAN") ||
      roleIdUpper.includes("SURGEON") ||
      roleIdUpper.includes("CLINICIAN")
    ) {
      defaultModule = "doctor_portal"
    } else if (roleIdUpper.includes("NURSE") || userRoleKey === "nurse") {
      defaultModule = "nursing"
    } else if (roleIdUpper.includes("PHARMAC") || userRoleKey === "pharmacy") {
      defaultModule = "pharmacy"
    } else if (roleIdUpper.includes("LAB") || userRoleKey === "lab") {
      defaultModule = "laboratory"
    } else if (roleIdUpper.includes("RECEPT") || userRoleKey === "reception" || roleIdUpper.includes("FRONT_DESK")) {
      defaultModule = "op_management"
    } else if (roleIdUpper.includes("BILLING") || userRoleKey === "billing") {
      defaultModule = "billing"
    } else if (roleIdUpper.includes("INSURANCE") || userRoleKey === "insurance") {
      defaultModule = "insurance"
    } else if (roleIdUpper.includes("FINANCE") || roleIdUpper.includes("ACCOUNT") || userRoleKey === "finance" || userRoleKey === "accountant") {
      defaultModule = "accounts"
    } else if (roleIdUpper.includes("HR") || userRoleKey === "hr") {
      defaultModule = "hrms"
    } else if (roleIdUpper.includes("RADIOL")) {
      defaultModule = "radiology"
    }

    // If the default module is not in the granted permissions, fallback to the first allowed module
    if (!isSuperAdminAccount && !isModuleAccessible(defaultModule, userData.role, userData.permissions, activeStaff)) {
      defaultModule = getFirstAllowedModule(userData.role, userData.permissions, activeStaff)
    }

    setLoggedIn(true)
    setModule(defaultModule)

    // Signed in from a scanned patient card: go straight to that patient.
    try {
      const pending = sessionStorage.getItem("hospai_pending_patient_page")
      if (pending) {
        sessionStorage.removeItem("hospai_pending_patient_page")
        window.location.hash = `#/patient/${encodeURIComponent(pending)}`
      }
    } catch { }
  }

  // A browser cache must never be sufficient to restore a signed-in user.
  // Ask the server to validate the HttpOnly session cookie on every app load.
  useEffect(() => {
    let cancelled = false
    const restoreSession = async () => {
      try {
        const response = await apiFetch<{ user: AuthenticatedUser | null }>(
          "/api/auth/session",
        )
        if (!cancelled && response.user) {
          handleLogin(loginUserFromAuthenticated(response.user))
        }
      } catch (error) {
        // Network and expired-session failures both leave the user at Login;
        // apiFetch deliberately has no local-auth fallback.
        console.warn("Unable to restore authenticated session", error)
      }
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {
          setIsFullscreen((prev) => !prev)
        })
    } else {
      if (document.exitFullscreen) {
        document
          .exitFullscreen()
          .then(() => setIsFullscreen(false))
          .catch(() => {
            setIsFullscreen(false)
          })
      }
    }
  }

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  // Global Shortcuts (Ctrl+K, F11, ?, Esc)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)

      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setCmdOpen(true)
        return
      }

      if (e.key === "F11") {
        e.preventDefault()
        toggleFullscreen()
        return
      }

      if (e.key === "Escape") {
        setCmdOpen(false)
      }
    }

    window.addEventListener("keydown", h)

    return () => window.removeEventListener("keydown", h)
  }, [])

  const [subModule, setSubModule] = useState<string | undefined>(undefined)

  // Any module (patient chart, admissions, ER, OT, discharge, bed board) can
  // open an insurance page on a case without threading a prop down to it.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ module: string; caseId?: string; section?: typeof mastersSection }>).detail
      if (!d?.module) return
      setInsuranceCaseId(d.caseId)
      if (d.section) setMastersSection(d.section)
      if (d.caseId && (d.module === "insurance" || d.module === "insurance_case" || d.module === "insurance_claims")) {
        setModule("insurance_case")
      } else if (d.module === "insurance_preauth") {
        setModule("insurance_preauth")
      } else {
        setModule(insuranceModule(d.module) as Module)
      }
    }
    const onNavigateGlobal = (e: Event) => {
      const d = (e as CustomEvent<{ module: string }>).detail
      if (d && d.module) {
        setModule(d.module as Module)
      }
    }
    window.addEventListener("hms:navigate", onNavigateGlobal)
    window.addEventListener("hms:open-insurance", onOpen)
    return () => {
      window.removeEventListener("hms:navigate", onNavigateGlobal)
      window.removeEventListener("hms:open-insurance", onOpen)
    }
  }, [])

  const navigate = (m: string, sub?: string) => {
    setModule(m as Module)
    setSubModule(sub)

    if (sub === "register") setModule("register")

    setCmdOpen(false)
  }

  // Counts on the nav itself, so a pharmacist sees what needs attention without opening each page.

  // Recomputed whenever the module changes, which is also when pharmacy data has just been written.

  useEffect(() => {
    if (!loggedIn) return

    try {
      const prescriptions = PharmacyDatabase.getPrescriptions()

      const batches = PharmacyDatabase.getBatches()

      const medicines = PharmacyDatabase.getMedicines()

      const active = batches.filter((b) => b.availableQuantity > 0)

      const expiringSoon = active.filter((b) => {
        const days = Math.ceil(
          (new Date(b.expiryDate).getTime() - Date.now()) / 86400000,
        )

        return days <= 90
      }).length

      const lowStock = medicines.filter(
        (m) =>
          batches
            .filter((b) => b.medicineId === m.id)
            .reduce((a, b) => a + b.availableQuantity, 0) <= m.reorderLevel,
      ).length

      // Merged in, not a full replace -- a separate effect owns the
      // "emergency" key (live ER visit count, polled from the backend) and
      // would get wiped out every time this effect re-runs otherwise.
      setSubBadges((prev) => ({
        ...prev,
        doctor_portal: activeDoctor
          ? DoctorPortalDatabase.getUnreadCount(activeDoctor.id)
          : 0,

        laboratory: 0,
        lab_orders_collection: LabOrderDatabase.getLabWorklist().filter(
          (o) => o.billing.status === "Paid" && o.status === "Billed",
        ).length,
        lab_workbench: LabOrderDatabase.getLabWorklist().filter(
          (o) => (o.status === "Sample Collected" || o.status === "In Progress"),
        ).length,
        lab_sample_collection: LabOrderDatabase.getLabWorklist().filter(
          (o) => o.billing.status === "Paid" && o.status === "Billed",
        ).length,
        lab_processing: LabOrderDatabase.getLabWorklist().filter(
          (o) => (o.status === "Sample Collected" || o.status === "In Progress"),
        ).length,
        lab_critical: LabOrderDatabase.getLabWorklist().filter((o) =>
          o.tests.some(
            (t) =>
              t.flag === "Critical" ||
              Object.values(t.results || {}).some((r) => r.flag === "Critical"),
          ),
        ).length,
        lab_reports: 0,
        lab_catalog: 0,
        lab_inventory: LabInventoryDatabase.getItems().filter(
          (i) => i.status === "Low Stock" || i.status === "Expiring Soon" || i.status === "Expired"
        ).length,
        lab_analytics: 0,
        lab_tat: 0,

        // Shared helper, not a list kept here: this badge omitted "Sent To Pharmacy"

        // -- the status the doctor portal dispatches with -- so a prescription sat

        pharmacy_rx: prescriptions.filter((p) =>
          isAwaitingVerification(p.status),
        ).length,
        pharmacy_dispensing: prescriptions.filter(
          (p) =>
            p.status === "Verified" ||
            p.status === "Approved" ||
            p.status === "Preparing" ||
            p.status === "Ready For Dispensing",
        ).length,

        pharmacy_expiry: expiringSoon,

        pharmacy_medicine: lowStock,
        radiology_worklist: RadiologyWorkflowDb.getStudies().length,
        radiology_operations: RadiologyWorkflowDb.getStudies().filter((s) => s.normalizedStatus === "IN PROGRESS").length,
        radiology_reporting: RadiologyWorkflowDb.getStudies().filter((s) => s.normalizedStatus === "DONE" && s.normalizedReportStatus !== "Finalized").length,
        radiology_reports: RadiologyWorkflowDb.getStudies().filter((s) => s.normalizedReportStatus === "Finalized").length,
      }))
    } catch {
      setSubBadges((prev) => ({
        ...prev,
        doctor_portal: 0,
        laboratory: 0,
        lab_sample_collection: 0,
        lab_processing: 0,
        lab_critical: 0,
        lab_reports: 0,
        lab_catalog: 0,
        lab_inventory: 0,
        lab_analytics: 0,
        lab_tat: 0,
        pharmacy_rx: 0,
        pharmacy_dispensing: 0,
        pharmacy_expiry: 0,
        pharmacy_medicine: 0,
        radiology_worklist: 0,
        radiology_operations: 0,
        radiology_reporting: 0,
        radiology_reports: 0,
      }))
    }
  }, [module, loggedIn, badgeTick, activeDoctor])

  // Emergency's nav badge is a live count of active ER visits, and Bed
  // Management's is pending ER bed requests -- both polled from the real
  // backend, unlike the pharmacy/lab/doctor-portal badges above, which read
  // from an in-memory local store. Triage doesn't get its own badge: it's a
  // child of Emergency now, and child badges sum onto the parent's, so a
  // separate "needs triage" count here would double-count against
  // `emergency`'s total-active count instead of adding real information.
  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    const fetchEmergencyCount = async () => {
      try {
        const data = await apiFetch<{ visits: unknown[] }>(
          "/api/er/visits?active_only=true",
        )
        if (!cancelled) {
          setSubBadges((prev) => ({
            ...prev,
            emergency: (data.visits || []).length,
          }))
        }
      } catch {
        // best effort -- picked up again on the next poll tick
      }
      try {
        const bedReqData = await apiFetch<{ bed_requests: unknown[] }>(
          "/api/er/bed-requests?status=pending",
        )
        if (!cancelled) {
          setSubBadges((prev) => ({
            ...prev,
            beds: (bedReqData.bed_requests || []).length,
          }))
        }
      } catch {
        // best effort -- picked up again on the next poll tick; a role
        // without beds.read just never gets this badge, which is fine
      }
    }
    void fetchEmergencyCount()
    const interval = window.setInterval(fetchEmergencyCount, 20000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loggedIn])

  // Landing on a sub-module from anywhere but the sidebar (command palette, a shortcut button)

  // should still reveal where you are in the tree.

  useEffect(() => {
    const parent = NAV.find((n) =>
      n.children?.some((c) => c.key === module && c.key !== n.key),
    )

    if (!parent) return

    setExpanded((prev) =>
      prev.includes(parent.key) ? prev : [...prev, parent.key],
    )

    if (parent.key === "reports") {
      const child = parent.children?.find((c) => c.key === module)

      if (child?.group) {
        const grp = child.group

        setExpandedReportGroups((prev) =>
          prev.includes(grp) ? prev : [...prev, grp],
        )
      }
    }
  }, [module])

  const toggleExpand = (key: string) => {
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  const toggleReportGroup = (group: string) => {
    setExpandedReportGroups((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
    )
  }

  return (
    <div
      className="flex flex-col overflow-hidden bg-[#F0F2F5]"
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        // dvh, not vh: on phones vh includes the area under the browser's
        // toolbar, which pushed the bottom of every page out of reach.
        height: `${100 / zoomLevel}dvh`,
        width: `${100 / zoomLevel}vw`,
        zoom: zoomLevel,
      }}
    >
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
      {!loggedIn ? (
        <Login onLogin={handleLogin} />
      ) : (
        <>
          {/* OP card scans (hardware scanner or "Open journey" on a card)
              open the patient's OP or IP journey from any screen. */}
          <JourneyScanHost
            onOpenJourney={(codeOrEnc) => {
              if (codeOrEnc && typeof codeOrEnc === "object" && codeOrEnc.id) {
                setScannedJourneyEncounter(codeOrEnc)
              } else if (typeof codeOrEnc === "string") {
                const normalized = codeOrEnc.toUpperCase().trim()
                const match = db.getEncounters().find(
                  (e) =>
                    (e.umr && e.umr.toUpperCase().trim() === normalized) ||
                    (e.opNumber && e.opNumber.toUpperCase().trim() === normalized) ||
                    e.id === codeOrEnc,
                )
                if (match) {
                  setScannedJourneyEncounter(match)
                } else {
                  const pat = db.getPatientByUmr(normalized)
                  if (pat) {
                    const fallbackEnc: DBOPEncounter = {
                      id: `ENC-${pat.umr}`,
                      umr: pat.umr,
                      opNumber: "OP",
                      patientName: pat.name,
                      age:
                        typeof pat.age === "number"
                          ? pat.age
                          : parseInt(String(pat.age || 0)) || 0,
                      sex: (pat.sex as any) || "Male",
                      phone: pat.phone || "",
                      address: pat.address || "",
                      dept: "General Medicine",
                      assignedDoctor: "",
                      status: "Registered",
                      isNew: false,
                      bloodGroup: pat.bloodGroup,
                    }
                    setScannedJourneyEncounter(fallbackEnc)
                  } else {
                    window.open(patientPageUrl(codeOrEnc), "_blank")
                  }
                }
              }
            }}
          />

          {/* Quick OP Card & Clinical Journey Scanner Modal */}
          {scannedJourneyEncounter && (
            <PatientJourneyModal
              encounter={scannedJourneyEncounter}
              onClose={() => setScannedJourneyEncounter(null)}
              onNavigateToDoctorPortal={(encId) => {
                setSelectedDoctorEncounterId(encId)
                setModule("doctor")
              }}
              onNavigateToOPWorkflow={(encId, step) => {
                setSelectedWorkflowEncounterId(encId)
                setWorkflowInitialStep(step ?? 1)
                setModule("op_workflow")
              }}
            />
          )}
          {/* ── Top Header ───────────────────────────────────────────────── */}
          <header className="bg-[#0C1524] border-b border-[#1E2D42] h-12 flex items-center gap-1.5 sm:gap-3 px-2 sm:px-3.5 flex-shrink-0 z-40 text-slate-200 shadow-sm">
            {/* Sidebar toggle */}
            <button
              data-sidebar-toggle
              onClick={() => {
                if (hoverLeaveTimerRef.current) {
                  clearTimeout(hoverLeaveTimerRef.current)
                  hoverLeaveTimerRef.current = null
                }
                setSidebarHovered(false)
                if (isCompactViewport) {
                  setMobileNavOpen((o) => !o)
                } else {
                  setSidebarCollapsed((c) => !c)
                }
              }}
              className="group w-8 h-8 flex-shrink-0 flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors rounded-lg hover:bg-white/10 cursor-pointer"
              title={
                isCompactViewport
                  ? mobileNavOpen
                    ? "Close menu"
                    : "Open menu"
                  : !railCollapsed
                    ? "Collapse sidebar"
                    : "Expand sidebar"
              }
              aria-label="Toggle navigation menu"
              aria-expanded={isSidebarOpen}
            >
              {/* Smooth animated hamburger icon morphing between 3-bar menu and left arrow */}
              <div className="w-[18px] h-[18px] relative flex flex-col justify-center items-center pointer-events-none group-hover:scale-105 transition-transform duration-200">
                {/* Top bar */}
                <span
                  className="absolute h-[1.6px] bg-current rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: isSidebarOpen ? "9px" : "14px",
                    left: "2px",
                    top: isSidebarOpen ? "8.2px" : "4px",
                    transformOrigin: "2px 50%",
                    transform: isSidebarOpen ? "rotate(-45deg)" : "none",
                  }}
                />
                {/* Middle bar */}
                <span
                  className="absolute h-[1.6px] bg-current rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: "14px",
                    left: "2px",
                    top: "8.2px",
                  }}
                />
                {/* Bottom bar */}
                <span
                  className="absolute h-[1.6px] bg-current rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: isSidebarOpen ? "9px" : "14px",
                    left: "2px",
                    top: isSidebarOpen ? "8.2px" : "12.4px",
                    transformOrigin: "2px 50%",
                    transform: isSidebarOpen ? "rotate(45deg)" : "none",
                  }}
                />
              </div>
            </button>

            {/* Top Middle: Search bar + New button */}
            <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 sm:gap-2.5 px-0 sm:px-3 max-w-2xl mx-auto">
              {/* Global Search */}
              <div className="w-full min-w-0 max-w-[420px] group">
                <button
                  onClick={() => setCmdOpen(true)}
                  aria-label="Search"
                  className="w-full relative flex items-center h-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-left text-[12.5px] text-[#94A3B8] transition-all overflow-hidden cursor-pointer"
                >
                  <span className="absolute left-2.5 text-[#64748B] group-hover:text-blue-400 transition-colors">
                    <Icon.Search />
                  </span>
                  <span className="pl-9 pr-2 md:pr-16 flex-1 truncate text-[#94A3B8]">
                    <span className="sm:hidden">Search…</span>
                    <span className="hidden sm:inline">
                      Search patients, MRN, appointments, reports...
                    </span>
                  </span>
                  <div className="absolute right-2 hidden md:flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <kbd className="bg-black/40 border border-white/10 text-white text-[9.5px] px-1.5 py-0.5 rounded font-mono">
                      Ctrl
                    </kbd>
                    <kbd className="bg-black/40 border border-white/10 text-white text-[9.5px] px-1.5 py-0.5 rounded font-mono">
                      K
                    </kbd>
                  </div>
                </button>
              </div>

              {/* Quick Create + New */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setNewMenuOpen((o) => !o)}
                  aria-label="New"
                  className="flex items-center gap-1.5 h-8 px-2 sm:px-3 bg-[#1B68F8] hover:bg-blue-600 rounded-lg text-white text-[12px] font-semibold transition-colors shadow-xs cursor-pointer"
                >
                  <Icon.Plus /> <span className="hidden sm:inline">New</span>
                </button>
                {newMenuOpen && (
                  <div className="absolute top-full right-0 sm:right-auto sm:left-0 mt-1 w-48 bg-[#0F172A] border border-[#1E2D42] rounded-lg shadow-xl z-50 py-1 text-slate-200">
                    <button
                      onClick={() => {
                        setModule("register")
                        setNewMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-1.5 text-[12px] hover:bg-white/5 text-slate-200"
                    >
                      New Patient
                    </button>
                    <button
                      onClick={() => {
                        setModule("appointments")
                        setNewMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-1.5 text-[12px] hover:bg-white/5 text-slate-200"
                    >
                      New Appointment
                    </button>
                    <button
                      onClick={() => {
                        setModule("chart")
                        setOrderOpen(true)
                        setNewMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-1.5 text-[12px] hover:bg-white/5 text-slate-200"
                    >
                      New Order
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1.5 ml-auto flex-shrink-0">
              {/* Text Size Zoom Controls -- pinch-zoom covers this on phones */}
              <div
                className="hidden md:flex items-center gap-1 px-1.5 py-1 bg-white/[0.04] hover:bg-white/[0.07] border border-[#1E2D42] rounded-lg transition-colors mr-1"
                title={`Text Size Zoom (Current scale: ${Math.round(zoomLevel * 100)}%)`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10))
                  }
                  title="Decrease text size (A-)"
                  className="px-2 py-0.5 bg-white/10 hover:bg-blue-600 text-slate-200 hover:text-white rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border border-white/10 hover:border-blue-500 active:scale-95"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  title={zoomLevel === 1 ? "Scale is 100%" : "Reset text size to 100%"}
                  className="px-2 py-0.5 bg-white/10 hover:bg-slate-700 text-slate-200 hover:text-white rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border border-white/10 hover:border-slate-500 active:scale-95"
                >
                  {Math.round(zoomLevel * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((z) => Math.min(1.3, Math.round((z + 0.1) * 10) / 10))
                  }
                  title="Increase text size (A+)"
                  className="px-2 py-0.5 bg-white/10 hover:bg-blue-600 text-slate-200 hover:text-white rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border border-white/10 hover:border-blue-500 active:scale-95"
                >
                  A+
                </button>
              </div>

              {/* Notifications */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen((n) => !n)}
                  className="relative w-8 h-8 flex items-center justify-center text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title="Notifications"
                >
                  <Icon.Bell />
                  <span className="absolute top-0.5 right-0.5 w-3 h-3 bg-[#DC2626] rounded-full text-[8px] text-white font-bold flex items-center justify-center">
                    1
                  </span>
                </button>
                {notifOpen && (
                  <NotificationPanel
                    onClose={() => setNotifOpen(false)}
                    onNavigate={(m, s) => navigate(m, s)}
                  />
                )}
              </div>

              {/* Messages */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMessagesOpen((m) => !m)}
                  className="relative w-8 h-8 flex items-center justify-center text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title="Staff Messages & Clinical Handovers"
                >
                  <Icon.Message />
                  {messagesUnreadCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 w-3 h-3 bg-[#16A34A] rounded-full text-[8px] text-white font-bold flex items-center justify-center">
                      {messagesUnreadCount}
                    </span>
                  )}
                </button>
                {messagesOpen && (
                  <MessagesPanel
                    onClose={() => setMessagesOpen(false)}
                    onNavigate={(m, s) => navigate(m, s)}
                    onUnreadChange={(count) => setMessagesUnreadCount(count)}
                  />
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="hidden md:flex w-8 h-8 items-center justify-center text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? <Icon.Minimize /> : <Icon.Maximize />}
              </button>

              {/* Role Switcher / User Profile */}
              <div className="relative ml-0.5 sm:ml-1 pl-1 sm:pl-2.5 border-l border-[#1E2D42]">
                <button
                  onClick={() => setRoleMenuOpen(!roleMenuOpen)}
                  className="flex items-center gap-2 text-left hover:bg-white/5 p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-full bg-[#1E293B] border border-white/15 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 shadow-2xs">
                    {activeStaff.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2) || "SA"}
                  </div>
                  <div className="hidden lg:block">
                    <div className="text-xs font-bold text-white leading-tight">
                      {activeStaff.name || "System Administrator"}
                    </div>
                    <div className="text-[10px] text-[#94A3B8] font-medium">
                      {activeStaff.title || "Hospital Administrator"}
                    </div>
                  </div>
                </button>

                {roleMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto bg-white border border-[#CBD5E1] shadow-2xl rounded-none z-50 p-2 text-[12px] space-y-1">
                    <div className="px-2 py-1 text-[10px] font-bold text-[#64748B] uppercase tracking-wider border-b border-[#E2E8F0]">
                      Assigned access
                    </div>
                    {[{ id: userRole, name: activeStaff.title || "Assigned role", allowedModules: ALL_SYSTEM_MODULES }].map((r) => {
                      const permissions = r.allowedModules || ALL_SYSTEM_MODULES

                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRoleMenuOpen(false)}
                          className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between transition-colors cursor-pointer ${userRole === r.id
                            ? "bg-[#EFF6FF] text-[#1B4FD8] font-bold"
                            : "hover:bg-[#F8FAFC] text-[#334155]"
                            }`}
                        >
                          <span className="flex items-center gap-2">
                            <span>🛡️</span>
                            <span>{r.name}</span>
                          </span>
                          {userRole === r.id && (
                            <span className="text-[10px] text-[#15803D]">
                              ● Active
                            </span>
                          )}
                        </button>
                      )
                    })}
                    <div className="border-t border-[#E2E8F0] pt-1 mt-1">
                      {(userRole === "ROLE_ADMIN" || userRole === "admin" || activeStaff?.id === "ADM-001" || userPermissions.includes("admin") || userPermissions.includes("*")) && (
                        <button
                          type="button"
                          onClick={() => {
                            setRoleMenuOpen(false)
                            setModule("admin")
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-[11px] text-[#1B4FD8] hover:bg-blue-50 font-bold rounded transition-colors flex items-center gap-2 cursor-pointer mb-1"
                        >
                          <span>⚙️</span>
                          <span>Administration &amp; RBAC</span>
                        </button>
                      )}
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-2.5 py-1 text-[11px] text-[#B91C1C] hover:bg-red-50 font-semibold rounded transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {notice && (
            <div
              className={`px-4 py-2 text-[12.5px] font-medium flex items-center justify-between flex-shrink-0 ${notice.type === "error"
                ? "bg-red-50 text-red-800 border-b border-red-200"
                : notice.type === "success"
                  ? "bg-green-50 text-green-800 border-b border-green-200"
                  : "bg-blue-50 text-blue-800 border-b border-blue-200"
                }`}
            >
              <span>{notice.message}</span>
              <button className="underline" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">
            {/* ── Sidebar ──────────────────────────────────────────────── */}
            {/* Drawer backdrop (phones / portrait tablets) */}
            {isCompactViewport && mobileNavOpen && (
              <div
                className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px]"
                onClick={() => setMobileNavOpen(false)}
                aria-hidden="true"
              />
            )}
            <aside
              aria-label="Main navigation"
              onMouseEnter={handleSidebarMouseEnter}
              onMouseLeave={handleSidebarMouseLeave}
              className={`bg-[#0C1524] border-r border-[#1E2D42] flex-shrink-0 flex flex-col overflow-y-auto overscroll-contain transition-[width,box-shadow] duration-500 ease-in-out ${isCompactViewport
                ? `fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl transition-[transform,visibility] duration-300 ease-in-out ${mobileNavOpen ? "translate-x-0" : "-translate-x-full invisible"}`
                : `overflow-x-hidden ${railCollapsed ? "w-14" : "w-72"} ${isHoverExpanded ? "shadow-2xl shadow-black/50 z-20" : ""}`
                }`}
            >
              {/* Top Logo Section */}
              <div className="relative flex items-center justify-center py-3.5 px-3 border-b border-[#1E2D42]/80 flex-shrink-0 text-center w-full">
                {isCompactViewport && (
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="Close menu"
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/10 text-[18px] leading-none cursor-pointer"
                  >
                    ×
                  </button>
                )}
                {railCollapsed ? (
                  <HospAILogo variant="icon" className="w-10 h-10 mx-auto" />
                ) : (
                  <HospAILogo variant="horizontal" className="h-24 lg:h-40 w-full justify-center mx-auto" />
                )}
              </div>
              <div
                className={`flex-1 py-2 ${railCollapsed ? "px-1" : "px-2"}`}
              >
                {!railCollapsed && (
                  <div className="flex items-center justify-between px-2.5 py-1 mb-1.5 text-[11px] font-semibold text-slate-400 border-b border-[#1E2D42]/60 select-none">
                    <span className="uppercase tracking-wider text-[10px] text-slate-400">Departments</span>
                    <button
                      type="button"
                      onClick={() => setShowAllDepartments((prev) => !prev)}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                        showAllDepartments
                          ? "bg-blue-600/30 text-blue-300 border border-blue-500/40 hover:bg-blue-600/40"
                          : "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                      }`}
                      title={showAllDepartments ? "Showing all hospital departments. Click to show only your assigned workspaces." : "Showing assigned workspaces only. Click to show all hospital departments."}
                    >
                      <span>{showAllDepartments ? "All Depts" : "Assigned"}</span>
                      <span className="text-[10px]">{showAllDepartments ? "👁️" : "🔒"}</span>
                    </button>
                  </div>
                )}
                {NAV.map((item) => {
                  // Module-based Access Control Filtering
                  const isSuperAdmin =
                    userRole === "ROLE_ADMIN" ||
                    userRole === "ROLE_SUPERADMIN" ||
                    userRole === "admin" ||
                    activeStaff?.id === "ADM-001" ||
                    activeStaff?.role === "ROLE_ADMIN" ||
                    userPermissions.includes("*") ||
                    userPermissions.includes("admin")
                  const hasAccess =
                    isSuperAdmin ||
                    isModuleAccessible(item.key, userRole, userPermissions, activeStaff) ||
                    item.children?.some((c) => isModuleAccessible(c.key, userRole, userPermissions, activeStaff))

                  // Strictly restrict Doctor Workspace: ONLY doctors, authorized oversight managers, and super admin can view and access that!
                  if (item.key === "doctor_portal" && !isSuperAdminUser && !isDoctorUser && !userPermissions.includes("doctors_overview")) {
                    return null
                  }

                  if (!hasAccess && !showAllDepartments) return null

                  // Sub-items inherit the parent's access unless the role actually enumerates
                  // sub-module keys -- otherwise a role granted only "pharmacy" would collapse
                  // the whole Pharmacy tree down to its Dashboard entry.
                  const subModulesGranted = item.children?.some(
                    (c) =>
                      c.key !== item.key &&
                      (userPermissions.includes(c.key) ||
                        userPermissions.some((p) => p.startsWith(c.key + ":") || p.startsWith(c.key + "."))),
                  )

                  const filteredChildren = item.children?.filter((c) => {
                    if (isSuperAdmin) return true
                    // Strictly isolate HRMS from regular staff
                    if (item.key === "hrms") {
                      return (
                        userPermissions.includes("hrms") ||
                        userPermissions.includes(c.key) ||
                        userPermissions.some((p) => p.startsWith("hrms:") || p.startsWith(c.key + ":"))
                      )
                    }
                    return (
                      c.key === item.key ||
                      (item.key === "pharmacy" &&
                        (userPermissions.includes("pharmacy") ||
                          userPermissions.includes("pharmacy_rx") ||
                          userPermissions.includes("pharmacy_dispensing") ||
                          userPermissions.some((p) => p.startsWith("pharmacy:") || p.startsWith("pharmacy.")) ||
                          userPermissions.includes("ROLE_DOCTOR") ||
                          userPermissions.includes("ROLE_PHARMACIST") ||
                          userPermissions.includes("ROLE_PHARMACY"))) ||
                      (item.key === "reports" &&
                        (userPermissions.includes("reports") || userPermissions.some((p) => p.startsWith("reports:")))) ||
                      (item.key === "insurance" &&
                        (userPermissions.includes("insurance") || userPermissions.some((p) => p.startsWith("insurance:")))) ||
                      (item.key === "laboratory" &&
                        (userPermissions.includes("laboratory") || userPermissions.some((p) => p.startsWith("laboratory:")))) ||
                      (item.key === "radiology" &&
                        (userPermissions.includes("radiology") || userPermissions.some((p) => p.startsWith("radiology:")))) ||
                      (c.key === "pharmacy_write_off" &&
                        (userPermissions.includes("pharmacy") ||
                          userPermissions.includes("pharmacy_ledger") ||
                          userPermissions.includes("pharmacy_expiry"))) ||
                      !subModulesGranted ||
                      userPermissions.includes(c.key) ||
                      userPermissions.some((p) => p.startsWith(c.key + ":") || p.startsWith(c.key + "."))
                    )
                  })

                  const isActive =
                    module === item.key ||
                    (item.key === "laboratory" && (module === "laboratory" || module.startsWith("lab_"))) ||
                    (item.key === "radiology" && (module === "radiology" || module.startsWith("radiology_"))) ||
                    (item.key === "hrms" && (module === "hrms" || module === "employees" || module === "scheduling" || module.startsWith("hr_"))) ||
                    filteredChildren?.some((c) => c.key === module)

                  const isExpanded = expanded.includes(item.key)

                  const childBadgeTotal =
                    filteredChildren?.reduce(
                      (a, c) => a + (subBadges[c.key] || 0),
                      0,
                    ) || 0

                  const navBadge =
                    childBadgeTotal > 0
                      ? childBadgeTotal
                      : subBadges[item.key] || item.badge

                  return (
                    <div key={item.key} className="relative group">
                      <div
                        className={
                          railCollapsed
                            ? `w-10 h-10 mx-auto my-1 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150 relative ${isActive
                              ? "bg-[#1B4FD8] text-white shadow-md shadow-blue-500/25 ring-1 ring-blue-400/40"
                              : "hover:bg-white/10 text-white"
                            }`
                            : `nav-item ${isActive ? "active" : ""}`
                        }
                        onClick={() => {
                          if (!hasAccess) {
                            setInsuranceCaseId(undefined)
                            setModule(item.key)
                            closeMobileNav()
                            return
                          }
                          if (filteredChildren && filteredChildren.length > 0) {
                            if (railCollapsed) {
                              setInsuranceCaseId(undefined)
                              if (item.key === "intelligence") {
                                setModule("intelligence")
                              } else {
                                setModule(filteredChildren[0].key)
                              }
                            } else {
                              if (isActive) {
                                toggleExpand(item.key)
                              } else {
                                setInsuranceCaseId(undefined)
                                setExpanded((prev) => (prev.includes(item.key) ? prev : [...prev, item.key]))
                                if (item.key === "intelligence") {
                                  setModule("intelligence")
                                } else {
                                  setModule(filteredChildren[0].key)
                                }
                                closeMobileNav()
                              }
                            }
                          } else {
                            setInsuranceCaseId(undefined)
                            setModule(item.key)
                            closeMobileNav()
                          }
                        }}
                        title={railCollapsed ? item.label : undefined}
                      >
                        <item.Icon
                          size={railCollapsed ? 20 : 18}
                          className={`${railCollapsed
                            ? "w-5 h-5 flex-shrink-0"
                            : "w-4.5 h-4.5 mr-3 flex-shrink-0"
                            } nav-icon ${isActive ? "text-white" : !hasAccess ? "text-[#64748B] group-hover:text-slate-300" : "text-[#94A3B8] group-hover:text-white"}`}
                        />

                        {/* Collapsed Badge Dot */}
                        {railCollapsed && navBadge && !isActive && (
                          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#DC2626] border border-[#0C1524] rounded-full"></span>
                        )}

                        {/* Collapsed Hover Tooltip */}
                        {railCollapsed && !sidebarHovered && (
                          <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#0F172A] text-white text-[12px] font-semibold rounded-lg shadow-2xl border border-white/10 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 flex items-center gap-2">
                            <span>
                              {item.key === "doctor_portal"
                                ? isSuperAdminUser
                                  ? "Doctor Workspace & Hospital Oversight"
                                  : "My Doctor Workspace"
                                : item.label}
                            </span>
                            {!hasAccess && (
                              <span className="bg-amber-500/20 text-amber-300 text-[10px] font-semibold px-1.5 py-0.2 rounded border border-amber-500/30">
                                🔒 Restricted
                              </span>
                            )}
                            {navBadge && (
                              <span className="bg-[#DC2626] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                                {navBadge}
                              </span>
                            )}
                          </div>
                        )}

                        {!railCollapsed && (
                          <div className="flex-1 min-w-0 flex items-center justify-between sidebar-fade-in">
                            <span className={`flex-1 truncate ${!hasAccess ? "text-slate-400 group-hover:text-slate-200" : ""}`}>
                              {item.key === "doctor_portal" ? "Doctor Workspace" : item.label}
                            </span>
                            {!hasAccess ? (
                              <span className="text-[10px] bg-amber-500/15 text-amber-300/90 border border-amber-500/30 px-1.5 py-0.2 rounded flex items-center gap-1 font-normal ml-1 shrink-0">
                                <span>🔒</span>
                                <span>Restricted</span>
                              </span>
                            ) : (
                              <>
                                {Boolean(navBadge) && (
                                  <span
                                    className={`badge ${isActive ? "bg-white/20 text-white" : "bg-[#DC2626] text-white"} ml-1`}
                                  >
                                    {navBadge}
                                  </span>
                                )}
                                {filteredChildren &&
                                  filteredChildren.length > 0 && (
                                    <span
                                      className={`transition-transform duration-200 ml-1 ${isExpanded ? "rotate-90" : ""
                                        }`}
                                    >
                                      <Icon.ChevronRight />
                                    </span>
                                  )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {!railCollapsed &&
                        filteredChildren &&
                        filteredChildren.length > 0 &&
                        isExpanded && (
                          <div className="space-y-0.5 my-1 sidebar-fade-in">
                            {/* Ungrouped children sit directly under the parent. */}
                            {filteredChildren
                              .filter((c) => !c.group)
                              .map((child) => {
                                const isChildActive =
                                  (module === child.key || (child.key === "laboratory" && module === "lab_catalog")) &&
                                  isActive
                                const childBadge = subBadges[child.key] || 0

                                return (
                                  <div
                                    key={`${child.key}_${child.label}`}
                                    className={`nav-item sub justify-between ${isChildActive ? "active" : ""}`}
                                    onClick={() => {
                                      setInsuranceCaseId(undefined)
                                      setModule(child.key)
                                      closeMobileNav()
                                    }}
                                  >
                                    <span className="flex-1 truncate">{child.label}</span>
                                    {childBadge > 0 && (
                                      <span
                                        className={`badge ${isChildActive ? "bg-white/25 text-white" : "bg-[#334155] text-[#CBD5E1]"}`}
                                      >
                                        {childBadge}
                                      </span>
                                    )}
                                  </div>
                                )
                              })}

                            {/* Grouped children are laid out under a plain section
                              caption rather than a second accordion: the group was
                              a third click before you could reach a page that the
                              module itself listed in one flat sidebar. The caption
                              keeps the grouping legible without hiding anything. */}
                            {[
                              ...new Set(
                                filteredChildren
                                  .filter((c) => c.group)
                                  .map((c) => c.group as string),
                              ),
                            ].map((group) => {
                              const groupChildren = filteredChildren.filter(
                                (c) => c.group === group,
                              )

                              const isGroupActive = groupChildren.some(
                                (c) => c.key === module,
                              )

                              const isGroupExpanded =
                                expandedReportGroups.includes(group)

                              if (item.key === "reports") {
                                const GroupIcon =
                                  group === "General Reports"
                                    ? Icon.Reports
                                    : Icon.Billing

                                return (
                                  <div
                                    key={`${item.key}:${group}`}
                                    className="mt-1"
                                  >
                                    {/* Category Header: exactly like Inpatient */}
                                    <div
                                      className={`nav-item category ${isGroupActive ? "active" : ""
                                        }`}
                                      onClick={(e) => {
                                        e.stopPropagation()

                                        toggleReportGroup(group)

                                        if (
                                          !isGroupExpanded &&
                                          !isGroupActive &&
                                          groupChildren.length > 0
                                        ) {
                                          setModule(groupChildren[0].key)
                                        }
                                      }}
                                    >
                                      <GroupIcon
                                        size={16}
                                        className="w-4 h-4 nav-icon"
                                      />
                                      <span className="flex-1 truncate">
                                        {group}
                                      </span>
                                      <span
                                        className={`transition-transform duration-200 ${isGroupExpanded ? "rotate-90" : ""
                                          }`}
                                      >
                                        <Icon.ChevronRight />
                                      </span>
                                    </div>

                                    {/* Sub-items: exactly like Bed Board / Inpatient sub-items */}
                                    {isGroupExpanded && (
                                      <div className="space-y-0.5 my-1">
                                        {groupChildren.map((child) => {
                                          const isChildActive =
                                            module === child.key

                                          return (
                                            <div
                                              key={`${child.key}_${child.label}`}
                                              className={`nav-item sub justify-between ${isChildActive ? "active" : ""
                                                }`}
                                              onClick={() => {
                                                setModule(child.key)
                                                closeMobileNav()
                                              }}
                                            >
                                              <span className="flex-1 truncate">
                                                {child.label}
                                              </span>
                                              {(subBadges[child.key] || 0) >
                                                0 &&
                                                !isChildActive && (
                                                  <span className="badge bg-[#334155] text-[#CBD5E1]">
                                                    {subBadges[child.key]}
                                                  </span>
                                                )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )
                              }

                              return (
                                <div
                                  key={`${item.key}:${group}`}
                                  className="mt-2 first:mt-1"
                                >
                                  <div
                                    className="px-3 pt-1 pb-1 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors mx-1 rounded"
                                    onClick={() =>
                                      setCollapsedGroups((prev) =>
                                        prev.includes(`${item.key}:${group}`)
                                          ? prev.filter(
                                            (g) =>
                                              g !== `${item.key}:${group}`,
                                          )
                                          : [...prev, `${item.key}:${group}`],
                                      )
                                    }
                                  >
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B] select-none">
                                      {group}
                                    </span>
                                    <span
                                      className={`text-[#64748B] transition-transform ${collapsedGroups.includes(
                                        `${item.key}:${group}`,
                                      )
                                        ? "-rotate-90"
                                        : ""
                                        }`}
                                    >
                                      <Icon.ChevronDown size={14} />
                                    </span>
                                  </div>
                                  {!collapsedGroups.includes(
                                    `${item.key}:${group}`,
                                  ) &&
                                    groupChildren.map((child) => (
                                      <div
                                        key={`${child.key}_${child.label}`}
                                        className={`nav-item sub justify-between ${module === child.key && isActive
                                          ? "active"
                                          : ""
                                          }`}
                                        onClick={() => {
                                          setModule(child.key)
                                          closeMobileNav()
                                        }}
                                      >
                                        <span className="flex-1 truncate">
                                          {child.label}
                                        </span>
                                        {(subBadges[child.key] || 0) > 0 &&
                                          module !== child.key && (
                                            <span className="badge bg-[#334155] text-[#CBD5E1]">
                                              {subBadges[child.key]}
                                            </span>
                                          )}
                                      </div>
                                    ))}
                                </div>
                              )
                            })}
                          </div>
                        )}
                    </div>
                  )
                })}
              </div>

              <div className="border-t border-[#1E2D42]/80 flex-shrink-0 overflow-hidden">
                {railCollapsed ? (
                  <div className="p-2 flex justify-center">
                    <button
                      onClick={() => setCmdOpen(true)}
                      title="Command Palette (Ctrl+K)"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Icon.Cmd size={18} className="w-8 h-8 p-1.5" />
                    </button>
                  </div>
                ) : (
                  <div className="p-3 sidebar-fade-in">
                    <button
                      onClick={() => {
                        closeMobileNav()
                        setCmdOpen(true)
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-white/10 text-[#64748B] hover:text-white hover:border-white/20 transition-colors text-[11.5px] cursor-pointer whitespace-nowrap"
                    >
                      <Icon.Cmd />
                      <span>Command Palette</span>
                      <kbd className="ml-auto font-mono text-[10px]">Ctrl+K</kbd>
                    </button>
                  </div>
                )}
              </div>
            </aside>

            {/* ── Main Workspace ───────────────────────────────────────── */}
            <main
              ref={mainRef}
              className="app-main flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-auto"
            >
              {/* Breadcrumb strip */}
              <div className="bg-white border-b border-slate-200 px-3 sm:px-5 py-2 flex items-center gap-2 text-xs text-slate-500 flex-shrink-0 font-medium overflow-x-auto whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setModule("dashboard")}
                  className="hover:text-blue-600 transition-colors cursor-pointer flex items-center gap-1 text-slate-600 font-medium"
                >
                  <span className="text-slate-400 text-xs">🏠</span>
                  <span>Home</span>
                </button>
                {moduleTrail(module).map((crumb, i, all) => (
                  <span key={crumb} className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs select-none font-bold">›</span>
                    <span
                      className={
                        i === all.length - 1
                          ? "text-slate-900 font-bold"
                          : "text-slate-600 font-medium hover:text-blue-600 transition-colors"
                      }
                    >
                      {crumb}
                    </span>
                  </span>
                ))}
              </div>

              {(() => {
                const isSuperAdminUser =
                  userRole === "ROLE_ADMIN" ||
                  userRole === "ROLE_SUPERADMIN" ||
                  userRole === "admin" ||
                  activeStaff?.id === "ADM-001" ||
                  activeStaff?.role === "ROLE_ADMIN" ||
                  userPermissions.includes("*") ||
                  userPermissions.includes("admin")

                const currentModuleHasAccess = isModuleAccessible(module, userRole, userPermissions, activeStaff)

                return (
                  <PageErrorBoundary resetKey={module}>
                    {!currentModuleHasAccess ? (
                      <DepartmentAccessDenied
                        moduleKey={module}
                        activeStaff={activeStaff}
                        userRole={userRole}
                        userPermissions={userPermissions}
                        onNavigateHome={() => {
                          const firstAllowed = getFirstAllowedModule(userRole, userPermissions, activeStaff)
                          setModule(firstAllowed)
                        }}
                        onOpenAdmin={isSuperAdminUser ? () => setModule("admin") : undefined}
                        onNavigateToModule={(mod) => setModule(mod as Module)}
                      />
                    ) : (
                      <>
                      {module === "dashboard" && (
                        <Dashboard
                          navigate={navigate}
                          userRole={userRole}
                          activeStaff={activeStaff}
                        />
                      )}
              {module === "patients" && (
                <PatientSearch
                  onSelect={(p) => {
                    setClinicalPatientId(
                      p.umr || (p as any).patient_id || (p as any).id,
                    )

                    setModule("chart")
                  }}
                  onRegister={() => setModule("register")}
                  onNavigateToWorkflow={(encounterId) => {
                    setSelectedWorkflowEncounterId(encounterId)

                    setWorkflowInitialStep(2)

                    setModule("op_workflow")
                  }}
                />
              )}
              {(module === "register" || module === "op_registration") && (
                <Registration
                  onBookAppointment={(patient) => {
                    if (patient?.id) setSelectedWorkflowEncounterId(patient.id)

                    setModule("appointments")
                  }}
                  onGoToBilling={() => setModule("billing")}
                  onComplete={() => setModule("patients")}
                  onBack={() => setModule("patients")}
                />
              )}
              {module === "chart" && (
                <PatientChart
                  onBack={() => setModule("patients")}
                  setNotice={setNotice}
                  initialPatientId={clinicalPatientId}
                  onConsumeInitialPatient={() => setClinicalPatientId(null)}
                />
              )}
              {module === "appointments" && (
                <Appointments
                  initialEncounterId={selectedWorkflowEncounterId}
                  onSelect={(patientId?: string) => {
                    if (patientId) setClinicalPatientId(patientId)
                    setModule("chart")
                  }}
                  onGoToBilling={() => setModule("billing")}
                />
              )}
              {module === "emergency" && <OnDutyStrip hmsModule="er" label="ER staff on duty" />}
              {module === "emergency" && (
                <ErPage
                  setNotice={stableSetNotice}
                  onNavigate={(m) => setModule(m as any)}
                  onOpenTriage={(visitId) => {
                    setSelectedTriageVisitId(visitId)

                    setModule("triage")
                  }}
                />
              )}
              {module === "inpatient" && (
                <Inpatient
                  navigate={navigate}
                  onOpenPatientClinical={openPatientClinical}
                  permissions={userPermissions}
                  initialWard={subModule}
                />
              )}
              {module === "beds" && (
                <BedManagementPage
                  setNotice={stableSetNotice}
                  onOpenPatientClinical={openPatientClinical}
                  permissions={userPermissions}
                />
              )}
              {module === "nursing" && <NursingPortal />}
              {(module === "laboratory" || (module.startsWith("lab_") && module !== "lab_billing")) && (
                <LaboratoryManagementSuite
                  technician={activeStaff.name}
                  activeSubPage={module}
                  onNavigate={(m) => setModule(m as Module)}
                />
              )}
              {(module === "pharmacy" || module.startsWith("pharmacy_")) && (
                <Pharmacy
                  activeModule={module}
                  onNavigate={(m) => setModule(m as Module)}
                />
              )}
              {module === "surgery" && <OnDutyStrip hmsModule="ot" label="OT staff on duty" />}
              {module === "surgery" && <Surgery onOpenPatientRecord={openPatientClinical} />}
              {(module === "billing_op" ||
                module === "billing_ip" ||
                module === "billing_er" ||
                module === "billing_unified") && (
                  <Billing
                    key={module}
                    view={module === "billing_unified" ? "unified" : "counter"}
                    scope={
                      module === "billing_op"
                        ? "op"
                        : module === "billing_ip"
                          ? "ip"
                          : "er"
                    }
                  />
                )}
              {module === "lab_billing" && <LabBillingQueue />}
              {module === "billing_revenue" && (
                <RevenueDashboard onNavigate={(m) => setModule(m as Module)} />
              )}
              {module === "billing" && (
                <BillingDashboard onNavigate={(m) => setModule(m as Module)} />
              )}
              {module === "payments" && <PaymentCollection />}
              {(module === "accounts" || module.startsWith("accounts_")) && (
                <AccountsModule
                  initialTab={
                    module === "accounts_coa"
                      ? "coa"
                      : module === "accounts_gl"
                        ? "gl"
                        : module === "accounts_receipts"
                          ? "receipts"
                          : module === "accounts_payments"
                            ? "payments"
                            : module === "accounts_ar"
                              ? "ar"
                              : module === "accounts_ap"
                                ? "ap"
                                : module === "accounts_cash_bank"
                                  ? "cash_bank"
                                  : module === "accounts_pharmacy"
                                    ? "pharmacy"
                                    : module === "accounts_insurance"
                                      ? "insurance"
                                      : module === "accounts_tax"
                                        ? "tax"
                                        : module === "accounts_budget"
                                          ? "budget"
                                          : module === "accounts_assets"
                                            ? "assets"
                                            : module === "accounts_reports"
                                              ? "statements"
                                              : module === "accounts_period_close"
                                                ? "closing"
                                                : module === "accounts_audit"
                                                  ? "audit"
                                                  : module === "accounts_manager"
                                                    ? "manager"
                                                    : "dashboard"
                  }
                />
              )}
              {(module === "radiology" ||
                module === "radiology_templates" ||
                module.startsWith("radiology_")) && (
                <Radiology
                  initialTab={
                    module === "radiology_worklist"
                      ? "worklist"
                      : module === "radiology_operations"
                      ? "operations"
                      : module === "radiology_reporting"
                      ? "reporting"
                      : module === "radiology_reports" || module === "radiology_finalized"
                      ? "finalized"
                      : module === "radiology_template_upload" || module === "radiology_templates"
                      ? "template_upload"
                      : module === "radiology_analytics"
                      ? "analytics"
                      : "overview"
                  }
                  initialStudyId={
                    module === "radiology_reporting" || module === "radiology_operations"
                      ? radiologyStudyId
                      : null
                  }
                  departmentScope={
                    module === "radiology_ct"
                      ? "ct"
                      : module === "radiology_usg"
                      ? "usg"
                      : module === "radiology_mri"
                      ? "mri"
                      : module === "radiology_xray"
                      ? "xray"
                      : "all"
                  }
                  technician={activeStaff?.name}
                  role={userRole}
                  onNavigateView={(view, subParam) => {
                    const mapping: Record<string, Module> = {
                      overview: "radiology",
                      worklist: "radiology_worklist",
                      operations: "radiology_operations",
                      reporting: "radiology_reporting",
                      finalized: "radiology_reports",
                      template_upload: "radiology_template_upload",
                      analytics: "radiology_analytics",
                    }
                    if (subParam) {
                      setRadiologyStudyId(subParam)
                      try {
                        localStorage.setItem("hospai_active_radiology_study_id", subParam)
                      } catch {}
                    } else if (view === "worklist" || view === "reporting" || view === "overview") {
                      setRadiologyStudyId(null)
                      try {
                        localStorage.removeItem("hospai_active_radiology_study_id")
                      } catch {}
                    }
                    if (mapping[view]) {
                      setModule(mapping[view])
                    }
                  }}
                  onNavigateTab={(tab: "worklist" | "reports" | "templates") => {
                    if (tab === "worklist") setModule("radiology_worklist")
                    else if (tab === "reports") setModule("radiology_reports")
                    else if (tab === "templates") setModule("radiology_template_upload")
                  }}
                />
              )}
              {(module === "icu" || module.startsWith("icu_")) && <OnDutyStrip hmsModule="icu" label="ICU staff on duty" />}
              {(module === "icu" || module.startsWith("icu_")) && (
                <ICU
                  unit={
                    module === "icu"
                      ? "All"
                      : module.slice("icu_".length).toUpperCase()
                  }
                  onOpenBedManagement={() => setModule("beds")}
                />
              )}
              {module === "analytics" && <Analytics />}
              {module === "discharge" && (
                <Discharge
                  setNotice={stableSetNotice}
                  onComplete={() => setModule("inpatient")}
                />
              )}
              {module === "triage" && (
                <Triage
                  initialVisitId={selectedTriageVisitId}
                  setNotice={stableSetNotice}
                  onNavigate={(m) => setModule(m as any)}
                />
              )}

              {/* Insurance Command Dashboard — new Page 1 */}
              {module === "insurance_overview" && (
                <InsuranceCommandDashboard
                  onNavigate={(page, caseId) => {
                    if (page === "board") setModule("insurance_board" as any)
                    else if (page === "preauth") setModule("insurance_preauth" as any)
                    else if (page === "intake") setModule("insurance_eligibility" as any)
                    else if (page === "claims") {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_claims" as any)
                    }
                    else if (page === "emails") setModule("insurance_emails" as any)
                    else if (page === "settlements") setModule("insurance_settlement" as any)
                    else if (page === "masters") setModule("insurance_masters" as any)
                    else if (page === "case" && caseId) {
                      setInsuranceCaseId(caseId)
                      setModule("insurance_case" as any)
                    }
                    else {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_claims" as any)
                    }
                  }}
                />
              )}
              {/* Legacy overview key */}
              {module === "insurance_desk" && (
                <InsuranceDashboardView
                  onOpenCase={(id) => openInsurance("insurance", id)}
                  onOpenIntake={() => setModule("insurance_eligibility" as any)}
                />
              )}
              {/* Page 2: Insurance Command Dashboard (reused for board key) */}
              {(module === "insurance_board" as any) && (
                <InsuranceCommandDashboard
                  onNavigate={(page, caseId) => {
                    if (page === "preauth") setModule("insurance_preauth" as any)
                    else if (page === "intake") setModule("insurance_eligibility" as any)
                    else if (page === "claims") {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_claims" as any)
                    }
                    else if (page === "emails") setModule("insurance_emails" as any)
                    else if (page === "settlements") setModule("insurance_settlement" as any)
                    else if (page === "masters") setModule("insurance_masters" as any)
                    else if (page === "case" && caseId) {
                      setInsuranceCaseId(caseId)
                      setModule("insurance_case" as any)
                    }
                    else {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_overview" as any)
                    }
                  }}
                />
              )}
              {/* Page 3: Intake */}
              {module === "insurance_patient_policies" && <PatientPoliciesPage />}
              {module === "insurance_eligibility" && (
                <InsuranceIntakeView
                  onBack={() => setModule("insurance_overview" as any)}
                  onComplete={(id) => {
                    setInsuranceCaseId(id)
                    setModule("insurance_preauth" as any)
                  }}
                />
              )}
              {/* Page 4/5: Pre-Auth */}
              {module === "insurance_preauth" && (
                <PreAuthRequestView
                  onBack={() => setModule("insurance_overview" as any)}
                  onSubmitted={(id) => {
                    setInsuranceCaseId(id)
                    setModule("insurance_case" as any)
                  }}
                />
              )}
              {/* Page 6: Full Case Detail Hub */}
              {module === "insurance_case" && (() => {
                const allCasesForDetail = InsuranceEngineService.getClaims()
                const detailCase = allCasesForDetail.find((c) => c.id === insuranceCaseId) || allCasesForDetail[0]
                return detailCase ? (
                  <InsuranceCaseDetailView
                    c={detailCase}
                    onBack={() => setModule("insurance_board")}
                    onOpenBilling={() => setModule("billing_ip")}
                  />
                ) : (
                  <div className="p-6 text-slate-500 text-sm">Case not found. <button className="text-blue-600 underline" onClick={() => setModule("insurance_board")}>Back to board</button></div>
                )
              })()}
              {/* Page 8: Discharge & Final Approval */}
              {module === "insurance_discharge" && (() => {
                const allCasesForDischarge = InsuranceEngineService.getClaims()
                const dischargeCase = allCasesForDischarge.find((c) => c.id === insuranceCaseId) || allCasesForDischarge[0]
                return dischargeCase ? (
                  <DischargeFinalizationView
                    c={dischargeCase}
                    onBack={() => setModule("insurance_board")}
                  />
                ) : null
              })()}
              {/* Pages: Legacy claim / settlement / masters */}
              {(module === "insurance" || module === "insurance_claims" || module === "insurance_queries") && (
                <InsuranceClaims onNavigate={openInsurance} initialCaseId={insuranceCaseId} initialView="needs" />
              )}
              {module === "insurance_emails" && (
                <InsuranceEmailHubPage
                  onNavigateToClaim={(claimId) => openInsurance("insurance_claims", claimId)}
                  initialClaimId={insuranceCaseId}
                />
              )}
              {(module === "insurance_settlement" || module === "insurance_reconciliation") && (
                <InsuranceSettlementPage onNavigate={openInsurance} initialCaseId={insuranceCaseId} />
              )}
              {module === "insurance_masters" && <InsuranceMastersPage section={mastersSection} />}
              {module === "insurance_tpas" && <InsuranceMastersPage section="tpas" />}
              {module === "insurance_packages" && <EnhancedAuditRulesPage initialTab="packages" />}
              {module === "insurance_pricing" && <EnhancedAuditRulesPage initialTab="packages" />}
              {module === "insurance_docrules" && <EnhancedAuditRulesPage initialTab="audit" />}
              {(module === "insurance_reports" as any) && <EnhancedAuditRulesPage initialTab="reports" />}

              {(module === "reports" || module === "reports_overview") && (
                <GeneralReportsOverviewPage
                  onNavigate={(m) => setModule(m as any)}
                />
              )}
              {module === "reports_op" && (
                <OpReportsPage
                  userRole={userRole}
                  onNavigate={(m) => setModule(m as any)}
                />
              )}
              {module === "revenue_reports" && <RevenueReports />}
              {(module === "reports_patients" ||
                module === "reports_er" ||
                module === "reports_inpatient" ||
                module === "reports_appointments" ||
                module === "reports_doctors" ||
                module === "reports_pharmacy" ||
                module === "reports_laboratory" ||
                module === "reports_radiology" ||
                module === "reports_beds" ||
                module === "reports_admissions" ||
                module === "reports_discharges" ||
                module === "reports_staff" ||
                module === "reports_pharmacy_damaged" ||
                module === "reports_supplier_returns") && (
                  <GenericReportPage
                    key={module}
                    reportType={module as ReportType}
                    onNavigate={(m) => setModule(m as any)}
                  />
                )}
              {module === "op_nurse" && (
                <NurseStation
                  nurseName={activeStaff?.name || "OP Nurse"}
                  onOpenQueue={
                    userPermissions.includes("queue")
                      ? () => setModule("queue")
                      : undefined
                  }
                />
              )}
              {(module === "admin" || module === "admin_doctors") && (
                <Administration
                  initialTab={module === "admin_doctors" ? "doctors" : "overview"}
                  initialDoctorSubTab={module === "admin_doctors" ? "workspace" : undefined}
                  onNavigateToDoctorPortal={() => setModule("doctor_portal")}
                />
              )}

              {/* Outpatient Department Modular Suite */}
              {module === "op_management" && <OnDutyStrip hmsModule="op" category="doctor" label="Doctors on duty in OP" />}
              {module === "op_management" && (
                <OPManagement
                  staffName={activeStaff?.name || "OP desk"}
                  onNavigateToNurseStation={
                    userPermissions.includes("op_nurse")
                      ? () => setModule("op_nurse")
                      : undefined
                  }
                  onNavigateToQueue={() => setModule("queue")}
                  onNavigateToOPDProcedures={() => setModule("opd_procedures")}
                  onNavigateToOPWorkflow={(encId, step) => {
                    if (encId) setSelectedWorkflowEncounterId(encId)

                    if (step !== undefined) setWorkflowInitialStep(step)

                    setModule("op_workflow")
                  }}
                  onNavigateToDoctorWorkflow={
                    !canOpenConsultation
                      ? undefined
                      : (encId) => {
                        if (encId) setSelectedWorkflowEncounterId(encId)

                        setModule("doctor_portal")
                      }
                  }
                  onNavigateToOPRegistration={() => {
                    setModule("op_registration")
                  }}
                />
              )}
              {module === "queue" && (
                <QueueManagement
                  onNavigateToNurseStation={
                    userPermissions.includes("op_nurse")
                      ? () => setModule("op_nurse")
                      : undefined
                  }
                  onNavigateToOPWorkflow={(encId, step) => {
                    if (encId) setSelectedWorkflowEncounterId(encId)

                    if (step !== undefined) setWorkflowInitialStep(step)

                    setModule("op_workflow")
                  }}
                  onNavigateToDoctorWorkflow={
                    !canOpenConsultation
                      ? undefined
                      : (encId) => {
                        if (encId) setSelectedWorkflowEncounterId(encId)

                        setModule("doctor_portal")
                      }
                  }
                  onNavigateToOPRegistration={() => {
                    setModule("op_registration")
                  }}
                />
              )}
              {module === "opd_procedures" && (
                <OPDProcedures
                  onNavigateToOPManagement={() => setModule("op_management")}
                />
              )}
              {module === "op_workflow" && (
                <OPWorkflow
                  initialStep={workflowInitialStep}
                  initialEncounterId={selectedWorkflowEncounterId}
                  onComplete={() => setModule("op_management")}
                  onOpenDoctorPortal={
                    !canOpenConsultation
                      ? undefined
                      : (encId) => {
                        if (encId) setSelectedWorkflowEncounterId(encId)

                        setModule("doctor_portal")
                      }
                  }
                />
              )}
              {module === "patient_exp" && <PatientExperience />}
              {module === "patient_messages" && <PatientMessages />}
              {(module === "doctor_workflow" || module === "doctor_portal" || module === "doctors_overview") &&
                (isDoctorUser && !isSuperAdminUser && !userPermissions.includes("doctors_overview") && activeDoctor ? (
                  // Logged-in doctor only views and accesses their OWN individual workspace:
                  // Strictly scoped to this doctor with no ability to switch to other doctors or view other queues.
                  <DoctorPortal
                    key={activeDoctor.id}
                    doctor={activeDoctor}
                    isSuperAdmin={false}
                    onOpenErVisit={(visitId) => {
                      setSelectedTriageVisitId(visitId)
                      setModule("triage")
                    }}
                  />
                ) : (isSuperAdminUser || userPermissions.includes("doctors_overview") || userPermissions.includes("admin")) ? (
                  // Admin / authorized oversight manager views the complete hospital clinical overview (the screen shown in user's screenshot).
                  // Clicking [Open Doctor Workspace] on any doctor card opens that specific doctor's consultation workspace.
                  adminInspectingDoctor ? (
                    <DoctorPortal
                      key={adminInspectingDoctor.id}
                      doctor={adminInspectingDoctor}
                      isSuperAdmin={true}
                      onBackToOverview={() => setAdminInspectingDoctor(null)}
                      onSwitchDoctor={(docId) => setAdminInspectingDoctor(getDoctorById(docId))}
                      onOpenErVisit={(visitId) => {
                        setSelectedTriageVisitId(visitId)
                        setModule("triage")
                      }}
                    />
                  ) : (
                    <DoctorsOverview
                      onOpenWorkspace={(doc) => {
                        setAdminInspectingDoctor(doc)
                      }}
                      onOpenAdminMaster={() => {
                        setModule("admin_doctors")
                      }}
                    />
                  )
                ) : activeDoctor ? (
                  <DoctorPortal
                    key={activeDoctor.id}
                    doctor={activeDoctor}
                    isSuperAdmin={false}
                    onOpenErVisit={(visitId) => {
                      setSelectedTriageVisitId(visitId)
                      setModule("triage")
                    }}
                  />
                ) : (
                  <DepartmentAccessDenied
                    department="Doctor Workspace"
                    requiredRole="Authenticated Doctor or Clinical Administrator"
                  />
                ))}
              {module === "admissions" && (
                <Admissions setNotice={setNotice} navigate={navigate} />
              )}
              {module === "readmission" && (
                <Readmission setNotice={setNotice} />
              )}
              {Boolean(HR_MODULE_SECTION_MAP[module]) && (
                <HrWorkspace
                  section={HR_MODULE_SECTION_MAP[module]}
                  onNavigateSection={(sec) => {
                    const targetModule = Object.entries(HR_MODULE_SECTION_MAP).find(
                      ([k, v]) => v === sec && k !== "hr_dashboard" && k !== "hr_shifts"
                    )?.[0]
                    if (targetModule) setModule(targetModule as Module)
                  }}
                  legacy={<HRMS onNavigate={(m) => setModule(m as any)} />}
                />
              )}
              {module === "ocr" && <SmartOCR setNotice={setNotice} />}
              {ocrMounted && (
                <div
                  className={module === "dpi_ocr" ? "h-full w-full" : "hidden"}
                >
                  <DpiOcrPortal />
                </div>
              )}
              {module === "symptom_ai" && <SymptomAI setNotice={setNotice} />}
              {module === "clinical_rag" && <ClinicalRAG />}
              {module === "clinical_summaries" && <ClinicalSummaries />}
              {module === "bulk_ai" && <BulkAI setNotice={setNotice} />}
              {module === "nl_filtering" && (
                <NLFiltering setNotice={setNotice} />
              )}
              {module === "intelligence" && (
                <IntelligenceHub navigate={navigate} />
              )}
                      </>
                    )}
                  </PageErrorBoundary>
                )
              })()}
            </main>
          </div>

          {/* ── Overlays ─────────────────────────────────────────────────── */}
          <OrderDrawer open={orderOpen} onClose={() => setOrderOpen(false)} />
          <CommandPalette
            open={cmdOpen}
            onClose={() => setCmdOpen(false)}
            onNavigate={(key) => {
              if (key === "order") {
                setModule("chart")
                setOrderOpen(true)
              } else if (key === "register") {
                setModule("register")
              } else {
                if (key === "radiology_reporting" || key === "radiology_worklist" || key === "radiology" || key === "radiology_operations" || key === "radiology_reports") {
                  setRadiologyStudyId(null)
                  try {
                    localStorage.removeItem("hospai_active_radiology_study_id")
                  } catch {}
                }
                setModule(key as Module)
              }
            }}
            onSelectPatient={(patientId, encounterId) => {
              setClinicalPatientId(patientId)

              if (encounterId) {
                setSelectedWorkflowEncounterId(encounterId)
              }

              setModule("chart")
            }}
          />

          {globalApplyLeaveOpen && (
            <ApplyLeaveModal
              isOpen={globalApplyLeaveOpen}
              onClose={() => setGlobalApplyLeaveOpen(false)}
              loggedInStaffId={activeStaff.id}
              loggedInStaffName={activeStaff.name}
              isSelfService={userRole !== "ROLE_ADMIN" && userRole !== "ROLE_SUPERADMIN" && userRole !== "ROLE_HR"}
            />
          )}
        </>
      )}
    </div>
  )
}
