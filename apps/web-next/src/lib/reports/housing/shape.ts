/** Building metadata + occupancy shaping (from legacy amu_housing_combined.html). */

import { HALL_REGISTRY } from "./names";

export type HousingRecord = {
  session_id?: string;
  student_id?: string;
  email?: string;
  building_id?: string;
  room_id?: string;
  gender?: string;
};

export type Room = {
  room?: string;
  capacity?: number;
  occupied?: number;
  gender?: string;
  residents?: string[];
};

export type Building = {
  name: string;
  key: string;
  gender?: string;
  capacity?: number;
  occupied?: number;
  rooms?: Room[];
};

const META: Record<
  string,
  {
    full: string;
    gender: string;
    maxOcc: number | null;
    mixedRooms: boolean;
    standardMax?: number;
    suiteMax?: number;
    suiteThreshold?: number;
  }
> = {
  JPII: { full: HALL_REGISTRY.JPII.name, gender: "women", maxOcc: 4, mixedRooms: false },
  TERESA: { full: HALL_REGISTRY.TERESA.name, gender: "men", maxOcc: 4, mixedRooms: false },
  XAVIER: {
    full: HALL_REGISTRY.XAVIER.name,
    gender: "women",
    maxOcc: null,
    mixedRooms: true,
    standardMax: 3,
    suiteMax: 8,
    suiteThreshold: 6,
  },
  GORET: {
    full: HALL_REGISTRY.GORET.name,
    gender: "women",
    maxOcc: null,
    mixedRooms: true,
    standardMax: 3,
    suiteMax: 8,
    suiteThreshold: 6,
  },
  SEBAST: {
    full: HALL_REGISTRY.SEBAST.name,
    gender: "men",
    maxOcc: null,
    mixedRooms: true,
    standardMax: 3,
    suiteMax: 8,
    suiteThreshold: 6,
  },
  STJOSE: { full: HALL_REGISTRY.STJOSE.name, gender: "men", maxOcc: 2, mixedRooms: false },
  MBK: { full: "Middle Brook Townhomes", gender: "other", maxOcc: null, mixedRooms: false },
  CIARA: { full: "Study Abroad", gender: "other", maxOcc: null, mixedRooms: false },
  MALAC: { full: "Study Abroad", gender: "other", maxOcc: null, mixedRooms: false },
  Commuter: { full: "Commuter Students", gender: "other", maxOcc: null, mixedRooms: false },
};

const ROOM_CAP_OVERRIDES: Record<string, Record<string, number>> = {
  XAVIER: { "151": 2, "251": 2, "351": 2 },
  JPII: { "104": 2 },
};

const HALL_ORDER = ["JPII", "XAVIER", "GORET", "SEBAST", "TERESA", "STJOSE", "MBK", "Commuter"];

function roomMax(key: string, roomId: string, occ: number) {
  const override = ROOM_CAP_OVERRIDES[key]?.[String(roomId)];
  if (override != null) return override;
  const m = META[key];
  if (!m) return Math.max(occ, 1);
  if (m.mixedRooms) {
    return occ >= (m.suiteThreshold || 6) ? m.suiteMax || 8 : m.standardMax || 3;
  }
  return m.maxOcc || Math.max(occ, 1);
}

/** Aggregate eRezLife/Qlik rows into the dashboard building shape. */
export function buildingsFromRecords(records: HousingRecord[]): Building[] {
  const raw: Record<string, { students: number; rooms: Record<string, number> }> = {};
  for (const k of Object.keys(META)) {
    raw[k] = { students: 0, rooms: {} };
  }
  raw.MBK = { students: 0, rooms: { Female: 0, Male: 0 } };
  raw.Commuter = { students: 0, rooms: { Female: 0, Male: 0 } };

  for (const r of records) {
    const bld = r.building_id || "";
    const room = r.room_id || "";
    const gen = (r.gender || "").toLowerCase();
    const isFem = gen.startsWith("f");
    const isMal = gen.startsWith("m");

    if (bld && raw[bld] !== undefined) {
      raw[bld].students += 1;
      const tracksGender = "Female" in raw[bld].rooms;
      if (tracksGender) {
        if (isFem) raw[bld].rooms.Female = (raw[bld].rooms.Female || 0) + 1;
        else if (isMal) raw[bld].rooms.Male = (raw[bld].rooms.Male || 0) + 1;
      } else if (room) {
        raw[bld].rooms[room] = (raw[bld].rooms[room] || 0) + 1;
      }
    } else {
      raw.Commuter.students += 1;
      if (isFem) raw.Commuter.rooms.Female = (raw.Commuter.rooms.Female || 0) + 1;
      else if (isMal) raw.Commuter.rooms.Male = (raw.Commuter.rooms.Male || 0) + 1;
    }
  }

  return HALL_ORDER.filter((k) => META[k]).map((key) => {
    const meta = META[key];
    const data = raw[key] || { students: 0, rooms: {} };
    const rooms: Room[] = Object.entries(data.rooms).map(([room, occupied]) => ({
      room,
      occupied,
      capacity: roomMax(key, room, occupied),
      gender: meta.gender,
    }));
    const capacity = rooms.reduce((s, r) => s + (r.capacity || 0), 0);
    return {
      key,
      name: meta.full,
      gender: meta.gender,
      occupied: data.students,
      capacity: capacity || undefined,
      rooms,
    };
  });
}
