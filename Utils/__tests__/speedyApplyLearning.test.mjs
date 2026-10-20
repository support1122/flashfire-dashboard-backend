// SpeedyApply shared learning: what one client's learning can teach everyone.
//
// The shared map fills real applications for every client, so the bar is
// "several different clients agree", and nothing personal ever gets in.

import test from "node:test";
import assert from "node:assert/strict";
import { mergeLearnedMaps, clientAliases, isShareableLabel, normalizeLabelKey } from "../speedyApplyLearning.js";

// The shape shared/learning.js stores.
const learned = (pairs) => Object.fromEntries(pairs.map(([label, field]) => [label, { profileField: field, count: 2, score: 1, lastSeen: 1 }]));

test("a label is shared once three different clients agree", () => {
  const two = [learned([["what should we call you", "preferredFirstName"]]), learned([["what should we call you", "preferredFirstName"]])];
  assert.deepEqual(mergeLearnedMaps(two).mappings, {});
  const three = [...two, learned([["What should we call you?*", "preferredFirstName"]])];
  const { mappings, stats } = mergeLearnedMaps(three);
  assert.deepEqual(mappings["what should we call you"], { profileField: "preferredFirstName", clients: 3, agreement: 1 });
  assert.equal(stats.contributors, 3);
});

test("clients who disagree keep a label out", () => {
  const maps = [
    ...Array(3).fill(learned([["name", "firstName"]])),
    ...Array(3).fill(learned([["name", "fullName"]])),
  ];
  const { mappings, stats } = mergeLearnedMaps(maps);
  assert.equal(mappings.name, undefined);
  assert.equal(stats.contested, 1);
});

test("a clear majority still wins", () => {
  const maps = [...Array(4).fill(learned([["legal first name", "firstName"]])), learned([["legal first name", "preferredFirstName"]])];
  const m = mergeLearnedMaps(maps).mappings["legal first name"];
  assert.equal(m.profileField, "firstName");
  assert.equal(m.agreement, 0.8);
});

test("pending flips and unknown fields never count", () => {
  const a = clientAliases({
    "town": { pendingField: "address.city", confirmCount: 1 },
    "salary": { profileField: "salaryExpectation" },
    "town of residence": { profileField: "address.city" },
  });
  assert.deepEqual([...a], [["town of residence", "address.city"]]);
});

test("labels that could carry personal or page data are not shared", () => {
  assert.equal(isShareableLabel("email me at jo@acme.com"), false);
  assert.equal(isShareableLabel("employee id 448812"), false);
  assert.equal(isShareableLabel("see https://acme.com/form"), false);
  assert.equal(isShareableLabel("why do you want to join"), false);
  assert.equal(isShareableLabel("a".repeat(81)), false);
  assert.equal(isShareableLabel("12"), false);
  assert.equal(isShareableLabel("zip / postal code"), true);
});

test("labels normalise the same way the extension does", () => {
  assert.equal(normalizeLabelKey("  Zip  Code *: "), "zip code");
  assert.equal(normalizeLabelKey("Town?"), "town");
});

test("garbage input is ignored, not thrown", () => {
  const { mappings, stats } = mergeLearnedMaps([null, "x", 42, {}, { a: null }]);
  assert.deepEqual(mappings, {});
  assert.equal(stats.contributors, 0);
});
