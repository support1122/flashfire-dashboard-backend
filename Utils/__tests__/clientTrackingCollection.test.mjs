// ClientTrackingModel must read the collection clients-tracking really writes.
//
// Reported 2026-09-23: a Professional client with a paid +250 addon was refused
// by /addjob at 500/500 ("PLAN_LIMIT_REACHED ... 500/500 applications for
// Professional"), while the clients-tracking row showed "Addon: +250".
//
// Cause: clients-tracking registers mongoose.model('DashboardTracking', schema)
// with no explicit collection, so its records live in Mongoose's pluralisation
// of that name, `dashboardtrackings`. This backend's ClientTrackingModel said
// collection "DashboardTracking" - a different, empty collection - so
// readPlanCap found no addons for ANY client, and JrCredsStatus never found a
// team lead.
//
// The test ties the name to Mongoose's own pluralisation of the model name
// clients-tracking uses, rather than to a string we typed, so the two cannot
// drift apart again. The addon arithmetic cases are the exact `type` shapes
// both clients-tracking writers produce (Stripe webhook metadata.addon and the
// manual add-addon form).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import {
    ClientTrackingModel,
    CLIENT_TRACKING_COLLECTION,
    computeAddonBonus,
} from '../../Schema_Models/ClientTrackingModel.js';

// The model name clients-tracking registers. Read from its source so a rename
// there fails this test instead of silently splitting the data again.
const CT_CLIENT_MODEL = new URL(
    '../../../clients-tracking/applications_monitor_backend/ClientModel.js',
    import.meta.url,
);

test('binds to the collection Mongoose derives from "DashboardTracking"', () => {
    const expected = mongoose.pluralize()('DashboardTracking');
    assert.equal(expected, 'dashboardtrackings');
    assert.equal(CLIENT_TRACKING_COLLECTION, expected);
    assert.equal(ClientTrackingModel.collection.collectionName, expected);
});

test('clients-tracking still registers "DashboardTracking" with no explicit collection', (t) => {
    let src;
    try { src = readFileSync(CT_CLIENT_MODEL, 'utf8'); }
    catch { t.skip('clients-tracking checkout not next to this repo'); return; }
    const m = src.match(/mongoose\.model\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*(,\s*['"]([^'"]+)['"])?\s*\)/);
    assert.ok(m, 'mongoose.model(...) registration not found in clients-tracking ClientModel.js');
    const [, modelName, , , explicitCollection] = m;
    const writes = explicitCollection || mongoose.pluralize()(modelName);
    assert.equal(writes, CLIENT_TRACKING_COLLECTION,
        `clients-tracking writes "${writes}" but ClientTrackingModel reads "${CLIENT_TRACKING_COLLECTION}"`);
});

test('addon bonus sums every addon type both writers produce', () => {
    // Stripe webhook: metadata.addon is a string ('250' / '500' / '1000').
    assert.equal(computeAddonBonus({ addons: [{ type: '250', price: 120 }] }), 250);
    // Manual form can arrive as a number, and legacy docs used addonType.
    assert.equal(computeAddonBonus({ addons: [{ type: 500 }, { addonType: '1000' }] }), 1500);
    // Several purchases stack.
    assert.equal(computeAddonBonus({ addons: [{ type: '250' }, { type: '250' }] }), 500);
});

test('addon bonus ignores junk and missing docs', () => {
    assert.equal(computeAddonBonus(null), 0);
    assert.equal(computeAddonBonus({}), 0);
    assert.equal(computeAddonBonus({ addons: [{ type: 'n/a' }, { type: -250 }, {}] }), 0);
});
