import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { routeAfterInboundMessage } from '@/lib/conversations/route-event';
import { getInboundConversationUpdate } from '@/lib/conversations/routing';
import {
  createSupabaseInboundDealRepository,
  ensureInboundDeal,
} from '@/lib/pipelines/inbound-deal';
import type { MetaChannel } from '@/types';

import type { NormalizedMetaMessage } from './messaging';

type MetaInboundDatabase = SupabaseClient;

interface SocialContact {
  id: string;
  name: string | null;
  phone: string | null;
}

interface SocialConversation {
  id: string;
  status: 'open' | 'pending' | 'closed';
  unread_count: number | null;
}

interface SocialIdentity {
  contact_id: string;
}

function isError(value: unknown): value is { message?: string; code?: string } {
  return typeof value === 'object' && value !== null;
}

async function findIdentity(
  db: MetaInboundDatabase,
  channelId: string,
  externalUserId: string
): Promise<SocialIdentity | null> {
  const { data, error } = await db
    .from('meta_contact_identities')
    .select('contact_id')
    .eq('channel_id', channelId)
    .eq('external_user_id', externalUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as SocialIdentity | null) ?? null;
}

async function findContact(
  db: MetaInboundDatabase,
  accountId: string,
  contactId: string
): Promise<SocialContact | null> {
  const { data, error } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as SocialContact | null) ?? null;
}

async function resolveContact(
  db: MetaInboundDatabase,
  channel: MetaChannel,
  message: NormalizedMetaMessage
): Promise<SocialContact> {
  const existingIdentity = await findIdentity(db, channel.id, message.senderId);

  if (existingIdentity) {
    const existingContact = await findContact(
      db,
      channel.account_id,
      existingIdentity.contact_id
    );
    if (!existingContact) throw new Error('Social identity has no contact');

    if (message.senderName && message.senderName !== existingContact.name) {
      const { error } = await db
        .from('contacts')
        .update({
          name: message.senderName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingContact.id)
        .eq('account_id', channel.account_id);
      if (error) throw error;
      existingContact.name = message.senderName;
    }
    return existingContact;
  }

  const fallbackName = `${channel.provider === 'instagram' ? 'Instagram' : 'Messenger'} user ${message.senderId}`;
  const { data: createdContact, error: contactError } = await db
    .from('contacts')
    .insert({
      account_id: channel.account_id,
      user_id: channel.user_id,
      phone: null,
      name: message.senderName || fallbackName,
    })
    .select('id, name, phone')
    .single();
  if (contactError || !createdContact)
    throw contactError ?? new Error('Contact was not created');

  const contact = createdContact as SocialContact;
  const { error: identityError } = await db
    .from('meta_contact_identities')
    .insert({
      channel_id: channel.id,
      external_user_id: message.senderId,
      contact_id: contact.id,
    });

  if (!identityError) return contact;

  // Another webhook delivery may have claimed the sender between the first
  // lookup and this insert. Reuse its identity and clean up only the contact
  // created by this losing request.
  if (isUniqueViolation(identityError)) {
    const racedIdentity = await findIdentity(db, channel.id, message.senderId);
    if (racedIdentity) {
      await db
        .from('contacts')
        .delete()
        .eq('id', contact.id)
        .eq('account_id', channel.account_id);
      const racedContact = await findContact(
        db,
        channel.account_id,
        racedIdentity.contact_id
      );
      if (racedContact) return racedContact;
    }
  }

  throw identityError;
}

async function findOrCreateConversation(
  db: MetaInboundDatabase,
  channel: MetaChannel,
  contactId: string,
  message: NormalizedMetaMessage
): Promise<SocialConversation> {
  const { data: existingRows, error: lookupError } = await db
    .from('conversations')
    .select('id, status, unread_count')
    .eq('account_id', channel.account_id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (lookupError) throw lookupError;

  const existing =
    (existingRows?.[0] as SocialConversation | undefined) ?? null;
  if (existing) return existing;

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: channel.account_id,
      user_id: channel.user_id,
      contact_id: contactId,
      channel: message.provider,
      channel_id: channel.id,
    })
    .select('id, status, unread_count')
    .single();
  if (!createError && created) return created as SocialConversation;

  if (isUniqueViolation(createError)) {
    const { data: racedRows, error: racedError } = await db
      .from('conversations')
      .select('id, status, unread_count')
      .eq('account_id', channel.account_id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (racedError) throw racedError;
    const raced = (racedRows?.[0] as SocialConversation | undefined) ?? null;
    if (raced) return raced;
  }

  throw createError ?? new Error('Conversation was not created');
}

async function insertMessage(
  db: MetaInboundDatabase,
  channel: MetaChannel,
  conversationId: string,
  message: NormalizedMetaMessage
): Promise<'inserted' | 'duplicate'> {
  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: message.contentType,
    content_text: message.contentText,
    media_url: message.mediaUrl,
    message_id: message.messageId,
    channel: message.provider,
    channel_id: channel.id,
    status: 'delivered',
    created_at: message.timestamp,
  });

  if (!error) return 'inserted';
  if (isUniqueViolation(error)) return 'duplicate';
  throw error;
}

async function updateConversation(
  db: MetaInboundDatabase,
  accountId: string,
  conversation: SocialConversation,
  message: NormalizedMetaMessage
): Promise<void> {
  const inboundUpdate = getInboundConversationUpdate(conversation.status);
  const { error } = await db
    .from('conversations')
    .update({
      last_message_text: message.contentText || '[Meta message]',
      last_message_at: message.timestamp,
      unread_count: (conversation.unread_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
      ...(inboundUpdate.status
        ? {
            status: inboundUpdate.status,
            assigned_agent_id: inboundUpdate.assignedAgentId,
          }
        : {}),
    })
    .eq('id', conversation.id)
    .eq('account_id', accountId);
  if (error) throw error;
}

/**
 * Persist one validated Meta message. The provider message id is the replay
 * boundary; duplicate deliveries return successfully without bumping unread
 * counts or conversation activity a second time.
 */
export async function processNormalizedMetaMessage(
  db: MetaInboundDatabase,
  channel: MetaChannel,
  message: NormalizedMetaMessage
): Promise<'inserted' | 'duplicate' | 'failed'> {
  try {
    const contact = await resolveContact(db, channel, message);
    const conversation = await findOrCreateConversation(
      db,
      channel,
      contact.id,
      message
    );
    const inserted = await insertMessage(db, channel, conversation.id, message);
    if (inserted === 'duplicate') return 'duplicate';

    await updateConversation(db, channel.account_id, conversation, message);

    await routeAfterInboundMessage(db, channel.account_id);

    try {
      await ensureInboundDeal(createSupabaseInboundDealRepository(db), {
        accountId: channel.account_id,
        userId: channel.user_id,
        contactId: contact.id,
        conversationId: conversation.id,
        contactLabel: contact.name || contact.phone || message.senderId,
        activityAt: message.timestamp,
      });
    } catch (error) {
      console.error('[meta/inbound] inbound pipeline deal failed:', error);
    }

    return 'inserted';
  } catch (error) {
    const detail = isError(error) && error.message ? error.message : error;
    console.error('[meta/inbound] message persistence failed:', detail);
    return 'failed';
  }
}
