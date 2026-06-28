import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";

type Room = {
  id: string;
  title: string;
  expires_at: string;
};

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;

  const supabase = createSupabaseServerClient();

  const { data: room } = await supabase
    .from("rooms")
    .select("id, title, expires_at")
    .eq("id", roomId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<Room>();

  const title = room ? `${room.title} |  팀짜기` : "모임 팀짜기";

  const description = room
    ? `${room.title} 시간표를 입력하고 팀 편성 결과를 확인하세요.`
    : "참여 가능한 시간을 입력하고 자동으로 팀을 짜보세요.";

  const url = `https://team-maker-sibijo.vercel.app/rooms/${roomId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "모임 팀짜기",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function RoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
