import React from "react";
import { STEPS } from "./full-tour/steps";
import { TourCard } from "./full-tour/TourCard";
import { MockApp } from "./full-tour/MockApp";
import { Dashboard } from "./full-tour/pages/Dashboard";
import { Queue } from "./full-tour/pages/Queue";
import { Responses } from "./full-tour/pages/Responses";
import { Attestation } from "./full-tour/pages/Attestation";

export function FullTour() {
  const urlParams = new URLSearchParams(window.location.search);
  const stepParam = parseInt(urlParams.get("step") || "1", 10);
  const stepId = Math.max(1, Math.min(STEPS.length, isNaN(stepParam) ? 1 : stepParam));
  const currentStep = STEPS.find((s) => s.id === stepId) || STEPS[0];

  const renderPage = () => {
    switch (currentStep.page) {
      case "queue":       return <Queue />;
      case "responses":   return <Responses />;
      case "attestation": return <Attestation />;
      default:            return <Dashboard />;
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <MockApp activePage={currentStep.page}>{renderPage()}</MockApp>
      <TourCard step={currentStep} />

      {/* Tiny step indicator so canvas viewers know which step they're seeing */}
      <div
        className="fixed bottom-2 right-2 z-50 px-2 py-1 rounded-md text-[10px] font-mono font-semibold pointer-events-none"
        style={{ backgroundColor: "rgba(15,23,42,0.7)", color: "white", letterSpacing: "0.05em" }}
      >
        ?step={stepId}
      </div>
    </div>
  );
}
