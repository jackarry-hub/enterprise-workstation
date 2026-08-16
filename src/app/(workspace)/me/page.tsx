import type { Metadata } from "next";

import { MobileProfilePage } from "@/features/mobile-workstation/mobile-profile-page";

export const metadata: Metadata = { title: "我的 | 量子智枢" };

export default function MeRoute() {
  return <MobileProfilePage />;
}
