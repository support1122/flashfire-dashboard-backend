/**
 * The written reason an operator (intern) must give when moving a job card to
 * Removed.
 *
 * WHERE IT LIVES AND WHO SEES IT
 * ------------------------------
 * It is stored on the job as `operatorRemoval` ({ reason, by, byEmail, at }),
 * NOT in `removalReason`. `removalReason` is the client's own reason: the
 * client reads it back by long-pressing a removed card, and it feeds the AI
 * summary on their profile. An operator's note is internal ("client asked us
 * to drop this", "link is dead") and must never reach the client, so it gets
 * its own field with `select: false` in JobModel. Every query leaves it out
 * unless it explicitly asks for `+operatorRemoval`, which only
 * /operations/job-removal-note does.
 *
 * WHY THE SERVER CHECKS IT
 * ------------------------
 * The portal asks for the reason in a modal, but a modal is only a request.
 * The rule is enforced in UpdateChanges, so a stale tab, a script or a future
 * screen cannot move a card to Removed as an operator without one.
 *
 * The minimum length is there to stop "x" and "ok" from passing as a reason.
 * Ten characters is short enough for "Job closed" or "Duplicate" plus a word.
 */

export const OPERATOR_REASON_MIN_LENGTH = 10;
export const OPERATOR_REASON_MAX_LENGTH = 1000;

/**
 * @param {unknown} raw
 * @returns {{ ok: true, reason: string } | { ok: false, message: string }}
 */
export function validateOperatorRemovalReason(raw) {
     const reason = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
     if (!reason) {
          return { ok: false, message: "A written reason is required to move a job card to Removed." };
     }
     if (reason.length < OPERATOR_REASON_MIN_LENGTH) {
          return {
               ok: false,
               message: `Please write a reason of at least ${OPERATOR_REASON_MIN_LENGTH} characters.`,
          };
     }
     return { ok: true, reason: reason.slice(0, OPERATOR_REASON_MAX_LENGTH) };
}
