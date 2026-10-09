import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnnunciationMember } from "./shape";
import { formalSalutation, newMemberCsv, newMemberRows } from "./mailing";

const WINDOW = { from: "2026-06-01", to: "2026-09-30", minAmount: null as number | null };

function member(partial: Partial<AnnunciationMember> & Pick<AnnunciationMember, "id">): AnnunciationMember {
  return {
    name: "Doe, Jane",
    contactType: "Household",
    email: null,
    phone: null,
    location: null,
    address: null,
    lifeToDateGiving: null,
    lifeToDateGivingNum: null,
    yearToDateGiving: null,
    yearToDateGivingNum: null,
    lastGiftAmount: null,
    lastGiftDate: null,
    giftAskAmount: null,
    createDateUtc: null,
    contactUrl: "https://example.test/contact",
    startDate: "2026-07-01",
    recurringAmount: 25,
    recurringFrequency: "Monthly",
    recurringStatus: "Active",
    firstSeen: null,
    ...partial,
  };
}

describe("annunciation new member mailing list", () => {
  it("includes Jun 1 through Sep 30 and excludes the days outside", () => {
    const rows = newMemberRows(
      [
        member({ id: 1, startDate: "2026-05-31", firstName: "May", lastName: "Doe" }),
        member({ id: 2, startDate: "2026-06-01", firstName: "June", lastName: "Doe" }),
        member({ id: 3, startDate: "2026-09-30", firstName: "Sept", lastName: "Doe" }),
        member({ id: 4, startDate: "2026-10-01", firstName: "Oct", lastName: "Doe" }),
      ],
      WINDOW,
    );
    assert.deepEqual(
      rows.map((row) => row.member.startDate),
      ["2026-09-30", "2026-06-01"],
    );
  });

  it("excludes a firstSeen-only member even when that date is inside the window", () => {
    const rows = newMemberRows(
      [member({ id: 5, startDate: null, firstSeen: "2026-07-15", firstName: "Jane", lastName: "Doe" })],
      WINDOW,
    );
    assert.equal(rows.length, 0);
  });

  it("applies the recurring amount floor, and skips it when the minimum is blank", () => {
    const people = [
      member({ id: 1, recurringAmount: 27.2, firstName: "Jane", lastName: "Doe" }),
      member({ id: 2, recurringAmount: 24.99, firstName: "June", lastName: "Doe" }),
      member({ id: 3, recurringAmount: null, firstName: "Joy", lastName: "Doe" }),
    ];
    const floored = newMemberRows(people, { ...WINDOW, minAmount: 25 });
    assert.deepEqual(floored.map((row) => row.member.id), [1]);
    const open = newMemberRows(people, { ...WINDOW, minAmount: null });
    assert.deepEqual(open.map((row) => row.member.id).sort(), [1, 2, 3]);
  });

  it("prefers formalContactName and does not invent a title", () => {
    const preferred = newMemberRows(
      [
        member({
          id: 1,
          firstName: "Jane",
          lastName: "Doe",
          prefix: "Ms.",
          formalContactName: "Jane Q. Doe",
        }),
      ],
      WINDOW,
    );
    assert.equal(preferred[0].formalAddressee, "Jane Q. Doe");

    const untitled = newMemberRows(
      [member({ id: 2, firstName: "Jane", lastName: "Doe", prefix: null, formalContactName: null })],
      WINDOW,
    );
    assert.equal(untitled[0].formalAddressee, "Jane Doe");
    assert.equal(untitled[0].formalAddressee.includes("Mr."), false);
    assert.equal(untitled[0].formalAddressee.includes("Mrs."), false);
  });

  it("builds a same-last-name couple from both prefixes", () => {
    const rows = newMemberRows(
      [
        member({
          id: 1,
          name: "Smith, John and Jane",
          firstName: "John",
          lastName: "Smith",
          prefix: "Mr.",
          secondaryFirstName: "Jane",
          secondaryLastName: "Smith",
          secondaryPrefix: "Mrs.",
          formalContactName: null,
        }),
      ],
      WINDOW,
    );
    assert.equal(rows[0].formalAddressee, "Mr. and Mrs. John Smith");
  });

  it("shortens a titled couple salutation to the last name and keeps an untitled addressee", () => {
    assert.equal(formalSalutation("Mr. and Mrs. John Smith"), "Mr. and Mrs. Smith");
    assert.equal(formalSalutation("Jane Doe"), "Jane Doe");
    const rows = newMemberRows(
      [member({ id: 1, firstName: "Jane", lastName: "Doe", formalContactName: "Jane Doe" })],
      WINDOW,
    );
    assert.equal(rows[0].formalSalutation, "Jane Doe");
  });

  it("quotes a comma inside an address and uses only the fake contact", () => {
    const csv = newMemberCsv(
      newMemberRows(
        [
          member({
            id: 42,
            name: "Doe, Jane",
            firstName: "Jane",
            lastName: "Doe",
            prefix: null,
            formalContactName: null,
            address1: "100 Oak, Suite 2",
            address2: null,
            city: "Ave Maria",
            state: "FL",
            postal: "34142",
            country: "US",
            recurringAmount: 27.2,
            recurringFrequency: "Monthly",
            startDate: "2026-06-01",
          }),
        ],
        WINDOW,
      ),
    );
    assert.equal(
      csv,
      [
        "Virtuous ID,First name,Last name,Formal addressee,Formal salutation,Address 1,Address 2,City,State,Postal,Country,Recurring gift amount,Frequency,Member since",
        '42,Jane,Doe,Jane Doe,Jane Doe,"100 Oak, Suite 2",,Ave Maria,FL,34142,US,27.20,Monthly,2026-06-01',
        "",
      ].join("\r\n"),
    );
    assert.equal(csv.includes("Jane Doe"), true);
    assert.equal(csv.split("Jane").length > 1, true);
  });
});
