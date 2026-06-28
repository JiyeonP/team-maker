"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

export default function TestSupabasePage() {
  const [message, setMessage] = useState("확인 중...");

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from("rooms")
        .select("id")
        .limit(1);

      if (error) {
        setMessage(`연결 실패: ${error.message}`);
        return;
      }

      setMessage(
        `Supabase 연결 성공! rooms 조회 가능. 데이터 수: ${data.length}`,
      );
    }

    testConnection();
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Supabase 연결 테스트</h1>
      <p className="mt-4">{message}</p>
    </main>
  );
}
