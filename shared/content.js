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

  return { PARTY, DEFAULT_PLACE, MODES, LINES, MISSIONS, TIERS, fill };
});
