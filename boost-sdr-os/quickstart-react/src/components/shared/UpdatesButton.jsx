import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchUpdates, createUpdate } from '../../api/monday';

// The monday "Updates" thread for any item, opened from a small button next to
// the record name. The modal has a comment box with @mentions at the top and
// the thread below. Tagged people get a monday notification linking to the
// update.

// Plain text of an update. monday sometimes leaves text_body empty (notably
// straight after creating), so fall back to the HTML body with tags stripped.
function textOf(u) {
  if (u?.text_body) return u.text_body;
  const html = (u?.body ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n');
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').trim();
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Full class names so Tailwind generates them
const SIZES = { 5: 'w-5 h-5', 6: 'w-6 h-6', 7: 'w-7 h-7' };

function Avatar({ person, size = 7 }) {
  const name = person?.name ?? '?';
  const cls = `${SIZES[size] ?? SIZES[7]} rounded-full flex-shrink-0`;
  return person?.photo_thumb
    ? <img src={person.photo_thumb} alt={name} className={`${cls} object-cover`} />
    : <div className={`${cls} bg-navy text-white grid place-items-center text-[10px] font-bold`}>
        {name.split(' ').map(n => n[0]).slice(0, 2).join('')}
      </div>;
}

// Textarea with "@" suggestions. Keeps the list of people picked so the
// update can carry proper mentions, not just the typed text.
function Composer({ users, placeholder, busy, onSubmit, autoFocus }) {
  const [text, setText]         = useState('');
  const [mentions, setMentions] = useState([]);
  const [query, setQuery]       = useState(null); // text after "@", or null when not mentioning
  const [active, setActive]     = useState(0);
  const ref = useRef(null);

  const suggestions = query === null ? [] : users
    .filter(u => u.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  function onChange(e) {
    const value = e.target.value;
    setText(value);
    const upToCaret = value.slice(0, e.target.selectionStart);
    const m = upToCaret.match(/(?:^|\s)@([^\s@]*(?: [^\s@]*)?)$/);
    setQuery(m ? m[1] : null);
    setActive(0);
  }

  function pick(user) {
    const el = ref.current;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]*(?: [^\s@]*)?)$/, `@${user.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentions(prev => (prev.some(p => String(p.id) === String(user.id)) ? prev : [...prev, { id: user.id, name: user.name }]));
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  }

  function onKeyDown(e) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return; }
      if (e.key === 'Escape') { setQuery(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  }

  async function submit() {
    if (!text.trim() || busy) return;
    // Only people whose "@Name" is still in the text count as mentioned
    const kept = mentions.filter(m => text.includes(`@${m.name}`));
    const ok = await onSubmit(text.trim(), kept);
    if (ok) { setText(''); setMentions([]); }
  }

  return (
    <div>
      <div className="relative">
      <textarea
        ref={ref}
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        rows={4}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="w-full border border-line rounded-xl px-3 py-2 text-[13px] bg-white resize-y focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy"
      />
      {suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-line rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((u, i) => (
            <button
              key={u.id}
              onMouseDown={e => { e.preventDefault(); pick(u); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${i === active ? 'bg-sunken' : 'hover:bg-sunken'}`}
            >
              <Avatar person={u} size={5} />
              {u.name}
            </button>
          ))}
        </div>
      )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-muted">Type @ to tag someone · Ctrl+Enter to post</span>
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold bg-navy text-white hover:bg-navy-700 disabled:opacity-40"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

function Thread({ itemId, itemName, users, me, accountSlug, onCount }) {
  const [updates, setUpdates] = useState(null);
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [note, setNote]       = useState('');
  const [replyTo, setReplyTo] = useState(null);

  useEffect(() => {
    setUpdates(null);
    fetchUpdates(itemId).then(setUpdates).catch(e => { setError(e.message); setUpdates([]); });
  }, [itemId]);

  useEffect(() => { if (updates) onCount?.(updates.length); }, [updates, onCount]);

  async function post(text, mentions, parentId) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { update, viaFallback, notifyFailed = [] } = await createUpdate(itemId, {
        text, mentions, parentId, itemName,
        accountSlug: accountSlug || me?.account?.slug || '',
        authorName: me?.name,
        authorId: me?.id,
      });
      if (parentId) {
        setUpdates(prev => prev.map(u => (u.id === parentId ? { ...u, replies: [...(u.replies ?? []), update] } : u)));
        setReplyTo(null);
      } else {
        setUpdates(prev => [update, ...(prev ?? [])]);
      }
      const notified = mentions.filter(m => !notifyFailed.includes(m.name) && String(m.id) !== String(me?.id));
      const parts = ['Posted'];
      if (notified.length) parts.push(`${notified.map(m => m.name).join(', ')} notified`);
      if (notifyFailed.length) parts.push(`couldn't notify ${notifyFailed.join(', ')}`);
      if (viaFallback) parts.push('sent with the shared account (marked as from you)');
      setNote(parts.join(' · '));
      return true;
    } catch (e) {
      setError(e.message.slice(0, 200));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Composer users={users} busy={busy} autoFocus placeholder="Write an update…" onSubmit={(t, m) => post(t, m)} />
      {error && <p className="text-[12px] font-semibold text-red mt-1.5">Error: {error}</p>}
      {note && <p className="text-[12px] font-semibold text-emerald mt-1.5">{note}</p>}

      <div className="mt-4 space-y-3">
        {updates === null && <div className="h-14 bg-canvas rounded-xl animate-pulse" />}
        {updates?.length === 0 && !error && <p className="text-[12.5px] text-muted">No updates yet.</p>}
        {updates?.map(u => (
          <div key={u.id} className="bg-canvas rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Avatar person={u.creator} size={6} />
              <span className="text-[12.5px] font-semibold text-ink">{u.creator?.name ?? 'Unknown'}</span>
              <span className="text-[11px] text-muted">{timeAgo(u.created_at)}</span>
            </div>
            <p className="text-[13px] text-ink whitespace-pre-wrap break-words">{textOf(u)}</p>
            {(u.replies ?? []).map(r => (
              <div key={r.id} className="mt-2 ml-4 pl-3 border-l-2 border-line">
                <div className="flex items-center gap-2 mb-0.5">
                  <Avatar person={r.creator} size={5} />
                  <span className="text-[12px] font-semibold text-ink">{r.creator?.name ?? 'Unknown'}</span>
                  <span className="text-[11px] text-muted">{timeAgo(r.created_at)}</span>
                </div>
                <p className="text-[12.5px] text-ink whitespace-pre-wrap break-words">{textOf(r)}</p>
              </div>
            ))}
            {replyTo === u.id ? (
              <div className="mt-2 ml-4">
                <Composer users={users} busy={busy} autoFocus placeholder="Write a reply…" onSubmit={(t, m) => post(t, m, u.id)} />
                <button onClick={() => setReplyTo(null)} className="text-[11.5px] text-muted hover:text-ink mt-1">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setReplyTo(u.id)} className="text-[11.5px] font-semibold text-navy hover:text-navy-700 mt-1.5">Reply</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// Pill button for record headers. Shows the update count and opens the modal.
export default function UpdatesButton({ itemId, itemName, users = [], me, accountSlug }) {
  const [open, setOpen]   = useState(false);
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!itemId) return;
    setCount(null);
    let live = true;
    fetchUpdates(itemId).then(u => { if (live) setCount(u.length); }).catch(() => {});
    return () => { live = false; };
  }, [itemId]);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!itemId) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Updates"
        className="flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line bg-white text-[12px] font-semibold text-navy hover:bg-sunken transition-colors mt-0.5"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
        </svg>
        {count ? `Updates (${count})` : 'Add update'}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-start justify-center p-4 pt-[8vh]" onMouseDown={() => setOpen(false)}>
          <div
            className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[84vh] flex flex-col"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-line flex-shrink-0">
              <div className="min-w-0 pr-3">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Updates</p>
                <h3 className="font-heading text-[16px] font-bold tracking-tight break-words">{itemName}</h3>
              </div>
              <button onClick={() => setOpen(false)} className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-line text-muted hover:text-ink transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <Thread itemId={itemId} itemName={itemName} users={users} me={me} accountSlug={accountSlug} onCount={setCount} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
