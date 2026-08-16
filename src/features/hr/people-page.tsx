"use client";

import { useEffect, useState } from "react";

import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import type { EmployeeDirectoryResult } from "@/features/hr/employee-types";
import { PeopleWorkspace } from "@/features/hr/people-workspace";
import { MobileTeamPage } from "@/features/mobile-workstation/mobile-team-page";

export function PeoplePage({
  result = employeeDirectoryMockResult,
}: {
  result?: EmployeeDirectoryResult;
}) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  if (isMobile) return <MobileTeamPage result={result} />;
  return <PeopleWorkspace result={result} />;
}
