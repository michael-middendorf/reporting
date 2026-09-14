import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_EMAILS,
  athleticsSportsForEmail,
  canAccessReport,
  canLogin,
  filterAthleticsPayload,
  filterAthleticsRecords,
  isAdmin,
  reportsForEmail,
  sportsScopeForAthleticsEmail,
} from "./access";

const ADMIN = "michael.t.middendorf@avemaria.edu";
const VANHEUSEN = "Eric.Vanheusen@avemaria.edu";
const COPELAND = "Jamon.Copeland@avemaria.edu";
const AKIL = "jelani.akil@avemaria.edu";
const COLLAZO = "dariel.collazo@avemaria.edu";
const ROSSER = "tyler.rosser@avemaria.edu";
const WEBB = "alan.webb@avemaria.edu";
const SCHMIDT = "john.schmidt@avemaria.edu";
const UNMAPPED = "unmapped.athletics@avemaria.edu";

/** Head coaches in ATHLETICS_SPORT_ASSIGNMENTS. Do not export the private map. */
const MAPPED_COACHES = [
  "robert.cooper@avemaria.edu",
  "jamon.copeland@avemaria.edu",
  "jelani.akil@avemaria.edu",
  "john.schmidt@avemaria.edu",
  "camryn.e.olive@avemaria.edu",
  "alan.webb@avemaria.edu",
  "joseph.patterson@avemaria.edu",
  "katelyn.j.sherman@avemaria.edu",
  "ryan.dolnick@avemaria.edu",
  "dariel.collazo@avemaria.edu",
  "tyler.rosser@avemaria.edu",
  "trinity.e.medina@avemaria.edu",
  "joshua.harriott@avemaria.edu",
  "steve.smith@avemaria.edu",
] as const;

const football = { id: "fb", sport: "Football", gender: "M" };
const soccerM = { id: "sm", sport: "Soccer", gender: "M" };
const soccerF = { id: "sf", sport: "Soccer", gender: "F" };
const basketballM = { id: "bm", sport: "Basketball", gender: "M" };
const basketballF = { id: "bf", sport: "Basketball", gender: "F" };
const crossCountry = { id: "cc", sport: "Cross Country", gender: "F" };
const track = { id: "tf", sport: "Track and Field", gender: "M" };
const volleyball = { id: "vb", sport: "Volleyball", gender: "F" };
const emptySport = { id: "es", sport: "", gender: "M" };
const basketballEmptyGender = { id: "be", sport: "Basketball", gender: "" };

const ALL_ROWS = [
  football,
  soccerM,
  soccerF,
  basketballM,
  basketballF,
  crossCountry,
  track,
  volleyball,
  emptySport,
  basketballEmptyGender,
];

function ids(rows: { id: string }[]) {
  return rows.map((row) => row.id);
}

describe("sportsScopeForAthleticsEmail", () => {
  it("gives admins unrestricted athletics", () => {
    assert.equal(isAdmin(ADMIN), true);
    assert.equal(sportsScopeForAthleticsEmail(ADMIN), "all");
    assert.equal(athleticsSportsForEmail(ADMIN), null);
  });

  it("gives VanHeusen all sports without making him a hub admin", () => {
    assert.equal(isAdmin(VANHEUSEN), false);
    assert.equal(canAccessReport(VANHEUSEN, "athletics"), true);
    assert.equal(sportsScopeForAthleticsEmail(VANHEUSEN), "all");
    assert.equal(athleticsSportsForEmail(VANHEUSEN), null);
  });

  it("gives Feger and Weisbrod all Athletics Master sports without making them hub admins", () => {
    for (const email of ["elizabeth.feger@avemaria.edu", "john.weisbrod@avemaria.edu"]) {
      assert.equal(isAdmin(email), false, email);
      assert.equal(canAccessReport(email, "athletics"), true, email);
      assert.equal(sportsScopeForAthleticsEmail(email), "all", email);
      assert.equal(athleticsSportsForEmail(email), null, email);
    }
  });

  it("maps Copeland to men's Basketball only", () => {
    assert.deepEqual(sportsScopeForAthleticsEmail(COPELAND), {
      sports: ["Basketball"],
      genders: ["M"],
    });
  });

  it("maps Akil to women's Basketball only", () => {
    assert.deepEqual(sportsScopeForAthleticsEmail(AKIL), {
      sports: ["Basketball"],
      genders: ["F"],
    });
  });

  it("maps Collazo to men's Soccer and Rosser to women's Soccer", () => {
    assert.deepEqual(sportsScopeForAthleticsEmail(COLLAZO), {
      sports: ["Soccer"],
      genders: ["M"],
    });
    assert.deepEqual(sportsScopeForAthleticsEmail(ROSSER), {
      sports: ["Soccer"],
      genders: ["F"],
    });
  });

  it("maps Webb to Cross Country and Track and Field", () => {
    assert.deepEqual(sportsScopeForAthleticsEmail(WEBB), {
      sports: ["Cross Country", "Track and Field"],
    });
  });

  it("maps Schmidt to Volleyball only", () => {
    assert.deepEqual(sportsScopeForAthleticsEmail(SCHMIDT), {
      sports: ["Volleyball"],
    });
  });

  it("fails closed for an unmapped non-admin even with an athletics grant", () => {
    const previous = process.env.ATHLETICS_ALLOWED_EMAILS;
    process.env.ATHLETICS_ALLOWED_EMAILS = UNMAPPED;
    try {
      assert.equal(canLogin(UNMAPPED), true);
      assert.equal(canAccessReport(UNMAPPED, "athletics"), true);
      assert.equal(isAdmin(UNMAPPED), false);
      assert.deepEqual(sportsScopeForAthleticsEmail(UNMAPPED), { sports: [] });
      assert.deepEqual(athleticsSportsForEmail(UNMAPPED), []);
    } finally {
      if (previous === undefined) delete process.env.ATHLETICS_ALLOWED_EMAILS;
      else process.env.ATHLETICS_ALLOWED_EMAILS = previous;
    }
  });

  it("lets every mapped coach log in to athletics without hub admin", () => {
    const admins = new Set(ADMIN_EMAILS.map((email) => email.toLowerCase()));
    assert.equal(MAPPED_COACHES.length, 14);
    for (const email of MAPPED_COACHES) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "athletics"), true, email);
      assert.equal(canAccessReport(email, "athletics-coaching"), false, email);
      assert.equal(admins.has(email), false, email);
      assert.deepEqual(reportsForEmail(email), ["athletics"], email);
    }
  });
});

describe("filterAthleticsRecords", () => {
  it("lets an admin see a Football row and a Soccer row", () => {
    const rows = filterAthleticsRecords(
      [football, soccerM],
      sportsScopeForAthleticsEmail(ADMIN),
    );
    assert.deepEqual(ids(rows), ["fb", "sm"]);
  });

  it("lets VanHeusen see all rows including empty sport", () => {
    const rows = filterAthleticsRecords(
      ALL_ROWS,
      sportsScopeForAthleticsEmail(VANHEUSEN),
    );
    assert.deepEqual(ids(rows), ids(ALL_ROWS));
  });

  it("lets Copeland see male Basketball only, not female Basketball, not Football", () => {
    const rows = filterAthleticsRecords(
      ALL_ROWS,
      sportsScopeForAthleticsEmail(COPELAND),
    );
    assert.deepEqual(ids(rows), ["bm"]);
  });

  it("lets Akil see female Basketball only", () => {
    const rows = filterAthleticsRecords(
      ALL_ROWS,
      sportsScopeForAthleticsEmail(AKIL),
    );
    assert.deepEqual(ids(rows), ["bf"]);
  });

  it("lets Collazo see male Soccer only and Rosser female Soccer only", () => {
    assert.deepEqual(
      ids(filterAthleticsRecords(ALL_ROWS, sportsScopeForAthleticsEmail(COLLAZO))),
      ["sm"],
    );
    assert.deepEqual(
      ids(filterAthleticsRecords(ALL_ROWS, sportsScopeForAthleticsEmail(ROSSER))),
      ["sf"],
    );
  });

  it("lets Webb see Cross Country and Track and Field, not Football", () => {
    const rows = filterAthleticsRecords(
      ALL_ROWS,
      sportsScopeForAthleticsEmail(WEBB),
    );
    assert.deepEqual(ids(rows), ["cc", "tf"]);
  });

  it("lets Schmidt see Volleyball only", () => {
    const rows = filterAthleticsRecords(
      ALL_ROWS,
      sportsScopeForAthleticsEmail(SCHMIDT),
    );
    assert.deepEqual(ids(rows), ["vb"]);
  });

  it("hides empty-sport rows from coaches and empty-gender rows from gender-scoped coaches", () => {
    const copeland = filterAthleticsRecords(
      [emptySport, basketballEmptyGender, basketballM],
      sportsScopeForAthleticsEmail(COPELAND),
    );
    assert.deepEqual(ids(copeland), ["bm"]);
  });

  it("gives an unmapped athletics user no rows", () => {
    const rows = filterAthleticsRecords(ALL_ROWS, sportsScopeForAthleticsEmail(UNMAPPED));
    assert.deepEqual(ids(rows), []);
  });

  it("matches sport and gender case-insensitively after trim", () => {
    const rows = filterAthleticsRecords(
      [{ id: "x", sport: " basketball ", gender: " m " }],
      sportsScopeForAthleticsEmail(COPELAND),
    );
    assert.deepEqual(ids(rows), ["x"]);
  });
});

describe("filterAthleticsPayload cache isolation", () => {
  it("does not mutate the cached full payload", () => {
    const cached = {
      success: true,
      generatedAt: "2026-09-04",
      applications: [football, soccerM, basketballM, basketballF],
      prospects: [emptySport, volleyball],
    };
    const originalApps = cached.applications.slice();
    const originalProspects = cached.prospects.slice();

    const scoped = filterAthleticsPayload(
      cached,
      sportsScopeForAthleticsEmail(COPELAND),
    );
    assert.deepEqual(ids(scoped.applications), ["bm"]);
    assert.deepEqual(ids(scoped.prospects), []);
    assert.notEqual(scoped.applications, cached.applications);
    assert.notEqual(scoped.prospects, cached.prospects);

    scoped.applications.push(soccerM);
    scoped.prospects.push(volleyball);
    assert.equal(cached.applications.length, originalApps.length);
    assert.equal(cached.prospects.length, originalProspects.length);
    assert.deepEqual(ids(cached.applications), ids(originalApps));
    assert.deepEqual(ids(cached.prospects), ids(originalProspects));

    const all = filterAthleticsPayload(
      cached,
      sportsScopeForAthleticsEmail(ADMIN),
    );
    all.applications.pop();
    assert.equal(cached.applications.length, originalApps.length);
  });
});
