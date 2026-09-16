'use strict';
const { setJSON, requireAdmin } = require('./_utils');
const { kv } = require('@vercel/kv');

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function handleCRM(req, res) {
  const { type, id, orgId: filterOrgId } = req.query;
  const body = req.body || {};

  // ── Organizations ──
  if (type === 'orgs' && req.method === 'GET') {
    const ids = await kv.lrange('orgs:ids', 0, -1);
    if (!ids || !ids.length) return res.status(200).json([]);
    const unique = [...new Set(ids)];
    const all = await Promise.all(unique.map(i => kv.get(`org:${i}`)));
    return res.status(200).json(all.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }

  if (type === 'org' && id && req.method === 'GET') {
    const org = await kv.get(`org:${id}`);
    if (!org) return res.status(404).json({ error: 'الشركة غير موجودة' });
    return res.status(200).json(org);
  }

  if (req.method === 'POST' && body.type === 'org') {
    if (!body.name) return res.status(400).json({ error: 'اسم الشركة مطلوب' });
    const orgId = genId('org');
    const org = {
      orgId, name: body.name, sector: body.sector || '', city: body.city || '',
      country: body.country || 'SA', size: body.size || '',
      status: body.status || 'prospect', notes: body.notes || '',
      linkedRefs: [], contactIds: [], createdAt: Date.now(), updatedAt: Date.now()
    };
    await kv.set(`org:${orgId}`, org);
    await kv.lpush('orgs:ids', orgId);
    return res.status(201).json(org);
  }

  if (type === 'org' && id && req.method === 'PATCH') {
    const existing = await kv.get(`org:${id}`);
    if (!existing) return res.status(404).json({ error: 'الشركة غير موجودة' });
    const updated = { ...existing, ...body, orgId: id, updatedAt: Date.now() };
    delete updated.type;
    await kv.set(`org:${id}`, updated);
    return res.status(200).json(updated);
  }

  // ── Contacts ──
  if (type === 'contacts' && req.method === 'GET') {
    const ids = await kv.lrange('contacts:ids', 0, -1);
    if (!ids || !ids.length) return res.status(200).json([]);
    const unique = [...new Set(ids)];
    let all = await Promise.all(unique.map(i => kv.get(`contact:${i}`)));
    all = all.filter(Boolean);
    if (filterOrgId) all = all.filter(c => c.orgId === filterOrgId);
    return res.status(200).json(all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }

  if (type === 'contact' && id && req.method === 'GET') {
    const contact = await kv.get(`contact:${id}`);
    if (!contact) return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
    return res.status(200).json(contact);
  }

  if (req.method === 'POST' && body.type === 'contact') {
    if (!body.name) return res.status(400).json({ error: 'اسم جهة الاتصال مطلوب' });
    const contactId = genId('cnt');
    const contact = {
      contactId, orgId: body.orgId || '', name: body.name, title: body.title || '',
      email: body.email || '', phone: body.phone || '',
      preferredContact: body.preferredContact || '', notes: body.notes || '',
      linkedRefs: [], createdAt: Date.now(), updatedAt: Date.now()
    };
    await kv.set(`contact:${contactId}`, contact);
    await kv.lpush('contacts:ids', contactId);
    if (body.orgId) {
      const org = await kv.get(`org:${body.orgId}`);
      if (org) {
        org.contactIds = [...(org.contactIds || []), contactId];
        org.updatedAt = Date.now();
        await kv.set(`org:${body.orgId}`, org);
      }
    }
    return res.status(201).json(contact);
  }

  if (type === 'contact' && id && req.method === 'PATCH') {
    const existing = await kv.get(`contact:${id}`);
    if (!existing) return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
    const updated = { ...existing, ...body, contactId: id, updatedAt: Date.now() };
    delete updated.type;
    await kv.set(`contact:${id}`, updated);
    return res.status(200).json(updated);
  }

  // ── Link submission → org + contact ──
  if (req.method === 'POST' && body.type === 'link') {
    const { ref, orgId: linkOrgId, contactId: linkContactId } = body;
    if (!ref) return res.status(400).json({ error: 'ref مطلوب' });
    const client = await kv.get(`client:${ref}`);
    if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

    // Remove ref from old org when re-linking to a different org
    if (linkOrgId && client.orgId && client.orgId !== linkOrgId) {
      const oldOrg = await kv.get(`org:${client.orgId}`);
      if (oldOrg) {
        oldOrg.linkedRefs = (oldOrg.linkedRefs || []).filter(r => r !== ref);
        oldOrg.updatedAt = Date.now();
        await kv.set(`org:${client.orgId}`, oldOrg);
      }
    }

    // Remove ref from old contact when re-linking to a different contact
    if (linkContactId && client.contactId && client.contactId !== linkContactId) {
      const oldContact = await kv.get(`contact:${client.contactId}`);
      if (oldContact) {
        oldContact.linkedRefs = (oldContact.linkedRefs || []).filter(r => r !== ref);
        oldContact.updatedAt = Date.now();
        await kv.set(`contact:${client.contactId}`, oldContact);
      }
    }

    const clientUpdate = { ...client, updatedAt: Date.now() };
    if (linkOrgId) clientUpdate.orgId = linkOrgId;
    if (linkContactId) clientUpdate.contactId = linkContactId;
    await kv.set(`client:${ref}`, clientUpdate);

    if (linkOrgId) {
      const org = await kv.get(`org:${linkOrgId}`);
      if (org && !(org.linkedRefs || []).includes(ref)) {
        org.linkedRefs = [...(org.linkedRefs || []), ref];
        org.updatedAt = Date.now();
        await kv.set(`org:${linkOrgId}`, org);
      }
    }
    if (linkContactId) {
      const contact = await kv.get(`contact:${linkContactId}`);
      if (contact && !(contact.linkedRefs || []).includes(ref)) {
        contact.linkedRefs = [...(contact.linkedRefs || []), ref];
        contact.updatedAt = Date.now();
        await kv.set(`contact:${linkContactId}`, contact);
      }
    }
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'طلب غير صحيح' });
}

module.exports = async function handler(req, res) {
  setJSON(res);

  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  const ref = req.query.ref;

  // CRM routes — keyed on method + explicit signals to avoid PATCH body collision:
  // GET  with ?type=  → list/fetch orgs or contacts
  // POST with body.type in ['org','contact','link'] → create or link
  // PATCH with ?type=  → update org or contact
  const isCRMGet   = req.method === 'GET'   && !!req.query.type;
  const isCRMPost  = req.method === 'POST'  && ['org', 'contact', 'link'].includes(req.body?.type);
  const isCRMPatch = req.method === 'PATCH' && !!req.query.type;
  if (isCRMGet || isCRMPost || isCRMPatch) {
    try { return await handleCRM(req, res); }
    catch (err) { console.error('[crm]', err.message); return res.status(500).json({ error: 'CRM error: ' + err.message }); }
  }

  // No ref → return all clients (same as /api/clients)
  if (!ref && req.method === 'GET') {
    try {
      const refs = await kv.lrange('clients:refs', 0, -1);
      if (!refs || refs.length === 0) return res.status(200).json([]);
      const unique = [...new Set(refs)];
      const all = await Promise.all(unique.map(r => kv.get(`client:${r}`)));
      const valid = all.filter(Boolean);
      valid.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      return res.status(200).json(valid);
    } catch (err) {
      console.error('[clients list]', err.message);
      return res.status(500).json({ error: 'فشل تحميل البيانات' });
    }
  }

  if (!ref) {
    return res.status(400).json({ error: 'المعرف المرجعي مطلوب' });
  }

  if (req.method === 'GET') {
    try {
      const client = await kv.get(`client:${ref}`);
      if (!client) return res.status(404).json({ error: 'العميل غير موجود' });
      return res.status(200).json(client);
    } catch (err) {
      console.error('[client GET]', err.message);
      return res.status(500).json({ error: 'فشل تحميل البيانات' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const existing = await kv.get(`client:${ref}`);
      if (!existing) return res.status(404).json({ error: 'العميل غير موجود' });
      const body = req.body || {};
      const updated = { ...existing, ...body, updatedAt: Date.now() };
      // Deep merge phases so P1 data isn't lost when saving P2 data
      if (body.phases) {
        const ep = existing.phases || {};
        updated.phases = { ...ep };
        for (const [k, v] of Object.entries(body.phases)) {
          updated.phases[k] = { ...(ep[k] || {}), ...v };
        }
      }
      await kv.set(`client:${ref}`, updated);
      return res.status(200).json(updated);
    } catch (err) {
      console.error('[client PATCH]', err.message);
      return res.status(500).json({ error: 'فشل تحديث البيانات' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
