"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const registerWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // Listen for updates gently
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                // New update available without interrupting current session
                console.log("[PWA] Update SPARTA SIAGA siap pada sesi berikutnya.");
              }
            });
          }
        });
      } catch (err) {
        console.warn("[PWA] Service Worker registration skipped:", err);
      }
    };

    if (document.readyState === "complete") {
      registerWorker();
    } else {
      window.addEventListener("load", registerWorker);
      return () => window.removeEventListener("load", registerWorker);
    }
  }, []);

  return null;
}
