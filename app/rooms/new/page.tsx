"use client";

import { useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

function randomAdminKey() {
  return crypto.randomUUID().replaceAll("-", "");
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatKoreanDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Array<Date | null> = [];

  const firstWeekday = firstDay.getDay();

  for (let i = 0; i < firstWeekday; i++) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    days.push(new Date(year, month, day));
  }

  return days;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}분`;
  if (mins === 0) return `${hours}시간`;

  return `${hours}시간 ${mins}분`;
}

function slotToTime(slot: number) {
  const totalMinutes = slot * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getTimeSlotOptions() {
  const options: number[] = [];

  for (let slot = 0; slot <= 48; slot++) {
    options.push(slot);
  }

  return options;
}

export default function NewRoomPage() {
  const today = new Date();

  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth());

  const [title, setTitle] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  const [dayStartSlot, setDayStartSlot] = useState(18); // 09:00
  const [dayEndSlot, setDayEndSlot] = useState(44); // 22:00

  const [durationMinutes, setDurationMinutes] = useState(120);
  const [minMembers, setMinMembers] = useState(3);
  const [maxMembers, setMaxMembers] = useState(6);
  const [desiredTeamCount, setDesiredTeamCount] = useState(2);

  const [participantUrl, setParticipantUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const monthDays = useMemo(() => {
    return getMonthDays(calendarYear, calendarMonth);
  }, [calendarYear, calendarMonth]);

  const durationOptions = useMemo(() => {
    const options: number[] = [];

    for (let minutes = 30; minutes <= 360; minutes += 30) {
      options.push(minutes);
    }

    return options;
  }, []);

  const timeSlotOptions = useMemo(() => {
    return getTimeSlotOptions();
  }, []);

  function moveMonth(diff: number) {
    const next = new Date(calendarYear, calendarMonth + diff, 1);
    setCalendarYear(next.getFullYear());
    setCalendarMonth(next.getMonth());
  }

  function toggleDate(date: Date) {
    const dateKey = toDateKey(date);

    setSelectedDates((current) => {
      if (current.includes(dateKey)) {
        return current.filter((item) => item !== dateKey);
      }

      return [...current, dateKey].sort();
    });
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert("링크가 복사되었습니다.");
    } catch {
      alert("복사에 실패했습니다. 링크를 직접 복사해주세요.");
    }
  }

  async function createRoom() {
    setErrorMessage("");
    setIsCreating(true);

    try {
      if (!title.trim()) {
        throw new Error("스터디 이름을 입력해주세요.");
      }

      if (selectedDates.length < 1) {
        throw new Error("날짜를 최소 1개 이상 선택해주세요.");
      }

      if (minMembers > maxMembers) {
        throw new Error("최소 인원은 최대 인원보다 클 수 없습니다.");
      }

      if (dayStartSlot >= dayEndSlot) {
        throw new Error("시간대 시작 시간은 종료 시간보다 빨라야 합니다.");
      }

      if (dayEndSlot - dayStartSlot < durationMinutes / 30) {
        throw new Error("선택한 시간대가 스터디 시간보다 짧습니다.");
      }

      if (desiredTeamCount < 1) {
        throw new Error("권장 팀 수는 1 이상이어야 합니다.");
      }

      const adminKey = randomAdminKey();

      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .insert({
          title,
          admin_key: adminKey,
          day_start_slot: dayStartSlot,
          day_end_slot: dayEndSlot,
          duration_minutes: durationMinutes,
          min_members: minMembers,
          max_members: maxMembers,
          desired_team_count: desiredTeamCount,
          allow_team_count_adjustment: true,
        })
        .select()
        .single();

      if (roomError) {
        throw roomError;
      }

      const { error: datesError } = await supabase.from("room_dates").insert(
        selectedDates.map((date) => ({
          room_id: room.id,
          date,
        })),
      );

      if (datesError) {
        throw datesError;
      }

      const origin = window.location.origin;

      setParticipantUrl(`${origin}/rooms/${room.id}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "방 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">스터디 방 만들기</h1>

      <div className="mt-8 space-y-6">
        <div>
          <label className="block font-medium">스터디 이름</label>
          <input
            className="mt-2 w-full rounded border p-3"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="예: 알고리즘 스터디"
          />
        </div>

        <section>
          <div className="flex items-center justify-between">
            <label className="block font-medium">날짜 후보</label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={() => moveMonth(-1)}
              >
                이전
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={() => moveMonth(1)}
              >
                다음
              </button>
            </div>
          </div>

          <div className="mt-3 rounded border p-4">
            <div className="mb-4 text-center text-lg font-semibold">
              {calendarYear}년 {calendarMonth + 1}월
            </div>

            <div className="grid grid-cols-7 gap-2 text-center text-sm font-medium text-gray-500">
              <div>일</div>
              <div>월</div>
              <div>화</div>
              <div>수</div>
              <div>목</div>
              <div>금</div>
              <div>토</div>
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {monthDays.map((date, index) => {
                if (!date) {
                  return <div key={`empty-${index}`} />;
                }

                const dateKey = toDateKey(date);
                const isSelected = selectedDates.includes(dateKey);
                const isPast = new Date(`${dateKey}T23:59:59`) < new Date();

                return (
                  <button
                    key={dateKey}
                    type="button"
                    disabled={isPast}
                    onClick={() => toggleDate(date)}
                    className={[
                      "rounded p-3 text-center",
                      isPast
                        ? "cursor-not-allowed bg-gray-100 text-gray-300"
                        : "border hover:bg-gray-50",
                      isSelected
                        ? "border-black bg-black text-white hover:bg-black"
                        : "",
                    ].join(" ")}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <p className="text-sm font-medium">선택한 날짜</p>

            {selectedDates.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">
                달력에서 날짜를 클릭해서 선택하세요.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedDates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    className="rounded-full bg-gray-100 px-3 py-1 text-sm"
                    onClick={() =>
                      setSelectedDates((current) =>
                        current.filter((item) => item !== date),
                      )
                    }
                  >
                    {formatKoreanDate(date)} ×
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <div>
          <label className="block font-medium">참여자 시간표 입력 시간대</label>

          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-sm text-gray-500">시작 시간</p>
              <select
                className="w-full rounded border p-3"
                value={dayStartSlot}
                onChange={(event) => {
                  const nextStart = Number(event.target.value);
                  setDayStartSlot(nextStart);

                  if (nextStart >= dayEndSlot) {
                    setDayEndSlot(nextStart + 1);
                  }
                }}
              >
                {timeSlotOptions.slice(0, 48).map((slot) => (
                  <option key={slot} value={slot}>
                    {slotToTime(slot)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1 text-sm text-gray-500">종료 시간</p>
              <select
                className="w-full rounded border p-3"
                value={dayEndSlot}
                onChange={(event) => setDayEndSlot(Number(event.target.value))}
              >
                {timeSlotOptions
                  .filter((slot) => slot > dayStartSlot)
                  .map((slot) => (
                    <option key={slot} value={slot}>
                      {slotToTime(slot)}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <p className="mt-2 text-sm text-gray-500">
            참여자들은 이 시간대 안에서 30분 단위로 가능한 시간을 체크합니다.
          </p>
        </div>

        <div>
          <label className="block font-medium">스터디 시간</label>
          <select
            className="mt-2 w-full rounded border p-3"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(Number(event.target.value))}
          >
            {durationOptions.map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatDuration(minutes)}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-gray-500">
            30분부터 6시간까지 30분 단위로 선택할 수 있습니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-medium">팀당 최소 인원</label>
            <input
              type="number"
              min={1}
              className="mt-2 w-full rounded border p-3"
              value={minMembers}
              onChange={(event) => setMinMembers(Number(event.target.value))}
            />
          </div>

          <div>
            <label className="block font-medium">팀당 최대 인원</label>
            <input
              type="number"
              min={1}
              className="mt-2 w-full rounded border p-3"
              value={maxMembers}
              onChange={(event) => setMaxMembers(Number(event.target.value))}
            />
          </div>
        </div>

        <div>
          <label className="block font-medium">권장 팀 수</label>
          <input
            type="number"
            min={1}
            className="mt-2 w-full rounded border p-3"
            value={desiredTeamCount}
            onChange={(event) =>
              setDesiredTeamCount(Number(event.target.value))
            }
          />
          <p className="mt-2 text-sm text-gray-500">
            권장 팀 수로 어렵다면 ±1팀 대안을 제안합니다.
          </p>
        </div>

        <button
          className="w-full rounded bg-black p-3 font-semibold text-white disabled:opacity-50"
          onClick={createRoom}
          disabled={isCreating}
        >
          {isCreating ? "생성 중..." : "방 만들기"}
        </button>

        {errorMessage && (
          <p className="rounded bg-red-50 p-3 text-red-600">{errorMessage}</p>
        )}

        {participantUrl && (
          <div className="space-y-4 rounded border p-4">
            <h2 className="text-xl font-bold">방이 생성되었습니다</h2>

            <div>
              <p className="font-medium">공유 링크</p>
              <div className="mt-1 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border p-2"
                  value={participantUrl}
                  readOnly
                />
                <button
                  type="button"
                  className="shrink-0 rounded bg-black px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => copyToClipboard(participantUrl)}
                >
                  복사
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                이 링크를 참여자들에게 공유하세요. 해당 링크에서 가능한 시간을
                입력하고 팀 편성을 할 수 있습니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
