const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { WhatsappCall, WhatsappConversation } = require('../models');
const { whatsapp: waClient } = require('../thirdparty');

/**
 * Voice calling (Phase 4) on Meta's WhatsApp Business Calling API.
 *
 * Signalling only lives here; audio is WebRTC between the counsellor's browser
 * and Meta's media servers. Flow for a business-initiated call:
 *   browser  -> POST /conversations/:id/calls { sdpOffer }
 *   backend  -> Meta  POST /{phone}/calls action=connect (sdp offer)
 *   Meta     -> webhook field=calls event=connect (sdp answer)
 *   backend  -> socket wa:call:sdp { callId, sdpAnswer }  (browser applies it)
 *   Meta     -> webhook statuses RINGING / ACCEPTED / REJECTED -> wa:call:status
 *   either   -> terminate; Meta -> webhook event=terminate (duration) -> wa:call:status ended
 *
 * Permission: Meta refuses to dial a user who has not granted calling
 * permission (error 138006). We cache the last known state on the conversation
 * and refresh it from the call_permissions endpoint when the inbox asks.
 */

const emitTo = (io, userIds, event, payload) => {
  if (!io) return;
  [...new Set((userIds || []).map(String))].forEach((uid) => io.to(uid).emit(event, payload));
};

const recipients = (conv) => (conv.assignees || []).map((a) => a.userId).filter(Boolean);

const toCallDTO = (call, conv) => ({
  id: call._id.toString(),
  waCallId: call.waCallId || undefined,
  conversationId: call.conversation.toString(),
  contact: conv ? { phone: conv.contact.phone, name: conv.contact.name, waId: conv.contact.waId } : undefined,
  direction: call.direction,
  status: call.status,
  startedAt: call.startedAt ? new Date(call.startedAt).toISOString() : undefined,
  connectedAt: call.connectedAt ? new Date(call.connectedAt).toISOString() : undefined,
  endedAt: call.endedAt ? new Date(call.endedAt).toISOString() : undefined,
  durationSec: call.durationSec,
  endReason: call.endReason || undefined,
});

const statusEvent = (call) => ({
  callId: call._id.toString(),
  conversationId: call.conversation.toString(),
  status: call.status,
  durationSec: call.durationSec,
  endReason: call.endReason || undefined,
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

const mapPermission = (meta) => {
  const p = (meta && meta.permission) || {};
  if (p.status === 'permanent') return { status: 'permanent' };
  if (p.status === 'temporary') {
    const exp = p.expiration_time || p.expiration;
    return { status: 'temporary', expiresAt: exp ? new Date(Number(exp) * 1000) : undefined };
  }
  return { status: 'none' };
};

const callHoursOpen = async () => {
  try {
    const s = await waClient.getCallSettings();
    const calling = (s && s.calling) || {};
    if (calling.status && calling.status !== 'ENABLED') return false;
    const hours = calling.call_hours || {};
    if (!hours.status || hours.status === 'DISABLED') return true;
    // Meta enforces the schedule itself (138002); we only surface a coarse hint.
    return true;
  } catch (e) {
    return true;
  }
};

/** GET permission as the CRM expects: { status: granted|pending|none, callHoursOpen }. */
const getPermission = async (conversationId) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  let live;
  try {
    live = mapPermission(await waClient.getCallPermissions(conv.contact.waId || conv.contact.phone));
  } catch (e) {
    live = null;
  }
  const cached = conv.callPermission || {};
  let status;
  if (live && live.status !== 'none') status = 'granted';
  else if (cached.status === 'pending' && cached.requestedAt && Date.now() - cached.requestedAt < 7 * 24 * 3600 * 1000) {
    status = 'pending';
  } else status = 'none';
  if (live) {
    const expired = live.status === 'temporary' && live.expiresAt && live.expiresAt < new Date();
    if (expired) status = cached.status === 'pending' ? 'pending' : 'none';
    conv.callPermission = {
      ...(status === 'pending' ? { status: 'pending', requestedAt: cached.requestedAt } : live),
      requestedAt: cached.requestedAt,
    };
    await conv.save();
  }
  return { status, callHoursOpen: await callHoursOpen() };
};

/** Send the permission request interactive message (24h window only). */
const requestPermission = async (conversationId, bodyText) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  const text =
    bodyText ||
    'Hi! A counsellor from Ulearn Abroad would like to call you on WhatsApp to help with your application. Please allow calls so we can reach you.';
  try {
    await waClient.sendCallPermissionRequest(conv.contact.phone, text);
  } catch (e) {
    // 138017: the customer already allows calls from this number — nothing to ask.
    if (e.meta && Number(e.meta.code) === 138017) {
      conv.callPermission = { status: 'permanent' };
      await conv.save();
      return { status: 'granted', callHoursOpen: await callHoursOpen() };
    }
    throw e;
  }
  conv.callPermission = { status: 'pending', requestedAt: new Date() };
  await conv.save();
  return { status: 'pending', callHoursOpen: await callHoursOpen() };
};

/** Inbound interactive call_permission_reply (arrives in the messages webhook). */
// eslint-disable-next-line no-param-reassign
const onPermissionReply = async (io, conv, reply) => {
  const accepted = reply && reply.response === 'accept';
  // eslint-disable-next-line no-param-reassign
  conv.callPermission = accepted
    ? {
        status: reply.is_permanent ? 'permanent' : 'temporary',
        expiresAt: reply.expiration_timestamp ? new Date(Number(reply.expiration_timestamp) * 1000) : undefined,
      }
    : { status: 'none' };
  await conv.save();
  emitTo(io, recipients(conv), 'wa:call:permission', {
    conversationId: conv._id.toString(),
    status: accepted ? 'granted' : 'none',
  });
};

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

const startCall = async (io, conversationId, sdpOffer, user) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (!sdpOffer) throw new ApiError(httpStatus.BAD_REQUEST, 'sdpOffer is required (browser WebRTC offer)');
  const call = await WhatsappCall.create({
    conversation: conv._id,
    direction: 'business_initiated',
    status: 'ringing',
    initiatedBy: user._id,
  });
  try {
    const resp = await waClient.startCall(conv.contact.phone, sdpOffer, `${conv._id}:${call._id}`);
    call.waCallId = resp && resp.calls && resp.calls[0] && resp.calls[0].id;
    await call.save();
  } catch (e) {
    call.status = 'failed';
    const reasons = { NO_PERMISSION: 'no_permission', OUT_OF_HOURS: 'out_of_hours' };
    call.endReason = reasons[e.code] || 'failed';
    call.endedAt = new Date();
    call.error = { code: e.code ? String(e.code) : 'CALL_FAILED', title: e.message };
    await call.save();
    if (e.code === 'NO_PERMISSION') conv.callPermission = { status: 'none' };
    await conv.save();
    throw e;
  }
  return toCallDTO(call, conv);
};

const terminateCall = async (io, callId) => {
  const call = await WhatsappCall.findById(callId);
  if (!call) throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  if (call.waCallId && !['ended', 'failed', 'rejected', 'missed'].includes(call.status)) {
    await waClient.terminateCall(call.waCallId).catch((e) => logger.warn(`[whatsapp] terminate: ${e.message}`));
  }
  if (!['ended', 'failed', 'rejected', 'missed'].includes(call.status)) {
    call.status = call.connectedAt ? 'ended' : 'missed';
    call.endReason = call.connectedAt ? 'completed' : 'no_answer';
    call.endedAt = new Date();
    if (call.connectedAt) call.durationSec = Math.round((call.endedAt - call.connectedAt) / 1000);
    await call.save();
    const conv = await WhatsappConversation.findById(call.conversation);
    if (conv) emitTo(io, recipients(conv), 'wa:call:status', statusEvent(call));
  }
  return { durationSec: call.durationSec || 0 };
};

/** Counsellor answers an inbound call from the browser with its SDP answer. */
const acceptCall = async (io, callId, sdpAnswer) => {
  const call = await WhatsappCall.findById(callId);
  if (!call) throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  if (call.direction !== 'user_initiated') throw new ApiError(httpStatus.BAD_REQUEST, 'Only inbound calls can be accepted');
  if (call.status !== 'ringing') throw new ApiError(httpStatus.CONFLICT, 'Call is no longer ringing');
  if (!sdpAnswer) throw new ApiError(httpStatus.BAD_REQUEST, 'sdpAnswer is required');
  await waClient.acceptCall(call.waCallId, sdpAnswer);
  call.status = 'in_call';
  call.connectedAt = new Date();
  call.sdpOffer = undefined;
  await call.save();
  const conv = await WhatsappConversation.findById(call.conversation);
  emitTo(io, conv ? recipients(conv) : [], 'wa:call:status', statusEvent(call));
  return toCallDTO(call, conv);
};

const rejectCall = async (io, callId) => {
  const call = await WhatsappCall.findById(callId);
  if (!call) throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  if (call.status === 'ringing') {
    await waClient.rejectCall(call.waCallId).catch((e) => logger.warn(`[whatsapp] reject: ${e.message}`));
    call.status = 'rejected';
    call.endReason = 'rejected';
    call.endedAt = new Date();
    call.sdpOffer = undefined;
    await call.save();
    const conv = await WhatsappConversation.findById(call.conversation);
    emitTo(io, conv ? recipients(conv) : [], 'wa:call:status', statusEvent(call));
  }
  return toCallDTO(call);
};

const listCalls = async (conversationId) => {
  const calls = await WhatsappCall.find({ conversation: conversationId }).sort({ startedAt: -1 }).limit(50);
  return calls.map((c) => toCallDTO(c));
};

// ---------------------------------------------------------------------------
// Webhooks (field: calls)
// ---------------------------------------------------------------------------

const findCallByWaId = (waCallId) => WhatsappCall.findOne({ waCallId });

const handleCallEvents = async (io, value) => {
  // value.calls[] — connect (SDP) / terminate events; value.statuses[] — RINGING/ACCEPTED/REJECTED
  await Promise.all(
    (value.calls || []).map(async (ev) => {
      let call = await findCallByWaId(ev.id);
      let conv;
      if (!call && ev.direction === 'USER_INITIATED') {
        // Inbound call from a customer. We do not auto-answer (needs a browser
        // media session); record it so the thread shows a missed call.
        conv = await WhatsappConversation.findOne({ 'contact.waId': String(ev.from || '').replace(/[^\d]/g, '') });
        if (!conv) return;
        call = await WhatsappCall.create({
          conversation: conv._id,
          waCallId: ev.id,
          direction: 'user_initiated',
          status: 'ringing',
          startedAt: ev.timestamp ? new Date(Number(ev.timestamp) * 1000) : new Date(),
        });
      }
      if (!call) return;
      conv = conv || (await WhatsappConversation.findById(call.conversation));
      const users = conv ? recipients(conv) : [];

      if (ev.event === 'connect' && ev.session && ev.session.sdp_type === 'answer') {
        if (call.status === 'ringing') call.status = 'connecting';
        await call.save();
        emitTo(io, users, 'wa:call:sdp', { callId: call._id.toString(), sdpAnswer: ev.session.sdp });
        emitTo(io, users, 'wa:call:status', statusEvent(call));
        return;
      }
      if (ev.event === 'connect' && call.direction === 'user_initiated') {
        // Inbound call: hold the caller's SDP offer and ring every assigned
        // counsellor's browser. Whoever answers first builds the SDP answer.
        if (ev.session && ev.session.sdp) {
          call.sdpOffer = ev.session.sdp;
          await call.save();
        }
        emitTo(io, users, 'wa:call:incoming', { ...toCallDTO(call, conv), sdpOffer: call.sdpOffer });
        emitTo(io, users, 'wa:call:status', { ...statusEvent(call), status: 'ringing' });
        return;
      }
      if (ev.event === 'terminate') {
        const st = String(ev.status || '').toUpperCase();
        if (st === 'COMPLETED' && (call.connectedAt || ev.duration)) {
          call.status = 'ended';
          call.endReason = 'completed';
        } else if (st === 'COMPLETED') {
          call.status = call.status === 'rejected' ? 'rejected' : 'missed';
          call.endReason = call.status === 'rejected' ? 'rejected' : 'no_answer';
        } else {
          call.status = 'failed';
          call.endReason = 'failed';
          if (ev.errors && ev.errors[0]) call.error = { code: String(ev.errors[0].code), title: ev.errors[0].message };
        }
        call.endedAt = ev.end_time ? new Date(Number(ev.end_time) * 1000) : new Date();
        if (ev.duration !== undefined) call.durationSec = Number(ev.duration);
        if (ev.start_time && !call.connectedAt) call.connectedAt = new Date(Number(ev.start_time) * 1000);
        await call.save();
        emitTo(io, users, 'wa:call:status', statusEvent(call));
      }
    })
  );

  await Promise.all(
    (value.statuses || []).map(async (st) => {
      if (st.type && st.type !== 'call') return;
      const call = await findCallByWaId(st.id);
      if (!call) return;
      const s = String(st.status || '').toUpperCase();
      if (s === 'RINGING' && call.status === 'ringing') {
        /* already ringing */
      } else if (s === 'ACCEPTED') {
        call.status = 'in_call';
        call.connectedAt = call.connectedAt || (st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date());
      } else if (s === 'REJECTED') {
        call.status = 'rejected';
        call.endReason = 'rejected';
        call.endedAt = new Date();
      } else return;
      await call.save();
      const conv = await WhatsappConversation.findById(call.conversation);
      emitTo(io, conv ? recipients(conv) : [], 'wa:call:status', statusEvent(call));
    })
  );
};

// ---------------------------------------------------------------------------
// Settings (admin diagnostics / onboarding)
// ---------------------------------------------------------------------------

const getSettings = () => waClient.getCallSettings();

const enableCalling = async () =>
  waClient.updateCallSettings({
    status: 'ENABLED',
    call_icon_visibility: 'DEFAULT',
    callback_permission_status: 'ENABLED',
  });

module.exports = {
  getPermission,
  requestPermission,
  onPermissionReply,
  startCall,
  acceptCall,
  rejectCall,
  terminateCall,
  listCalls,
  handleCallEvents,
  getSettings,
  enableCalling,
};
