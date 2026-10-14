// "UK visa sponsors only" - the clients-tracking side of Utils/ukVisaSponsor.js.
//
//   GET  /uk-sponsor-only?email=          -> is this a UK client, is the switch on, register size,
//                                            and sponsor counts for the places the client wants
//   POST /update-uk-sponsor-only          { email, enabled, updatedBy? } -> flip the switch
//   GET  /uk-visa-sponsors/lookup?company= -> would this employer pass?
//
// Same access model as the neighbouring /update-scrape-sources and
// /update-target-jobs: the clients-tracking AI Summary page calls these from
// the browser. The switch can only be turned ON for a UK client (422
// otherwise), because for anyone else the register says nothing useful.

import { ProfileModel } from "../Schema_Models/ProfileModel.js";
import { UkVisaSponsorModel } from "../Schema_Models/UkVisaSponsorModel.js";
import { resolveClientCountry, findUkSponsor, sponsorCountsForPlaces } from "../Utils/ukVisaSponsor.js";

const cleanEmail = (raw) => String(raw || "").toLowerCase().trim();

async function registerInfo() {
  const [count, newest] = await Promise.all([
    UkVisaSponsorModel.estimatedDocumentCount(),
    UkVisaSponsorModel.findOne({}, { registerDate: 1, importedAt: 1, _id: 0 }).sort({ importedAt: -1 }).lean(),
  ]);
  return { sponsors: count, registerDate: newest?.registerDate || null, importedAt: newest?.importedAt || null };
}

export async function GetUkSponsorOnly(req, res) {
  try {
    const email = cleanEmail(req.query?.email);
    if (!email.includes("@")) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
    }
    const [profile, client, register] = await Promise.all([
      ProfileModel.findOne({ email }).select("ukSponsorOnly ukSponsorOnlyMeta preferredLocations").lean(),
      resolveClientCountry(email),
      registerInfo(),
    ]);
    if (!profile) {
      return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
    }
    // Where the client wants to work, with the sponsor count for each place.
    // Only worth the queries for a UK client; everyone else gets [].
    const places = client.isUk && register.sponsors
      ? await sponsorCountsForPlaces(profile.preferredLocations)
      : [];
    return res.json({
      success: true,
      email,
      isUkClient: client.isUk,
      preferredLocations: Array.isArray(profile.preferredLocations) ? profile.preferredLocations : [],
      places,
      clientCountry: client.country,
      countrySource: client.source,
      enabled: profile.ukSponsorOnly === true,
      // On but not enforced: the client was re-tagged to another country.
      active: profile.ukSponsorOnly === true && client.isUk,
      updatedAt: profile.ukSponsorOnlyMeta?.updatedAt || null,
      updatedBy: profile.ukSponsorOnlyMeta?.updatedBy || "",
      register,
    });
  } catch (err) {
    console.error("GetUkSponsorOnly error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
  }
}

export async function UpdateUkSponsorOnly(req, res) {
  try {
    const { email: rawEmail, enabled, updatedBy } = req.body || {};
    const email = cleanEmail(rawEmail);
    if (!email.includes("@")) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "email is required" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "enabled must be true or false" });
    }
    if (enabled) {
      const client = await resolveClientCountry(email);
      if (!client.isUk) {
        return res.status(422).json({
          success: false,
          error: "NOT_UK_CLIENT",
          message: `${email} is not a UK client (country: ${client.country || "not set"}). Set the country to UK in Client Job Analysis first.`,
        });
      }
      const { sponsors } = await registerInfo();
      if (!sponsors) {
        return res.status(503).json({
          success: false,
          error: "SPONSOR_REGISTER_EMPTY",
          message: "The UK sponsor register has not been imported yet, so every job would be refused. Run scripts/import-uk-visa-sponsors.mjs first.",
        });
      }
    }
    const profile = await ProfileModel.findOneAndUpdate(
      { email },
      {
        $set: {
          ukSponsorOnly: enabled,
          "ukSponsorOnlyMeta.updatedAt": new Date(),
          "ukSponsorOnlyMeta.updatedBy": String(updatedBy || "clients-tracking").slice(0, 80),
        },
      },
      { new: true, lean: true, projection: { email: 1, ukSponsorOnly: 1, ukSponsorOnlyMeta: 1 } },
    );
    if (!profile) {
      return res.status(404).json({ success: false, error: "PROFILE_NOT_FOUND", message: `no profile for ${email}` });
    }
    return res.json({
      success: true,
      email: profile.email,
      enabled: profile.ukSponsorOnly === true,
      updatedAt: profile.ukSponsorOnlyMeta?.updatedAt || null,
      updatedBy: profile.ukSponsorOnlyMeta?.updatedBy || "",
    });
  } catch (err) {
    console.error("UpdateUkSponsorOnly error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
  }
}

export async function LookupUkSponsor(req, res) {
  try {
    const company = String(req.query?.company || "").trim().slice(0, 200);
    if (!company) {
      return res.status(400).json({ success: false, error: "BAD_INPUT", message: "company is required" });
    }
    const result = await findUkSponsor(company);
    return res.json({ success: true, company, ...result });
  } catch (err) {
    console.error("LookupUkSponsor error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", message: err.message });
  }
}
