// Original game text. All parties, people and events are fictional.
// Placeholders: {town} {mandal} {district} {short} {party} {rival} {ally} {leader} {doc} {n} {s}
// {ally} and {leader} are the town's invented YSRCP ally and TDP leader (see Towns); fill(str, Content.TOWNS[id]) resolves them.
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
    ally: ['Nenu {ally}, {town} nunchi. Mee venta nadusthanu!', 'Bhayam endhuku? {ally} unnadu, {short} kutumbam mee venta!', 'Raa raa, mana {short} andaru kalisi velduam!'],
    allyJoined: ['🤝 {ally} of {town} joins your crowd with a band of supporters! Stones sting less and the counter wait is shorter.', '🤝 {ally} has brought supporters from the {short} office! Stones sting less and the counter wait is shorter.'],
    allyBack: ['🤝 {ally} is back in your crowd! Stones sting less and the counter wait is shorter again.'],
    allyLeft: ['😟 {ally} was scattered from your crowd! Stones sting in full again until you bring them back.', '😟 {ally} has left the crowd. Walk up to them again for the stone shield and the shorter counter wait.'],
    allyShield: ['Bhayapadakandi, ee rallu ni nenu aduthanu!', 'Nenu unna kada, mundhuki nadavandi!', '{ally} mee venta ne undi, tala dinchakandi!'],
    leader: ['{leader} ikkada undagane, {town} veedhulu {rival} vi!', 'Yellow jenda ki ee road, blue vaallaki detour!', 'Mee fan ki power cut! {leader} switch off chesaru!', 'Rallu ready ga unnayi, {leader} order ichaaru!'],
    riotLeader: ['{leader} leads a {rival} mob! Stones incoming, keep moving!', '{rival} leader {leader} and the mob are out! Don\u2019t stand still!', 'Stone pelting ahead, {town}! {leader} is at the head of the {rival} mob!'],
    riot: ['A {rival} mob is out! Stones incoming, keep moving!', '{rival} mob nearby! Don\u2019t stand still!', 'Stone pelting ahead, {town}! Keep walking!'],
    mobRetreat: ['Your crowd drove the {rival} mob back! 💪', '{rival} mob backs off from the big crowd!'],
    arson: ['Aa jenda unna illu ki nippu pettandi!', 'Ee veedhi lo {short} illu undadu, kaalchandi!', 'Vaalla vandi kuda kaalchesey, tirigi raadu!', 'Nippu ra, nippu! {rival} wave!'],
    fireHouse: ['🔥 A {rival} mob set a {short} supporter\u2019s house on fire! The streets around it are blocked.', '🔥 A supporter\u2019s house is burning! Find another way round.'],
    fireVehicle: ['🔥 A supporter\u2019s vehicle is burning! The street beside it is blocked.', '🔥 A parked vehicle is on fire! Keep clear of the smoke.'],
    fireScared: ['Ayyo, nippu! Paripondi!', 'Illu kaalipothundi, fire engine ni pilavandi!', 'Pogaa, pogaa! Venakki randi!'],
    fireCrowd: ['Mantalu! Venakki randi!', 'Nenu intiki velthunna, nippu!', 'Ee mantalu lo undalenu anna!'],
    scared: ['Ammo! Lathi!', 'Nenu intiki velthunna!', 'Tear gas! Paripondi!', 'Ivvala kaadu anna!'],
    shop: ['Ready ga undi sir. Sign here, here, and here.', 'Xerox 2 rupees, notary 200. Haha.', 'All the best anna!', 'Stamp padindi! Next!'],
    roMissing: ['Documents incomplete: {doc}. Next!', 'Where is your {doc}? Come back with it.'],
    boothMissing: ['Voter slip ledu? BLO tent lo teesukondi.'],
    torn: ['My Form-A! Chinchesaru! 😱', 'Papers torn! Fresh form kaavali!'],
    detained: ['Nenu candidate ni! Idi anyayam!', 'Arrest chesina, nomination aagadu!'],
    gas: ['Kallu mandutunnayi! 😵', '*cough cough*'],
    barricade: ['Andaru kalisi thoyyandi!', 'Barricade ni pakkaki jarapandi!'],
    filing: ['Stamp kotandi sir, time aipothundi!', 'Okka nimisham, sign chesthunna!'],
    scrutiny: ['📜 Filed! But the scrutiny has begun, and a {rival} mob is storming the RO Office!', '📜 The RO Office is being stormed by a {rival} mob. The scrutiny of {short} nominations begins!'],
    snatch: ['📄 Nomination {n} snatched off the RO\u2019s table!', '📄 A {short} nomination is grabbed from the counter! That is {n}.', '📄 Another one gone: {n} {short} nominations snatched!'],
    snatchShout: ['Idi teesuko! Ee papers lekapothe nomination ledu!', 'Ee kaagitham {town} ki kaadu, chinchandi!', 'Scrutiny ante idi, aa papers ivvandi!', 'Table meedha papers anni naavi, ra ra!'],
    tearShout: ['Chinchesaam! {leader} cheppina pani ayyindi!', 'Aaa, ayipoyindi! Migilina papers table meedha vadilesi vellandi!'],
    tear: ['✂️ {n} {short} nominations torn to pieces on the RO\u2019s table!', '✂️ The mob tore {n} nominations. The rest went to the stamp!'],
  };

  // The scrutiny result panel (client/scrutiny.js). `{n}` is the number from the result; the lines read, for example,
  // "10 YSRCP nominations filed", "6 snatched and torn", "4 accepted".
  const SCRUTINY = {
    title: '{town}: scrutiny at the RO Office',
    filed: '{n} {short} nominations filed',
    torn: '{n} snatched and torn',
    accepted: '{n} accepted',
    note: 'The counter is bare and the stamp is still warm. Only {n} papers are left of the day.',
    again: 'Play again ▶',
    close: 'Back to menu',
    disclaimer: 'Satire. All characters and the events shown are fictional; no real person is depicted.',
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

  return { PARTY, RIVAL, TOWNS, DEFAULT_TOWN, MODES, LINES, SCRUTINY, MISSIONS, TIERS, fill };
});
