"use client";

import React, { useState, useEffect } from "react";
import { AppDialog } from "@/components/shared/app-dialog";
import { IncidentRecord } from "@/types/incident";
import { UserIdentity } from "@/lib/identity";
import { CompletionApprovalCard } from "./completion-approval-card";
import {
  ApprovalRouteResolution,
  CompletionApprovalRecord,
  CompletionApprovalHistoryRecord,
} from "@/lib/completion-approval-service";
import { ShieldCheck, UserCheck } from "lucide-react";

interface CompletionApprovalModalProps {
  incident: IncidentRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void | Promise<void>;
}

export function CompletionApprovalModal({
  incident,
  isOpen,
  onClose,
  onUpdated,
}: CompletionApprovalModalProps) {
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [approval, setApproval] = useState<CompletionApprovalRecord | null>(null);
  const [approvalRoute, setApprovalRoute] = useState<ApprovalRouteResolution | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<CompletionApprovalHistoryRecord[]>([]);
  const [physicalProgress, setPhysicalProgress] = useState(0);
  const [hasFinalEvidence, setHasFinalEvidence] = useState(false);
  const [workflowPermissions, setWorkflowPermissions] = useState<{
    canSubmitCompletion: boolean;
    submitCompletionReason?: string;
    canApproveCoordinator: boolean;
    approveCoordinatorReason?: string;
    canFinalApprove?: boolean;
    finalApproveReason?: string;
    canClose: boolean;
    closeReason?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshApprovalData = async () => {
    if (!incident) return;
    setLoading(true);
    try {
      const [identityRes, permRes, compRes, progRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch(`/api/incidents/${encodeURIComponent(incident.id)}/permissions`, { cache: "no-store" }),
        fetch(`/api/incidents/${encodeURIComponent(incident.id)}/completion`, { cache: "no-store" }),
        fetch(`/api/incidents/${encodeURIComponent(incident.id)}/progress`, { cache: "no-store" }),
      ]);

      const [identityJson, permJson, compJson, progJson] = await Promise.all([
        identityRes.ok ? identityRes.json() : null,
        permRes.ok ? permRes.json() : null,
        compRes.ok ? compRes.json() : null,
        progRes.ok ? progRes.json() : null,
      ]);

      if (identityJson) {
        setIdentity(identityJson.user || identityJson);
      }
      if (permJson?.data) {
        setWorkflowPermissions(permJson.data);
      }
      if (compJson?.data) {
        setApproval(compJson.data.approval || null);
        setApprovalRoute(compJson.data.route || null);
        setApprovalHistory(compJson.data.history || []);
      }
      if (progJson?.data) {
        setPhysicalProgress(Number(progJson.data.latestProgress) || 0);
        setHasFinalEvidence(Boolean(progJson.data.hasFinalEvidence));
      }
    } catch (err) {
      console.error("[CompletionApprovalModal] Gagal memuat data persetujuan:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && incident) {
      void refreshApprovalData();
    }
  }, [isOpen, incident?.id]);

  if (!isOpen || !incident) return null;

  const isManagerMode = identity?.role?.toLowerCase() === "bm";

  return (
    <AppDialog
      open={isOpen}
      onClose={onClose}
      title={
        isManagerMode
          ? "Persetujuan Akhir & Case Close"
          : "Review Penyelesaian Koordinator"
      }
      className="sm:!max-w-3xl"
    >
      <div className="flex flex-col max-h-[85vh]">
        {/* Modal Header Context */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/70 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-[#1D5AA6] dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-200 dark:border-blue-800">
              {isManagerMode ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <UserCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                {isManagerMode
                  ? "Persetujuan Akhir & Case Close"
                  : "Review Penyelesaian Koordinator"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {incident.storeName} ({incident.branch}) • Tiket: {incident.maintenanceTicket?.ticketId || incident.id}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-4">
          <CompletionApprovalCard
            incident={incident}
            approval={approval}
            route={approvalRoute}
            history={approvalHistory}
            latestProgress={physicalProgress}
            hasFinalEvidence={hasFinalEvidence}
            userRole={identity?.role}
            userBranch={identity?.branch}
            userSystemRole={identity?.systemRole}
            canSubmitCompletion={Boolean(workflowPermissions?.canSubmitCompletion)}
            submitCompletionReason={workflowPermissions?.submitCompletionReason}
            canApproveCoordinator={Boolean(workflowPermissions?.canApproveCoordinator)}
            approveCoordinatorReason={workflowPermissions?.approveCoordinatorReason}
            canFinalApprove={Boolean(workflowPermissions?.canFinalApprove ?? workflowPermissions?.canClose)}
            finalApproveReason={workflowPermissions?.finalApproveReason ?? workflowPermissions?.closeReason}
            canClose={Boolean(workflowPermissions?.canClose)}
            closeReason={workflowPermissions?.closeReason}
            readOnly={false}
            onRefresh={() => {
              void refreshApprovalData();
              void onUpdated?.();
            }}
          />
        </div>
      </div>
    </AppDialog>
  );
}
