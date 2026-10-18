// The playable towns: identity and map-crop settings, shared by the game (Content) and the offline converter.
// `centre` is the middle of the 2 km square cut from the osm.org export; `anchor` is where the RO office is
// placed: the Old Collector Office in Kadapa, the town's centre point where no government office is mapped
// (Pulivendula, Punganur). Both are [lat, lon]. `skip` names mapped landmarks to leave out of the town file: Kadapa's
// 'police ground' is tagged amenity=police in OSM but is a parade ground, not a station. `ally` is the town's invented YSRCP
// local leader who waits at the party office; `leader` is the invented TDP leader who heads the largest mob. Both are made up.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Towns = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 2000; // metres: the side of the square cut from the export

  const TOWNS = {
    pulivendula: { id: 'pulivendula', town: 'Pulivendula', mandal: 'Pulivendula', district: 'Kadapa', ally: 'Ramanna', leader: 'Madhu Toogutla', centre: [14.4197, 78.2249], anchor: [14.42292, 78.22659], size: SIZE },
    kadapa: { id: 'kadapa', town: 'Kadapa', mandal: 'Kadapa', district: 'Kadapa', ally: 'Lakshmi Devi', leader: 'Chaitanya', centre: [14.4695, 78.824], anchor: [14.47717, 78.82241], size: SIZE, skip: ['police ground'] },
    punganur: { id: 'punganur', town: 'Punganur', mandal: 'Punganur', district: 'Chittoor', ally: 'Sivanna', leader: 'Bhupal', centre: [13.3695, 78.5712], anchor: [13.36405, 78.57305], size: SIZE },
  };
  const DEFAULT_TOWN = 'pulivendula';

  return { TOWNS, DEFAULT_TOWN, SIZE };
});
