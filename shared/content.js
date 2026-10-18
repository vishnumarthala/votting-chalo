// Original game text. All parties, people and events are fictional.
// Placeholders: {town} {mandal} {district} {short} {party} {rival} {doc} {n} {s}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./towns.js'));
  else root.Content = factory(root.Towns);
})(typeof self !== 'undefined' ? self : this, function (Towns) {
  'use strict';

  const PARTY = { name: 'YSR Congress Party', short: 'YSRCP', color: '#1e5bd8' };
  const RIVAL = { name: 'Telugu Desam Party', short: 'TDP', color: '#f2c200' };
  const { TOWNS, DEFAULT_TOWN } = Towns;

  const MODES = {
    nomination: {
      title: 'Nomination Day',
      goal: 'RO Office',
      time: 480, clockStart: 10 * 60, clockEnd: 15 * 60, hold: 6,
      docs: ['Form-A Nomination', 'Affidavit', 'Caste Certificate', 'Deposit Receipt', 'Proposer Signatures'],
      intro: 'Collect your 5 documents from shops across {town}, then reach the {district} RO Office before 3 PM and hold the counter to file.',
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

  const LINES = {
    start: ['Chalo, {district} RO Office! ✊', 'Papers ready. Crowd ready. Chalo!', '{short} zindabad!'],
    startVote: ['Vote veyyadaniki velthunna! 🗳️', 'Naa vote, naa hakku!'],
    slogan: ['{short} zindabad! ✊', 'Jenda ettandi, {town} lechindi!', 'Prajala gonthu, mana gonthu!', 'Chalo RO Office!', 'Mana {town}, mana hakku!'],
    sloganVote: ['Vote is our right!', 'Andaru randi, vote veyyandi!', 'Booth ki chalo!'],
    join: ['Nenu kuda vasthunna!', 'Anna, mee tho unnam!', 'Selfie tarvatha, first nomination!', 'Jenda pattukunna!', 'Mana {town} pride!', 'Chalo chalo!'],
    cop: ['Section 144 sir! Gumpulu vaddu!', 'Ekkadiki velthunnaru? Permission undha?', 'Aagandi! Papers chupinchandi!', 'Station ki randi, oka chinna enquiry.', 'Road closed for "security reasons".'],
    copLifted: ['Ayyo, crowd ekkuva!', 'Sir, nannu dinchandi!', 'Control room, backup pampandi!'],
    copEscort: ['Ee gumpu ni aapandi, aa yellow vaallu mana guests!', 'Rallu padithe adi accident, mee gumpu ne illegal!', 'Law and order mee crowd valla ne kharaabu, sir!', 'Yellow vaallaki escort ivvandi, blue gumpu ki lathi!'],
    lathi: ['Chedaripondi!', 'Lathi charge!'],
    goon: ['{rival} area ee road, tirigipondi!', 'Form-A lo spelling mistake undi anna! 😏', 'Ee road ki toll undi, papers ivvandi!', 'Return ticket kavala? Ikkade free!', 'Papers jaagratta, ee roju gaali ekkuva!'],
    goonScared: ['Ammo, chala mandi unnaru!', 'Tarvatha kalustham, aagandi!'],
    mob: ['Aagandi! Ee veedhi {rival} di!', 'Yellow wave vastondi, tappukondi!', 'Ee roju {town} lo nomination ledu!', 'Rallu tayaaru, mee papers ekkada?', 'Mee jenda mee jebulo pettukondi!', '{rival} zindabad! Yellow wave!'],
    mobThrow: ['Idigo rayi!', 'Teesko, ee rayi {rival} nunchi!', 'Tala dinchuko, rayi vastondi!', 'Ee rayi mee papers kosam!'],
    mobScared: ['Ammo, entha mandi! Venakki!', 'Crowd ekkuva ayindi, venakki ra!', 'Tarvatha vastham, inka mandi tho!'],
    stoned: ['Ayyo, rayi! Tala tirigindi!', 'Rayi tagilindi! Papers jaagratta!', 'Eppudu vesaaru ee rayi!'],
    stonedCrowd: ['Rallu! Paripondi!', 'Ayyo, rallu padatayi, nenu velthunna!'],
    riot: ['A {rival} mob is out! Stones incoming, keep moving!', '{rival} mob nearby! Don\u2019t stand still!', 'Stone pelting ahead, {town}! Keep walking!'],
    mobRetreat: ['Your crowd drove the {rival} mob back! 💪', '{rival} mob backs off from the big crowd!'],
    scared: ['Ammo! Lathi!', 'Nenu intiki velthunna!', 'Tear gas! Paripondi!', 'Ivvala kaadu anna!'],
    shop: ['Ready ga undi sir. Sign here, here, and here.', 'Xerox 2 rupees, notary 200. Haha.', 'All the best anna!', 'Stamp padindi! Next!'],
    roMissing: ['Documents incomplete: {doc}. Next!', 'Where is your {doc}? Come back with it.'],
    boothMissing: ['Voter slip ledu? BLO tent lo teesukondi.'],
    torn: ['My Form-A! Chinchesaru! 😱', 'Papers torn! Fresh form kaavali!'],
    detained: ['Nenu candidate ni! Idi anyayam!', 'Arrest chesina, nomination aagadu!'],
    gas: ['Kallu mandutunnayi! 😵', '*cough cough*'],
    barricade: ['Andaru kalisi thoyyandi!', 'Barricade ni pakkaki jarapandi!'],
    filing: ['Stamp kotandi sir, time aipothundi!', 'Okka nimisham, sign chesthunna!'],
  };

  const MISSIONS = [
    { k: 'rec', txt: 'Recruit {n} supporters', n: [10, 20, 30], rew: 150 },
    { k: 'crowd', txt: 'Lead a crowd of {n}', n: [8, 15, 25], rew: 200 },
    { k: 'brk', txt: 'Break {n} barricade{s}', n: [1, 2], rew: 250 },
    { k: 'lift', txt: 'Let your crowd lift {n} cop{s}', n: [1, 3], rew: 200 },
    { k: 'doc', txt: 'Collect {n} document{s}', n: [2, 3], rew: 150 },
    { k: 'slogan', txt: 'Raise {n} slogans', n: [5, 10], rew: 100 },
    { k: 'goon', txt: 'Scare off {n} {rival} goon{s}', n: [1, 3], rew: 150 },
  ];

  const TIERS = ['', 'Josh!', 'Mass!', 'Mass Jathara!'];

  function fill(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (all, k) => {
      if (k === 'party') return PARTY.name;
      if (k === 'short') return PARTY.short;
      if (k === 'rival') return RIVAL.short;
      if (vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null) return String(vars[k]);
      return all;
    });
  }

  return { PARTY, RIVAL, TOWNS, DEFAULT_TOWN, MODES, LINES, MISSIONS, TIERS, fill };
});
