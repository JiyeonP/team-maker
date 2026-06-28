"use client";

import { use, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

type Room = {
  id: string;
  title: string;
  day_start_slot: number;
  day_end_slot: number;
  duration_minutes: number;
  min_members: number;
  max_members: number;
  desired_team_count: number;
  expires_at: string;
};

type RoomDate = {
  id: string;
  date: string;
};

function slotToTime(slot: number) {
  const totalMinutes = slot * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatKoreanDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdays[date.getDay()];

  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

export default function RoomParticipantPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);

  const [room, setRoom] = useState<Room | null>(null);
  const [roomDates, setRoomDates] = useState<RoomDate[]>([]);
  const [name, setName] = useState("");
  const [selectedSlots, setSelectedSlots] = useState<Record<string, number[]>>(
    {},
  );

  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<"select" | "deselect" | null>(null);
  const [lastDragCell, setLastDragCell] = useState<{
    date: string;
    slot: number;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const timeSlots = useMemo(() => {
    if (!room) return [];

    const slots: number[] = [];
    for (let slot = room.day_start_slot; slot < room.day_end_slot; slot++) {
      slots.push(slot);
    }

    return slots;
  }, [room]);

  useEffect(() => {
    async function loadRoom() {
      setIsLoading(true);

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (roomError || !roomData) {
        setMessage("방을 찾을 수 없거나 만료된 방입니다.");
        setIsLoading(false);
        return;
      }

      const { data: dateData, error: dateError } = await supabase
        .from("room_dates")
        .select("*")
        .eq("room_id", roomId)
        .order("date", { ascending: true });

      if (dateError) {
        setMessage("날짜 정보를 불러오지 못했습니다.");
        setIsLoading(false);
        return;
      }

      setRoom(roomData);
      setRoomDates(dateData ?? []);
      setIsLoading(false);
    }

    loadRoom();
  }, [roomId]);

  function isSlotSelected(date: string, slot: number) {
    return selectedSlots[date]?.includes(slot) ?? false;
  }

  function setSlotValue(date: string, slot: number, shouldSelect: boolean) {
    setSelectedSlots((current) => {
      const currentSlots = current[date] ?? [];
      const exists = currentSlots.includes(slot);

      if (shouldSelect && exists) {
        return current;
      }

      if (!shouldSelect && !exists) {
        return current;
      }

      const nextSlots = shouldSelect
        ? [...currentSlots, slot].sort((a, b) => a - b)
        : currentSlots.filter((item) => item !== slot);

      return {
        ...current,
        [date]: nextSlots,
      };
    });
  }
  function setSlotRangeValue(
    date: string,
    fromSlot: number,
    toSlot: number,
    shouldSelect: boolean,
  ) {
    const start = Math.min(fromSlot, toSlot);
    const end = Math.max(fromSlot, toSlot);

    for (let slot = start; slot <= end; slot++) {
      setSlotValue(date, slot, shouldSelect);
    }
  }
  function handleSlotMouseDown(date: string, slot: number) {
    const currentlySelected = isSlotSelected(date, slot);
    const nextMode = currentlySelected ? "deselect" : "select";

    setIsDragging(true);
    setDragMode(nextMode);
    setLastDragCell({ date, slot });
    setSlotValue(date, slot, nextMode === "select");
  }

  function handleSlotMouseEnter(date: string, slot: number) {
    if (!isDragging || !dragMode) return;

    if (lastDragCell && lastDragCell.date === date) {
      setSlotRangeValue(date, lastDragCell.slot, slot, dragMode === "select");
    } else {
      setSlotValue(date, slot, dragMode === "select");
    }

    setLastDragCell({ date, slot });
  }

  function stopDragging() {
    setIsDragging(false);
    setDragMode(null);
    setLastDragCell(null);
  }

  useEffect(() => {
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchend", stopDragging);

    return () => {
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchend", stopDragging);
    };
  }, []);

  async function saveAvailability() {
    setMessage("");

    if (!room) return;

    if (!name.trim()) {
      setMessage("이름을 입력해주세요.");
      return;
    }

    const totalSelected = Object.values(selectedSlots).reduce(
      (sum, slots) => sum + slots.length,
      0,
    );

    if (totalSelected === 0) {
      setMessage("가능한 시간을 최소 1개 이상 선택해주세요.");
      return;
    }

    setIsSaving(true);

    try {
      const { data: participant, error: participantError } = await supabase
        .from("participants")
        .insert({
          room_id: room.id,
          name: name.trim(),
        })
        .select()
        .single();

      if (participantError) {
        throw participantError;
      }

      const rows = Object.entries(selectedSlots).flatMap(([date, slots]) =>
        slots.map((slot) => ({
          participant_id: participant.id,
          date,
          slot,
        })),
      );

      const { error: availabilityError } = await supabase
        .from("availability")
        .insert(rows);

      if (availabilityError) {
        throw availabilityError;
      }

      setMessage("가능 시간이 저장되었습니다!");
      setName("");
      setSelectedSlots({});
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <main className="p-8">불러오는 중...</main>;
  }

  if (!room) {
    return <main className="p-8">{message}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-bold">{room.title}</h1>

      <p className="mt-2 text-gray-600">
        가능한 시간을 30분 단위로 선택해주세요.
      </p>

      <section className="mt-8">
        <label className="block font-medium">이름</label>
        <input
          className="mt-2 w-full max-w-md rounded border p-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="예: 지연"
        />
      </section>

      <section className="mt-8 select-none">
        {/* 모바일: 날짜별 카드 */}
        <div className="space-y-6 md:hidden">
          {roomDates.map((roomDate) => (
            <div key={roomDate.id} className="rounded border">
              <div className="sticky top-0 z-10 border-b bg-white p-3 text-center font-semibold">
                {formatKoreanDate(roomDate.date)}
              </div>

              <div>
                {timeSlots.map((slot) => {
                  const selected =
                    selectedSlots[roomDate.date]?.includes(slot) ?? false;

                  return (
                    <button
                      key={`${roomDate.date}-${slot}`}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSlotMouseDown(roomDate.date, slot);
                      }}
                      onMouseEnter={() =>
                        handleSlotMouseEnter(roomDate.date, slot)
                      }
                      onTouchStart={(event) => {
                        event.preventDefault();
                        handleSlotMouseDown(roomDate.date, slot);
                      }}
                      onTouchMove={(event) => {
                        const touch = event.touches[0];
                        const element = document.elementFromPoint(
                          touch.clientX,
                          touch.clientY,
                        );

                        const date = element?.getAttribute("data-date");
                        const slotValue = element?.getAttribute("data-slot");

                        if (!date || !slotValue) return;

                        handleSlotMouseEnter(date, Number(slotValue));
                      }}
                      data-date={roomDate.date}
                      data-slot={slot}
                      className={[
                        "flex w-full touch-none items-center border-b text-left last:border-b-0",
                        selected
                          ? "bg-black text-white"
                          : "bg-white hover:bg-gray-50",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "w-24 shrink-0 border-r p-4 text-sm",
                          selected ? "border-white/30" : "border-gray-200",
                        ].join(" ")}
                      >
                        {slotToTime(slot)}
                      </span>
                      <span className="flex-1 p-4 text-center text-sm">
                        {selected ? "가능" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* PC/태블릿: 기존 표 */}
        <div className="hidden overflow-x-auto rounded border md:block">
          <div
            className="grid min-w-max"
            style={{
              gridTemplateColumns: `100px repeat(${roomDates.length}, 140px)`,
            }}
          >
            <div className="border-b bg-gray-50 p-3 font-medium">시간</div>

            {roomDates.map((roomDate) => (
              <div
                key={roomDate.id}
                className="border-b border-l bg-gray-50 p-3 text-center font-medium"
              >
                {formatKoreanDate(roomDate.date)}
              </div>
            ))}

            {timeSlots.map((slot) => (
              <>
                <div key={`time-${slot}`} className="border-b p-3 text-sm">
                  {slotToTime(slot)}
                </div>

                {roomDates.map((roomDate) => {
                  const selected =
                    selectedSlots[roomDate.date]?.includes(slot) ?? false;

                  return (
                    <button
                      key={`${roomDate.date}-${slot}`}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSlotMouseDown(roomDate.date, slot);
                      }}
                      onMouseEnter={() =>
                        handleSlotMouseEnter(roomDate.date, slot)
                      }
                      onTouchStart={(event) => {
                        event.preventDefault();
                        handleSlotMouseDown(roomDate.date, slot);
                      }}
                      onTouchMove={(event) => {
                        const touch = event.touches[0];
                        const element = document.elementFromPoint(
                          touch.clientX,
                          touch.clientY,
                        );

                        const date = element?.getAttribute("data-date");
                        const slotValue = element?.getAttribute("data-slot");

                        if (!date || !slotValue) return;

                        handleSlotMouseEnter(date, Number(slotValue));
                      }}
                      data-date={roomDate.date}
                      data-slot={slot}
                      className={[
                        "select-none touch-none border-b border-l p-3 text-sm",
                        selected
                          ? "bg-black text-white"
                          : "bg-white hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {selected ? "가능" : ""}
                    </button>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </section>

      <button
        className="mt-8 rounded bg-black px-6 py-3 font-semibold text-white disabled:opacity-50"
        onClick={saveAvailability}
        disabled={isSaving}
      >
        {isSaving ? "저장 중..." : "가능 시간 저장"}
      </button>

      {message && <p className="mt-4 rounded bg-gray-100 p-3">{message}</p>}
    </main>
  );
}
