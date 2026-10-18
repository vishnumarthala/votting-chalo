// Original game text. All parties, people and events are fictional.
// Placeholders: {town} {mandal} {district} {short} {party} {doc} {n} {s}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Content = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARTY = { name: 'YSR Congress Party', short: 'YSRCP', color: '#00a651' };
  const DEFAULT_PLACE = { town: 'Kothapalli', mandal: 'Kothapalli', district: 'Godavari', pin: '' };

  const MODES = {
    nomination: {
      title: 'Nomination Day',
      goal: 'RO Office',
      time: 480, clockStart: 10 * 60, clockEnd: 15 * 60, hold: 6,
      docs: ['Affidavit', 'Caste Certificate', 'Deposit Receipt', 'Proposer Signatures'], given: ['Form-A Nomination'],
      intro: 'You have your Form-A. Collect the 4 supporting documents across {town}, then reach the {district} RO Office before 3 PM and hold the counter to file.',
      win: 'NOMINATION FILED! ✅ {town} has a new candidate.',
    },
    vote: {
      title: 'Polling Day',
      goal: 'Polling Booth',
      time: 360, clockStart: 7 * 60, clockEnd: 18 * 60, hold: 4,
      docs: ['Voter Slip'], given: ['Voter ID Card'],
      intro: 'Pick up your voter slip at the BLO tent, then get through to the polling booth in {town} and cast your vote before 6 PM.',
      win: 'VOTE CAST! ☑️ Ink on the finger, pride in the heart.',
    },
  };

  // Simple English with a light Telugu touch (anna, Ammo, Ayyo and a couple of slogans).
  const LINES = {
    start: ['To the {district} RO Office! Jai Jagan! ✊', 'Papers ready. Crowd ready. Jai {short}!', 'Jai Jagan!'],
    startVote: ['Off to vote! Jai Jagan! 🗳️', 'My vote, my right!'],
    slogan: ['Jai Jagan! ✊', 'Jai {short}!', 'Jagananna, we are with you!', 'Our town, our right!', 'Make way for the people!'],
    sloganVote: ['Jai Jagan! 🗳️', 'Vote for the fan!', 'Everyone come, everyone vote!', 'Naa vote, naa hakku!'],
    join: ['I\u2019m coming too!', 'Anna, we are with you!', 'Selfie later, nomination first!', 'Give me a flag!', 'For {town}!', 'Jai Jagan! Count me in!'],
    cop: ['Section 144, sir! No crowds!', 'Where are you going? Got permission?', 'Stop! Show your papers!', 'Come to the station. Just a small enquiry.', 'Road closed for "security reasons".'],
    copLifted: ['Ayyo, too many people!', 'Sir, put me down!', 'Control room, send backup!'],
    lathi: ['Clear the road!', 'Lathi charge!'],
    goon: ['You can\u2019t pass here!', 'Your papers have a spelling mistake! 😏', 'Nomination? Try next election!', 'Go back home!', 'This road is ours!'],
    goonScared: ['Ammo, too many of them!', 'We\u2019ll see you later!'],
    scared: ['Ammo! Lathi!', 'I\u2019m going home!', 'Tear gas! Run!', 'Not today, anna!'],
    shop: ['All ready, sir. Sign here, here and here.', 'Seal and signature done. Keep it safe.', 'All the best, anna!', 'Stamped! Next!'],
    roMissing: ['Documents incomplete: {doc}. Next!', 'Where is your {doc}? Come back with it.'],
    boothMissing: ['No voter slip? Get one at the BLO tent.'],
    torn: ['My papers! They tore them! 😱', 'Papers torn! I need a fresh copy!'],
    detained: ['I am a candidate! This is unfair!', 'Arrest me if you want. The nomination still goes in!'],
    gas: ['My eyes are burning! 😵', '*cough cough*'],
    barricade: ['Everyone push together!', 'Move the barricade aside!'],
    filing: ['Stamp it, sir, time is running out!', 'One minute, signing now!'],
    // stones on the road (the ruling front's goons are fictional)
    throw: ['Law and order is perfect!', 'Democracy is fine, go home!', 'Here is your nomination!', 'Development delivered!', 'Peaceful protest, sir!'],
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
    vip: ['Just a courtesy visit.', 'We are only observers.', 'Tea with the officer, that\u2019s all.'],
    vipVote: ['Booth agent, sir.', 'We are only helping voters.', 'Just checking the arrangements.'],
    waitOut: ['We will wait here, anna!', 'Go in, we are right here!', 'File it, anna!'],
    frisk: ['This signature looks suspicious.', 'Attested copy?', 'Photo is not clear, sir.', 'Wait, I have to verify.'],
    stall: ['Lunch break.', 'Server down.', 'Photo size wrong: 3.5 \u00d7 4.5 only.', 'Sir is in a meeting.', 'Bring one more attested copy.'],
    stallVote: ['Machine is being checked.', 'Your name has a spelling mistake.', 'Wait, the list is not loading.', 'Show one more ID.'],
    proposers: ['Rule 33 says it is fine, sir!', 'We are the proposers, check again!', 'Sir, everything is attested!'],
  };

  // Who is who: shirt colours in the game
  const LEGEND = [
    { color: '#2156d1', label: 'Blue: YSRCP (you)' },
    { color: '#fbc02d', label: 'Yellow: ruling-front goons' },
    { color: '#f5f5f5', label: 'White: the public' },
    { color: '#c8ab72', label: 'Khaki: police' },
  ];

  // "How democracy is being spoiled": one card the first time each tactic shows up in play
  const TACTICS = [
    { id: 'sec144', title: 'Section 144', text: 'Ban gatherings, so the candidate can\u2019t bring supporters.' },
    { id: 'barricade', title: 'Barricades', text: 'Block every road to the office.' },
    { id: 'stones', title: 'Stones on the road', text: 'Ruling-front goons pelt the candidate and the crowd.' },
    { id: 'women', title: 'Attacks on women and children', text: 'Scare families so they stay at home and don\u2019t vote.' },
    { id: 'police', title: 'Police look away', text: '"No complaint received." The attackers walk free.' },
    { id: 'arrest', title: 'Arrest the candidate', text: 'Detain the candidate on the way, "for safety".' },
    { id: 'line', title: 'Police line at the gate', text: 'Stop the candidate at the office gate.' },
    { id: 'gate', title: 'Shut for you, open for friends', text: 'The gate is shut for the candidate, but opens for ruling-front guests.' },
    { id: 'papers', title: 'Papers check', text: '"Your signature looks suspicious." Every minute counts.' },
    { id: 'stall', title: '"Server down"', text: 'Officials stall until time runs out.' },
    { id: 'clock', title: 'The clock trick', text: 'The office clock runs fast, only today.' },
  ];

  const GATE = {
    line: '🚔 Police line at the gate! Push through together.',
    shut: '🔒 Gate shut for "lunch"! Chant at the gate with 8+ supporters, or sneak round to the side wicket they forgot to lock.',
    needCrowd: 'Too few voices. The officials need 8+ supporters at the gate to listen.',
    open: '📣 The crowd and the cameras win: the gate is open!',
    four: '🚶 "Only candidate + 4 allowed." The rest of your crowd waits at the gate.',
    clock: '🕒 The office clock jumps forward: "It is {close} by our clock."',
    lineBroken: 'LINE BROKEN!',
  };

  // Democracy meter: labels by stage (0 = healthy), toasts when a stage is reached
  const DEMO = {
    labels: ['Healthy', 'Unwell', 'In hospital', 'In ICU', 'On ventilator'],
    toasts: ['🤒 Democracy is feeling unwell.', '🏥 Democracy admitted to hospital.', '🚑 Democracy moved to the ICU.', '⚠️ Democracy is on a ventilator.'],
    ring: '🚧 Section 144 zone: 4 or more people together is now a "crime".',
  };

  // Satirical front page shown when you don't make it. {name} {stop} {goal} {town} {district}
  const NEWS = {
    masthead: 'THE DAILY BALLOT',
    tagline: 'Fearless. Satirical. Price: one vote.',
    headlines: {
      time: ['DOORS CLOSE ON DEMOCRACY', 'NOMINATION? COME BACK IN 5 YEARS', 'OFFICE SHUTS AT 3 PM SHARP. DEMOCRACY ALSO.'],
      jailed: ['CANDIDATE ARRESTED FOR TRYING TO CONTEST', 'JAIL, NOT BALLOT: CANDIDATE HELD "FOR SAFETY"'],
      timeVote: ['POLLS CLOSE BEFORE VOTER ARRIVES', '"YOUR VOTE HAS ALREADY BEEN CAST," SAYS GANG AT BOOTH'],
      jailedVote: ['VOTER ARRESTED ON THE WAY TO VOTE', 'SECTION 144 STOPS VOTER. GANG AT BOOTH UNAFFECTED.'],
      low: ['DEMOCRACY KILLED IN BROAD DAYLIGHT. OFFICIALS: "ALL IS WELL"', 'DEMOCRACY KILLED IN {TOWN}. POLICE: "NO COMPLAINT"', 'DEMOCRACY DIES ON THE ROAD TO THE {GOAL}'],
      gate: ['GATE SHUT ON CANDIDATE, OPEN FOR "GUESTS"', 'OFFICE CLOCK RUNS 30 MINUTES FAST, ONLY TODAY', 'POLICE SALUTE "GUESTS", STOP CANDIDATE AT GATE'],
    },
    sub: {
      time: '{name} was stopped {stop} m from the {goal} as stones rained on {town}.',
      jailed: '{name} was detained three times on the way to the {goal}. Officials call it "routine".',
    },
    police: ['Police: "No complaint received."', 'SP: "Situation fully under control."', 'Officials: "Minor incident, nothing to see."'],
    explainer: {
      title: 'HOW TO STOP AN ELECTION WITHOUT CANCELLING IT',
      steps: ['Declare Section 144', 'Barricade every road', 'Throw stones on the way', 'Shut the gate. Open it for friends.', 'Say "server down"', 'Arrest the candidate'],
      footer: 'Every step is "legal". That is the trick. Notice it. Talk about it. Go vote.',
    },
    disclaimer: 'Satire. The "ruling front", its goons, the town and its people are fictional. Any resemblance to real events is your own conclusion.',
  };

  const MISSIONS = [
    { k: 'rec', txt: 'Recruit {n} supporters', n: [10, 20, 30], rew: 150 },
    { k: 'crowd', txt: 'Lead a crowd of {n}', n: [8, 15, 25], rew: 200 },
    { k: 'brk', txt: 'Break {n} barricade{s}', n: [1, 2], rew: 250 },
    { k: 'lift', txt: 'Let your crowd lift {n} cop{s}', n: [1, 3], rew: 200 },
    { k: 'doc', txt: 'Collect {n} document{s}', n: [2, 3], rew: 150 },
    { k: 'slogan', txt: 'Raise {n} slogans', n: [5, 10], rew: 100 },
    { k: 'goon', txt: 'Scare off {n} goon{s}', n: [1, 3], rew: 150 },
  ];

  const TIERS = ['', 'Nice!', 'Mass!', 'Mass Jathara!'];

  function fill(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (all, k) => {
      if (k === 'party') return PARTY.name;
      if (k === 'short') return PARTY.short;
      if (vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null && (vars[k] !== '' || !(k in DEFAULT_PLACE))) return String(vars[k]);
      if (k in DEFAULT_PLACE) return DEFAULT_PLACE[k];
      return all;
    });
  }

  return { PARTY, DEFAULT_PLACE, MODES, LINES, MISSIONS, TIERS, DEMO, NEWS, GATE, LEGEND, TACTICS, fill };
});
