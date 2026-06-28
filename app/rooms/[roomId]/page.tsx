"use client";

import Link from "next/link";
import { Fragment, use, useEffect, useMemo, useState } from "react";
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

type Participant = {
  id: string;
  room_id: string;
  name: string;
};

type AvailabilityRow = {
  participant_id: string;
  date: string;
  slot: number;
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

  const [nameInput, setNameInput] = useState("");
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [hasCheckedName, setHasCheckedName] = useState(false);

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
  const [isCheckingName, setIsCheckingName] = useState(false);
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

  useEffect(() => {
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchend", stopDragging);

    return () => {
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchend", stopDragging);
    };
  }, []);

  function normalizeName(name: string) {
    return name.trim();
  }

  async function checkNameAndLoadAvailability() {
    if (!room) return;

    setMessage("");

    const normalizedName = normalizeName(nameInput);

    if (!normalizedName) {
      setMessage("이름을 입력해주세요.");
      return;
    }

    setIsCheckingName(true);

    try {
      const { data: existingParticipant, error: participantError } =
        await supabase
          .from("participants")
          .select("*")
          .eq("room_id", room.id)
          .eq("name", normalizedName)
          .maybeSingle();

      if (participantError) {
        throw participantError;
      }

      if (existingParticipant) {
        const { data: availabilityData, error: availabilityError } =
          await supabase
            .from("availability")
            .select("participant_id, date, slot")
            .eq("participant_id", existingParticipant.id);

        if (availabilityError) {
          throw availabilityError;
        }

        setParticipant(existingParticipant);
        setSelectedSlots(rowsToSelectedSlots(availabilityData ?? []));
        setHasCheckedName(true);
        setMessage(
          "기존 입력 기록을 불러왔습니다. 수정 후 저장할 수 있습니다.",
        );
      } else {
        setParticipant(null);
        setSelectedSlots({});
        setHasCheckedName(true);
        setMessage("새 참여자로 입력합니다. 가능한 시간을 선택해주세요.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "이름 확인 중 오류가 발생했습니다.",
      );
    } finally {
      setIsCheckingName(false);
    }
  }

  function rowsToSelectedSlots(rows: AvailabilityRow[]) {
    const next: Record<string, number[]> = {};

    for (const row of rows) {
      if (!next[row.date]) {
        next[row.date] = [];
      }

      next[row.date].push(row.slot);
    }

    for (const date of Object.keys(next)) {
      next[date].sort((a, b) => a - b);
    }

    return next;
  }

  function isSlotSelected(date: string, slot: number) {
    return selectedSlots[date]?.includes(slot) ?? false;
  }

  function setSlotValue(date: string, slot: number, shouldSelect: boolean) {
    setSelectedSlots((current) => {
      const currentSlots = current[date] ?? [];
      const exists = currentSlots.includes(slot);

      if (shouldSelect && exists) return current;
      if (!shouldSelect && !exists) return current;

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

  async function saveAvailability() {
    setMessage("");

    if (!room) return;

    const normalizedName = normalizeName(nameInput);

    if (!normalizedName) {
      setMessage("이름을 입력해주세요.");
      return;
    }

    if (!hasCheckedName) {
      setMessage("먼저 이름을 확인해주세요.");
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
      let currentParticipant = participant;

      if (!currentParticipant) {
        const { data: createdParticipant, error: createError } = await supabase
          .from("participants")
          .insert({
            room_id: room.id,
            name: normalizedName,
          })
          .select()
          .single();

        if (createError) {
          throw createError;
        }

        currentParticipant = createdParticipant;
        setParticipant(createdParticipant);
      }

      const { error: deleteError } = await supabase
        .from("availability")
        .delete()
        .eq("participant_id", currentParticipant.id);

      if (deleteError) {
        throw deleteError;
      }

      const rows = Object.entries(selectedSlots).flatMap(([date, slots]) =>
        slots.map((slot) => ({
          participant_id: currentParticipant.id,
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

      setMessage(
        "가능 시간이 저장되었습니다. 다시 들어와도 같은 이름으로 수정할 수 있습니다.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function resetName() {
    setParticipant(null);
    setHasCheckedName(false);
    setSelectedSlots({});
    setMessage("");
  }

  if (isLoading) {
    return <main className="p-4 md:p-8">불러오는 중...</main>;
  }

  if (!room) {
    return <main className="p-4 md:p-8">{message}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <h1 className="text-3xl font-bold">{room.title}</h1>
      <div className="mt-8 rounded border p-4">
        <p className="text-sm text-gray-600">
          모든 참여자가 입력을 마쳤다면, 현재 반영 현황을 보고 조를 짤 수
          있습니다.
        </p>

        <Link
          href={`/rooms/${room.id}/manage`}
          className="mt-3 inline-block rounded bg-gray-900 px-5 py-3 font-semibold text-white"
        >
          시간표 반영 현황 및 조 짜기
        </Link>
      </div>

      <p className="mt-2 text-gray-600">
        이름을 입력하면 기존 기록을 불러오거나 새 시간표를 입력할 수 있습니다.
      </p>

      <section className="mt-8 rounded border p-4">
        <label className="block font-medium">이름</label>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded border p-3"
            value={nameInput}
            onChange={(event) => {
              setNameInput(event.target.value);
              setHasCheckedName(false);
              setParticipant(null);
              setSelectedSlots({});
              setMessage("");
            }}
            placeholder="이름을 입력하세요"
          />

          <button
            type="button"
            className="rounded bg-black px-5 py-3 font-semibold text-white disabled:opacity-50"
            onClick={checkNameAndLoadAvailability}
            disabled={isCheckingName}
          >
            {isCheckingName ? "확인 중..." : "내 시간표 입력하기"}
          </button>
        </div>

        {hasCheckedName && (
          <div className="mt-3 flex flex-col gap-2 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {participant
                ? "기존 기록을 수정하는 중입니다."
                : "새 참여자로 입력하는 중입니다."}
            </p>

            <button
              type="button"
              className="text-sm underline"
              onClick={resetName}
            >
              다른 이름으로 입력하기
            </button>
          </div>
        )}
      </section>

      {!hasCheckedName ? (
        <section className="mt-8 rounded border p-6 text-center text-gray-600">
          이름을 입력하고{" "}
          <span className="font-medium">내 시간표 입력하기</span>를 눌러주세요.
        </section>
      ) : (
        <>
          <section className="mt-8 select-none">
            <h2 className="text-xl font-semibold">가능 시간 선택</h2>
            <p className="mt-2 text-sm text-gray-500">
              빈칸을 누르거나 드래그하면 가능 시간이 선택됩니다. 선택된 칸에서
              드래그하면 지울 수 있습니다.
            </p>

            {/* 모바일 */}
            <div className="mt-4 space-y-6 md:hidden">
              {roomDates.map((roomDate) => (
                <div
                  key={roomDate.id}
                  className="overflow-hidden rounded border"
                >
                  <div className="border-b bg-white p-4 text-center text-lg font-semibold">
                    {formatKoreanDate(roomDate.date)}
                  </div>

                  <div className="divide-y">
                    {timeSlots.map((slot) => {
                      const selected =
                        selectedSlots[roomDate.date]?.includes(slot) ?? false;

                      return (
                        <div
                          key={`${roomDate.date}-${slot}`}
                          className="grid min-h-14 grid-cols-[88px_1fr]"
                        >
                          <div className="flex items-center border-r bg-white px-4 text-sm">
                            {slotToTime(slot)}
                          </div>

                          <button
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
                              const slotValue =
                                element?.getAttribute("data-slot");

                              if (!date || !slotValue) return;

                              handleSlotMouseEnter(date, Number(slotValue));
                            }}
                            data-date={roomDate.date}
                            data-slot={slot}
                            className={[
                              "flex touch-none select-none items-center justify-center text-sm",
                              selected
                                ? "bg-black text-white"
                                : "bg-white hover:bg-gray-50",
                            ].join(" ")}
                          >
                            {selected ? "가능" : ""}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* PC */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <div className="flex justify-center">
                <div
                  className="grid w-fit overflow-hidden rounded border"
                  style={{
                    gridTemplateColumns: `100px repeat(${roomDates.length}, 140px)`,
                  }}
                >
                  <div className="border-b bg-gray-50 p-3 font-medium">
                    시간
                  </div>

                  {roomDates.map((roomDate) => (
                    <div
                      key={roomDate.id}
                      className="border-b border-l bg-gray-50 p-3 text-center font-medium"
                    >
                      {formatKoreanDate(roomDate.date)}
                    </div>
                  ))}

                  {timeSlots.map((slot) => (
                    <Fragment key={slot}>
                      <div className="border-b p-3 text-sm">
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
                              const slotValue =
                                element?.getAttribute("data-slot");

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
                    </Fragment>
                  ))}
                </div>
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
        </>
      )}

      {message && <p className="mt-4 rounded bg-gray-100 p-3">{message}</p>}
    </main>
  );
}
