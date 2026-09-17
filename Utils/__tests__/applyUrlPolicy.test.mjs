// The apply-URL policy in AddJob.js.
//
// Two separate lists, both read from the environment so adding or removing a
// portal is a config change, never a code edit:
//   BLOCKED_APPLY_HOSTS      job boards + unresolved jobright.ai links
//   EXCLUDED_EMPLOYER_HOSTS  employers we do not apply to, by policy
//
// The distinction matters to the operator. An aggregator link is fixable -
// go and find the employer URL. An excluded employer is not: the link is
// already correct and the job is skipped deliberately. Reporting the second
// as the first told operators to hunt for a URL that does not exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../Controllers/AddJob.js', import.meta.url), 'utf8');
const start = src.indexOf('        const hostList = (raw, fallback) =>');
const end = src.indexOf('        let host = ');
assert.ok(start >= 0 && end > start, 'apply-URL policy block not found in AddJob.js');

function policy(env = {}) {
    const body = `
${src.slice(start, end)}
return (url) => {
    const joblinkRaw = String(url || '');
    let host = '';
    try { host = new URL(joblinkRaw).hostname.toLowerCase(); } catch { host = ''; }
    const loose = (list) => list.some((h) => joblinkRaw.toLowerCase().includes(h));
    const hit = (list) => (host ? matchesHost(host, list) : loose(list));
    if (hit(AGGREGATOR_HOSTS)) return 'BLOCKED_SOURCE';
    if (hit(EXCLUDED_EMPLOYER_HOSTS)) return 'EXCLUDED_EMPLOYER';
    return 'allowed';
};`;
    return new Function('process', body)({ env });
}

test('defaults block aggregators and unresolved jobright links', () => {
    const p = policy();
    assert.equal(p('https://www.linkedin.com/jobs/view/1'), 'BLOCKED_SOURCE');
    assert.equal(p('https://www.dice.com/job-detail/x'), 'BLOCKED_SOURCE');
    assert.equal(p('https://www.indeed.com/viewjob?jk=1'), 'BLOCKED_SOURCE');
    assert.equal(p('https://jobright.ai/jobs/info/abc'), 'BLOCKED_SOURCE');
});

test('real employer and ATS links go through', () => {
    const p = policy();
    for (const url of [
        'https://www.sthree.com/en-gb/job-detail/scrum-master/ER001447/',
        'https://jobs.smartrecruiters.com/Netcompany1/744000149877712',
        'https://usource.ripplehire.com/candidate?token=x#detail/job/61317',
        'https://boards.greenhouse.io/acme/jobs/1',
        'https://jobs.lever.co/acme/1',
        'https://careers.google.com/jobs/results/1',
        'https://servicenow.wd1.myworkdayjobs.com/x',
        'https://acme.icims.com/jobs/1',
        'https://acme.bamboohr.com/careers/1',
    ]) assert.equal(p(url), 'allowed', url);
});

test('subdomains are covered, lookalikes are not', () => {
    const p = policy();
    assert.equal(p('https://uk.linkedin.com/jobs/1'), 'BLOCKED_SOURCE');
    assert.equal(p('https://notlinkedin.com/jobs/1'), 'allowed');
    assert.equal(p('https://dice.com.example.org/jobs/1'), 'allowed');
});

test('excluded employers are reported as policy, not as a bad link', () => {
    const p = policy();
    assert.equal(p('https://jobs.apple.com/en-us/details/200612'), 'EXCLUDED_EMPLOYER');
    assert.equal(p('https://humana.wd5.myworkdayjobs.com/x'), 'EXCLUDED_EMPLOYER');
    // A different Workday tenant is a normal employer.
    assert.equal(p('https://acme.wd5.myworkdayjobs.com/x'), 'allowed');
});

test('the lists are configurable without a code change', () => {
    const p = policy({ BLOCKED_APPLY_HOSTS: 'ziprecruiter.com,glassdoor.com', EXCLUDED_EMPLOYER_HOSTS: 'acme.com' });
    assert.equal(p('https://www.ziprecruiter.com/jobs/1'), 'BLOCKED_SOURCE');
    assert.equal(p('https://careers.acme.com/1'), 'EXCLUDED_EMPLOYER');
    // No longer in the list, so it is allowed again.
    assert.equal(p('https://www.dice.com/job-detail/x'), 'allowed');
    assert.equal(p('https://jobs.apple.com/x'), 'allowed');
});

test('an unparseable URL still cannot smuggle a blocked host through', () => {
    const p = policy();
    assert.equal(p('href=www.dice.com/job/1'), 'BLOCKED_SOURCE');
    assert.equal(p('not a url at all'), 'allowed');
});
