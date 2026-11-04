// Turns the transcript update posted on each Aircall item into turns and talk stats.
//
// Format on the board:
//   Call ID: CA...
//
//   Call Transcription:
//   +448006335050 Aircall new contact: Total sales. Alex speaking.
//   Sam Fessey: Hi there...
//
// The prospect is labelled with their phone number, the SDR with their name.

const wordCount = (s) => (s.match(/\S+/g) || []).length;

function parseTranscript(raw, agentName = '') {
  if (!raw) return null;
  const at = raw.search(/Call Transcription:/i);
  const body = at >= 0 ? raw.slice(at).replace(/^Call Transcription:\s*/i, '') : raw;
  const agent = agentName.trim().toLowerCase();

  const isProspectLabel = (l) => /^\+?\d[\d\s()-]{5,}/.test(l) || /aircall new contact/i.test(l);
  const isAgentLabel = (l) => (agent && l.trim().toLowerCase() === agent) || (!isProspectLabel(l) && /^[\p{L}][\p{L} .'-]{1,60}$/u.test(l));

  const turns = [];
  for (const line of body.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([^:]{1,80}):\s*(.*)$/);
    if (m && (isProspectLabel(m[1]) || isAgentLabel(m[1]))) {
      turns.push({ who: isProspectLabel(m[1]) ? 'prospect' : 'sdr', text: m[2] });
    } else if (turns.length) {
      turns[turns.length - 1].text += ` ${line}`;
    }
  }
  if (!turns.length) return null;

  const words = { sdr: 0, prospect: 0 };
  let longestSdrTurn = 0;
  let sdrQuestions = 0;
  for (const t of turns) {
    const w = wordCount(t.text);
    words[t.who] += w;
    if (t.who === 'sdr') {
      longestSdrTurn = Math.max(longestSdrTurn, w);
      sdrQuestions += (t.text.match(/\?/g) || []).length;
    }
  }
  const total = words.sdr + words.prospect;
  return {
    turns,
    stats: {
      chars: body.trim().length,
      sdrWords: words.sdr,
      prospectWords: words.prospect,
      sdrShare: total ? words.sdr / total : null,
      turns: turns.length,
      longestSdrTurnWords: longestSdrTurn,
      sdrQuestions,
      // A real conversation has both sides saying something substantial. Gatekeepers,
      // voicemail and phone menus fail this and are not sent for analysis.
      hasConversation: words.sdr >= 60 && words.prospect >= 40 && turns.length >= 8,
    },
  };
}

// Plain-text version for the model. Uses SDR / PROSPECT labels so prospect phone
// numbers are never sent.
function renderForModel(turns, maxChars = 40000) {
  const text = turns.map((t) => `${t.who === 'sdr' ? 'SDR' : 'PROSPECT'}: ${t.text}`).join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[transcript truncated]` : text;
}

module.exports = { parseTranscript, renderForModel, wordCount };
