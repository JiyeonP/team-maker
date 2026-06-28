export type Participant = {
  id: string;
  name: string;
};

export type Availability = {
  participantId: string;
  slotsByDate: Record<string, number[]>;
};

export type Session = {
  date: string;
  startSlot: number;
  endSlot: number;
};

export type Team = {
  session: Session;
  members: Participant[];
};

export type MatchSuccess = {
  status: "success";
  reason: string;
  teamCount: number;
  durationMinutes: number;
  teams: Team[];
};

export type MatchSuggestion = {
  type: "alternative_team_count" | "shorter_duration";
  message: string;
  result: MatchSuccess;
};

export type MatchFailure = {
  status: "failed";
  reason: string;
  suggestions: MatchSuggestion[];
};

export type MatchResult = MatchSuccess | MatchFailure;

export type MatchInput = {
  participants: Participant[];
  availability: Availability[];
  dates: string[];
  dayStartSlot: number;
  dayEndSlot: number;
  durationMinutes: number;
  minMembers: number;
  maxMembers: number;
  desiredTeamCount: number;
  allowTeamCountAdjustment: boolean;
};

function durationToSlotCount(durationMinutes: number) {
  return durationMinutes / 30;
}

function generateSessions(
  dates: string[],
  dayStartSlot: number,
  dayEndSlot: number,
  durationMinutes: number,
): Session[] {
  const durationSlots = durationToSlotCount(durationMinutes);
  const sessions: Session[] = [];

  for (const date of dates) {
    for (
      let startSlot = dayStartSlot;
      startSlot + durationSlots <= dayEndSlot;
      startSlot++
    ) {
      sessions.push({
        date,
        startSlot,
        endSlot: startSlot + durationSlots,
      });
    }
  }

  return sessions;
}

function canAttendSession(availability: Availability, session: Session) {
  const availableSlots = new Set(availability.slotsByDate[session.date] ?? []);

  for (let slot = session.startSlot; slot < session.endSlot; slot++) {
    if (!availableSlots.has(slot)) {
      return false;
    }
  }

  return true;
}

function sessionCombinationsWithReplacement<T>(
  items: T[],
  count: number,
  startIndex = 0,
): T[][] {
  if (count === 0) return [[]];

  const result: T[][] = [];

  for (let i = startIndex; i < items.length; i++) {
    const tails = sessionCombinationsWithReplacement(items, count - 1, i);

    for (const tail of tails) {
      result.push([items[i], ...tail]);
    }
  }

  return result;
}

function getAvailabilityMap(availability: Availability[]) {
  return new Map(availability.map((item) => [item.participantId, item]));
}

function assignParticipantsToSessions(params: {
  participants: Participant[];
  availabilityMap: Map<string, Availability>;
  sessions: Session[];
  minMembers: number;
  maxMembers: number;
}): Team[] | null {
  const { participants, availabilityMap, sessions, minMembers, maxMembers } =
    params;

  const teamMembers: Participant[][] = sessions.map(() => []);

  const participantOptions = participants
    .map((participant) => {
      const availableTeamIndexes = sessions
        .map((session, index) => {
          const personAvailability = availabilityMap.get(participant.id);

          if (!personAvailability) return null;

          return canAttendSession(personAvailability, session) ? index : null;
        })
        .filter((index): index is number => index !== null);

      return {
        participant,
        availableTeamIndexes,
      };
    })
    .sort(
      (a, b) => a.availableTeamIndexes.length - b.availableTeamIndexes.length,
    );

  if (
    participantOptions.some((item) => item.availableTeamIndexes.length === 0)
  ) {
    return null;
  }

  function backtrack(personIndex: number): boolean {
    if (personIndex === participantOptions.length) {
      return teamMembers.every(
        (members) =>
          members.length >= minMembers && members.length <= maxMembers,
      );
    }

    const { participant, availableTeamIndexes } =
      participantOptions[personIndex];

    for (const teamIndex of availableTeamIndexes) {
      if (teamMembers[teamIndex].length >= maxMembers) {
        continue;
      }

      teamMembers[teamIndex].push(participant);

      const remainingPeople = participantOptions.length - personIndex - 1;

      const impossible = teamMembers.some((members) => {
        return members.length + remainingPeople < minMembers;
      });

      if (!impossible && backtrack(personIndex + 1)) {
        return true;
      }

      teamMembers[teamIndex].pop();
    }

    return false;
  }

  const success = backtrack(0);
  if (!success) return null;

  return sessions.map((session, index) => ({
    session,
    members: teamMembers[index],
  }));
}

function resultSortKey(teams: Team[]) {
  const sizes = teams.map((team) => team.members.length);
  const maxSize = Math.max(...sizes);
  const minSize = Math.min(...sizes);

  // 팀 인원 차이가 작을수록 좋음
  const balancePenalty = maxSize - minSize;

  // 너무 늦은 시간은 약한 패널티
  const latePenalty = teams.reduce((sum, team) => {
    return sum + Math.max(0, team.session.startSlot - 36);
  }, 0);

  // 날짜가 너무 많이 쪼개지는 것은 약한 패널티
  const uniqueDates = new Set(teams.map((team) => team.session.date)).size;
  const datePenalty = uniqueDates - 1;

  return balancePenalty * 100 + datePenalty * 10 + latePenalty;
}

function findBestAssignment(params: {
  participants: Participant[];
  availability: Availability[];
  dates: string[];
  dayStartSlot: number;
  dayEndSlot: number;
  durationMinutes: number;
  minMembers: number;
  maxMembers: number;
  teamCount: number;
}): Team[] | null {
  const {
    participants,
    availability,
    dates,
    dayStartSlot,
    dayEndSlot,
    durationMinutes,
    minMembers,
    maxMembers,
    teamCount,
  } = params;

  if (participants.length < minMembers * teamCount) return null;
  if (participants.length > maxMembers * teamCount) return null;

  const sessions = generateSessions(
    dates,
    dayStartSlot,
    dayEndSlot,
    durationMinutes,
  );

  if (sessions.length === 0) return null;

  const availabilityMap = getAvailabilityMap(availability);

  const validResults: Team[][] = [];

  const sessionCombinations = sessionCombinationsWithReplacement(
    sessions,
    teamCount,
  );

  for (const selectedSessions of sessionCombinations) {
    const assigned = assignParticipantsToSessions({
      participants,
      availabilityMap,
      sessions: selectedSessions,
      minMembers,
      maxMembers,
    });

    if (assigned) {
      validResults.push(assigned);
    }
  }

  if (validResults.length === 0) {
    return null;
  }

  validResults.sort((a, b) => resultSortKey(a) - resultSortKey(b));

  return validResults[0];
}

function canTeamCountFitPeople(params: {
  totalPeople: number;
  teamCount: number;
  minMembers: number;
  maxMembers: number;
}) {
  const { totalPeople, teamCount, minMembers, maxMembers } = params;

  return (
    totalPeople >= teamCount * minMembers &&
    totalPeople <= teamCount * maxMembers
  );
}

function getPossibleTeamCounts(params: {
  totalPeople: number;
  minMembers: number;
  maxMembers: number;
}) {
  const { totalPeople, minMembers, maxMembers } = params;

  const possibleTeamCounts: number[] = [];

  // 1팀도 포함
  for (let teamCount = 1; teamCount <= totalPeople; teamCount++) {
    if (
      canTeamCountFitPeople({
        totalPeople,
        teamCount,
        minMembers,
        maxMembers,
      })
    ) {
      possibleTeamCounts.push(teamCount);
    }
  }

  return possibleTeamCounts;
}

function getAlternativeTeamCounts(params: {
  desiredTeamCount: number;
  totalPeople: number;
  minMembers: number;
  maxMembers: number;
}) {
  const { desiredTeamCount, totalPeople, minMembers, maxMembers } = params;

  const possibleTeamCounts = getPossibleTeamCounts({
    totalPeople,
    minMembers,
    maxMembers,
  }).filter((teamCount) => teamCount !== desiredTeamCount);

  const largerTeamCounts = possibleTeamCounts
    .filter((teamCount) => teamCount > desiredTeamCount)
    .sort((a, b) => a - b);

  const smallerTeamCounts = possibleTeamCounts
    .filter((teamCount) => teamCount < desiredTeamCount)
    .sort((a, b) => b - a);

  // 권장보다 큰 팀 수 먼저: +1, +2, +3...
  // 그다음 권장보다 작은 팀 수: -1, -2...
  return [...largerTeamCounts, ...smallerTeamCounts];
}

export function recommendStudyTeams(input: MatchInput): MatchResult {
  const primary = findBestAssignment({
    participants: input.participants,
    availability: input.availability,
    dates: input.dates,
    dayStartSlot: input.dayStartSlot,
    dayEndSlot: input.dayEndSlot,
    durationMinutes: input.durationMinutes,
    minMembers: input.minMembers,
    maxMembers: input.maxMembers,
    teamCount: input.desiredTeamCount,
  });

  if (primary) {
    return {
      status: "success",
      reason: `권장 ${input.desiredTeamCount}팀 구성으로 전원 배정 가능합니다.`,
      teamCount: input.desiredTeamCount,
      durationMinutes: input.durationMinutes,
      teams: primary,
    };
  }

  const suggestions: MatchSuggestion[] = [];

  if (input.allowTeamCountAdjustment) {
    const alternativeTeamCounts = getAlternativeTeamCounts({
      desiredTeamCount: input.desiredTeamCount,
      totalPeople: input.participants.length,
      minMembers: input.minMembers,
      maxMembers: input.maxMembers,
    });

    for (const alternativeTeamCount of alternativeTeamCounts) {
      const alternative = findBestAssignment({
        participants: input.participants,
        availability: input.availability,
        dates: input.dates,
        dayStartSlot: input.dayStartSlot,
        dayEndSlot: input.dayEndSlot,
        durationMinutes: input.durationMinutes,
        minMembers: input.minMembers,
        maxMembers: input.maxMembers,
        teamCount: alternativeTeamCount,
      });

      if (alternative) {
        suggestions.push({
          type: "alternative_team_count",
          message: `권장 ${input.desiredTeamCount}팀은 어렵지만, ${alternativeTeamCount}팀으로는 전원 배정 가능합니다.`,
          result: {
            status: "success",
            reason: `${alternativeTeamCount}팀 구성으로 전원 배정 가능합니다.`,
            teamCount: alternativeTeamCount,
            durationMinutes: input.durationMinutes,
            teams: alternative,
          },
        });
      }
    }
  }

  const shorterDurations = [
    330, 300, 270, 240, 210, 180, 150, 120, 90, 60, 30,
  ].filter((duration) => duration < input.durationMinutes);

  for (const shorterDuration of shorterDurations) {
    const shorterResult = findBestAssignment({
      participants: input.participants,
      availability: input.availability,
      dates: input.dates,
      dayStartSlot: input.dayStartSlot,
      dayEndSlot: input.dayEndSlot,
      durationMinutes: shorterDuration,
      minMembers: input.minMembers,
      maxMembers: input.maxMembers,
      teamCount: input.desiredTeamCount,
    });

    if (shorterResult) {
      suggestions.push({
        type: "shorter_duration",
        message: `모임 시간을 ${formatDuration(shorterDuration)}으로 줄이면 권장 ${input.desiredTeamCount}팀으로 전원 배정 가능합니다.`,
        result: {
          status: "success",
          reason: `모임 시간을 줄이면 권장 팀 수로 전원 배정 가능합니다.`,
          teamCount: input.desiredTeamCount,
          durationMinutes: shorterDuration,
          teams: shorterResult,
        },
      });

      break;
    }
  }

  return {
    status: "failed",
    reason: `권장 ${input.desiredTeamCount}팀 구성으로는 모든 인원을 배정할 수 없습니다.`,
    suggestions,
  };
}

export function slotToTime(slot: number) {
  const totalMinutes = slot * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}분`;
  if (mins === 0) return `${hours}시간`;

  return `${hours}시간 ${mins}분`;
}
