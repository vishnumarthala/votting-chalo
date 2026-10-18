// Original game text. All parties, people and events are fictional.
// Placeholders: {town} {mandal} {district} {short} {party} {doc} {n} {s}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Content = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARTY = { name: 'Neelam Praja Party', short: 'NPP', color: '#1e5bd8' };
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
    start: ['To the {district} RO Office! ✊', 'Papers ready. Crowd ready. Let\u2019s go!', '{short}! {short}! {short}!'],
    startVote: ['Off to vote! 🗳️', 'My vote, my right!'],
    slogan: ['{short}! {short}! ✊', 'Neelam Jenda, Praja Agenda!', 'Our town, our right!', 'Make way for the people!', 'To the RO Office!'],
    sloganVote: ['Vote is our right!', 'Everyone come, everyone vote!', 'To the booth!', 'Naa vote, naa hakku!'],
    join: ['I\u2019m coming too!', 'Anna, we are with you!', 'Selfie later, nomination first!', 'Give me a flag!', 'For {town}!', 'Count me in!'],
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
    tagline: 'Fearless. Fictional. Price: one vote.',
    headlines: {
      time: ['DOORS CLOSE ON DEMOCRACY', 'NOMINATION? COME BACK IN 5 YEARS', 'OFFICE SHUTS AT 3 PM SHARP. DEMOCRACY ALSO.'],
      jailed: ['CANDIDATE ARRESTED FOR TRYING TO CONTEST', 'JAIL, NOT BALLOT: CANDIDATE HELD "FOR SAFETY"'],
      timeVote: ['POLLS CLOSE BEFORE VOTER ARRIVES', '"YOUR VOTE HAS ALREADY BEEN CAST," SAYS GANG AT BOOTH'],
      jailedVote: ['VOTER ARRESTED ON THE WAY TO VOTE', 'SECTION 144 STOPS VOTER. GANG AT BOOTH UNAFFECTED.'],
      low: ['DEMOCRACY ON VENTILATOR. OFFICIALS: "ALL IS WELL"', 'DEMOCRACY RUSHED TO ICU. POLICE: "NO COMPLAINT"'],
    },
    sub: {
      time: '{name} was stopped {stop} m from the {goal} as stones rained on {town}.',
      jailed: '{name} was detained three times on the way to the {goal}. Officials call it "routine".',
    },
    police: ['Police: "No complaint received."', 'SP: "Situation fully under control."', 'Officials: "Minor incident, nothing to see."'],
    explainer: {
      title: 'HOW TO STOP AN ELECTION WITHOUT CANCELLING IT',
      steps: ['Declare Section 144', 'Barricade every road', 'Say "documents incomplete"', 'Throw stones on the way', 'Scare the people watching', 'Arrest the candidate'],
      footer: 'Every step is "legal". That is the trick. Notice it. Talk about it. Go vote.',
    },
    disclaimer: 'Satire. Fictional town, party and people. Any resemblance to real events is your own conclusion.',
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

  return { PARTY, DEFAULT_PLACE, MODES, LINES, MISSIONS, TIERS, DEMO, NEWS, fill };
});
