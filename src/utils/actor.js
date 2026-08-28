/**
 * Who performed this request, for activity-timeline attribution.
 *
 * Historically every controller read `req.body.editor` and fell back to the
 * string 'Someone'. That has two problems: any client that forgets to send the
 * field produces an unattributable timeline entry (which is why the back-office
 * showed "Someone updated the profile" for every event), and the field is
 * client-supplied, so a caller could attribute an action to anybody.
 *
 * `req.user` is set by softAuth/auth from the verified JWT, so prefer it and
 * keep `req.body.editor` only as a fallback for callers that predate auth on
 * these routes.
 *
 * @param {import('express').Request} req
 * @returns {{ id: string|undefined, name: string }}
 */
const actorOf = (req) => {
  const u = req.user || {};
  const editor = (req.body && req.body.editor) || {};

  const fromUser = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const name = fromUser || editor.name || 'Someone';
  const id = (u.id && String(u.id)) || (u._id && String(u._id)) || editor.id || undefined;

  return { id, name };
};

module.exports = { actorOf };
