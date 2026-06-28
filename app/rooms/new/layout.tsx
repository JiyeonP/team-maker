import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "모임 짜기 | 새 방 만들기",
  description:
    "가능 시간을 입력받고, 조건에 맞춰 전원 배정 가능한 모임 조를 자동으로 짜보세요.",
  openGraph: {
    title: "모임 팀짜기",
    description:
      "가능 시간을 입력받고, 조건에 맞춰 전원 배정 가능한 모임 조를 자동으로 짜보세요.",
    url: "https://team-maker-sibijo.vercel.app/rooms/new",
    siteName: "모임 팀짜기",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "모임 팀짜기",
    description:
      "가능 시간을 입력받고, 조건에 맞춰 전원 배정 가능한 팀을 자동으로 짜보세요.",
  },
};

export default function NewRoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
