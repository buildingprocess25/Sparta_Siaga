"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, AlertTriangle, FileText, Building, User, ChevronRight, CheckCircle2, Eye, Activity } from "lucide-react";
import { DisasterType, getRoleDisplayLabel } from "@/types/incident";
import { Earthquake } from "@/types/disaster";
import { FieldPhotoUploader, PhotoData } from "./field-photo-uploader";
import { UserIdentity } from "@/lib/identity";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

interface ManualIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRole: string;
  currentUser?: UserIdentity | null;
  rawStores: any[];
  activeEarthquakes?: Earthquake[];
  onConfirm: (data: any) => void;
}

const availableCategories = [
  "Dinding/Struktur",
  "Kaca/Pintu",
  "Rak Barang",
  "Kelistrikan/AC",
  "Plafon",
  "Brankas/Kasir",
];

const emptyPhoto: PhotoData = { file: null, previewUrl: null, source: null, reporterRelation: null, capturedAt: null };

export function ManualIncidentModal({
  isOpen,
  onClose,
  activeRole,
  currentUser,
  rawStores,
  activeEarthquakes = [],
  onConfirm,
}: ManualIncidentModalProps) {
  // Lock background scroll when modal is open
  useBodyScrollLock(isOpen);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [disasterType, setDisasterType] = useState<DisasterType>("flood");
  const [selectedEarthquakeEventId, setSelectedEarthquakeEventId] = useState<string>("");
  const [tkpType, setTkpType] = useState<"Toko" | "DC">("Toko");
  const [storeId, setStoreId] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [severity, setSeverity] = useState("Sedang");
  const [operationalStatus, setOperationalStatus] = useState("Buka Normal");
  const [notes, setNotes] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDiagnostic, setSearchDiagnostic] = useState<string | null>(null);
  const [selectedStoreObj, setSelectedStoreObj] = useState<any>(null);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchError(null);
      setSearchDiagnostic(null);
      return;
    }

    const delay = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      setSearchDiagnostic(null);
      try {
        const typeParam = tkpType === "DC" ? "FACILITY" : "TOKO";
        const res = await fetch(
          `/api/stores/search?q=${encodeURIComponent(searchQuery.trim())}&type=${typeParam}&limit=10`
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setSearchResults(data.data || []);
          setSearchDiagnostic(data.message || null);
        } else {
          setSearchError(data.error || (tkpType === "DC" ? "Gagal mencari data fasilitas" : "Gagal mencari data toko"));
          setSearchResults([]);
        }
      } catch (err) {
        console.error("Failed to search locations:", err);
        setSearchError("Gagal menghubungi server pencarian");
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [searchQuery, tkpType]);

  const [photos, setPhotos] = useState<{
    depan: PhotoData;
    dalam: PhotoData;
    kiri: PhotoData;
    kanan: PhotoData;
    detailDC: PhotoData;
  }>({
    depan: emptyPhoto,
    dalam: emptyPhoto,
    kiri: emptyPhoto,
    kanan: emptyPhoto,
    detailDC: emptyPhoto,
  });

  const [identity, setIdentity] = useState<UserIdentity | null>(currentUser || null);

  useEffect(() => {
    if (currentUser) {
      setIdentity(currentUser);
      return;
    }
    if (isOpen) {
      fetch("/api/auth/me")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setIdentity(data.user || data);
        })
        .catch(() => {});
    }
  }, [isOpen, currentUser]);

  const isHOScope = identity?.scope === "HO";

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const userRole = (identity?.businessRole || identity?.role || activeRole || "").toLowerCase();
      if (userRole === "bes") {
        setTkpType("DC");
        setStoreId("");
        setSelectedStoreObj(null);
        setSearchQuery("");
        setSearchResults([]);
      } else if (!isHOScope && identity?.branch) {
        setTkpType("Toko");
        const assignedStore = rawStores.find(
          (s) => s.cabang?.toLowerCase() === identity.branch?.toLowerCase()
        );
        if (assignedStore) {
          setStoreId(assignedStore.id || assignedStore.kode_toko);
          setSelectedStoreObj(assignedStore);
          setSearchQuery("");
        } else {
          setStoreId("");
          setSelectedStoreObj(null);
          setSearchQuery("");
        }
      } else if (isHOScope) {
        setTkpType("Toko");
        setStoreId("");
        setSelectedStoreObj(null);
        setSearchQuery("");
      }
      setStep(1);
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, isHOScope, identity, rawStores, activeRole]);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleNext = () => {
    if (step === 1) {
      if (!storeId && !selectedStoreObj) {
        alert("Pilih lokasi terlebih dahulu!");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const requiredPhotos = photos.depan.file && photos.dalam.file && photos.kiri.file && photos.kanan.file;
      const isDCValid = tkpType === "DC" ? photos.detailDC.file : true;
      if (!requiredPhotos || !isDCValid) {
        alert("Laporan manual WAJIB melampirkan seluruh sisi foto yang diminta.");
        return;
      }

      // Validate that all gallery photos have mandatory reasons and provider identity
      const allSlots = [
        { name: "Foto Tampak 1 (Depan)", data: photos.depan },
        { name: "Foto Tampak 2 (Dalam)", data: photos.dalam },
        { name: "Foto Tampak 3 (Kiri)", data: photos.kiri },
        { name: "Foto Tampak 4 (Kanan)", data: photos.kanan },
      ];
      if (tkpType === "DC") {
        allSlots.push({ name: "Foto Titik Detail DC", data: photos.detailDC });
      }

      for (const slot of allSlots) {
        if (slot.data.source === "gallery") {
          if (!slot.data.galleryReason?.trim()) {
            alert(`Slot ${slot.name} menggunakan foto galeri tetapi belum menyertakan alasan penggunaan.`);
            return;
          }
          if (slot.data.reporterRelation === "received") {
            if (!slot.data.sourceProvider?.trim() || !slot.data.receiptContext?.trim()) {
              alert(`Slot ${slot.name} bersumber dari pihak lain tetapi belum menyertakan identitas pemberi dan konteks penerimaan.`);
              return;
            }
          }
        }
      }

      setStep(3);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (identity?.systemRole === "ADMIN") {
      alert("Akun System Administrator tidak diizinkan membuat laporan operasional.");
      return;
    }
    const store = selectedStoreObj || rawStores.find(
      (s) => s.kode_toko === storeId || s.id === storeId
    );

    // Map photos to detailed metadata objects
    const photoDetails = [
      {
        url: photos.depan.previewUrl || "",
        source: photos.depan.source || "camera",
        reporterRelation: photos.depan.reporterRelation,
        galleryReason: photos.depan.galleryReason,
        sourceProvider: photos.depan.sourceProvider,
        receiptContext: photos.depan.receiptContext,
        capturedAt: photos.depan.capturedAt,
        slotLabel: "Foto Tampak 1",
      },
      {
        url: photos.dalam.previewUrl || "",
        source: photos.dalam.source || "camera",
        reporterRelation: photos.dalam.reporterRelation,
        galleryReason: photos.dalam.galleryReason,
        sourceProvider: photos.dalam.sourceProvider,
        receiptContext: photos.dalam.receiptContext,
        capturedAt: photos.dalam.capturedAt,
        slotLabel: "Foto Tampak 2",
      },
      {
        url: photos.kiri.previewUrl || "",
        source: photos.kiri.source || "camera",
        reporterRelation: photos.kiri.reporterRelation,
        galleryReason: photos.kiri.galleryReason,
        sourceProvider: photos.kiri.sourceProvider,
        receiptContext: photos.kiri.receiptContext,
        capturedAt: photos.kiri.capturedAt,
        slotLabel: "Foto Tampak 3",
      },
      {
        url: photos.kanan.previewUrl || "",
        source: photos.kanan.source || "camera",
        reporterRelation: photos.kanan.reporterRelation,
        galleryReason: photos.kanan.galleryReason,
        sourceProvider: photos.kanan.sourceProvider,
        receiptContext: photos.kanan.receiptContext,
        capturedAt: photos.kanan.capturedAt,
        slotLabel: "Foto Tampak 4",
      },
    ];
    if (tkpType === "DC" && photos.detailDC.previewUrl) {
      photoDetails.unshift({
        url: photos.detailDC.previewUrl,
        source: photos.detailDC.source || "camera",
        reporterRelation: photos.detailDC.reporterRelation,
        galleryReason: photos.detailDC.galleryReason,
        sourceProvider: photos.detailDC.sourceProvider,
        receiptContext: photos.detailDC.receiptContext,
        capturedAt: photos.detailDC.capturedAt,
        slotLabel: "Foto Titik Detail DC",
      });
    }

    const matchedEq = disasterType === "earthquake" && selectedEarthquakeEventId
      ? activeEarthquakes.find((e) => (e.canonicalEventKey || e.id) === selectedEarthquakeEventId)
      : undefined;

    const resolvedLocationKind = selectedStoreObj?.locationKind || (tkpType === "DC" ? "FACILITY" : "STORE");
    const resolvedLocationId = selectedStoreObj?.locationId || (resolvedLocationKind === "FACILITY" ? (selectedStoreObj?.id || storeId).replace(/^FACILITY:/, "") : storeId);
    const resolvedLocationCode = selectedStoreObj?.kode_toko || storeId;
    const resolvedLocationName = selectedStoreObj?.nama_toko || (tkpType === "DC" ? "Fasilitas Cabang" : "Lokasi Tidak Diketahui");
    const resolvedLocationType = selectedStoreObj?.facilityType || (tkpType === "DC" ? "DC" : "STORE");

    const derivedBranch = store?.cabang || identity?.branch || "Nasional";
    const derivedCity = (store as any)?.kab_kota || store?.cabang || identity?.branch || "Kota Cabang";

    onConfirm({
      disasterType,
      reportOrigin: "manual",
      reporter: {
        userId: identity?.id || identity?.userId,
        name: identity?.name || "Pelapor Lapangan",
        nik: identity?.nik || null,
        role: identity?.businessRole || identity?.role || activeRole,
        branch: identity?.branch || store?.cabang || null,
        storeId: storeId || null,
      },
      earthquakeEventId: selectedEarthquakeEventId ? selectedEarthquakeEventId : undefined,
      earthquakeSource: matchedEq?.source || (selectedEarthquakeEventId ? "BMKG" : undefined),
      earthquakeProvenance: selectedEarthquakeEventId
        ? `Ditautkan manual oleh pelapor ke kejadian ${selectedEarthquakeEventId}`
        : undefined,
      tkpType,
      storeId,
      storeName: resolvedLocationName,
      branch: derivedBranch,
      locationCity: derivedCity,
      locationKind: resolvedLocationKind,
      locationId: resolvedLocationId,
      locationCodeSnapshot: resolvedLocationCode,
      locationNameSnapshot: resolvedLocationName,
      locationTypeSnapshot: resolvedLocationType,
      facilityType: selectedStoreObj?.facilityType,
      categories,
      severity,
      operationalStatus,
      notes,
      photos: photoDetails,
    });

    // Reset state after submit handled in parent, but clean up local urls
    if (photos.depan.previewUrl) URL.revokeObjectURL(photos.depan.previewUrl);
    if (photos.dalam.previewUrl) URL.revokeObjectURL(photos.dalam.previewUrl);
    if (photos.kiri.previewUrl) URL.revokeObjectURL(photos.kiri.previewUrl);
    if (photos.kanan.previewUrl) URL.revokeObjectURL(photos.kanan.previewUrl);
    if (photos.detailDC.previewUrl) URL.revokeObjectURL(photos.detailDC.previewUrl);

    setPhotos({
      depan: emptyPhoto,
      dalam: emptyPhoto,
      kiri: emptyPhoto,
      kanan: emptyPhoto,
      detailDC: emptyPhoto,
    });
  };

  if (!isOpen) return null;

  const userRole = (identity?.businessRole || identity?.role || activeRole || "").toLowerCase();
  const isSystemAdmin = identity?.systemRole === "ADMIN";
  const isBMMRole = !isSystemAdmin && userRole === "bm";
  const isBESRole = !isSystemAdmin && userRole === "bes";
  const isBMSRole = !isSystemAdmin && !isBMMRole && !isBESRole;

  const store = selectedStoreObj || rawStores.find(s => s.kode_toko === storeId || s.id === storeId);

  return (
    <div className="fixed inset-0 z-[6000] flex md:items-center justify-center p-0 md:p-4 bg-slate-50 md:bg-slate-950/70 md:backdrop-blur-sm animate-in fade-in overscroll-none touch-none select-none">
      {/* Full screen on mobile, large dialog on desktop */}
      <div className="bg-slate-50 md:bg-white w-full h-full md:h-auto md:max-h-[90dvh] md:max-w-4xl md:rounded-[24px] overflow-hidden md:shadow-2xl flex flex-col animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:zoom-in-95 duration-200 ease-out touch-auto select-text">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-4 bg-[#123B6D] text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/10">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">
                Pelaporan Insiden Operasional
              </h3>
              <p className="text-[10px] text-blue-200">
                Langkah {step} dari 3
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-1 w-full bg-slate-200 shrink-0">
          <div
            className="h-full bg-[#D9272E] transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-8">

          {/* STEP 1: Pelapor & Lokasi & Kondisi */}
          {step === 1 && (
            <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-right-4">

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-[#123B6D] uppercase tracking-wider mb-4 flex items-center gap-2">
                  <User className="w-4 h-4" /> 1. Data Pelapor
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Nama Pelapor</label>
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 flex items-center justify-between">
                      <span className="truncate">{identity?.name || "Memuat..."}</span>
                      {identity?.nik && (
                        <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">
                          NIK: {identity.nik}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Peran / Jabatan</label>
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700">
                      {identity?.systemRole === "ADMIN"
                        ? "System Admin"
                        : getRoleDisplayLabel(identity?.businessRole || identity?.role || activeRole)}
                    </div>
                  </div>
                </div>

                {identity?.systemRole === "ADMIN" && (
                  <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-xs text-red-700 font-semibold">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                    <span>Akun System Administrator hanya memiliki hak audit & pemantauan, tidak diizinkan membuat laporan operasional.</span>
                  </div>
                )}

                {(identity?.businessRole === "tim_toko" || identity?.role === "tim_toko" || activeRole === "tim_toko") && (
                  <div className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-xs text-amber-800 font-semibold">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span>Pelaporan mandiri oleh Tim Toko saat ini dinonaktifkan sementara. Laporan ditangani langsung melalui tim operasional cabang (BMS/BES).</span>
                  </div>
                )}
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-[#123B6D] uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Building className="w-4 h-4" /> 2. Lokasi TKP
                </h4>

                {/* Role-locked TKP Selector */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <button
                    type="button"
                    disabled={isBESRole}
                    onClick={() => {
                      if (isBESRole) return;
                      setTkpType("Toko");
                      setStoreId("");
                      setSelectedStoreObj(null);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                      tkpType === "Toko"
                        ? "border-[#1D5AA6] bg-[#1D5AA6]/5 text-[#1D5AA6]"
                        : isBESRole
                        ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed opacity-60"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Building className="w-6 h-6 mb-2" />
                    <span className="font-bold text-sm">Gerai / Toko</span>
                    <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                      {isBESRole ? "Khusus Petugas BMS" : "Operasional BMS"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isBMSRole}
                    onClick={() => {
                      if (isBMSRole) return;
                      setTkpType("DC");
                      setStoreId("");
                      setSelectedStoreObj(null);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                      tkpType === "DC"
                        ? "border-[#1D5AA6] bg-[#1D5AA6]/5 text-[#1D5AA6]"
                        : isBMSRole
                        ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed opacity-60"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Building className="w-6 h-6 mb-2" />
                    <span className="font-bold text-sm">Fasilitas / DC</span>
                    <span className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                      {isBMSRole ? "Khusus Petugas BES" : "DC, Depo, Gudang (BES)"}
                    </span>
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">
                    {tkpType === "DC" ? "Cari & Pilih Fasilitas / Gudang / DC:" : "Cari & Pilih Lokasi Gerai / Toko:"}
                  </label>

                  {selectedStoreObj ? (
                    <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between gap-3 animate-in fade-in">
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-blue-950 truncate flex items-center gap-1.5">
                          <span className="font-mono bg-blue-100 text-blue-800 px-1 py-0.5 rounded text-[11px]">
                            {selectedStoreObj.kode_toko}
                          </span>
                          {selectedStoreObj.locationKind === "FACILITY" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                              {selectedStoreObj.facilityType || "FASILITAS"}
                            </span>
                          )}
                          <span className="truncate">{selectedStoreObj.nama_toko}</span>
                        </div>
                        <div className="text-[11px] text-blue-800 truncate mt-1">
                          Cabang: <span className="font-semibold">{selectedStoreObj.cabang || "Belum Mapping"}</span> • {selectedStoreObj.alamat}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStoreObj(null);
                          setStoreId("");
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        className="shrink-0 px-3 py-1 text-xs font-bold text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors shadow-2xs"
                      >
                        Ganti {tkpType === "DC" ? "Fasilitas" : "Toko"}
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={tkpType === "DC" ? "Ketik kode atau nama fasilitas / DC / gudang..." : "Ketik kode, nama toko, atau alamat gerai..."}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#1D5AA6] bg-slate-50"
                      />
                      {isSearching && (
                        <div className="absolute right-3 top-2.5 text-xs text-blue-600 font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                          <span>Mencari...</span>
                        </div>
                      )}

                      {/* Dropdown Results / Feedback States */}
                      {searchQuery.trim().length >= 1 && (
                        <div className="absolute z-20 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                          {isSearching ? (
                            <div className="p-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                              <span>Mencari lokasi di database...</span>
                            </div>
                          ) : searchError ? (
                            <div className="p-4 text-center text-xs text-red-600 bg-red-50/50">
                              <p className="font-semibold">{searchError}</p>
                              <p className="text-[10px] text-red-400 mt-0.5">Silakan periksa kata kunci Anda.</p>
                            </div>
                          ) : searchResults.length > 0 ? (
                            <ul>
                              {searchResults.map((s) => (
                                <li
                                  key={s.id || s.kode_toko}
                                  onClick={() => {
                                    setStoreId(s.id || s.kode_toko);
                                    setSelectedStoreObj(s);
                                    setSearchQuery("");
                                    setSearchResults([]);
                                  }}
                                  className="p-3 text-sm text-slate-700 hover:bg-blue-50/60 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                                >
                                  <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                                    <span className="font-mono text-blue-600 bg-blue-50 px-1 py-0.5 rounded text-[11px]">
                                      {s.kode_toko}
                                    </span>
                                    {s.locationKind === "FACILITY" && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                                        {s.facilityType || "FASILITAS"}
                                      </span>
                                    )}
                                    <span className="truncate">{s.nama_toko}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                                    Cabang: <span className="font-medium text-slate-700">{s.cabang || "Belum Mapping"}</span> • {s.alamat}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="p-4 text-center text-xs">
                              {tkpType === "DC" ? (
                                <div className="space-y-2 text-left">
                                  <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                                    <Building className="w-4 h-4 text-amber-600 shrink-0" />
                                    <span>Fasilitas Tidak Ditemukan</span>
                                  </div>
                                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1">
                                    <p className="font-semibold">
                                      {searchDiagnostic || `Belum ada fasilitas yang terhubung dengan cabang Anda (${identity?.branch || "Cabang"}). Hubungi Admin untuk memverifikasi master fasilitas.`}
                                    </p>
                                    <p className="text-[11px] text-amber-700/90">
                                      Kata kunci: &quot;{searchQuery}&quot;. Seluruh 67 fasilitas nasional dikelola dan dipetakan oleh Administrator.
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <p className="font-bold text-slate-700">Tidak ada gerai/toko ditemukan</p>
                                  <p className="text-[11px] text-slate-400 mt-1">
                                    Kata kunci: <span className="font-medium text-slate-600">&quot;{searchQuery}&quot;</span>
                                  </p>
                                  {!isHOScope && identity?.branch && (
                                    <p className="text-[10px] text-blue-700 bg-blue-50 rounded-lg p-2 mt-2">
                                      Pencarian dibatasi pada gerai toko cabang: <span className="font-bold">{identity.branch}</span>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-[#123B6D] uppercase tracking-wider mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> 3. Kategori Kejadian
                </h4>

                <div className="mb-4">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">
                    Jenis Kejadian Utama:
                  </label>
                  <select
                    value={disasterType}
                    onChange={(e) => setDisasterType(e.target.value as DisasterType)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#1D5AA6]"
                  >
                    <option value="theft">KEMALINGAN</option>
                    <option value="fire">KEBAKARAN</option>
                    <option value="flood">KEBANJIRAN</option>
                    <option value="heavy_rain">HUJAN/BADAI (Termasuk Angin Kencang)</option>
                    <option value="earthquake">GEMPA BUMI</option>
                    <option value="severe_building_damage">BANGUNAN RUSAK PARAH</option>
                  </select>
                </div>

                {disasterType === "earthquake" && (
                  <div className="mb-4 p-3 bg-sky-50/80 border border-sky-200/80 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Activity className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-sky-950">
                          Rekonsiliasi Otomatis BMKG/USGS
                        </p>
                        <p className="text-[11px] text-sky-900 mt-0.5 leading-relaxed">
                          Anda dapat langsung melaporkan pengamatan dan bukti fisik di lokasi tanpa harus memilih kejadian gempa. Sistem SPARTA SIAGA akan otomatis mencocokkan laporan ini dengan data gempa resmi BMKG/USGS.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Tingkat Keparahan</label>
                    <select
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                    >
                      <option value="Ringan">Ringan (Struktur Aman)</option>
                      <option value="Sedang">Sedang (Perlu Perbaikan Segera)</option>
                      <option value="Berat">Berat (Rusak Total)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Status Operasional</label>
                    <select
                      value={operationalStatus}
                      onChange={(e) => setOperationalStatus(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                    >
                      <option value="Buka Normal">Buka Normal</option>
                      <option value="Tutup Sementara">Tutup Sementara</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Kronologi / Catatan</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Deskripsikan secara singkat kejadian..."
                    rows={3}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 resize-none focus:outline-none focus:border-[#1D5AA6]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Foto Bukti */}
          {step === 2 && (
            <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-right-4">
              <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-sm font-bold text-[#123B6D] uppercase tracking-wider mb-2 flex items-center gap-2">
                  <FileText className="w-5 h-5" /> 4. Bukti Foto Aktual
                </h4>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl mb-6 flex gap-3 items-start">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 font-medium">
                    Sesuai SOP Pelaporan, setiap insiden wajib melampirkan minimal 4 sisi foto aktual. Untuk DC, wajib tambah foto titik detail.
                  </p>
                </div>

                {tkpType === "DC" && (
                  <div className="mb-6">
                    <FieldPhotoUploader
                      label="Titik Kejadian Spesifik (Detail)"
                      description="Fokus pada lokasi kerusakan utama di area Gudang/DC"
                      value={photos.detailDC}
                      onChange={(data) => setPhotos({ ...photos, detailDC: data })}
                      storeName={store?.nama_toko || "Lokasi Tidak Diketahui"}
                      reporterName={identity?.name || "Pelapor Lapangan"}
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FieldPhotoUploader
                    label="Foto Tampak 1"
                    value={photos.depan}
                    onChange={(data) => setPhotos({ ...photos, depan: data })}
                    storeName={store?.nama_toko || "Lokasi Tidak Diketahui"}
                    reporterName={identity?.name || "Pelapor Lapangan"}
                  />
                  <FieldPhotoUploader
                    label="Foto Tampak 2"
                    value={photos.dalam}
                    onChange={(data) => setPhotos({ ...photos, dalam: data })}
                    storeName={store?.nama_toko || "Lokasi Tidak Diketahui"}
                    reporterName={identity?.name || "Pelapor Lapangan"}
                  />
                  <FieldPhotoUploader
                    label="Foto Tampak 3"
                    value={photos.kiri}
                    onChange={(data) => setPhotos({ ...photos, kiri: data })}
                    storeName={store?.nama_toko || "Lokasi Tidak Diketahui"}
                    reporterName={identity?.name || "Pelapor Lapangan"}
                  />
                  <FieldPhotoUploader
                    label="Foto Tampak 4"
                    value={photos.kanan}
                    onChange={(data) => setPhotos({ ...photos, kanan: data })}
                    storeName={store?.nama_toko || "Lokasi Tidak Diketahui"}
                    reporterName={identity?.name || "Pelapor Lapangan"}
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Review */}
          {step === 3 && (
            <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-right-4">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-sm font-bold text-[#123B6D] uppercase tracking-wider mb-6 flex items-center gap-2">
                  <Eye className="w-5 h-5" /> 5. Review Laporan
                </h4>

                <div className="space-y-4">
                  <div className="flex justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs text-slate-500">TKP / Lokasi</span>
                    <span className="text-sm font-bold text-slate-800 text-right">{store?.nama_toko || "Tidak diketahui"} <br/> <span className="text-[10px] text-slate-400 font-normal">({store?.cabang})</span></span>
                  </div>
                  <div className="flex justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Kategori Kejadian</span>
                    <span className="text-sm font-bold text-slate-800 capitalize">{disasterType}</span>
                  </div>
                  <div className="flex justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Status Operasional</span>
                    <span className="text-sm font-bold text-[#D9272E]">{operationalStatus}</span>
                  </div>
                  <div className="flex justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Bukti Foto</span>
                    <span className="text-sm font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Lengkap ({tkpType === "DC" ? "5" : "4"} Foto)
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
                  <p className="text-xs text-slate-600 leading-relaxed text-center font-medium">
                    Pastikan seluruh data dan foto yang dilampirkan adalah benar dan dapat dipertanggungjawabkan sesuai SOP Perusahaan.
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 md:px-8 md:py-5 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (step > 1) setStep((step - 1) as 1 | 2);
              else onClose();
            }}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            {step === 1 ? "Batal" : "Kembali"}
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={
                identity?.systemRole === "ADMIN" ||
                identity?.businessRole === "tim_toko" ||
                identity?.role === "tim_toko" ||
                activeRole === "tim_toko"
              }
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-[#1D5AA6] hover:bg-[#123B6D] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md shadow-blue-500/20"
            >
              <span>Lanjut</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                identity?.systemRole === "ADMIN" ||
                identity?.businessRole === "tim_toko" ||
                identity?.role === "tim_toko" ||
                activeRole === "tim_toko"
              }
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-[#D9272E] hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md shadow-red-500/20"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Kirim Laporan Resmi</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
