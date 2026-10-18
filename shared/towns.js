// The playable towns: identity and map-crop settings, shared by the game (Content) and the offline converter.
// `centre` is the middle of the 2 km square cut from the osm.org export; `anchor` is where the RO office is
// placed (no government office is mapped in Pulivendula, so it is the town's centre point). Both are [lat, lon].
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Towns = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 2000; // metres: the side of the square cut from the export

  const TOWNS = {
    pulivendula: { id: 'pulivendula', town: 'Pulivendula', mandal: 'Pulivendula', district: 'Kadapa', centre: [14.4197, 78.2249], anchor: [14.42292, 78.22659], size: SIZE },
  };
  const DEFAULT_TOWN = 'pulivendula';

  return { TOWNS, DEFAULT_TOWN, SIZE };
});
