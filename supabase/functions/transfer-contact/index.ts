// Passation d'un contact entre membres d'une même équipe (org).
// Permission : propriétaire du contact, OU admin/owner de l'org, OU super admin.
// Option keepCopy : duplique le contact pour l'expéditeur (l'original part au destinataire).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return jsonResponse({ error: 'Missing authorization' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: { user }, error: userErr } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { contactId, toUserId, keepCopy = false } = await req.json().catch(() => ({}));
  if (!contactId || !toUserId) return jsonResponse({ error: 'contactId and toUserId required' }, 400);

  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .select('id, organization_id, owner_user_id, full_name, email, role_title, company_id, web_bio, enrichment_data, secondary_emails, linkedin_url, avatar_url')
    .eq('id', contactId).maybeSingle();
  if (cErr || !contact) return jsonResponse({ error: 'Contact not found' }, 404);
  const orgId = contact.organization_id;

  const { data: members } = await supabase.from('memberships').select('user_id, role').eq('organization_id', orgId);
  const memberIds = new Set((members ?? []).map((m: any) => m.user_id));
  if (!memberIds.has(user.id)) return jsonResponse({ error: 'Vous n’êtes pas membre de cette organisation' }, 403);
  if (!memberIds.has(toUserId)) return jsonResponse({ error: 'Le destinataire n’est pas dans l’équipe' }, 400);

  const callerRole = (members ?? []).find((m: any) => m.user_id === user.id)?.role;
  const isAdmin = callerRole === 'owner' || callerRole === 'admin';
  const { data: sa } = await supabase.from('super_admins').select('id').eq('user_id', user.id).maybeSingle();
  const isOwnerOfContact = contact.owner_user_id === user.id;
  if (!isOwnerOfContact && !isAdmin && !sa) {
    return jsonResponse({ error: 'Permission refusée (ni propriétaire, ni admin)' }, 403);
  }

  const fromUserId = contact.owner_user_id;

  if (keepCopy && fromUserId) {
    await supabase.from('contacts').insert({
      organization_id: orgId, owner_user_id: fromUserId,
      full_name: contact.full_name, email: contact.email, role_title: contact.role_title,
      company_id: contact.company_id, web_bio: contact.web_bio, enrichment_data: contact.enrichment_data,
      secondary_emails: contact.secondary_emails ?? null, linkedin_url: contact.linkedin_url ?? null, avatar_url: contact.avatar_url ?? null,
    });
  }

  const { error: upErr } = await supabase.from('contacts')
    .update({ owner_user_id: toUserId, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  await supabase.from('contact_transfers').insert({
    organization_id: orgId, contact_id: contactId,
    from_user_id: fromUserId, to_user_id: toUserId, kept_copy: keepCopy, transferred_by: user.id,
  });

  return jsonResponse({ status: 'done', contactId, toUserId, keptCopy: keepCopy });
});

