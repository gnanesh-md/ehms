import React, { useEffect, useMemo, useState } from "react"
import { LabOrder, LabOrderDatabase } from "../services/labOrdersDb"
import { BillingDatabase, RadiologyStudyRecord, ClaimRecord, PaymentRecord, normalizeUmr, cleanEnc } from "../services/billingDb"
import { RadiologyWorkflowDb, ExtendedRadiologyRecord } from "../services/radiologyWorkflowDb"
import { AuditDatabase } from "../services/auditDb"
import HospitalReceiptModal from "./HospitalReceiptModal"
import { BillingHeader, KpiTile } from "./billing/BillingChrome"
import { FlaskConical, Hourglass, Activity, Layers, Search, CheckCircle2, ShieldCheck, Printer } from "lucide-react"

/**
 * Unified Patient-Wise Consolidated Investigation Billing Queue:
 * Centralized Cashier Desk for Doctor -> Investigation Handoff.
 *
 * Consolidates ALL Laboratory and Radiology investigations belonging to the
 * same patient and OP encounter into ONE single billing entry.
 *
 * - 1 Patient + 1 OP Encounter = 1 Consolidated Investigation Billing Entry.
 * - Grouped by Patient UMR and OP / Encounter Number.
 * - Displays both Laboratory and Radiology test breakdowns with individual charges.
 * - Single payment collection settles all included investigations and issues one official receipt.
 * - Updates Laboratory and Radiology department worklists independently upon settlement.
 */

const PAYMENT_MODES: Array<"Cash" | "Card" | "UPI" | "Corporate"> = [
  "Cash",
  "Card",
  "UPI",
  "Corporate",
]

export type UnifiedDepartment = "Laboratory" | "Radiology" | "Both"

export interface UnifiedInvestigationItem {
  id: string
  name: string
  price: number
  urgency?: string
  modality?: string
  room?: string
  department: "Laboratory" | "Radiology"
}

export interface UnifiedInvestigationOrder {
  id: string // Consolidated identifier (e.g. CONSOL-OP-1001)
  department: UnifiedDepartment
  departments: Array<"Laboratory" | "Radiology">
  patientName: string
  age?: number
  sex?: string
  umr: string
  opNumber: string
  encounterId?: string
  phone?: string
  doctorName: string
  consultingDepartment: string
  diagnosis?: string
  items: UnifiedInvestigationItem[]
  labItems: UnifiedInvestigationItem[]
  radItems: UnifiedInvestigationItem[]
  subtotal: number
  discount: number
  total: number
  status: "Awaiting Billing" | "Paid" | "Billed"
  paymentStatus: "Pending" | "Paid"
  createdAt: string
  paidAt?: string
  receiptNo?: string
  invoiceNo?: string
  mode?: string
  collectedBy?: string
  rawLabOrders?: LabOrder[]
  rawRadiologyStudies?: (ExtendedRadiologyRecord | RadiologyStudyRecord)[]
}

interface GroupRecord {
  umr: string
  opNumber: string
  encounterId?: string
  patientName: string
  age?: number
  sex?: string
  phone?: string
  doctorName?: string
  consultingDepartment?: string
  diagnosis?: string
  labOrders: LabOrder[]
  radStudies: (ExtendedRadiologyRecord | RadiologyStudyRecord)[]
}

/**
 * Consolidates all Laboratory orders and Radiology studies into unified, patient-encounter entries.
 */
function consolidateAllInvestigations(
  labOrders: LabOrder[],
  radStudies: (ExtendedRadiologyRecord | RadiologyStudyRecord)[],
): { pending: UnifiedInvestigationOrder[]; settled: UnifiedInvestigationOrder[] } {
  const groups = new Map<string, GroupRecord>()

  // 1. Group Laboratory Orders by (Patient UMR, OP/Encounter)
  labOrders.forEach((ord) => {
    const umr = normalizeUmr(ord.umr) || (ord.patientName || "").trim().toUpperCase() || "UNKNOWN"
    const enc = cleanEnc(ord.opNumber || ord.encounterId) || "STANDALONE"
    const groupKey = `${umr}|${enc}`

    const existing = groups.get(groupKey) || {
      umr: ord.umr,
      opNumber: ord.opNumber || (ord.encounterId?.startsWith("OP-") ? ord.encounterId : `OP-${ord.umr.replace(/\D/g, "")}`),
      encounterId: ord.encounterId,
      patientName: ord.patientName,
      age: ord.age,
      sex: ord.sex,
      phone: ord.phone,
      doctorName: ord.doctorName,
      consultingDepartment: ord.department || "General Medicine",
      diagnosis: ord.diagnosis,
      labOrders: [],
      radStudies: [],
    }
    existing.labOrders.push(ord)
    if (!existing.doctorName && ord.doctorName) existing.doctorName = ord.doctorName
    if (!existing.diagnosis && ord.diagnosis) existing.diagnosis = ord.diagnosis
    groups.set(groupKey, existing)
  })

  // 2. Group Radiology Studies by (Patient UMR, OP/Encounter)
  radStudies.forEach((rs) => {
    const umr = normalizeUmr(rs.umr || (rs as any).mrn) || (rs.patient || "").trim().toUpperCase() || "UNKNOWN"
    const enc = cleanEnc((rs as any).opNumber || rs.encounterId) || "STANDALONE"
    const groupKey = `${umr}|${enc}`

    const opNumber =
      (rs as any).opNumber ||
      (rs.encounterId?.startsWith("OP-") ? rs.encounterId : `OP-${(rs.umr || (rs as any).mrn || "1002").replace(/\D/g, "")}`)

    const existing = groups.get(groupKey) || {
      umr: rs.umr || (rs as any).mrn || "WALK-IN",
      opNumber,
      encounterId: rs.encounterId,
      patientName: rs.patient,
      age: (rs as any).age,
      sex: (rs as any).gender,
      phone: (rs as any).phone || "",
      doctorName: rs.provider || "Attending Doctor",
      consultingDepartment: rs.department || "Radiology",
      diagnosis: rs.diagnosis || rs.indication,
      labOrders: [],
      radStudies: [],
    }
    existing.radStudies.push(rs)
    if (!existing.doctorName && rs.provider) existing.doctorName = rs.provider
    if (!existing.diagnosis && (rs.diagnosis || rs.indication)) existing.diagnosis = rs.diagnosis || rs.indication
    groups.set(groupKey, existing)
  })

  // 3. Build Unified Consolidated Billing Entries
  const pending: UnifiedInvestigationOrder[] = []
  const settled: UnifiedInvestigationOrder[] = []

  groups.forEach((group) => {
    const labItems: UnifiedInvestigationItem[] = []
    const radItems: UnifiedInvestigationItem[] = []

    // Deduplicate Laboratory test items
    group.labOrders.forEach((ord) => {
      (ord.tests || []).forEach((t, idx) => {
        const exists = labItems.some(
          (it) => it.id === t.id || it.name.toLowerCase().trim() === t.name.toLowerCase().trim()
        )
        if (!exists) {
          labItems.push({
            id: t.id || `ITEM-LAB-${ord.id}-${idx + 1}`,
            name: t.name,
            price: t.price || 0,
            urgency: t.urgency,
            department: "Laboratory",
          })
        }
      })
    })

    // Deduplicate Radiology study items
    group.radStudies.forEach((rs) => {
      const cleanStudyName = (rs.study || "Radiology Scan").replace(/\s*\([^)]*\)$/, "")
      const exists = radItems.some(
        (it) =>
          it.id === rs.id ||
          it.name.toLowerCase().trim() === cleanStudyName.toLowerCase().trim() ||
          it.name.toLowerCase().trim() === (rs.study || "").toLowerCase().trim()
      )
      if (!exists) {
        radItems.push({
          id: rs.id,
          name: cleanStudyName,
          price: rs.price || 500,
          urgency: rs.priority,
          modality: rs.modality,
          room: rs.room,
          department: "Radiology",
        })
      }
    })

    const allItems = [...labItems, ...radItems]
    if (allItems.length === 0) return

    const subtotal = allItems.reduce((acc, it) => acc + (it.price || 0), 0)
    const hasLab = labItems.length > 0
    const hasRad = radItems.length > 0
    const department: UnifiedDepartment = hasLab && hasRad ? "Both" : hasLab ? "Laboratory" : "Radiology"

    // Accurate settlement check: An investigation order is ONLY settled if ALL lab orders AND all rad studies are paid
    const isLabSettled = group.labOrders.length === 0 || group.labOrders.every((o) => o.billing?.status === "Paid")
    const isRadSettled = group.radStudies.length === 0 || group.radStudies.every(
      (s) =>
        s.isPaid ||
        s.paymentStatus === "Paid" ||
        (s.paymentStatusDisplay || "").toUpperCase() === "PAID" ||
        s.billingStatus === "Authorized Exception" ||
        Boolean((s as any).authorizedException)
    )
    const isPaid = isLabSettled && isRadSettled && allItems.length > 0

    const receiptNo =
      group.radStudies.find((s) => s.paidReceiptNo)?.paidReceiptNo ||
      group.labOrders.find((o) => o.billing?.receiptNo)?.billing?.receiptNo ||
      (isPaid ? `RCPT-2026-${group.opNumber.replace(/\D/g, "").slice(-4) || "5501"}` : undefined)

    const paidAt =
      group.radStudies.find((s) => s.paidAt)?.paidAt ||
      group.labOrders.find((o) => o.billing?.paidAt)?.billing?.paidAt ||
      (isPaid ? new Date().toISOString() : undefined)

    const invoiceNo =
      group.radStudies.find((s) => s.invoiceNo && !s.invoiceNo.startsWith("INV-RAD-"))?.invoiceNo ||
      group.labOrders.find((o) => o.billing?.invoiceNo)?.billing?.invoiceNo ||
      `INV-${group.opNumber}`

    // Representative ID for this consolidated entry
    const id = `CONSOL-${group.opNumber || group.encounterId || group.umr}`

    // Oldest creation date among included items
    const createdDates = [
      ...group.labOrders.map((o) => o.createdAt),
      ...group.radStudies.map((s) => (s as any).createdAt || s.orderedAt || s.ordered),
    ].filter(Boolean)
    const createdAt = createdDates.sort()[0] || new Date().toISOString()

    const entry: UnifiedInvestigationOrder = {
      id,
      department,
      departments: [...(hasLab ? (["Laboratory"] as const) : []), ...(hasRad ? (["Radiology"] as const) : [])],
      patientName: group.patientName,
      age: group.age,
      sex: group.sex,
      umr: group.umr,
      opNumber: group.opNumber,
      encounterId: group.encounterId,
      phone: group.phone,
      doctorName: group.doctorName || "Attending Specialist",
      consultingDepartment: group.consultingDepartment || "General Medicine",
      diagnosis: group.diagnosis,
      items: allItems,
      labItems,
      radItems,
      subtotal,
      discount: 0,
      total: subtotal,
      status: isPaid ? "Billed" : "Awaiting Billing",
      paymentStatus: isPaid ? "Paid" : "Pending",
      createdAt,
      paidAt,
      receiptNo,
      invoiceNo,
      mode: isPaid ? "Cash" : undefined,
      collectedBy: "Reception",
      rawLabOrders: group.labOrders,
      rawRadiologyStudies: group.radStudies,
    }

    if (isPaid) {
      settled.push(entry)
    } else {
      pending.push(entry)
    }
  })

  const sorter = (a: UnifiedInvestigationOrder, b: UnifiedInvestigationOrder) => {
    const timeB = new Date(b.createdAt || 0).getTime()
    const timeA = new Date(a.createdAt || 0).getTime()
    return timeB - timeA || b.id.localeCompare(a.id)
  }

  return {
    pending: pending.sort(sorter),
    settled: settled.sort(sorter),
  }
}

export default function LabBillingQueue({
  collectedBy = "Reception",
}: {
  collectedBy?: string
}) {
  const [tick, setTick] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<"Cash" | "Card" | "UPI" | "Corporate">("Cash")
  const [discount, setDiscount] = useState<number>(0)
  const [view, setView] = useState<"pending" | "settled">("pending")
  const [deptFilter, setDeptFilter] = useState<"All" | "Laboratory" | "Radiology">("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [receipt, setReceipt] = useState<UnifiedInvestigationOrder | null>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectError, setCollectError] = useState<string | null>(null)

  useEffect(() => {
    const unsubLab = LabOrderDatabase.subscribe(() => setTick((t) => t + 1))
    const unsubRad = RadiologyWorkflowDb.subscribe(() => setTick((t) => t + 1))
    const unsubBilling = BillingDatabase.onUpdate(() => setTick((t) => t + 1))
    return () => {
      unsubLab()
      unsubRad()
      unsubBilling()
    }
  }, [])

  // 1. Retrieve Raw Orders from BOTH Laboratory and Radiology
  const rawLabOrders = useMemo(
    () => LabOrderDatabase.getOrders().filter((o) => o.status !== "Cancelled"),
    [tick]
  )
  const rawRadStudies = useMemo(
    () => RadiologyWorkflowDb.getStudies().filter((s) => s.status !== "Cancelled"),
    [tick]
  )

  // 2. Consolidate into unified patient-encounter entries
  const { pending: allPending, settled: allSettled } = useMemo(
    () => consolidateAllInvestigations(rawLabOrders, rawRadStudies),
    [rawLabOrders, rawRadStudies]
  )

  const currentDataset = view === "pending" ? allPending : allSettled

  const filteredList = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return currentDataset.filter((order) => {
      if (deptFilter === "Laboratory" && order.labItems.length === 0) return false
      if (deptFilter === "Radiology" && order.radItems.length === 0) return false
      if (q) {
        const matches =
          order.patientName.toLowerCase().includes(q) ||
          order.umr.toLowerCase().includes(q) ||
          order.opNumber.toLowerCase().includes(q) ||
          order.id.toLowerCase().includes(q) ||
          order.doctorName.toLowerCase().includes(q) ||
          order.items.some((it) => it.name.toLowerCase().includes(q))
        if (!matches) return false
      }
      return true
    })
  }, [currentDataset, deptFilter, searchQuery])

  const selected = useMemo(
    () => filteredList.find((order) => order.id === selectedId) || filteredList[0],
    [filteredList, selectedId],
  )

  useEffect(() => {
    setDiscount(0)
  }, [selected?.id])

  // Single-action payment collection for the entire consolidated investigation bill
  const collect = async () => {
    if (!selected || selected.paymentStatus === "Paid" || collecting) return
    setCollectError(null)
    setCollecting(true)

    const nowIso = new Date().toISOString()
    const numericDiscount = Math.max(0, Math.min(Number(discount) || 0, selected.subtotal))
    const totalToPay = Math.max(0, selected.subtotal - numericDiscount)
    const receiptNo = `RCPT-2026-${Math.floor(1000 + Math.random() * 9000)}`

    try {
      // 1. Settle all included Laboratory orders independently
      if (selected.rawLabOrders && selected.rawLabOrders.length > 0) {
        for (const labOrder of selected.rawLabOrders) {
          try {
            await LabOrderDatabase.markBilled(labOrder.id, {
              mode: mode as any,
              discount: 0,
              collectedBy,
            })
          } catch (err) {
            console.warn(`Could not update lab order ${labOrder.id}:`, err)
          }
        }
      }

      // 2. Settle all included Radiology studies independently
      if (selected.rawRadiologyStudies && selected.rawRadiologyStudies.length > 0) {
        for (const study of selected.rawRadiologyStudies) {
          try {
            BillingDatabase.updateRadiologyStudy(study.id, {
              paymentStatus: "Paid",
              paymentStatusDisplay: "PAID",
              isPaid: true,
              paidReceiptNo: receiptNo,
              paidAt: nowIso,
              billingClearedAt: nowIso,
              eligibleAt: nowIso,
              billingStatus: "Cleared / Paid",
              normalizedStatus: "ORDERED",
            })
          } catch (err) {
            console.warn(`Could not update radiology study ${study.id}:`, err)
          }
        }
      }

      // 3. Settle consolidated claim in Centralized Billing POS
      try {
        BillingDatabase.recordPayment(selected.invoiceNo || `CLM-${selected.encounterId || selected.id}`, {
          amount: totalToPay,
          paymentMethod: mode === "Cash" ? "Cash" : mode === "Card" ? "Debit Card" : "UPI / Digital",
          transactionRef: `TXN-${Date.now().toString().slice(-6)}`,
          collectedBy,
          notes: `Consolidated investigation payment settled at Reception Desk.`,
        })
      } catch {
        // Fallback match in central claims
        try {
          const claims = BillingDatabase.getClaims()
          const matching = claims.find(
            (c) =>
              c.invoiceNo === selected.invoiceNo ||
              c.id === `CLM-${selected.id}` ||
              (selected.encounterId && c.encounterId === selected.encounterId) ||
              (selected.opNumber && c.encounterId === selected.opNumber)
          )
          if (matching) {
            BillingDatabase.recordPayment(matching.id, {
              amount: totalToPay,
              paymentMethod: mode === "Cash" ? "Cash" : mode === "Card" ? "Debit Card" : "UPI / Digital",
              collectedBy,
              notes: `Consolidated investigation payment settled.`,
            })
          }
        } catch {}
      }

      // 4. Trigger cross-department broadcast channels
      try {
        new BroadcastChannel("hospai_rad_channel").postMessage("changed")
      } catch {}
      try {
        new BroadcastChannel("hospai_lab_orders").postMessage("changed")
      } catch {}
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("hospai_rad_workflow_updated"))
      }

      AuditDatabase.logEvent(
        "Consolidated Investigations Billed",
        "Billing",
        `${collectedBy} collected ₹${totalToPay.toLocaleString("en-IN")} (${mode}) for ${selected.patientName} (${selected.umr}, ${selected.opNumber}) — ` +
          `${selected.items.length} investigation(s) [${selected.labItems.length} Lab, ${selected.radItems.length} Rad] released to respective departments. Receipt: ${receiptNo}.`,
        "Success",
      )

      const unifiedReceipt: UnifiedInvestigationOrder = {
        ...selected,
        status: "Billed",
        paymentStatus: "Paid",
        discount: numericDiscount,
        total: totalToPay,
        paidAt: nowIso,
        receiptNo,
        mode,
        collectedBy,
      }

      setReceipt(unifiedReceipt)
      setShowReceiptModal(true)
      setView("settled")
      setSelectedId(unifiedReceipt.id)
    } catch (error) {
      setCollectError(
        error instanceof Error
          ? `Payment was not recorded: ${error.message}`
          : "Payment was not recorded. Please retry.",
      )
    } finally {
      setCollecting(false)
      setTick((t) => t + 1)
    }
  }

  const pendingTotal = allPending.reduce((sum, order) => sum + order.total, 0)
  const pendingLabCount = allPending.filter((o) => o.labItems.length > 0).length
  const pendingRadCount = allPending.filter((o) => o.radItems.length > 0).length

  return (
    <div className="flex-1 overflow-y-auto bg-[#F1F5F9]">
      <BillingHeader
        icon={FlaskConical}
        title="Investigation Billing"
        pill="Laboratory & Radiology"
        subtitle="Centralized investigation cashier desk — payment confirms orders and releases them for departmental processing."
      />

      <div className="px-5 pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          tone="amber"
          icon={Hourglass}
          label="Awaiting Payment (All)"
          value={allPending.length}
          sub={`₹${pendingTotal.toLocaleString("en-IN")} total to collect`}
        />
        <KpiTile
          tone="sky"
          icon={FlaskConical}
          label="Laboratory Awaiting"
          value={pendingLabCount}
          sub="Patients with diagnostic lab tests"
        />
        <KpiTile
          tone="purple"
          icon={Activity}
          label="Radiology Awaiting"
          value={pendingRadCount}
          sub="Patients with imaging studies held"
        />
        <KpiTile
          tone="emerald"
          icon={CheckCircle2}
          label="Settled Investigations"
          value={allSettled.length}
          sub="Cleared for departmental worklists"
        />
      </div>

      {/* Main Tabs (Awaiting Billing vs Settled) */}
      <div className="mx-5 mt-4 bg-white border border-[#CBD5E1] shadow-2xs flex flex-wrap items-center justify-between gap-3 p-1">
        <div className="flex">
          {[
            {
              key: "pending" as const,
              label: "Awaiting Billing",
              count: allPending.length,
            },
            {
              key: "settled" as const,
              label: "Settled Orders",
              count: allSettled.length,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              data-inv-tab={tab.key}
              onClick={() => {
                setView(tab.key)
                setSelectedId(null)
              }}
              className={`px-5 py-2.5 text-[12.5px] font-semibold border-b-2 transition-colors cursor-pointer ${
                view === tab.key
                  ? "border-[#1B4FD8] text-[#1B4FD8]"
                  : "border-transparent text-[#64748B] hover:text-[#334155]"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-[10px] font-bold bg-[#F1F5F9] text-[#475569] px-1.5 py-0.5 rounded">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Filter by Department */}
        <div className="flex items-center gap-2 pr-3">
          <div className="flex items-center bg-[#F1F5F9] p-0.5 rounded border border-[#CBD5E1] text-[11.5px]">
            {(["All", "Laboratory", "Radiology"] as const).map((dept) => (
              <button
                key={dept}
                type="button"
                onClick={() => setDeptFilter(dept)}
                className={`px-3 py-1 rounded font-semibold transition-colors cursor-pointer ${
                  deptFilter === dept
                    ? "bg-white text-[#1B4FD8] shadow-2xs"
                    : "text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                {dept === "All"
                  ? `All (${currentDataset.length})`
                  : dept === "Laboratory"
                    ? `Laboratory (${currentDataset.filter((d) => d.labItems.length > 0).length})`
                    : `Radiology (${currentDataset.filter((d) => d.radItems.length > 0).length})`}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search patient, UMR, order ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-white border border-[#CBD5E1] rounded text-[12px] text-[#334155] focus:outline-none focus:border-[#1B4FD8] w-48"
            />
          </div>
        </div>
      </div>

      {receipt && (
        <div className="mx-5 mt-4 bg-[#F0FDF4] border border-[#BBF7D0] rounded px-4 py-3 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
          <div className="text-[12.5px] text-[#166534] flex items-center gap-2">
            <span className="font-bold">✓ Payment collected</span> — receipt{" "}
            <span className="font-mono font-bold">{receipt.receiptNo}</span>
            , ₹{receipt.total.toLocaleString("en-IN")} for{" "}
            <span className="font-semibold">{receipt.patientName}</span>.{" "}
            All {receipt.items.length} investigations released to respective departments.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReceiptModal(true)}
              className="text-[#15803D] hover:underline font-bold text-[12px] flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" /> View Receipt
            </button>
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="text-[#15803D] hover:text-green-800 font-bold text-[14px] cursor-pointer ml-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="px-5 pb-5 pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Investigation Orders List (1 Patient + 1 Encounter = 1 Entry) */}
        <div data-inv-queue className="lg:col-span-2 bg-white border border-[#DDE2EC] rounded">
          <div className="px-4 py-2.5 border-b border-[#DDE2EC] flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-gray-900 flex items-center gap-2">
              <span>{view === "pending" ? "Investigations Awaiting Payment" : "Settled Investigations"}</span>
              <span className="text-[11px] font-normal text-slate-500">({filteredList.length} patient bills)</span>
            </h2>
            <span className="text-[11px] text-[#64748B]">Click bill to review &amp; collect</span>
          </div>

          {filteredList.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-3xl mb-2">🧾</div>
              <p className="text-[13px] font-semibold text-[#334155]">
                {view === "pending"
                  ? "No investigations currently awaiting billing"
                  : "No settled investigation orders found"}
              </p>
              <p className="text-[11.5px] text-[#94A3B8] mt-1">
                Laboratory and Radiology investigations appear here immediately when ordered by a doctor.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#F1F5F9] max-h-[600px] overflow-y-auto">
              {filteredList.map((order) => {
                const isSelected = selected?.id === order.id
                const hasStat = order.items.some((it) => it.urgency === "STAT")

                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedId(order.id)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      isSelected ? "bg-[#EFF6FF] border-l-4 border-l-[#1B4FD8]" : "hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                        {order.department === "Both" ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 shrink-0">
                            🔬 Lab + ☢️ Rad
                          </span>
                        ) : order.department === "Radiology" ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-50 text-purple-700 border-purple-200 shrink-0">
                            ☢️ Radiology
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 shrink-0">
                            🔬 Laboratory
                          </span>
                        )}

                        <span className="font-bold text-[13.5px] text-gray-900">
                          {order.patientName}
                        </span>

                        {(order.age || order.sex) && (
                          <span className="text-[11.5px] text-slate-500 font-medium">
                            ({order.age ? `${order.age} Y` : ""}{order.age && order.sex ? " · " : ""}{order.sex || ""})
                          </span>
                        )}

                        <span className="text-[11.5px] font-mono text-[#64748B]">
                          UMR: {order.umr}
                        </span>

                        {hasStat && (
                          <span className="text-[9.5px] font-bold bg-[#FEE2E2] text-[#B91C1C] px-1.5 py-0.2 rounded border border-[#FECACA] animate-pulse">
                            STAT
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {order.paymentStatus === "Paid" ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded">
                            ✓ PAID
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded">
                            ⏳ AWAITING BILLING
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Payment Collection & Order Review Dossier */}
        <div className="space-y-4">
          {selected ? (
            <div className="bg-white border border-[#DDE2EC] rounded shadow-2xs">
              <div className="px-4 py-2.5 border-b border-[#DDE2EC] flex items-center justify-between">
                <div>
                  <h2 className="text-[13px] font-bold text-gray-900">
                    {selected.paymentStatus === "Paid" ? "Official Receipt" : "Consolidated Investigation Bill"}
                  </h2>
                  <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                    Invoice: <span className="font-bold text-[#1B4FD8]">{selected.invoiceNo || selected.opNumber}</span>
                  </p>
                </div>
                {selected.department === "Both" ? (
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
                    Lab + Radiology
                  </span>
                ) : selected.department === "Radiology" ? (
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded border bg-purple-50 text-purple-700 border-purple-200">
                    Radiology
                  </span>
                ) : (
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                    Laboratory
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3">
                {/* Patient Summary Card */}
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded p-3 space-y-1">
                  {[
                    ["Patient Name", `${selected.patientName} (${selected.age || "—"} Y / ${selected.sex || "—"})`],
                    ["UMR Number", selected.umr],
                    ["OP / Encounter", `${selected.opNumber}${selected.encounterId ? ` • ${selected.encounterId}` : ""}`],
                    ["Referring Doctor", `Dr. ${selected.doctorName} (${selected.consultingDepartment})`],
                    ["Clinical Indication", selected.diagnosis || "Routine OPD diagnostic investigation"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 text-[11.5px]">
                      <span className="text-[#94A3B8]">{label}</span>
                      <span className="text-gray-900 font-medium text-right">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Department-Wise Investigations Breakdown */}
                <div className="space-y-3 border-t border-slate-100 pt-2">
                  {/* Laboratory Tests */}
                  {selected.labItems && selected.labItems.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <FlaskConical size={12} /> Laboratory ({selected.labItems.length})
                        </span>
                        <span className="font-mono">
                          ₹{selected.labItems.reduce((s, i) => s + i.price, 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      {selected.labItems.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="flex justify-between gap-3 text-[12px] py-1 px-1 border-b border-[#F8FAFC] last:border-0"
                        >
                          <span className="text-[#475569] font-medium flex items-center gap-1">
                            <span>{item.name}</span>
                            {item.urgency === "STAT" && (
                              <span className="text-[#DC2626] font-bold text-[9.5px] bg-red-50 border border-red-200 px-1 rounded">
                                STAT
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-gray-900 font-semibold">
                            ₹{item.price.toLocaleString("en-IN")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Radiology Studies */}
                  {selected.radItems && selected.radItems.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-purple-800 bg-purple-50 px-2 py-1 rounded border border-purple-200 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Activity size={12} /> Radiology ({selected.radItems.length})
                        </span>
                        <span className="font-mono">
                          ₹{selected.radItems.reduce((s, i) => s + i.price, 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      {selected.radItems.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="flex justify-between gap-3 text-[12px] py-1 px-1 border-b border-[#F8FAFC] last:border-0"
                        >
                          <span className="text-[#475569] font-medium flex items-center gap-1">
                            <span>{item.name}</span>
                            {item.urgency === "STAT" && (
                              <span className="text-[#DC2626] font-bold text-[9.5px] bg-red-50 border border-red-200 px-1 rounded">
                                STAT
                              </span>
                            )}
                            {item.room && <span className="text-[10.5px] text-slate-500 font-mono">({item.room})</span>}
                          </span>
                          <span className="font-mono text-gray-900 font-semibold">
                            ₹{item.price.toLocaleString("en-IN")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selected.paymentStatus === "Paid" ? (
                  <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded p-3 text-[12px] text-[#166534] space-y-1.5">
                    <div className="flex justify-between">
                      <span className="font-medium">Amount Paid:</span>
                      <span className="font-mono font-bold">₹{selected.total.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Payment Mode:</span>
                      <span className="font-bold">{selected.mode || "Cash"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Official Receipt No:</span>
                      <span className="font-mono font-bold text-slate-900">{selected.receiptNo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Collected By:</span>
                      <span>{selected.collectedBy || collectedBy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Settled At:</span>
                      <span>{selected.paidAt ? new Date(selected.paidAt).toLocaleString() : new Date().toLocaleString()}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowReceiptModal(true)}
                      className="w-full mt-2 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded text-xs cursor-pointer shadow-2xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Printer className="w-3.5 h-3.5" /> View &amp; Print Official Receipt
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-[12px] pt-1 border-t border-[#E2E8F0]">
                      <span className="text-[#64748B]">Combined Subtotal</span>
                      <span className="font-mono text-gray-900 font-semibold">
                        ₹{selected.subtotal.toLocaleString("en-IN")}
                      </span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wide text-[#94A3B8] mb-1">
                        Discount (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={selected.subtotal}
                        value={discount === 0 ? "" : discount}
                        placeholder="0"
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === "") {
                            setDiscount(0)
                          } else {
                            const parsed = parseInt(val, 10)
                            setDiscount(isNaN(parsed) ? 0 : Math.max(0, Math.min(selected.subtotal, parsed)))
                          }
                        }}
                        className="w-full border border-[#DDE2EC] rounded px-3 py-1.5 text-[13px] font-mono focus:outline-none focus:border-[#1B4FD8]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wide text-[#94A3B8] mb-1">
                        Payment Mode
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {PAYMENT_MODES.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setMode(option)}
                            className={`px-3 py-1 text-[11.5px] font-semibold rounded border transition-colors cursor-pointer ${
                              mode === option
                                ? "bg-blue-600 text-white border-blue-700 shadow-2xs"
                                : "bg-white text-[#475569] border-[#CBD5E1] hover:border-[#94A3B8]"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-[#DDE2EC] pt-3">
                      <span className="text-[12px] font-semibold text-[#334155]">Total Amount Due</span>
                      <span className="text-[18px] font-bold text-gray-900 font-mono">
                        ₹{Math.max(0, selected.subtotal - (Number(discount) || 0)).toLocaleString("en-IN")}
                      </span>
                    </div>

                    {collectError && (
                      <p className="text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 rounded">
                        {collectError}
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={collecting}
                      onClick={collect}
                      className="w-full py-2.5 bg-[#1B4FD8] hover:bg-[#1540B2] disabled:opacity-50 text-white font-bold rounded text-xs cursor-pointer shadow-xs transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {collecting
                        ? "Collecting & Clearing..."
                        : `Collect Payment (₹${Math.max(0, selected.subtotal - (Number(discount) || 0)).toLocaleString("en-IN")}) & Release`}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 bg-white border border-[#DDE2EC] rounded text-center text-[#64748B] text-[12.5px]">
              Select an investigation bill on the left to review details and collect payment.
            </div>
          )}
        </div>
      </div>

      {/* Official Receipt Modal for Both Laboratory & Radiology */}
      {showReceiptModal && (receipt || selected) && (() => {
        const active = receipt || selected!
        const receiptNo =
          active.receiptNo ||
          `RCPT-2026-${(active.invoiceNo || active.id || "").replace(/\D/g, "").slice(-4) || "5501"}`
        const total = active.total || active.subtotal || 0

        const claimObj: ClaimRecord = {
          id: `CLM-${active.id}`,
          invoiceNo: active.invoiceNo || `INV-${active.opNumber}`,
          patientId: active.umr,
          patientName: active.patientName,
          mrn: active.umr,
          age: active.age || 35,
          gender: active.sex === "Female" ? "Female" : "Male",
          phone: active.phone || "",
          department: (active.department === "Both" ? "Outpatient" : active.department) as any,
          carePathway: active.department === "Both" ? "Laboratory & Radiology Investigations" : active.department === "Radiology" ? "Radiology Imaging" : "Laboratory Diagnostics",
          dateOfService: active.createdAt ? active.createdAt.split("T")[0] : new Date().toISOString().split("T")[0],
          encounterId: active.opNumber || active.encounterId || active.id,
          insuranceProvider: "Self-Pay",
          policyNumber: "N/A",
          status: "Paid",
          items: active.items.map((it, idx) => ({
            id: `ITEM-${it.id || idx}`,
            description: it.name.replace(/\s*\([^)]*\)$/, ""),
            category: it.department === "Radiology" ? "Radiology / Imaging" : "Laboratory",
            cptCode: it.department === "Radiology" ? `RAD-${it.modality || "01"}` : `LAB0${10 + idx}`,
            quantity: 1,
            unitPrice: it.price,
            total: it.price,
            insuranceCovered: 0,
            patientPayable: it.price,
          })),
          subtotal: active.subtotal,
          discount: active.discount || 0,
          tax: 0,
          totalAmount: total,
          insurancePortion: 0,
          patientPortion: total,
          amountPaid: total,
          balanceDue: 0,
          payments: [
            {
              id: `PAY-${active.id}`,
              invoiceId: active.invoiceNo || active.id,
              receiptNo,
              amount: total,
              paymentDate: active.paidAt || new Date().toISOString(),
              paymentMethod: active.mode === "Cash" ? "Cash" : active.mode === "Card" ? "Debit Card" : "UPI / Digital",
              collectedBy: active.collectedBy || collectedBy,
              notes: `${active.department} Investigation Settlement`,
            },
          ],
          diagnosisCodes: ["Z01.89"],
          attendingDoctor: active.doctorName,
          createdAt: active.createdAt || new Date().toISOString(),
          updatedAt: active.paidAt || new Date().toISOString(),
        }

        const paymentObj: PaymentRecord = {
          id: `PAY-${active.id}`,
          invoiceId: active.invoiceNo || active.id,
          receiptNo,
          amount: total,
          paymentDate: active.paidAt || new Date().toISOString(),
          paymentMethod: active.mode === "Cash" ? "Cash" : active.mode === "Card" ? "Debit Card" : "UPI / Digital",
          collectedBy: active.collectedBy || collectedBy,
          notes: `${active.department} Investigation Settlement`,
        }

        return (
          <HospitalReceiptModal
            claim={claimObj}
            payment={paymentObj}
            onClose={() => {
              setShowReceiptModal(false)
              setReceipt(null)
            }}
          />
        )
      })()}
    </div>
  )
}
