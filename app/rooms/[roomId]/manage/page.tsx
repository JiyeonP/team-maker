"use client";

import { Fragment, use, useEffect, useMemo, useState } from "react";
import {
  formatDuration,
  recommendStudyTeams,
  slotToTime,
  type MatchResult,
} from "../../../../lib/matcher";
import { supabase } from "../../../../lib/supabase";

type Room = {
  id: string;
  title: string;
  day_start_slot: number;
  day_end_slot: number;
  duration_minutes: number;
  min_members: number;
  max_members: number;
  desired_team_count: number;
  allow_team_count_adjustment: boolean;
  expires_at: string;
};

type Participant = {
  id: string;
  name: string;
  created_at: string;
};

type RoomDate = {
  id: string;
  date: string;
};

type AvailabilityRow = {
  participant_id: string;
  date: string;
  slot: number;
};

function formatKoreanDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdays[date.getDay()];

  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

function getHeatStyle(
  count: number,
  maxCount: number,
  isSinglePersonMode: boolean,
) {
  if (count === 0) {
    return {
      backgroundColor: "white",
      color: "#111827",
    };
  }

  if (isSinglePersonMode) {
    return {
      backgroundColor: "black",
      color: "white",
    };
  }

  const ratio = maxCount === 0 ? 0 : count / maxCount;
  const alpha = 0.12 + ratio * 0.82;

  return {
    backgroundColor: `rgba(0, 0, 0, ${alpha})`,
    color: ratio > 0.45 ? "white" : "#111827",
  };
}

export default function ManagePage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);

  const [room, setRoom] = useState<Room | null>(null);
  const [roomDates, setRoomDates] = useState<RoomDate[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [availabilityRows, setAvailabilityRows] = useState<AvailabilityRow[]>(
    [],
  );

  const [selectedParticipantId, setSelectedParticipantId] = useState<
    string | null
  >(null);

  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [leadersByTeamIndex, setLeadersByTeamIndex] = useState<
    Record<number, string>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRecommending, setIsRecommending] = useState(false);
  const [message, setMessage] = useState("");

  const selectedParticipant = participants.find(
    (participant) => participant.id === selectedParticipantId,
  );

  const timeSlots = useMemo(() => {
    if (!room) return [];

    const slots: number[] = [];

    for (let slot = room.day_start_slot; slot < room.day_end_slot; slot++) {
      slots.push(slot);
    }

    return slots;
  }, [room]);

  const availabilityByCell = useMemo(() => {
    const map = new Map<string, Participant[]>();
    const participantMap = new Map(
      participants.map((participant) => [participant.id, participant]),
    );

    for (const row of availabilityRows) {
      const participant = participantMap.get(row.participant_id);
      if (!participant) continue;

      if (
        selectedParticipantId &&
        row.participant_id !== selectedParticipantId
      ) {
        continue;
      }

      const key = `${row.date}-${row.slot}`;
      const current = map.get(key) ?? [];

      map.set(key, [...current, participant]);
    }

    return map;
  }, [availabilityRows, participants, selectedParticipantId]);

  const maxAvailableCount = useMemo(() => {
    if (selectedParticipantId) return 1;

    let max = 0;

    for (const people of availabilityByCell.values()) {
      max = Math.max(max, people.length);
    }

    return max;
  }, [availabilityByCell, selectedParticipantId]);

  async function loadManagePage() {
    setIsLoading(true);
    setMessage("");
    setMatchResult(null);

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

    const { data: datesData, error: datesError } = await supabase
      .from("room_dates")
      .select("*")
      .eq("room_id", roomId)
      .order("date", { ascending: true });

    if (datesError) {
      setMessage("날짜 정보를 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }

    const { data: participantsData, error: participantsError } = await supabase
      .from("participants")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    if (participantsError) {
      setMessage("참여자 정보를 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }

    const participantIds = (participantsData ?? []).map(
      (participant) => participant.id,
    );

    let availabilityData: AvailabilityRow[] = [];

    if (participantIds.length > 0) {
      const { data, error: availabilityError } = await supabase
        .from("availability")
        .select("participant_id, date, slot")
        .in("participant_id", participantIds);

      if (availabilityError) {
        setMessage("가능 시간 정보를 불러오지 못했습니다.");
        setIsLoading(false);
        return;
      }

      availabilityData = data ?? [];
    }

    setRoom(roomData);
    setRoomDates(datesData ?? []);
    setParticipants(participantsData ?? []);
    setAvailabilityRows(availabilityData);
    setIsLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadManagePage();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  function getCellPeople(date: string, slot: number) {
    return availabilityByCell.get(`${date}-${slot}`) ?? [];
  }

  function runRecommendation() {
    if (!room) return;
    setMessage("");
    setMatchResult(null);
    setLeadersByTeamIndex({});
    setIsRecommending(true);

    try {
      if (participants.length === 0) {
        setMessage("아직 참여자가 없습니다.");
        return;
      }

      const availabilityForMatcher = participants.map((participant) => {
        const rows = availabilityRows.filter(
          (row) => row.participant_id === participant.id,
        );

        const slotsByDate: Record<string, number[]> = {};

        for (const row of rows) {
          if (!slotsByDate[row.date]) {
            slotsByDate[row.date] = [];
          }

          slotsByDate[row.date].push(row.slot);
        }

        return {
          participantId: participant.id,
          slotsByDate,
        };
      });

      const result = recommendStudyTeams({
        participants: participants.map((participant) => ({
          id: participant.id,
          name: participant.name,
        })),
        availability: availabilityForMatcher,
        dates: roomDates.map((roomDate) => roomDate.date),
        dayStartSlot: room.day_start_slot,
        dayEndSlot: room.day_end_slot,
        durationMinutes: room.duration_minutes,
        minMembers: room.min_members,
        maxMembers: room.max_members,
        desiredTeamCount: room.desired_team_count,
        allowTeamCountAdjustment: room.allow_team_count_adjustment,
      });

      setMatchResult(result);
    } finally {
      setIsRecommending(false);
    }
  }
  function pickRandomLeaders() {
    if (!matchResult || matchResult.status !== "success") return;

    const nextLeaders: Record<number, string> = {};

    matchResult.teams.forEach((team, index) => {
      if (team.members.length === 0) return;

      const randomIndex = Math.floor(Math.random() * team.members.length);
      nextLeaders[index] = team.members[randomIndex].name;
    });

    setLeadersByTeamIndex(nextLeaders);
  }

  if (isLoading) {
    return <main className="p-4 md:p-8">불러오는 중...</main>;
  }

  if (!room) {
    return <main className="p-4 md:p-8">{message}</main>;
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">시간표 반영 현황 및 팀 짜기</h1>
          <p className="mt-2 text-gray-600">{room.title}</p>
        </div>

        <button
          type="button"
          onClick={loadManagePage}
          className="rounded border px-4 py-2 text-sm font-medium"
        >
          새로고침
        </button>
      </div>

      <section className="mt-6 rounded border p-4">
        <h2 className="text-xl font-semibold">방 설정</h2>

        <div className="mt-4 grid gap-2 text-sm text-gray-700 md:grid-cols-2">
          <p>
            <span className="font-medium">날짜 후보:</span>{" "}
            {roomDates.map((date) => formatKoreanDate(date.date)).join(", ")}
          </p>
          <p>
            <span className="font-medium">시간표 범위:</span>{" "}
            {slotToTime(room.day_start_slot)}~{slotToTime(room.day_end_slot)}
          </p>
          <p>
            <span className="font-medium">모임 시간:</span>{" "}
            {formatDuration(room.duration_minutes)}
          </p>
          <p>
            <span className="font-medium">팀당 인원:</span> 최소{" "}
            {room.min_members}명 / 최대 {room.max_members}명
          </p>
          <p>
            <span className="font-medium">권장 팀 수:</span>{" "}
            {room.desired_team_count}팀
          </p>
          <p>
            <span className="font-medium">대안:</span>{" "}
            {room.allow_team_count_adjustment
              ? "권장 팀 수, 스터디 시간 등 조건을 조정하여 대안 제안"
              : "대안 제안 없음"}
          </p>
        </div>
      </section>

      <section className="mt-6 rounded border p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-semibold">참여자</h2>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm">
            총 {participants.length}명
          </span>
        </div>

        {participants.length === 0 ? (
          <p className="mt-4 text-gray-500">
            아직 가능 시간을 입력한 참여자가 없습니다.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedParticipantId(null)}
              className={[
                "rounded-full border px-3 py-2 text-sm",
                selectedParticipantId === null
                  ? "bg-black text-white"
                  : "bg-white",
              ].join(" ")}
            >
              전체 보기
            </button>

            {participants.map((participant) => (
              <button
                key={participant.id}
                type="button"
                onClick={() => setSelectedParticipantId(participant.id)}
                className={[
                  "rounded-full border px-3 py-2 text-sm",
                  selectedParticipantId === participant.id
                    ? "bg-black text-white"
                    : "bg-white",
                ].join(" ")}
              >
                {participant.name}
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 text-sm text-gray-500">
          {selectedParticipant
            ? `${selectedParticipant.name}님의 가능 시간만 보고 있습니다.`
            : "전체 보기에서는 가능한 사람이 많을수록 칸이 더 진하게 표시됩니다."}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-xl font-semibold">시간표 현황</h2>

        {/* 모바일 */}
        <div className="mt-4 space-y-6 md:hidden">
          {roomDates.map((roomDate) => (
            <div key={roomDate.id} className="overflow-hidden rounded border">
              <div className="border-b bg-white p-4 text-center text-lg font-semibold">
                {formatKoreanDate(roomDate.date)}
              </div>

              <div className="divide-y">
                {timeSlots.map((slot) => {
                  const people = getCellPeople(roomDate.date, slot);
                  const count = people.length;
                  const style = getHeatStyle(
                    count,
                    maxAvailableCount,
                    Boolean(selectedParticipantId),
                  );

                  return (
                    <div
                      key={`${roomDate.date}-${slot}`}
                      className="grid min-h-14 grid-cols-[88px_1fr]"
                    >
                      <div className="flex items-center border-r bg-white px-4 text-sm">
                        {slotToTime(slot)}
                      </div>

                      <div
                        className="flex items-center justify-center px-3 text-sm"
                        style={style}
                        title={people.map((person) => person.name).join(", ")}
                      >
                        {count > 0 ? (
                          selectedParticipantId ? (
                            "가능"
                          ) : (
                            <span>
                              {count}명
                              <span className="ml-2 text-xs opacity-80">
                                {people.map((person) => person.name).join(", ")}
                              </span>
                            </span>
                          )
                        ) : (
                          ""
                        )}
                      </div>
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
                gridTemplateColumns: `100px repeat(${roomDates.length}, 180px)`,
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
                <Fragment key={slot}>
                  <div className="border-b p-3 text-sm">{slotToTime(slot)}</div>

                  {roomDates.map((roomDate) => {
                    const people = getCellPeople(roomDate.date, slot);
                    const count = people.length;
                    const style = getHeatStyle(
                      count,
                      maxAvailableCount,
                      Boolean(selectedParticipantId),
                    );

                    return (
                      <div
                        key={`${roomDate.date}-${slot}`}
                        className="flex min-h-12 items-center justify-center border-b border-l p-2 text-center text-sm"
                        style={style}
                        title={people.map((person) => person.name).join(", ")}
                      >
                        {count > 0 ? (
                          selectedParticipantId ? (
                            "가능"
                          ) : (
                            <div>
                              <div className="font-semibold">{count}명</div>
                              <div className="mt-1 truncate text-xs opacity-80">
                                {people.map((person) => person.name).join(", ")}
                              </div>
                            </div>
                          )
                        ) : (
                          ""
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded border p-4">
        <h2 className="text-xl font-semibold">팀 추천</h2>

        <p className="mt-2 text-sm text-gray-600">
          모든 참여자를 반드시 한 팀에 배정하는 조합만 추천합니다.
        </p>

        <button
          type="button"
          className="mt-4 rounded bg-black px-6 py-3 font-semibold text-white disabled:opacity-50"
          onClick={runRecommendation}
          disabled={isRecommending || participants.length === 0}
        >
          {isRecommending ? "추천 중..." : "팀 추천하기"}
        </button>

        {message && <p className="mt-4 rounded bg-gray-100 p-3">{message}</p>}

        {matchResult && (
          <div className="mt-6 space-y-4">
            {matchResult.status === "success" ? (
              <div className="rounded border p-4">
                <h3 className="text-lg font-semibold">{matchResult.reason}</h3>

                <p className="mt-2 text-sm text-gray-600">
                  모임 시간: {formatDuration(matchResult.durationMinutes)} / 총{" "}
                  {matchResult.teamCount}팀
                </p>
                <button
                  type="button"
                  className="mt-4 rounded border px-4 py-2 text-sm font-semibold"
                  onClick={pickRandomLeaders}
                >
                  팀장 랜덤 배정
                </button>

                <div className="mt-4 space-y-4">
                  {matchResult.teams.map((team, index) => (
                    <div key={index} className="rounded bg-gray-50 p-4">
                      <h4 className="font-semibold">{index + 1}팀</h4>
                      {leadersByTeamIndex[index] && (
                        <p className="mt-2 inline-block rounded-full bg-black px-3 py-1 text-sm font-semibold text-white">
                          팀장: {leadersByTeamIndex[index]}
                        </p>
                      )}

                      <p className="mt-1 text-sm">
                        {formatKoreanDate(team.session.date)}{" "}
                        {slotToTime(team.session.startSlot)}~
                        {slotToTime(team.session.endSlot)}
                      </p>

                      <p className="mt-2 text-sm">
                        {team.members.map((member) => member.name).join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded border p-4">
                <h3 className="text-lg font-semibold">{matchResult.reason}</h3>

                {matchResult.suggestions.length > 0 ? (
                  <div className="mt-4 space-y-4">
                    <p className="text-sm text-gray-600">가능한 대안:</p>

                    {matchResult.suggestions.map((suggestion, index) => (
                      <div key={index} className="rounded bg-gray-50 p-4">
                        <p className="font-medium">{suggestion.message}</p>

                        <button
                          type="button"
                          className="mt-3 rounded bg-black px-4 py-2 text-sm font-semibold text-white"
                          onClick={() => {
                            setMatchResult(suggestion.result);
                            setLeadersByTeamIndex({});
                          }}
                        >
                          이 구성으로 선택
                        </button>
                        <div className="mt-3 space-y-3">
                          {suggestion.result.teams.map((team, teamIndex) => (
                            <div
                              key={teamIndex}
                              className="rounded bg-white p-3"
                            >
                              <h4 className="font-semibold">
                                {teamIndex + 1}팀
                              </h4>

                              <p className="mt-1 text-sm">
                                {formatKoreanDate(team.session.date)}{" "}
                                {slotToTime(team.session.startSlot)}~
                                {slotToTime(team.session.endSlot)}
                              </p>

                              <p className="mt-2 text-sm">
                                {team.members
                                  .map((member) => member.name)
                                  .join(", ")}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-gray-600">
                    날짜를 추가하거나, 가능 시간을 넓히거나, 모임 시간을
                    줄여보세요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
