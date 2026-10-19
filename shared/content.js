// Original game text: political satire and parody. No real person is depicted; places and events are invented.
// Placeholders: {short} {party} {n} {s}, plus optional {town} {mandal} {district} when a place is given
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Content = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARTY = { name: 'YSR Congress Party', short: 'YSRCP', color: '#00a651' };
  const DEFAULT_PLACE = { town: '', mandal: '', district: '' }; // the town is unnamed
  // The opposing side, in one place: change it here and every tag, chant, legend and disclaimer follows.
  const OPPONENT = { short: 'TDP', full: 'Telugu Drama Party', tag: 'TDP', leaderTag: 'TDP LEADER', chant: 'Jai TDP!' };
  const O = OPPONENT, OPP_GOONS = `${O.short} (${O.full}) goons`;
  const DISCLAIMER = `Political satire and parody. ‘${O.full}’ is our satirical name; the game is opinion and comment on reported pre-election violence, not a factual account. No real person is depicted. Not an official YSRCP website.`;

  const MODE = {
    title: 'Nomination Day',
    goal: 'RO Office',
    hold: 6,
    intro: `Your Form-A is ready. Get your candidate through the streets to the RO Office and file the nomination. Democracy starts at 100%. Every ${O.short} (${O.full}) goon attack and police lathi charge takes a piece of it.`,
  };

  // Simple English with a light Telugu touch (anna, Ammo, Ayyo and a couple of slogans).
  const LINES = {
    start: ['To the RO Office! Jai Jagan! ✊', 'Papers ready. Crowd ready. Jai {short}!', 'Jai Jagan!'],
    slogan: ['Jai Jagan! ✊', 'Jai {short}!', 'Jagananna, we are with you!', 'Our town, our right!', 'Make way for the people!'],
    join: ['I\u2019m coming too!', 'Anna, we are with you!', 'Selfie later, nomination first!', 'Give me a flag!', 'For our town!', 'Jai Jagan! Count me in!'],
    cop: ['Section 144, sir! No crowds!', 'Where are you going? Got permission?', 'Stop! Show your papers!', 'Come to the station. Just a small enquiry.', 'Road closed for "security reasons".'],
    copLifted: ['Ayyo, too many people!', 'Sir, put me down!', 'Control room, send backup!'],
    lathi: ['Clear the road!', 'Lathi charge!'],
    // the opponent's chant in about a third of their lines, so they are clear by ear too
    goon: [`${O.chant} You can\u2019t pass here!`, 'Your papers have a spelling mistake! 😏', 'Nomination? Try next election!', `${O.chant} Go back home!`, 'This road is ours!', O.chant],
    goonScared: ['Ammo, too many of them!', 'We\u2019ll see you later!', `Run! ${O.chant}`],
    scared: ['Ammo! Lathi!', 'I\u2019m going home!', 'Tear gas! Run!', 'Not today, anna!'],
    attacked: ['They are beating us in broad daylight!', 'Is this democracy?', 'Keep walking, don\u2019t stop!'],
    detained: ['I am a candidate! This is unfair!', 'Arrest me if you want. The nomination still goes in!'],
    gas: ['My eyes are burning! 😵', '*cough cough*'],
    barricade: ['Everyone push together!', 'Move the barricade aside!'],
    filing: ['Stamp it, sir, time is running out!', 'One minute, signing now!'],
    // stones on the road (satirical caricatures; no real person is depicted)
    throw: [O.chant, 'Law and order is perfect!', 'Democracy is fine, go home!', `${O.chant} Here is your nomination!`, 'Development delivered!', 'Peaceful protest, sir!'],
    hit: ['Ow! Is this democracy?', 'Stones? Seriously?', 'My head! Keep walking!'],
    shield: ['I\u2019ve got you, anna!', 'Keep going, I\u2019m fine!'],
    protect: ['Not the children!', 'Hit me, not them!', 'Get behind me, amma!'],
    womanHurt: ['Ayyo! Why stones at us?', 'We only came to vote!', 'Ayyo, my head!'],
    childHurt: ['Amma!', 'Why are they throwing stones?', 'I want to go home!'],
    manHurt: ['Ow!', 'I\u2019m okay, keep going!'],
    copIgnore: ['Didn\u2019t see anything.', 'No complaint received.', 'Minor incident.', 'Situation under control.'],
    childNews: ['A child was hit by a stone. Officials: "Situation under control."', 'Schoolkid hurt by a stone. Police: "No complaint received."'],
    womanNews: ['A woman was hit by a stone. Officials: "Minor incident."', 'Women hit by stones. Police: "Didn\u2019t see anything."'],
    // the gate showdown
    lineCop: ['Section 144! No entry!', 'Only officials allowed!', 'Go back, go back!', 'Orders from above, sir.'],
    gateShut: ['Lunch break! Come after lunch.', 'Office closed, sir. Rules.', 'Gate closed for security reasons.'],
    chant: ['Jai Jagan! Open the gate!', 'Media is watching!', 'Democracy, open up!', 'Let the candidate in!'],
    vipSalute: ['Welcome, sir!', 'Please, sir, this way.', 'Sir has come, open the gate!'],
    vip: [`${O.chant} Just a courtesy visit.`, 'We are only observers.', 'Tea with the officer, that\u2019s all.'],
    frisk: ['This signature looks suspicious.', 'Attested copy?', 'Photo is not clear, sir.', 'Wait, I have to verify.'],
    stall: ['Lunch break.', 'Server down.', 'Photo size wrong: 3.5 \u00d7 4.5 only.', 'Sir is in a meeting.', 'Bring one more attested copy.'],
    reject: ['Rejected: signature does not match.', 'Rejected: wrong form, sir.', 'Rejected: proposer not in the list.', 'Rejected: photo size wrong.', 'Rejected: time is over by our clock.'],
    proposers: ['Rule 33 says it is fine, sir!', 'We are the proposers, check again!', 'Sir, everything is attested!'],
  };

  // Who is who: shirt colours in the game
  const LEGEND = [
    { color: '#2156d1', label: 'Blue: YSRCP (you)' },
    { color: '#fbc02d', label: `Yellow: ${OPP_GOONS}` },
    { color: '#f5f5f5', label: 'White: the public' },
    { color: '#c8ab72', label: 'Khaki: police' },
  ];

  // "How democracy is being spoiled": one card the first time each tactic shows up in play
  const TACTICS = [
    { id: 'sec144', title: 'Section 144', text: 'Ban gatherings, so the candidate can\u2019t bring supporters.' },
    { id: 'barricade', title: 'Barricades', text: 'Block every road to the office.' },
    { id: 'stones', title: 'Stones on the road', text: `${OPP_GOONS} pelt the candidate and the crowd.` },
    { id: 'women', title: 'Attacks on women and children', text: 'Scare families so they stay at home and don\u2019t vote.' },
    { id: 'police', title: 'Police look away', text: '"No complaint received." The attackers walk free.' },
    { id: 'arrest', title: 'Arrest the candidate', text: 'Detain the candidate on the way, "for safety".' },
    { id: 'line', title: 'Police line at the gate', text: 'Stop the candidate at the office gate.' },
    { id: 'gate', title: 'Shut for you, open for friends', text: `The gate is shut for the candidate, but opens for ${O.short} leaders.` },
    { id: 'papers', title: 'Papers check', text: '"Your signature looks suspicious." Every check is a delay.' },
    { id: 'stall', title: '"Server down"', text: 'Officials stall, then find a reason to reject.' },
  ];

  const GATE = {
    lineBroken: 'LINE BROKEN!',
  };

  // Democracy meter: labels by stage (0 = healthy), toasts when a stage is reached
  const DEMO = {
    labels: ['Healthy', 'Unwell', 'In hospital', 'In ICU', 'On ventilator'],
    ring: '🚧 Section 144 zone: 4 or more people together is now a "crime".',
    dead: '💀 Democracy has flatlined.',
  };

  // The end title. Every run ends here, on the front page of "The Daily Ballot".
  const END = {
    title: 'Democracy is killed in broad daylight.',
    sub: 'Welcome to Andhra Pradesh.',
  };
  const NEWS = {
    masthead: 'THE DAILY BALLOT',
    tagline: 'Fearless. Satirical. Price: one vote.',
    disclaimer: DISCLAIMER,
  };

  function fill(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (all, k) => {
      if (k === 'party') return PARTY.name;
      if (k === 'short') return PARTY.short;
      if (vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null && (vars[k] !== '' || !(k in DEFAULT_PLACE))) return String(vars[k]);
      if (k in DEFAULT_PLACE) return DEFAULT_PLACE[k];
      return all;
    });
  }

  return { PARTY, OPPONENT, DISCLAIMER, DEFAULT_PLACE, MODE, LINES, DEMO, END, NEWS, GATE, LEGEND, TACTICS, fill };
});
