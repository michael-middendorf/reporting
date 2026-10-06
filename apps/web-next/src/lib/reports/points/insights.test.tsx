import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InsightsPanel } from "../../../app/advancement/points/insights-panel";
import { POINTS_MAP } from "./config.js";
import { CHANNELS, buildInsights, campaignOf } from "./insights.js";
import { ageFromPerson, projectProfile, projectProfiles } from "./profiles.js";

const AS_OF = new Date(2026, 8, 28);

describe("donor profiles", () => {
  it("uses the primary person's birth month and keeps alumni from the contact tag", () => {
    const profile = projectProfile(
      {
        id: 144,
        tags: ["Lapsed Donor", "Alumni"],
        contactIndividuals: [
          {
            isPrimary: true,
            birthMonth: 11,
            birthDay: null,
            birthYear: 1996,
            approximateAge: 29,
            customFields: [{ name: "Alumni", value: "Alumni" }, { name: "Class Year", value: "2019" }],
          },
        ],
      },
      AS_OF,
    );
    assert.ok(profile);
    assert.equal(profile.age, 29);
    assert.equal(profile.birthYear, 1996);
    assert.deepEqual(profile.relationships, ["alumni"]);
    assert.deepEqual(profile.donorTags, ["lapsed"]);
    assert.equal("name" in profile, false);
  });

  it("reads faculty and parent from individual fields and tags", () => {
    const profile = projectProfile({
      id: 9,
      tags: ["Staff/Faculty"],
      contactIndividuals: [
        {
          isPrimary: true,
          birthYear: 1972,
          customFields: [
            { name: "Faculty/Staff", value: "Faculty/Staff" },
            { name: "Parents", value: "Parents" },
            { name: "Student", value: "" },
          ],
        },
      ],
    }, AS_OF);
    assert.ok(profile);
    assert.deepEqual(profile.relationships, ["faculty", "parent"]);
    assert.equal(profile.age, 54);
  });

  it("does not invent a relationship from an empty field", () => {
    const profile = projectProfile({
      id: 3,
      tags: ["No Valid Address"],
      contactIndividuals: [{ isPrimary: true, birthYear: 1940, customFields: [{ name: "Alumni", value: "No" }] }],
    }, AS_OF);
    assert.deepEqual(profile?.relationships, []);
    assert.equal(profile?.deceased, false);
  });

  it("marks a deceased primary person", () => {
    const profile = projectProfile({
      id: 4,
      contactIndividuals: [{ isPrimary: true, birthYear: 1938, isDeceased: true }],
    }, AS_OF);
    assert.equal(profile?.deceased, true);
  });

  it("drops a contact with no id and keeps the first copy", () => {
    const rows = projectProfiles([
      { contactId: 8, tags: ["Alumni"] },
      { id: 8, tags: ["Parent"] },
      { name: "No id" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 8);
    assert.deepEqual(rows[0].relationships, ["alumni"]);
  });

  it("counts a birthday that has not arrived yet", () => {
    const aged = ageFromPerson({ birthYear: 1980, birthMonth: 12, birthDay: 2 }, AS_OF);
    assert.equal(aged.age, 45);
    assert.equal(aged.birthYear, 1980);
  });
});

describe("gift insights", () => {
  const profiles = [
    { id: 1, birthYear: 1990, age: 36, deceased: false, relationships: ["alumni"], donorTags: ["lapsed"] },
    { id: 2, birthYear: 1955, age: 71, deceased: false, relationships: ["faculty", "parent"], donorTags: ["recurring"] },
    { id: 3, birthYear: null, age: null, deceased: true, relationships: [], donorTags: ["first"] },
  ];

  it("groups counted gifts by generation and names the contact type with the most dollars", () => {
    const insights = buildInsights({
      profiles,
      gifts: [
        { contactId: 1, giftId: 11, amount: 100, touchLabel: "Phone conversation" },
        { contactId: 1, giftId: 12, amount: 50, touchLabel: "Voicemail / dial" },
        { contactId: 2, giftId: 21, amount: 400, touchLabel: "Handwritten note / letter" },
        { contactId: 3, giftId: 31, amount: 25, touchLabel: "No contact logged" },
      ],
      notes: [
        { contactId: 1, bucket: "conversation", label: "Phone conversation" },
        { contactId: 1, bucket: "dial", label: "Voicemail / dial" },
        { contactId: 4, bucket: "conversation", label: "Phone conversation" },
        { contactId: 2, bucket: "note", label: "Handwritten note / letter" },
        { contactId: 2, bucket: "obituary", label: "Obituary" },
        { contactId: 9, bucket: "email", label: "Email bounced" },
      ],
    });
    const millennial = insights.generations.find((group) => group.id === "millennial");
    const boomer = insights.generations.find((group) => group.id === "boomer");
    const unknown = insights.generations.find((group) => group.id === "unknown");
    assert.ok(millennial);
    assert.equal(millennial.donors, 1);
    assert.equal(millennial.gifts, 2);
    assert.equal(millennial.amount, 150);
    assert.equal(millennial.best?.label, "Phone conversation");
    assert.equal(millennial.best?.rate, 1);
    assert.equal(boomer?.best?.label, "Handwritten note / letter");
    assert.equal(boomer?.amount, 400);
    assert.equal(unknown?.best?.label, "No contact logged");
    assert.equal(insights.knownAge, 2);
    assert.equal(insights.deceased, 1);
    assert.equal(insights.relationships.find((group) => group.id === "faculty")?.amount, 400);
    assert.equal(insights.relationships.find((group) => group.id === "parent")?.amount, 400);
    assert.match(insights.findings.join(" "), /Boomer gave \$400/);
    assert.match(insights.findings.join(" "), /Handwritten note \/ letter brought in the most Boomer dollars/);
  });

  it("counts a donor in each university relationship they carry", () => {
    const insights = buildInsights({
      profiles: [
        { id: 2, birthYear: 1955, age: 71, deceased: false, relationships: ["faculty"], donorTags: [] },
      ],
      gifts: [{ contactId: 2, giftId: 21, amount: 400, touchLabel: "Handwritten note / letter" }],
      notes: [],
    });
    const faculty = insights.relationships.find((group) => group.id === "faculty");
    assert.equal(faculty?.amount, 400);
    assert.equal(insights.relationships.find((group) => group.id === "parent"), undefined);
    assert.equal(insights.relationships.find((group) => group.id === "untagged"), undefined);
    assert.match(insights.findings.join(" "), /Faculty\/Staff account for \$400/);
  });

  it("keeps an older outreach gift rate from counting people who were not reached in range", () => {
    const insights = buildInsights({
      profiles,
      gifts: [{ contactId: 1, giftId: 11, amount: 80, touchLabel: "Voicemail / dial" }],
      notes: [
        { contactId: 2, bucket: "dial", label: "Voicemail / dial" },
      ],
    });
    const millennial = insights.generations.find((group) => group.id === "millennial");
    assert.equal(millennial?.best?.rate, null);
    assert.equal(millennial?.cells.dial.amount, 80);
  });

  it("uses the same contact labels as the points map", () => {
    for (const channel of CHANNELS) {
      if (channel.id === "none") continue;
      const rule = Object.values(POINTS_MAP).find((entry) => entry.label === channel.label);
      assert.ok(rule, channel.label);
    }
  });

  it("renders the insights tab from the summary", () => {
    const insights = buildInsights({
      profiles,
      gifts: [
        { contactId: 2, giftId: 21, amount: 400, touchLabel: "Handwritten note / letter" },
        { contactId: 1, giftId: 11, amount: 100, touchLabel: "Phone conversation" },
      ],
      notes: [],
    });
    const html = renderToStaticMarkup(<InsightsPanel insights={insights} />);
    assert.match(html, /Insights/);
    assert.match(html, /Boomer/);
    assert.match(html, /Faculty\/Staff/);
    assert.match(html, /Handwritten note \/ letter/);
    assert.match(html, /Giving history/);
    assert.match(html, /\$400/);
    assert.doesNotMatch(html, /the most of any generation/);
    assert.doesNotMatch(html, /Same dates as the Points tab/);
    assert.doesNotMatch(html, /Birth year is on file/);
    assert.match(html, /Phone vs email conversations/);
    assert.match(html, /No phone or email conversations in this range/);
  });

  it("counts phone and email conversation notes by generation", () => {
    const insights = buildInsights({
      profiles: [
        ...profiles,
        { id: 5, birthYear: 1972, age: 54, deceased: false, relationships: [], donorTags: [] },
        { id: 6, birthYear: 2015, age: 11, deceased: false, relationships: [], donorTags: [] },
      ],
      gifts: [],
      notes: [
        { contactId: 1, bucket: "conversation", label: "Phone conversation" },
        { contactId: 1, bucket: "conversation", label: "Phone conversation" },
        { contactId: 1, bucket: "email", label: "Email conversation" },
        { contactId: 2, bucket: "email", label: "Email conversation" },
        { contactId: 5, bucket: "conversation", label: "Phone conversation" },
        { contactId: 5, bucket: "email", label: "Email conversation" },
        { contactId: 2, bucket: "email", label: "Email conversation", removed: true },
        { contactId: 1, bucket: "conversation", label: "Phone conversation", unmatched: true },
        { contactId: 1, bucket: "email", label: "Email reach-out" },
        { contactId: 1, bucket: "email", label: "Text message" },
        { contactId: 1, bucket: "email", label: "Email conversation", assist: true },
        { label: "Email conversation" },
        { contactId: 6, bucket: "conversation", label: "Phone conversation" },
      ],
    });
    const byId = Object.fromEntries(insights.conversations.map((row) => [row.id, row]));
    assert.equal(byId.millennial.phone, 2);
    assert.equal(byId.millennial.email, 1);
    assert.equal(byId.millennial.more, "phone");
    assert.equal(byId.boomer.phone, 0);
    assert.equal(byId.boomer.email, 1);
    assert.equal(byId.boomer.more, "email");
    assert.equal(byId.genx.phone, 1);
    assert.equal(byId.genx.email, 1);
    assert.equal(byId.genx.more, "tie");
    assert.equal(byId.genz.more, "none");
    assert.equal(byId.earlier.more, "none");
    assert.equal(byId.later.phone, 1);
    assert.equal(byId.later.email, 0);
    assert.equal(byId.unknown.email, 1);
    assert.equal(byId.unknown.phone, 0);
    assert.equal(insights.generations.length, 0);
    assert.equal(insights.conversations.find((row) => row.id === "millennial")?.label, "Millennial");

    const html = renderToStaticMarkup(<InsightsPanel insights={insights} />);
    assert.match(html, /Phone vs email conversations/);
    assert.match(html, /Phone conversation/);
    assert.match(html, /Email conversation/);
    assert.match(html, /Gen X/);
    assert.match(html, /Tie/);
    assert.match(html, /No counted gifts in this range/);
    assert.doesNotMatch(html, /the most of any generation/);
    assert.doesNotMatch(html, /Email reach-out/);
  });

  it("rolls a Virtuous segment into a campaign", () => {
    assert.equal(campaignOf({ segment: "FYE27 Fall 2026 Appeal Active Direct Mail 1" }).id, "fall");
    assert.equal(campaignOf({ project: "Annunciation Circle" }).id, "ac");
    assert.equal(campaignOf({ segment: "26-27 Chancellor's Gala" }).id, "gala");
    assert.equal(campaignOf({ segment: "Direct Solicitation (MGO)" }).id, "mgo");
    assert.equal(campaignOf({ segment: "White Mail" }).id, "white");
    assert.equal(campaignOf({ segment: "Gyrene Booster Club" }).id, "athletics");
    assert.equal(campaignOf({ segment: "Mission Fund" }).label, "Mission Fund");
  });

  it("groups counted gifts by campaign and names the contact that reached them", () => {
    const insights = buildInsights({
      profiles,
      gifts: [
        { contactId: 1, giftId: 11, amount: 100, touchLabel: "Phone conversation", segment: "FYE27 Fall 2026 Appeal Active Direct Mail 1" },
        { contactId: 2, giftId: 21, amount: 400, touchLabel: "Handwritten note / letter", segment: "Annunciation Circle" },
        { contactId: 2, giftId: 22, amount: 50, touchLabel: "Phone conversation", project: "Annunciation Circle" },
      ],
      notes: [],
    });
    const fall = insights.campaigns.find((group) => group.id === "fall");
    const ac = insights.campaigns.find((group) => group.id === "ac");
    assert.ok(fall);
    assert.ok(ac);
    assert.equal(fall.gifts, 1);
    assert.equal(fall.amount, 100);
    assert.equal(fall.best?.label, "Phone conversation");
    assert.equal(ac.gifts, 2);
    assert.equal(ac.amount, 450);
    assert.equal(ac.best?.label, "Handwritten note / letter");
    const html = renderToStaticMarkup(<InsightsPanel insights={insights} />);
    assert.match(html, /Reached by campaign/);
    assert.match(html, /Fall Appeal/);
    assert.match(html, /Annunciation Circle/);
  });
});
