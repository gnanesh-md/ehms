import React, { useMemo, useState } from "react"
import { LabOrder, LabOrderDatabase, LabOrderTest } from "../../services/labOrdersDb"
import {
  ExtendedRadiologyRecord,
  RadiologyWorkflowDb,
} from "../../services/radiologyWorkflowDb"
import CompleteLabReportModal from "../laboratory/CompleteLabReportModal"
import RadiologyReportPdfModal from "../radiology/RadiologyReportPdfModal"

/**
 * Every laboratory and radiology report on file for one patient, as the doctor
 * sees it from the patient record.
 *
 * Reports are matched on the permanent UMR, never on the name -- two patients
 * can share a name, and showing a doctor someone else's report is far worse than
 * showing none.
 *
 * A report counts as ready only once the department has released it: a lab order
 * that is Completed and paid (the same rule the lab's own "Approved reports" list
 * uses) and a radiology study whose report is Finalized. Anything earlier is
 * listed as pending with where it is stuck, so "no report" is never confused
 * with "not done yet".
 */

type Filter = "all" | "lab" | "radiology"

type ReportRow =
  | { kind: "lab"; id: string; at: number; ready: boolean; order: LabOrder }
  | {
      kind: "radiology"
      id: string
      at: number
      ready: boolean
      study: ExtendedRadiologyRecord
    }

function toEpoch(value?: string): number {
  if (!value) return 0
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

function labTimestamp(order: LabOrder): number {
  const verified = order.tests
    .map((t) => toEpoch(t.verifiedAt) || toEpoch(t.resultedAt))
    .filter(Boolean)
  return (
    toEpoch(order.processingCompletedAt) ||
    (verified.length ? Math.max(...verified) : 0) ||
    toEpoch(order.updatedAt) ||
    toEpoch(order.createdAt)
  )
}

function isLabReady(order: LabOrder): boolean {
  return order.status === "Completed" && order.billing?.status === "Paid"
}

function labPendingReason(order: LabOrder): string {
  if (order.billing?.status !== "Paid") return "Awaiting payment at reception"
  switch (order.status) {
    case "Billed":
      return "Paid · sample not collected yet"
    case "Sample Collected":
      return "Sample collected · awaiting processing"
    case "In Progress":
      return "Processing in the lab"
    default:
      return order.status
  }
}

function testIsAbnormal(test: LabOrderTest): boolean {
  if (test.flag) return true
  return Object.values(test.results || {}).some((r) => !!r?.flag)
}

function testIsCritical(test: LabOrderTest): boolean {
  if (test.flag === "Critical") return true
  return Object.values(test.results || {}).some((r) => r?.flag === "Critical")
}

function radiologyPendingReason(study: ExtendedRadiologyRecord): string {
  if (!study.isPaid) return "Awaiting payment at reception"
  switch (study.normalizedReportStatus) {
    case "Awaiting Scan":
      return study.normalizedStatus === "IN PROGRESS"
        ? "Scan in progress"
        : "Awaiting scan"
    case "Draft":
      return "Radiologist is drafting the report"
    case "Submitted for Review":
      return "Report under senior review"
    case "Needs Correction":
    case "Correction Required":
      return "Report returned for correction"
    default:
      return "Scan done · awaiting report"
  }
}

function formatDate(epoch: number): string {
  if (!epoch) return "--"
  return new Date(epoch).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Released lab + radiology reports per patient, keyed by upper-cased UMR.
 * Reads each store once, so it is cheap enough for a whole inbox list.
 */
export function countReadyReports(umrs: string[]): Map<string, number> {
  const wanted = new Set(umrs.map((u) => u.trim().toUpperCase()).filter(Boolean))
  const counts = new Map<string, number>()
  if (wanted.size === 0) return counts
  const add = (raw?: string) => {
    const key = (raw || "").trim().toUpperCase()
    if (wanted.has(key)) counts.set(key, (counts.get(key) || 0) + 1)
  }
  LabOrderDatabase.getOrders()
    .filter(isLabReady)
    .forEach((o) => add(o.umr))
  RadiologyWorkflowDb.getStudies()
    .filter((s) => s.normalizedReportStatus === "Finalized")
    .forEach((s) => add(s.umr || s.mrn))
  return counts
}

export default function PatientReportsPanel({
  umr,
  revision = 0,
}: {
  umr: string
  /** Bumps whenever lab or radiology data changes, so new reports appear live. */
  revision?: number
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [openLab, setOpenLab] = useState<LabOrder | null>(null)
  const [openStudy, setOpenStudy] = useState<ExtendedRadiologyRecord | null>(null)

  const rows: ReportRow[] = useMemo(() => {
    const key = umr.trim().toUpperCase()
    if (!key) return []

    const lab: ReportRow[] = LabOrderDatabase.getOrdersForPatient(key)
      .filter((o) => o.status !== "Cancelled")
      .map((order) => ({
        kind: "lab",
        id: order.id,
        at: labTimestamp(order),
        ready: isLabReady(order),
        order,
      }))

    const radiology: ReportRow[] = RadiologyWorkflowDb.getStudies()
      .filter((s) => (s.umr || s.mrn || "").trim().toUpperCase() === key)
      .map((study) => ({
        kind: "radiology",
        id: study.id,
        at:
          RadiologyWorkflowDb.getReportFinalizedTimestamp(study) ||
          RadiologyWorkflowDb.getOrderCreationTimestamp(study),
        ready: study.normalizedReportStatus === "Finalized",
        study,
      }))

    // Ready reports first, newest at the top within each group.
    return [...lab, ...radiology].sort((a, b) =>
      a.ready !== b.ready ? (a.ready ? -1 : 1) : b.at - a.at,
    )
    // `revision` is the refresh signal; the stores are read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [umr, revision])

  const counts = useMemo(
    () => ({
      all: rows.length,
      lab: rows.filter((r) => r.kind === "lab").length,
      radiology: rows.filter((r) => r.kind === "radiology").length,
      ready: rows.filter((r) => r.ready).length,
    }),
    [rows],
  )

  const shown = filter === "all" ? rows : rows.filter((r) => r.kind === filter)

  return (
    <section className="bg-white border border-[#DDE2EC] rounded">
      <div className="px-4 py-2.5 border-b border-[#DDE2EC] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-[13px] font-bold text-gray-900">
            Lab &amp; radiology reports
          </h3>
          <span className="text-[11px] text-[#94A3B8]">
            {counts.all === 0
              ? "Nothing ordered for this patient yet"
              : `${counts.ready} ready · ${counts.all - counts.ready} pending`}
          </span>
        </div>
        {counts.all > 0 && (
          <div className="flex items-center gap-1" role="tablist" aria-label="Report type">
            {(
              [
                { key: "all", label: "All" },
                { key: "lab", label: "Laboratory" },
                { key: "radiology", label: "Radiology" },
              ] as { key: Filter; label: string }[]
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={filter === option.key}
                onClick={() => setFilter(option.key)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded border transition-colors ${
                  filter === option.key
                    ? "bg-[#1B4FD8] text-white border-[#1B4FD8]"
                    : "bg-white text-[#475569] border-[#E2E8F0] hover:bg-slate-50"
                }`}
              >
                {option.label} ({counts[option.key]})
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-4 text-[12px] text-[#64748B] italic">
          {counts.all === 0
            ? "No laboratory or radiology investigations are on file for this patient."
            : filter === "lab"
              ? "No laboratory investigations are on file for this patient."
              : "No radiology investigations are on file for this patient."}
        </p>
      ) : (
        <div className="divide-y divide-[#F1F5F9]">
          {shown.map((row) =>
            row.kind === "lab" ? (
              <LabRow
                key={`lab-${row.id}`}
                order={row.order}
                ready={row.ready}
                at={row.at}
                onView={() => setOpenLab(row.order)}
              />
            ) : (
              <RadiologyRow
                key={`rad-${row.id}`}
                study={row.study}
                ready={row.ready}
                at={row.at}
                onView={() => setOpenStudy(row.study)}
              />
            ),
          )}
        </div>
      )}

      {openLab && (
        <CompleteLabReportModal order={openLab} onClose={() => setOpenLab(null)} />
      )}
      {openStudy && (
        <RadiologyReportPdfModal study={openStudy} onClose={() => setOpenStudy(null)} />
      )}
    </section>
  )
}

function KindTag({ kind }: { kind: "lab" | "radiology" }) {
  return kind === "lab" ? (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]">
      LAB
    </span>
  ) : (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F0F9FF] text-[#0369A1] border border-[#BAE6FD]">
      RADIOLOGY
    </span>
  )
}

function StateTag({ ready, pendingText }: { ready: boolean; pendingText: string }) {
  return ready ? (
    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#15803D]">
      Report ready
    </span>
  ) : (
    <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">
      {pendingText}
    </span>
  )
}

function ViewButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="shrink-0 h-7 px-3 rounded bg-[#1B4FD8] text-white text-[11.5px] font-semibold hover:bg-[#1740B4] transition-colors"
    >
      View report
    </button>
  )
}

function LabRow({
  order,
  ready,
  at,
  onView,
}: {
  order: LabOrder
  ready: boolean
  at: number
  onView: () => void
}) {
  const abnormal = order.tests.filter(testIsAbnormal).length
  const critical = order.tests.filter(testIsCritical).length

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <KindTag kind="lab" />
          <span className="text-[12px] font-semibold text-gray-900 font-mono">{order.id}</span>
          <StateTag ready={ready} pendingText={labPendingReason(order)} />
          {ready && critical > 0 && (
            <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#B91C1C]">
              {critical} critical
            </span>
          )}
          {ready && abnormal > critical && (
            <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-[#FFF7ED] text-[#C2410C]">
              {abnormal - critical} abnormal
            </span>
          )}
        </div>
        <div className="text-[12px] text-[#334155] mt-1 break-words">
          {order.tests.map((t) => t.name).join(", ")}
        </div>
        <div className="text-[11px] text-[#94A3B8] mt-0.5">
          {ready ? "Released" : "Ordered"} {formatDate(ready ? at : toEpoch(order.createdAt))}
          {order.doctorName ? ` · ordered by ${order.doctorName}` : ""}
        </div>
      </div>
      {ready && <ViewButton onClick={onView} label={`View lab report ${order.id}`} />}
    </div>
  )
}

function RadiologyRow({
  study,
  ready,
  at,
  onView,
}: {
  study: ExtendedRadiologyRecord
  ready: boolean
  at: number
  onView: () => void
}) {
  const impression = Array.isArray(study.impression)
    ? study.impression.filter(Boolean).join(" ")
    : study.impression
      ? String(study.impression)
      : ""

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <KindTag kind="radiology" />
          <span className="text-[12px] font-semibold text-gray-900">{study.study}</span>
          {study.modality && (
            <span className="text-[10.5px] font-mono text-[#64748B]">{study.modality}</span>
          )}
          <StateTag ready={ready} pendingText={radiologyPendingReason(study)} />
        </div>
        {ready && impression && (
          <p className="text-[12px] text-[#334155] mt-1 line-clamp-2">
            <span className="font-semibold">Impression: </span>
            {impression}
          </p>
        )}
        <div className="text-[11px] text-[#94A3B8] mt-0.5">
          {ready ? "Finalized" : "Ordered"} {formatDate(at)}
          {ready && (study.finalizedBy || study.radiologist)
            ? ` · ${study.finalizedBy || study.radiologist}`
            : ""}
        </div>
      </div>
      {ready && <ViewButton onClick={onView} label={`View radiology report for ${study.study}`} />}
    </div>
  )
}
